import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { Sphere, toHumanReadable, createPriceProvider } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';
import { requestAppraisal } from './genlayer.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const NETWORK = (process.env.UNICITY_NETWORK as 'testnet' | 'testnet2' | 'mainnet' | 'dev') || 'testnet';
const NAMETAG = process.env.SHOP_NAMETAG || 'my_shop';
const CATALOG_PATH = process.env.CATALOG_PATH || './catalog.json';
const ENABLE_FIAT_PRICE = (process.env.ENABLE_FIAT_PRICE ?? 'true') === 'true';
const REPOST_INTERVAL_MS = Number(process.env.REPOST_INTERVAL_HOURS || '24') * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
interface CatalogItem {
  id: string;
  name: string;
  description: string;
  coinId: string;
  amount: string; // smallest units, decimal string
  decimals: number;
  stock: number; // -1 = unlimited
  deliveryMessage: string;
}

function loadCatalog(): CatalogItem[] {
  const raw = readFileSync(CATALOG_PATH, 'utf-8');
  return JSON.parse(raw) as CatalogItem[];
}

let catalog: CatalogItem[] = loadCatalog();

function findItem(id: string): CatalogItem | undefined {
  return catalog.find((i) => i.id === id);
}

function formatPrice(item: CatalogItem): string {
  return `${toHumanReadable(item.amount, item.decimals)} ${item.coinId}`;
}

// Best-effort USD estimate. Only meaningful for coins CoinGecko actually
// lists (e.g. 'bitcoin', 'ethereum') — a testnet token like UCT/USDU has
// no listing and this will just come back empty, which is fine.
async function formatFiatEstimate(item: CatalogItem): Promise<string> {
  if (!ENABLE_FIAT_PRICE) return '';
  try {
    const provider = createPriceProvider({ platform: 'coingecko' });
    const price = await provider.getPrice(item.coinId.toLowerCase());
    if (!price || !price.priceUsd) return '';
    const qty = Number(toHumanReadable(item.amount, item.decimals));
    return ` (~$${(qty * price.priceUsd).toFixed(2)})`;
  } catch {
    return '';
  }
}

// Pending order: requestId -> { buyer, itemId }
const pendingOrders = new Map<string, { buyer: string; itemId: string }>();

