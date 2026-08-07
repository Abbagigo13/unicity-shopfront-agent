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
const RESULT_METHOD = process.env.GENLAYER_RESULT_METHOD || 'get_result';
const POLL_INTERVAL_MS = Number(process.env.GENLAYER_POLL_INTERVAL_MS || '3000');
const POLL_TIMEOUT_MS = Number(process.env.GENLAYER_POLL_TIMEOUT_MS || '45000');

// Basic per-IP cooldown. This is in-memory, so it only holds within a single
// warm serverless instance — good enough to stop casual button-mashing on a
// hackathon demo, not a substitute for real infra-level rate limiting (e.g.
// Upstash/Vercel KV) if this ever needs to hold up under real traffic.
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

    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: TransactionStatus.FINALIZED,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ticketId = (receipt as any).result?.data ?? (receipt as any).data ?? (receipt as any).return_value;
    if (ticketId === undefined) {
      return NextResponse.json({ error: 'Could not extract ticket ID from receipt.' }, { status: 502 });
    }

    // 2. Poll for the verdict
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const result = await client.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          functionName: RESULT_METHOD,
          args: [ticketId],
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = result as any;
        if (r?.verdict) {
          return NextResponse.json({
            ticketId,
            productName: r.product_name,
            verdict: r.verdict,
            marketLow: r.market_low,
            marketHigh: r.market_high,
            reason: r.reason,
          });
        }
      } catch {
        // ticket likely not finalized yet — keep polling
      }
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    }

    return NextResponse.json({ error: `Appraisal ticket ${ticketId} did not resolve in time.` }, { status: 504 });
  } catch (err) {
    console.error('Appraisal API error:', err);
    return NextResponse.json({ error: (err as Error).message ?? 'Unknown error' }, { status: 500 });
  }
}