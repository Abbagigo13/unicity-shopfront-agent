import 'dotenv/config';
import { createInterface } from 'node:readline';
import { Sphere, getCoinIdBySymbol, parseTokenAmount, toHumanReadable } from '@unicitylabs/sphere-sdk';
import { createNodeProviders, FileStorageProvider } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';

const NETWORK = (process.env.UNICITY_NETWORK as 'testnet' | 'testnet2' | 'mainnet' | 'dev') || 'testnet';
const SHOP_HANDLE = process.env.SHOP_NAMETAG || 'my_shop';
const MINT_COIN = process.env.SETTLEMENT_COIN || 'UCT';
const MINT_AMOUNT = process.env.TESTBUYER_MINT_AMOUNT || '5';

async function main() {
  const baseProviders = createNodeProviders({
    network: NETWORK,
    dataDir: './wallet-data-testbuyer',
    tokensDir: './tokens-testbuyer',
    oracle: { apiKey: process.env.UNICITY_API_KEY },
  });

  const providers = createWalletApiProviders(baseProviders, {
    baseUrl: process.env.WALLET_API_BASE_URL || 'https://wallet-api.unicity.network',
    network: NETWORK,
    deviceId: process.env.WALLET_API_DEVICE_ID_BUYER || 'test-buyer-device',
  });

  const storage = new FileStorageProvider('./wallet-data-testbuyer');

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    storage,
    network: NETWORK,
    autoGenerate: true,
    mnemonic: process.env.TESTBUYER_MNEMONIC || undefined,
    nametag: process.env.TESTBUYER_NAMETAG || undefined,
  });

  if (created && generatedMnemonic) {
    console.log('New disposable test-buyer wallet created.');
    console.log('Save to TESTBUYER_MNEMONIC in .env to keep this identity across runs:');
    console.log(generatedMnemonic);
  }

  console.log('Test buyer live at:', sphere.identity?.directAddress, sphere.identity?.nametag ?? '(no nametag)');

  // -- Self-mint test tokens --------------------------------------------------
  const coinId = getCoinIdBySymbol(MINT_COIN);
  if (coinId) {
    const amount = parseTokenAmount(MINT_AMOUNT, 18);
    const mintResult = await sphere.payments.mintFungibleToken(coinId, amount);
    if (mintResult.success) {
      console.log(`Self-minted ${MINT_AMOUNT} ${MINT_COIN} (testnet only).`);
    } else {
      console.warn(`Mint skipped/failed (${mintResult.error}) — check existing balance.`);
    }
  } else {
    console.warn(`Coin symbol "${MINT_COIN}" not found in registry — skipping self-mint.`);
  }

  // -- Auto-pay incoming payment requests -------------------------------------
  sphere.payments.onPaymentRequest(async (request) => {
    console.log(`\n[Payment request] ${request.amount} ${request.symbol} — "${request.message}"`);
    try {
      const result = await sphere.payments.payPaymentRequest(request.id);
      if (result.status === 'failed') {
        console.log(`  -> failed to pay: ${result.error ?? '(no error message)'}`);
      } else {
        console.log(`  -> ${result.status}${result.deliveryPending ? ' (delivery pending)' : ''}`);
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.error('  -> payment threw:', (err as any)?.code ?? err);
    }
  });

  // -- Print incoming messages from shop -------------------------------------
  sphere.communications.onDirectMessage((msg) => {
    const from = msg.senderNametag ?? msg.senderPubkey;
    console.log(`\n[${from}]: ${msg.content}`);
  });

  console.log(`\nReady. Type a message and press Enter to send it to @${SHOP_HANDLE}.`);
  console.log('Try: balance | catalog | quote sticker-pack | buy sticker-pack\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const text = line.trim();
    if (text === 'balance') {
      const assets = await sphere.payments.getAssets();
      console.log(
        assets.map((a) => `${toHumanReadable(a.totalAmount, a.decimals)} ${a.symbol}`).join(', ') || '(empty)'
      );
    } else if (text) {
      await sphere.communications.sendDM(SHOP_HANDLE, text);
    }
    rl.prompt();
  });
}

main().catch((err) => {
  console.error('Test buyer crashed:', err);
  process.exit(1);
});