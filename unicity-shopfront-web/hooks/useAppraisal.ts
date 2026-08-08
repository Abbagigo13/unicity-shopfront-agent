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

export function useAppraisal() {
  const [state, setState] = useState<AppraisalState>({ phase: 'idle' });
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
      setState({ phase: 'submitting' });

      try {
        const submitRes = await fetch('/api/appraisal/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const submitData = await submitRes.json();

        if (!submitRes.ok) {
          setState({ phase: 'error', message: submitData.error ?? 'Submit failed.' });
          return;
        }

        const { txHash, ticketId, submittedAt } = submitData;

        const poll = async () => {
          const params = new URLSearchParams({ submittedAt: String(submittedAt) });
          if (ticketId) params.set('ticketId', ticketId);
          else params.set('txHash', txHash);

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
    setState({ phase: 'idle' });
  }, [stopPolling]);

  return { state, requestAppraisal, cancel: stopPolling, reset };
}