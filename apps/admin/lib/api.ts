// apps/admin/lib/api.ts

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
