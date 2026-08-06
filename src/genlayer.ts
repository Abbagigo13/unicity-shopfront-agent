import { createClient, createAccount } from 'genlayer-js';
import * as chains from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';

const CHAIN_NAME = process.env.GENLAYER_CHAIN || 'studionet';
const CONTRACT_ADDRESS = process.env.GENLAYER_CONTRACT_ADDRESS || '';
const PRIVATE_KEY = process.env.GENLAYER_PRIVATE_KEY || '';

// Confirmed via GenLayer Studio's Write/Read Methods panel for the
// deployed Smart Price Check contract.
const SUBMIT_METHOD = process.env.GENLAYER_SUBMIT_METHOD || 'check_price';
const RESULT_METHOD = process.env.GENLAYER_RESULT_METHOD || 'get_result';

const POLL_INTERVAL_MS = Number(process.env.GENLAYER_POLL_INTERVAL_MS || '3000');
const POLL_TIMEOUT_MS = Number(process.env.GENLAYER_POLL_TIMEOUT_MS || '60000');

function getChain() {
  const chain = (chains as Record<string, unknown>)[CHAIN_NAME];
  if (!chain) throw new Error(`Unknown GENLAYER_CHAIN "${CHAIN_NAME}"`);
  return chain as never;
}

export interface AppraisalResult {
  ticketId: string | number;
  productName: string;
  category: string;
  condition: string;
  sellerPrice: number;
  marketLow: number;
  marketHigh: number;
  verdict: string;
  reason: string;
  raw: unknown;
}

/**
 * Submits an item for appraisal via `check_price` (write — the contract's
 * LLM-backed logic runs and reaches validator consensus), then polls
 * `get_result` until the ticket resolves.
 *
 * Confirmed against the real deployed contract (0x87eE19C1...ff96609) in
 * GenLayer Studio's Write Methods panel — check_price takes exactly these
 * four positional args, in this order.
 */
export async function requestAppraisal(
  productName: string,
  category: string,
  condition: string,
  sellerPrice: number
): Promise<AppraisalResult> {
  if (!CONTRACT_ADDRESS) throw new Error('GENLAYER_CONTRACT_ADDRESS not set.');
  if (!PRIVATE_KEY) throw new Error('GENLAYER_PRIVATE_KEY not set — needed to sign the appraisal write tx.');

  const account = createAccount(PRIVATE_KEY as `0x${string}`);
  const client = createClient({ chain: getChain(), account });

  // 1. Submit the appraisal request (write — costs gas, needs consensus)
  const txHash = await client.writeContract({
    account,
    address: CONTRACT_ADDRESS,
    functionName: SUBMIT_METHOD,
    args: [productName, category, condition, sellerPrice],
  });

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
  });

  // check_price's next_id/history pattern strongly suggests it returns the
  // new ticket_id directly — but confirm against your actual receipt shape
  // the first time this runs (uncomment the log below).
  // console.log('receipt:', JSON.stringify(receipt, null, 2));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticketId = (receipt as any).result?.data ?? (receipt as any).data ?? (receipt as any).return_value;
  if (ticketId === undefined) {
    throw new Error('Could not extract ticket ID from receipt — inspect `receipt` shape and adjust.');
  }

  // 2. Poll get_result until the ticket has a verdict. The contract's
  // _record_to_dict always returns a full dict (no separate "pending"
  // state visible in the code we've seen) — if get_result throws for an
  // unresolved ticket_id, that's the more likely "not ready yet" signal,
  // so we retry on error too, not just on a missing field.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: RESULT_METHOD,
        args: [ticketId],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = result as any;
      if (r?.verdict) {
        return {
          ticketId,
          productName: r.product_name,
          category: r.category,
          condition: r.condition,
          sellerPrice: r.seller_price,
          marketLow: r.market_low,
          marketHigh: r.market_high,
          verdict: r.verdict,
          reason: r.reason,
          raw: result,
        };
      }
    } catch (err) {
      lastError = err; // likely means the ticket isn't finalized yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Appraisal ticket ${ticketId} did not resolve within ${POLL_TIMEOUT_MS}ms.` +
      (lastError ? ` Last error: ${(lastError as Error).message}` : '')
  );
}