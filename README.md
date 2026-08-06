# Unicity Shopfront Agent

A catalog-driven shop bot: browsable via DM, discoverable via the Market,
sells on demand with an automatic payment request → fulfillment flow.

## How it works

1. **Catalog** (`catalog.json`) defines items: name, description, price
   (coin + smallest-unit amount + decimals), stock, and a delivery message.
2. **Market listings**-every in-stock item is posted as a `sell` intent
   (`sphere.market.postIntent`) on startup and re-posted every
   `REPOST_INTERVAL_HOURS` (intents expire after 7 days).
3. **DM storefront**-customers can:
   - `catalog`-list everything in stock
   - `quote <id>`-item detail + price (+ best-effort USD estimate)
   - `buy <id>`-triggers a payment request for the exact price
4. **Fulfillment**- `sphere.payments.onPaymentRequestResponse` fires when
   the buyer pays; the shop decrements stock and DMs the delivery message.

## Setup

```bash
cp .env.example .env
npm install
```

Edit `catalog.json` to list your actual items. Fill in `.env`:
- `UNICITY_API_KEY`-testnet2 key from sphere-sdk's `.env.example`
- `SHOP_NAMETAG`-the `@handle` customers will find you at
- Leave `WALLET_MNEMONIC` blank on first run, then copy the printed
  mnemonic back in so the shop keeps its identity (and remaining stock)
  across restarts

## Run

```bash
npm start
```

From another Sphere wallet, DM `@abbagigoo`: