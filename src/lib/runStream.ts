'use client';

// Live workflow progress via SSE with polling fallback (spec §4, §11).
import { useEffect, useRef, useState } from 'react';

export interface RunEvent {
  id: string;
  node: string;
  level: string;
  message: string;
  data: Record<string, unknown> | null;
  at: string;
}

export interface RunStreamState {
  events: RunEvent[];
  status: string;
  stage: string | null;
  connected: boolean;
}

export function useRunStream(runId: string | null): RunStreamState {
  const [state, setState] = useState<RunStreamState>({ events: [], status: 'unknown', stage: null, connected: false });
  const lastIdRef = useRef<string>('');
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!runId) {
      void Promise.resolve().then(() => {
        if (!cancelledRef.current) setState({ events: [], status: 'unknown', stage: null, connected: false });
      });
      return;
    }

    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    cancelledRef.current = false;

    const merge = (incoming: RunEvent[], status: string, stage: string | null, connected: boolean) => {
      if (cancelled) return;
      setState((prev) => {
        const seen = new Set(prev.events.map((e) => e.id));
        const merged = [...prev.events, ...incoming.filter((e) => !seen.has(e.id) && e.id > (lastIdRef.current || ''))];
        merged.sort((a, b) => a.id.localeCompare(b.id));
        if (merged.length) lastIdRef.current = merged[merged.length - 1].id;
        return { events: merged, status, stage, connected };
      });
    };

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`/api/workflows/${runId}`, { cache: 'no-store' });
          if (!res.ok) return;
          const data = (await res.json()) as { run: { status: string; stage: string | null }; events: RunEvent[] };
          merge(data.events, data.run.status, data.run.stage, false);
        } catch {
          // keep polling silently
        }
      }, 2000);
    };

    try {
      es = new EventSource(`/api/workflows/${runId}/events`);
      es.addEventListener('open', () => setState((p) => ({ ...p, connected: true })));
      es.addEventListener('event', (e) => {
        const parsed = JSON.parse((e as MessageEvent).data) as RunEvent;
        merge([parsed], 'running', null, true);
      });
      es.addEventListener('status', (e) => {
        const parsed = JSON.parse((e as MessageEvent).data) as { status: string; stage: string | null };
        setState((p) => ({ ...p, status: parsed.status, stage: parsed.stage, connected: true }));
      });
      es.addEventListener('done', () => {
        es?.close();
        startPolling(); // final poll to capture trailing events
        setTimeout(() => {
          if (pollTimer) clearInterval(pollTimer);
        }, 4000);
      });
      es.onerror = () => {
        es?.close();
        es = null;
        startPolling();
      };
    } catch {
      startPolling();
    }

    // seed from REST immediately (covers refresh while awaiting approval)
    void (async () => {
      try {
        const res = await fetch(`/api/workflows/${runId}`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { run: { status: string; stage: string | null }; events: RunEvent[] };
          merge(data.events, data.run.status, data.run.stage, false);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
      cancelledRef.current = true;
      es?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [runId]);

  return state;
}
