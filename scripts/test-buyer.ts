import 'dotenv/config';
import { createInterface } from 'node:readline';
import { Sphere, getCoinIdBySymbol, parseTokenAmount, toHumanReadable } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';

// ---------------------------------------------------------------------------
// Config — deliberately separate from the shop's .env values. This is a
// disposable test identity with no connection to any real wallet.
// ---------------------------------------------------------------------------
const NETWORK = (process.env.UNICITY_NETWORK as 'testnet' | 'testnet2' | 'mainnet' | 'dev') || 'testnet';
const SHOP_HANDLE = process.env.SHOP_NAMETAG || 'my_shop';
const MINT_COIN = process.env.SETTLEMENT_COIN || 'UCT';
const MINT_AMOUNT = process.env.TESTBUYER_MINT_AMOUNT || '5'; // whole units

async function main() {
  const baseProviders = createNodeProviders({
    network: NETWORK,
    dataDir: './wallet-data-testbuyer', // separate from the shop's own wallet-data
    tokensDir: './tokens-testbuyer',
    oracle: { apiKey: process.env.UNICITY_API_KEY },
  });

  const providers = createWalletApiProviders(baseProviders, {
    baseUrl: process.env.WALLET_API_BASE_URL || 'https://wallet-api.unicity.network',
    network: NETWORK,
    deviceId: process.env.WALLET_API_DEVICE_ID_BUYER || 'test-buyer-device',
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: NETWORK,
    autoGenerate: true,
    mnemonic: process.env.TESTBUYER_MNEMONIC || undefined,
    nametag: process.env.TESTBUYER_NAMETAG || undefined, // optional — fine to stay anonymous
  });

  if (created && generatedMnemonic) {
    console.log('New disposable test-buyer wallet created.');
    console.log('(Optional) save to TESTBUYER_MNEMONIC in .env to keep this identity across runs:');
    console.log(generatedMnemonic);
  }

  console.log('Test buyer live at:', sphere.identity?.directAddress, sphere.identity?.nametag ?? '(no nametag)');

  // -- Self-mint some test funds so there's something to spend --------------
  const coinId = getCoinIdBySymbol(MINT_COIN);
  if (coinId) {
    const amount = parseTokenAmount(MINT_AMOUNT, 18);
    const mintResult = await sphere.payments.mintFungibleToken(coinId, amount);
    if (mintResult.success) {
      console.log(`Self-minted ${MINT_AMOUNT} ${MINT_COIN} (testnet only, no faucet needed).`);
    } else {
      console.warn(`Mint failed (${mintResult.error}) — you may already have a balance, or check MINT_COIN.`);
    }
  } else {
    console.warn(`Coin symbol "${MINT_COIN}" not found in registry — skipping self-mint.`);
  }

  // -- Auto-pay any incoming payment request (this is the buyer side) -------
  sphere.payments.onPaymentRequest(async (request) => {
    console.log(`\n[Payment request] ${request.amount} ${request.symbol} — "${request.message}"`);
    try {
      const result = await sphere.payments.payPaymentRequest(request.id);
      if (result.status === 'failed') {
        console.log(`  -> failed to pay: ${result.error ?? '(no error message)'}`);
      } else {
        console.log(`  -> ${result.status}${result.deliveryPending ? ' (delivery pending, not a failure)' : ''}`);
      }
    } catch (err) {
      console.error('  -> payment threw:', (err as any)?.code ?? err);
    }
  });

  // -- Print whatever the shop sends back ------------------------------------
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