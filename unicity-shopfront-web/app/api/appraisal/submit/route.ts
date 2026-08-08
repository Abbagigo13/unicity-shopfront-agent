import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAccount } from 'genlayer-js';
import * as chains from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';

// Must run on the Node.js runtime (not Edge) — genlayer-js needs Node APIs,
// and this uses a server-side private key that must never reach the client.
export const runtime = 'nodejs';

const CHAIN_NAME = process.env.GENLAYER_CHAIN || 'studionet';
const CONTRACT_ADDRESS = process.env.GENLAYER_CONTRACT_ADDRESS || '';
const PRIVATE_KEY = process.env.GENLAYER_PRIVATE_KEY || '';
const SUBMIT_METHOD = process.env.GENLAYER_SUBMIT_METHOD || 'check_price';

// We only wait for ACCEPTED here — it's a "decided" consensus state
// (isDecidedState() === true), meaning the verdict is already locked in.
// FINALIZED just marks that the appeal window has since passed; waiting
// for it here would needlessly hold this request open. Since ACCEPTED
// arrives much sooner, these can be modest.
// Just a quick opportunistic check — if ACCEPTED lands fast, great, the
// client gets the ticketId immediately. If not, no problem: the status
// route's own polling will pick up the ticket on a later call using the
// same extraction logic.
const ACCEPT_WAIT_INTERVAL_MS = Number(process.env.GENLAYER_ACCEPT_INTERVAL_MS || '1000');
const ACCEPT_WAIT_RETRIES = Number(process.env.GENLAYER_ACCEPT_RETRIES || '5'); // ~5s

// Basic per-IP cooldown. In-memory, so it only holds within a single warm
// serverless instance — good enough to stop casual button-mashing on a
// hackathon demo, not a substitute for real infra-level rate limiting.
const RATE_LIMIT_MS = Number(process.env.APPRAISAL_RATE_LIMIT_MS || '60000');
const lastRequestByIp = new Map<string, number>();

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function getChain() {
  const chain = (chains as Record<string, unknown>)[CHAIN_NAME];
  if (!chain) throw new Error(`Unknown GENLAYER_CHAIN "${CHAIN_NAME}"`);
  return chain as never;
}

export async function POST(req: NextRequest) {
  if (!CONTRACT_ADDRESS || !PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Server not configured: missing GENLAYER_CONTRACT_ADDRESS or GENLAYER_PRIVATE_KEY.' },
      { status: 500 }
    );
  }

  const ip = getClientIp(req);
  const lastRequest = lastRequestByIp.get(ip);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_MS) {
    const waitSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastRequest)) / 1000);
    return NextResponse.json(
      { error: `Rate limited — try again in ${waitSec}s. Real appraisals cost real gas, so we cap how often each visitor can trigger one.` },
      { status: 429 }
    );
  }
  lastRequestByIp.set(ip, Date.now());

  const body = await req.json().catch(() => null);
  const { productName, category, condition, sellerPrice } = body ?? {};
  if (!productName || !category || !condition || sellerPrice == null) {
    return NextResponse.json(
      { error: 'Required: productName, category, condition, sellerPrice.' },
      { status: 400 }
    );
  }

  try {
    const account = createAccount(PRIVATE_KEY as `0x${string}`);
    const client = createClient({ chain: getChain(), account });

    // 1. Submit — real write transaction, goes through validator consensus
    const txHash = await client.writeContract({
      account,
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: SUBMIT_METHOD,
      args: [productName, category, condition, Number(sellerPrice)],
      value: BigInt(0),
    });

    // 2. Wait only for ACCEPTED — the decided state, not the eventual
    // FINALIZED settlement. This is the part that used to block for
    // minutes; ACCEPTED typically lands in well under 30s.
    let ticketId: unknown;
    try {
      const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        interval: ACCEPT_WAIT_INTERVAL_MS,
        retries: ACCEPT_WAIT_RETRIES,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = receipt as any;
      // The actual scalar return value from the contract call (our ticket
      // ID) lives here — NOT at receipt.result (a numeric status code) or
      // receipt.data (a generic object), which were the wrong fields we
      // were guessing at before and which caused ticketId to end up as
      // the literal string "[object Object]" once serialized into a URL.
      ticketId = r.consensus_data?.leader_receipt?.[0]?.result;
    } catch {
      // Still hasn't reached ACCEPTED yet — not an error, just slow.
      // The client can keep polling /api/appraisal/status with the txHash
      // and the status route will pick up the ticket once it's available.
    }

    return NextResponse.json({
      txHash,
      ticketId: ticketId ?? null,
      submittedAt: Date.now(),
    });
  } catch (err) {
    console.error('Appraisal submit error:', err);
    return NextResponse.json({ error: (err as Error).message ?? 'Unknown error' }, { status: 500 });
  }
}