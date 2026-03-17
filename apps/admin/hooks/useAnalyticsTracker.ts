'use client';

import { useCallback, useRef } from 'react';

// ─── Event Catalogue ─────────────────────────────────────────────────────────
export type EngagementEventName =
  | 'trip_clicked'
  | 'destination_viewed'
  | 'planner_edit'
  | 'trip_accepted'
  | 'trip_rejected';

export interface EngagementEventPayload {
  tripId?: string;
  destinationId?: string;
  userId?: string;
  /** Any additional context that's useful as an ML signal */
  [key: string]: unknown;
}

// ─── Flush helpers ───────────────────────────────────────────────────────────
/**
 * Best-effort, fire-and-forget POST.
 * Errors are silently swallowed — tracking must NEVER break the UI.
 */
async function sendEvent(
  event: EngagementEventName,
  payload: EngagementEventPayload,
): Promise<void> {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  try {
    await fetch(`${API_BASE}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, timestamp: Date.now(), ...payload }),
      // Use keepalive so the request survives page navigations
      keepalive: true,
    });
  } catch {
    // Intentionally swallowed — tracking failures are non-fatal
  }
}

// ─── Batch queue ─────────────────────────────────────────────────────────────
interface QueuedEvent {
  event: EngagementEventName;
  payload: EngagementEventPayload;
}

const BATCH_DELAY_MS = 1000; // flush at most once per second

// ─── Hook ────────────────────────────────────────────────────────────────────
/**
 * useAnalyticsTracker
 *
 * Returns a stable `track` callback that:
 *  1. Enqueues the event into a 1-second batch buffer.
 *  2. Schedules the flush via requestIdleCallback (degrades to setTimeout).
 *  3. Never blocks the rendering thread.
 *  4. The flush itself is fire-and-forget; errors are silently discarded.
 *
 * @example
 *   const { track } = useAnalyticsTracker();
 *   // inside an onClick:
 *   track('trip_clicked', { tripId: trip.id });
 */
export function useAnalyticsTracker() {
  const queueRef = useRef<QueuedEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const batch = queueRef.current.splice(0);
    if (batch.length === 0) return;

    const schedule =
      typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? (cb: () => void) => (window as Window & typeof globalThis).requestIdleCallback(cb, { timeout: 3000 })
        : (cb: () => void) => setTimeout(cb, 0);

    schedule(() => {
      batch.forEach(({ event, payload }) => {
        // Each event is its own request — simple and debuggable
        void sendEvent(event, payload);
      });
    });
  }, []);

  const track = useCallback(
    (event: EngagementEventName, payload: EngagementEventPayload = {}) => {
      queueRef.current.push({ event, payload });

      // Debounce: reset the flush timer each time a new event arrives
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flush();
      }, BATCH_DELAY_MS);
    },
    [flush],
  );

  return { track };
}
