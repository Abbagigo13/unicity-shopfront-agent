import { useCallback, useRef, useState } from 'react';

type AppraisalInput = {
  productName: string;
  category: string;
  condition: string;
  sellerPrice: number;
};

type AppraisalResult = {
  ticketId: string;
  productName: string;
  verdict: string;
  marketLow: number;
  marketHigh: number;
  reason: string;
};

type AppraisalState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'polling'; elapsedMs: number; stage?: string }
  | { phase: 'complete'; result: AppraisalResult }
  | { phase: 'timeout'; elapsedMs: number }
  | { phase: 'error'; message: string };

const POLL_INTERVAL_MS = 4000;
const EXPLORER_BASE_URL = 'https://explorer-studio.genlayer.com/tx/';

export function useAppraisal() {
  const [state, setState] = useState<AppraisalState>({ phase: 'idle' });
  // Kept separate from AppraisalState on purpose — the tx hash is known
  // the moment submit succeeds and stays valid/clickable regardless of
  // whether polling later completes, times out, or errors. Tying it to
  // one specific phase would lose it exactly when it's most useful (e.g.
  // on 'timeout', so the user can still verify the real transaction).
  const [txHash, setTxHash] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const requestAppraisal = useCallback(
    async (input: AppraisalInput) => {
      stopPolling();
      setTxHash(null);
      setState({ phase: 'submitting' });

      try {
        const submitRes = await fetch('/api/appraisal/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const submitData = await submitRes.json();

        if (!submitRes.ok) {
          if (submitData.txHash) setTxHash(submitData.txHash);
          setState({ phase: 'error', message: submitData.error ?? 'Submit failed.' });
          return;
        }

        const { txHash: hash, ticketId, submittedAt } = submitData;
        setTxHash(hash);

        const poll = async () => {
          const params = new URLSearchParams({ submittedAt: String(submittedAt) });
          if (ticketId) params.set('ticketId', ticketId);
          else params.set('txHash', hash);

          const statusRes = await fetch(`/api/appraisal/status?${params.toString()}`);
          const statusData = await statusRes.json();

          if (!statusRes.ok) {
            setState({ phase: 'error', message: statusData.error ?? 'Status check failed.' });
            return;
          }

          if (statusData.status === 'complete') {
            setState({ phase: 'complete', result: statusData });
            return;
          }

          if (statusData.status === 'timeout') {
            setState({ phase: 'timeout', elapsedMs: statusData.elapsedMs ?? 0 });
            return;
          }

          // still pending — keep polling
          setState({
            phase: 'polling',
            elapsedMs: statusData.elapsedMs ?? 0,
            stage: statusData.stage,
          });
          pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
        };

        await poll();
      } catch (err) {
        setState({ phase: 'error', message: (err as Error).message ?? 'Unknown error' });
      }
    },
    [stopPolling]
  );

  const reset = useCallback(() => {
    stopPolling();
    setTxHash(null);
    setState({ phase: 'idle' });
  }, [stopPolling]);

  const explorerUrl = txHash ? `${EXPLORER_BASE_URL}${txHash}` : null;

  return { state, txHash, explorerUrl, requestAppraisal, cancel: stopPolling, reset };
}
