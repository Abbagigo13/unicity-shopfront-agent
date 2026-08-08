import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAccount } from 'genlayer-js';
import * as chains from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';
import type { Hash } from 'genlayer-js/types';

export const runtime = 'nodejs';

const CHAIN_NAME = process.env.GENLAYER_CHAIN || 'studionet';
const CONTRACT_ADDRESS = process.env.GENLAYER_CONTRACT_ADDRESS || '';
const PRIVATE_KEY = process.env.GENLAYER_PRIVATE_KEY || '';
const RESULT_METHOD = process.env.GENLAYER_RESULT_METHOD || 'get_result';

// Server-side ceiling on how long we consider a ticket "still worth
// polling". Comfortably covers slow multi-rotation consensus rounds
// without leaving the UI stuck spinning forever.
const MAX_WAIT_MS = Number(process.env.GENLAYER_MAX_WAIT_MS) || 8 * 60 * 1000; // 8 minutes

function getChain() {
  const chain = (chains as Record<string, unknown>)[CHAIN_NAME];
  if (!chain) throw new Error(`Unknown GENLAYER_CHAIN "${CHAIN_NAME}"`);
  return chain as never;
}

export async function GET(req: NextRequest) {
  if (!CONTRACT_ADDRESS || !PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Server not configured: missing GENLAYER_CONTRACT_ADDRESS or GENLAYER_PRIVATE_KEY.' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const txHash = searchParams.get('txHash');
  let ticketId = searchParams.get('ticketId');
  const submittedAtRaw = searchParams.get('submittedAt');
  const submittedAt = submittedAtRaw ? Number(submittedAtRaw) : null;

  if (!txHash && !ticketId) {
    return NextResponse.json({ error: 'Required: txHash or ticketId.' }, { status: 400 });
  }

  const elapsedMs = submittedAt ? Date.now() - submittedAt : null;
  const timedOut = elapsedMs !== null && elapsedMs > MAX_WAIT_MS;

  try {
    const account = createAccount(PRIVATE_KEY as `0x${string}`);
    const client = createClient({ chain: getChain(), account });

    // 1. If we don't have a ticketId yet, do one quick, single-shot check.
    // (Note: getTransaction and waitForTransactionReceipt both return the
    // same GenLayerTransaction shape — using waitForTransactionReceipt
    // here just lets us assert the ACCEPTED status in the same call.)
    if (!ticketId && txHash) {
      try {
        const receipt = await client.waitForTransactionReceipt({
          hash: txHash as unknown as Hash,
          status: TransactionStatus.ACCEPTED,
          interval: 500,
          retries: 1,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = receipt as any;
        // The actual scalar return value (ticket ID) lives here — NOT at
        // receipt.result (a numeric status code) or receipt.data (a
        // generic object, which was silently turning into the literal
        // string "[object Object]" once passed through a URL param).
        const extracted = r.consensus_data?.leader_receipt?.[0]?.result;
        if (extracted !== undefined && extracted !== null) {
          ticketId = String(extracted);
        }
      } catch {
        // Not yet ACCEPTED — normal, keep polling.
      }

      if (!ticketId) {
        return NextResponse.json({
          status: timedOut ? 'timeout' : 'pending',
          elapsedMs,
        });
      }
    }

    // 2. We have a ticket — check whether the contract has a verdict yet.
    // ticketId arrives here as a string (it round-tripped through a URL
    // query param), but get_result expects the numeric ticket ID — pass
    // it as a Number or the GenVM call fails with a type mismatch every
    // single time, regardless of whether the ticket is actually ready.
    const numericTicketId = Number(ticketId);
    const result = await client.readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: RESULT_METHOD,
      args: [numericTicketId],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;

    if (r?.verdict) {
      return NextResponse.json({
        status: 'complete',
        ticketId,
        productName: r.product_name,
        verdict: r.verdict,
        marketLow: r.market_low,
        marketHigh: r.market_high,
        reason: r.reason,
      });
    }

    return NextResponse.json({
      status: timedOut ? 'timeout' : 'pending',
      ticketId,
      elapsedMs,
    });
  } catch {
    // Ticket/result not resolvable yet — not a hard error, just not ready.
    return NextResponse.json({
      status: timedOut ? 'timeout' : 'pending',
      ticketId,
      elapsedMs,
    });
  }
}