// Buyers who've paid for an appraisal-credit item and now need to send
// their item details as a follow-up DM
const awaitingAppraisal = new Set<string>();
const APPRAISAL_ITEM_ID = 'appraisal-credit';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const baseProviders = createNodeProviders({
    network: NETWORK,
    dataDir: './wallet-data',
    tokensDir: './tokens',
    oracle: { apiKey: process.env.UNICITY_API_KEY },
  });

  // Payment requests (sendPaymentRequest / onPaymentRequestResponse) live on
  // the wallet-api port — createNodeProviders alone doesn't include it.
  const providers = createWalletApiProviders(baseProviders, {
    baseUrl: process.env.WALLET_API_BASE_URL || 'https://wallet-api.unicity.network',
    network: NETWORK,
    deviceId: process.env.WALLET_API_DEVICE_ID || 'shopfront-agent-device',
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: NETWORK,
    autoGenerate: true,
    mnemonic: process.env.WALLET_MNEMONIC || undefined,
    nametag: NAMETAG,
    market: true,
  });

  if (created && generatedMnemonic) {
    console.log('New wallet created. Save this mnemonic to WALLET_MNEMONIC in .env:');
    console.log(generatedMnemonic);
  }
  if (!sphere.market) throw new Error('Market module failed to initialize.');

  console.log('Shop live at:', sphere.identity?.directAddress, sphere.identity?.nametag);
  console.log(`Catalog: ${catalog.length} item(s) from ${CATALOG_PATH}`);

  // -- Post/refresh Market listings for every in-stock item ------------------
  async function postListings() {
    for (const item of catalog) {
      if (item.stock === 0) continue;
      try {
        await sphere.market!.postIntent({
          description: `${item.name} — ${item.description}`,
          intentType: 'sell',
          category: 'shop',
          price: Number(toHumanReadable(item.amount, item.decimals)),
          currency: item.coinId,
          contactHandle: sphere.identity?.nametag,
          expiresInDays: 7,
        });
      } catch (err) {
        console.error(`Failed to post listing for ${item.id}:`, err);
      }
    }
    console.log('Listings posted/refreshed.');
  }
  await postListings();
  const repostTimer = setInterval(() => postListings().catch(console.error), REPOST_INTERVAL_MS);

  // -- DM storefront: catalog / quote / buy -----------------------------------
  sphere.communications.onDirectMessage(async (msg) => {
    const from = msg.senderNametag ?? msg.senderPubkey;

    // Some relay/SDK setups echo the shop's own outgoing DMs back through
    // its own inbox subscription. Without this guard that creates an
    // infinite self-reply loop — confirmed happening in testing.
    if (msg.senderPubkey === sphere.identity?.publicKey || from === sphere.identity?.nametag) {
      return;
    }

    const text = msg.content.trim();
    console.log(`\n[DM received] from ${from}: "${text}"`);

    if (/^catalog$/i.test(text)) {
      if (catalog.length === 0) {
        await sphere.communications.sendDM(from, 'Catalog is empty right now.');
        return;
      }
      const lines = catalog
        .filter((i) => i.stock !== 0)
        .map((i) => `${i.id} — ${i.name} — ${formatPrice(i)}${i.stock > 0 ? ` (${i.stock} left)` : ''}`);
      try {
        const sent = await sphere.communications.sendDM(from, `Catalog:\n${lines.join('\n')}\n\nSend "quote <id>" or "buy <id>".`);
        console.log(`[DM sent] id=${sent.id} to ${from}`);
      } catch (err) {
        console.error(`[DM send FAILED] to ${from}:`, err);
      }
      return;
    }

    const quoteMatch = text.match(/^quote\s+(\S+)/i);
    if (quoteMatch) {
      const item = findItem(quoteMatch[1]);
      if (!item) {
        await sphere.communications.sendDM(from, `No item "${quoteMatch[1]}". Send "catalog" to see what's available.`);
        return;
      }
      const fiat = await formatFiatEstimate(item);
      await sphere.communications.sendDM(
        from,
        `${item.name}: ${item.description}\nPrice: ${formatPrice(item)}${fiat}\nSend "buy ${item.id}" to purchase.`
      );
      return;
    }

    const buyMatch = text.match(/^buy\s+(\S+)/i);
    if (buyMatch) {
      const item = findItem(buyMatch[1]);
      if (!item) {
        await sphere.communications.sendDM(from, `No item "${buyMatch[1]}".`);
        return;
      }
      if (item.stock === 0) {
        await sphere.communications.sendDM(from, `"${item.name}" is out of stock.`);
        return;
      }

      const result = await sphere.payments.sendPaymentRequest(from, {
        amount: item.amount,
        coinId: item.coinId,
        message: `Order: ${item.name}`,
      });

      if (result.success && result.requestId) {
        pendingOrders.set(result.requestId, { buyer: from, itemId: item.id });
        await sphere.communications.sendDM(from, `Payment request sent for "${item.name}" — accept it in your wallet to complete the order.`);
      } else {
        console.error('[sendPaymentRequest FAILED]', result);
        await sphere.communications.sendDM(from, `Couldn't create the order: ${result.error}`);
      }
      return;
    }

    if (awaitingAppraisal.has(from)) {
      const parts = text.split('|').map((s) => s.trim());
      const [productName, category, condition, sellerPriceStr] = parts;
      if (!productName || !category || !condition || !sellerPriceStr || isNaN(Number(sellerPriceStr))) {
        await sphere.communications.sendDM(from, 'Send it as: <product name> | <category> | <condition> | <your asking price (number)>');
        return;
      }
      await sphere.communications.sendDM(from, 'Appraising — this goes through validator consensus, give it a moment...');
      try {
        const result = await requestAppraisal(productName, category, condition, Number(sellerPriceStr));
        awaitingAppraisal.delete(from);
        await sphere.communications.sendDM(
          from,
          `Verdict on "${result.productName}": ${result.verdict}\nMarket range: ${result.marketLow}–${result.marketHigh}\nReason: ${result.reason}`
        );
      } catch (err) {
        console.error('Appraisal failed:', err);
        await sphere.communications.sendDM(from, `Appraisal failed — try again in a bit, or contact support. (${(err as Error).message})`);
      }
      return;
    }

    await sphere.communications.sendDM(from, 'Send "catalog" to browse, "quote <id>" for details, or "buy <id>" to purchase.');
  });

  // -- Fulfil orders once payment lands ---------------------------------------
  sphere.payments.onPaymentRequestResponse(async (response) => {
    const order = pendingOrders.get(response.requestId);
    if (!order) return;

    if (response.responseType === 'paid') {
      const item = findItem(order.itemId);
      if (item && item.stock > 0) item.stock -= 1;
      if (order.itemId === APPRAISAL_ITEM_ID) awaitingAppraisal.add(order.buyer);

      await sphere.communications.sendDM(order.buyer, item?.deliveryMessage ?? 'Payment received — thank you!');
      console.log(`Order fulfilled: ${order.itemId} -> ${order.buyer} (transfer ${response.transferId})`);
    } else {
      console.log(`Order declined: ${order.itemId} by ${order.buyer}`);
    }
    pendingOrders.delete(response.requestId);
  });

  console.log('Shopfront ready. Waiting for DMs...');

  process.on('SIGINT', () => {
    clearInterval(repostTimer);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Shop crashed:', err);
  process.exit(1);
});
