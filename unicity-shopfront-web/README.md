# Unicity Shopfront Agent

An autonomous shop agent on Unicity testnet2: browsable via Sphere DM,
discoverable via the Market intent board, sells on demand with a real
payment-request → fulfillment flow, and offers a live AI price check backed
by a deployed GenLayer contract.

**Live demo (frontend):** https://unicity-shopfront-agent-laz9-pi.vercel.app/
**Backend agent handle:** `@abbagigoo_shop`

## Submission details

- **Track:** Payments and markets (storefront + intent market + payment requests)
- **Agentic:** Yes-the backend runs unattended. It posts its own Market
  listings, replies to DM commands, issues payment requests, fulfills orders,
  and settles GenLayer appraisals with no human in the loop after startup.
- **Runs on AstridOS:** No-plain Node.js/TypeScript process.

## Architecture

Two parts:
1. **`src/agent.ts`**-the actual autonomous agent (Sphere SDK). This is
   what does real network work: registers a nametag, posts sell intents to
   the Market, listens for DMs, issues payment requests, and fulfills orders.
2. **`unicity-shopfront-web/`**-a Next.js frontend that displays the
   catalog and links out to the agent for purchases (see below for what's
   real vs. informational).

## How it works

1. **Catalog** (`catalog.json`) defines items: name, description, price
   (coin + smallest-unit amount + decimals), stock, and a delivery message.
2. **Market listings**-every in-stock item is posted as a `sell` intent
   (`sphere.market.postIntent`) on startup and re-posted every
   `REPOST_INTERVAL_HOURS` (intents expire after 7 days).
3. **DM storefront**-customers can:
   - `catalog`-list everything in stock
   - `quote <id>`-item detail + price (+ best-effort USD estimate)
   - `buy <id>`-triggers a real `sendPaymentRequest` for the exact price
4. **Fulfillment**-`sphere.payments.onPaymentRequestResponse` fires when
   the buyer pays; the shop decrements stock and DMs the delivery message.

## GenLayer integration—real, not simulated

The `appraisal-credit` catalog item and the frontend's "AI Price Check"
button both call a **deployed GenLayer contract**
(`0x87eE19C1D3a0B148E4D197Ed5a3B01163ff96609`, `check_price`/`get_result`
on Studionet) via `genlayer-js`:

- **Backend path**: buy `appraisal-credit` over DM, then reply with
  `<product name> | <category> | <condition> | <asking price>`-the shop
  calls `src/genlayer.ts`'s `requestAppraisal()`.
- **Frontend path**: the "AI Price Check" button calls
  `unicity-shopfront-web/app/api/appraise/route.ts`, a server-side Next.js
  API route that submits the same real write transaction and polls for the
  consensus verdict.

Both are real GenLayer write transactions-validator consensus takes
roughly 15-45 seconds, not instant. The frontend is rate-limited to one
request per visitor per 60 seconds since each call costs real testnet gas.

## Setup (backend agent)

Requires Node.js and a Unicity testnet2 setup.

```bash
cp .env.example .env
npm install
```

Fill in `.env`:
- `UNICITY_NETWORK=testnet2`—this project targets testnet2 specifically
- `UNICITY_API_KEY`-testnet2 gateway key (not a secret; see sphere-sdk's
  own `.env.example`)
- `SHOP_NAMETAG`-the `@handle` customers will find you at (must be unique
  on the network-registration fails if already taken)
- Leave `WALLET_MNEMONIC` blank on first run, then copy the printed
  mnemonic back in so the shop keeps its identity (and remaining stock)
  across restarts
- `GENLAYER_*`-only needed if you want the real appraisal flow to work
  (see GenLayer section above)

```bash
npm start
```

Once it logs `Shopfront ready. Waiting for DMs...`, from any other Sphere
wallet on testnet2, DM `@abbagigoo_shop`:

```
catalog
quote sticker-pack
buy sticker-pack
```

## Setup (frontend)

```bash
cd unicity-shopfront-web
npm install
npm run dev
```

For the AI Price Check button to work locally or in deployment, set the
same `GENLAYER_*` variables as server-side environment variables (never
exposed to the browser).

## Known limitations

- **In-memory stock** on the backend-resets to `catalog.json`'s values on
  restart. Fine for a demo, not for production.
- **Frontend catalog is a static snapshot** (`/catalog.json` bundled with
  the site), not live-synced with the running agent's actual stock.
- **One order per item per request**-no cart/multi-item checkout.
- **In-memory rate limiting** on the appraisal API route only holds within
  a single warm serverless instance, not a hard guarantee under real load.