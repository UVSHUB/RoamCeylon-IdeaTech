// apps/admin/lib/api.ts

// ─── Engagement Event Types (ML Training Signals) ─────────────────────────────
export type EngagementEventType =
  | 'trip_clicked'
  | 'destination_viewed'
  | 'planner_edit'
  | 'trip_accepted'
  | 'trip_rejected';

export interface EngagementEventCount {
  eventType: EngagementEventType;
  count: number;
}

export interface EngagementStatsResponse {
  totalEvents: number;
  breakdown: EngagementEventCount[];
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

export interface PlannerDailyMetric {
  eventType: string;
  count: number;
}

export interface PlannerDailyStatsResponse {
  date: string;
  totalEvents: number;
  avgResponseTimeMs: number;
  recentResponseTimes: number[];
  last7Days: {
    date: string;
    count: number;
  }[];
  breakdown: PlannerDailyMetric[];
}

export interface FeedbackRateMetric {
  submissionRate: number;
  positiveFeedbackPercentage: number;
  ratingDistribution: {
    rating: number;
    count: number;
  }[];
  last7Days: {
    date: string;
    count: number;
  }[];
}

export interface SystemErrorMetric {
  errorCount: number;
  totalRequests: number;
  errorRate: string | number;
}

export async function getPlannerDailyStats(): Promise<PlannerDailyStatsResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/analytics/planner/daily`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error('Failed to fetch planner stats');
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

export async function getFeedbackRate(): Promise<FeedbackRateMetric | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/analytics/feedback/rate`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error('Failed to fetch feedback rate');
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

export async function getSystemErrors(): Promise<SystemErrorMetric | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/analytics/system/errors`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error('Failed to fetch system errors');
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget engagement event tracker.
 * Safe to call from client components — never throws, never blocks.
 */
export function trackEngagementEvent(
  event: EngagementEventType,
  payload: Record<string, unknown> = {},
): void {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  // Intentionally NOT awaited
  fetch(`${API_BASE}/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, timestamp: Date.now(), ...payload }),
    keepalive: true,
  }).catch(() => {
    // Silently swallow — tracking must never surface errors to users
  });
}

/**
 * Fetches aggregate engagement event counts for the dashboard.
 * Returns null on any failure (graceful degradation).
 */
export async function getEngagementStats(): Promise<EngagementStatsResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/analytics/events/summary`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error('Failed to fetch engagement stats');
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}
