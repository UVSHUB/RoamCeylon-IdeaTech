// apps/backend/src/modules/analytics/analytics.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an analytics event to the appropriate table.
   */
  async recordEvent(
    category: 'planner' | 'feedback' | 'system',
    eventType: string,
    userId?: string,
    metadata: Record<string, any> = {},
    eventId?: string,
    timestamp?: Date,
  ): Promise<void> {
    try {
      if (category === 'planner') {
        const data = {
          ...(eventId && { id: eventId }),
          ...(userId && { userId }),
          eventType,
          metadata,
          ...(timestamp && { timestamp }),
        };

        await this.prisma.plannerEvent.create({ data });
      } else if (category === 'feedback') {
        if (!userId) {
          throw new Error('Feedback events require userId');
        }

        // FeedbackEvent.id has no @default in schema, so it must always be supplied.
        const data = {
          id: eventId ?? randomUUID(),
          userId,
          eventType,
          metadata,
          ...(timestamp && { timestamp }),
        };

        await this.prisma.feedbackEvent.create({ data });
      } else {
        const data = {
          ...(eventId && { id: eventId }),
          ...(userId && { userId }),
          eventType,
          metadata,
          ...(timestamp && { timestamp }),
        };

        await this.prisma.systemMetric.create({ data });
      }
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'P2002'
      ) {
        // Ignore gracefully due to idempotency
        this.logger.debug(`[Analytics] Duplicate event ignored: ${eventId}`);
        return;
      }
      this.logger.error(
        `[Analytics] Failed to record ${category}/${eventType}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ============================================================
  // Aggregation Queries
  // ============================================================

  /**
   * GET /analytics/planner/daily
   */
  async getPlannerDailyStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [events, totalEvents, recentResponseEvents, stats] =
      await Promise.all([
        this.prisma.plannerEvent.groupBy({
          by: ['eventType'],
          _count: { id: true },
          where: { timestamp: { gte: startOfDay } },
        }),
        this.prisma.plannerEvent.count({
          where: { timestamp: { gte: startOfDay } },
        }),
        this.prisma.plannerEvent.findMany({
          where: { eventType: 'planner_generated' },
          select: { metadata: true },
          orderBy: { timestamp: 'desc' },
          take: 30,
        }),
        this.prisma.$queryRaw<Array<{ avg_val: string | number }>>`
        SELECT AVG(CAST(metadata->>'durationMs' AS numeric)) as avg_val
        FROM "PlannerEvent"
        WHERE "eventType" = 'planner_generated'
          AND "timestamp" >= ${startOfDay}
      `,
      ]);

    const statsVal = stats[0]?.avg_val;
    const avgResponseTimeMs = statsVal ? Math.round(Number(statsVal)) : 0;

    const recentResponseTimes = recentResponseEvents
      .map(
        (e) =>
          (e.metadata as Record<string, unknown>)?.durationMs as
            | number
            | undefined,
      )
      .filter((val): val is number => typeof val === 'number')
      .reverse();

    const last7Days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - i);
      const nextD = new Date(d);
      nextD.setDate(nextD.getDate() + 1);

      const count = await this.prisma.plannerEvent.count({
        where: {
          eventType: 'planner_generated',
          timestamp: { gte: d, lt: nextD },
        },
      });

      last7Days.push({
        date: d.toISOString().split('T')[0],
        count,
      });
    }

    return {
      date: startOfDay.toISOString().split('T')[0],
      totalEvents,
      avgResponseTimeMs,
      recentResponseTimes,
      last7Days,
      breakdown: events.map((e) => ({
        eventType: e.eventType,
        count: e._count.id,
      })),
    };
  }

  /**
   * GET /analytics/feedback/rate
   */
  async getFeedbackRate() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const last7DaysDate = new Date(
      startOfDay.getTime() - 6 * 24 * 60 * 60 * 1000,
    );

    const [totalFeedbacks, last7DaysEvents] = await Promise.all([
      this.prisma.plannerFeedback.count(),
      this.prisma.feedbackEvent.count({
        where: { timestamp: { gte: last7DaysDate } },
      }),
    ]);

    const avgPerDay = last7DaysEvents / 7;

    const ratingStats = await this.prisma.$queryRaw<
      Array<{ rating: string | number; count: string | number }>
    >`
      SELECT 
        CAST(metadata->>'rating' AS INTEGER) as rating,
        COUNT(*) as count
      FROM "FeedbackEvent"
      WHERE "eventType" = 'feedback_submitted'
        AND "timestamp" >= ${last7DaysDate}
        AND metadata->>'rating' IS NOT NULL
      GROUP BY CAST(metadata->>'rating' AS INTEGER)
    `;

    let submittedCount = 0;
    let positiveCount = 0;
    const ratingDistribution = [
      { rating: 1, count: 0 },
      { rating: 2, count: 0 },
      { rating: 3, count: 0 },
      { rating: 4, count: 0 },
      { rating: 5, count: 0 },
    ];

    for (const row of ratingStats) {
      const rowRating = row.rating;
      const rowCount = row.count;
      if (rowRating && !isNaN(Number(rowRating))) {
        const r = Math.min(5, Math.max(1, Math.round(Number(rowRating))));
        const c = Number(rowCount);
        ratingDistribution[r - 1].count += c;
        submittedCount += c;
        if (r >= 4) {
          positiveCount += c;
        }
      }
    }

    const positiveFeedbackPercentage =
      submittedCount > 0
        ? parseFloat(((positiveCount / submittedCount) * 100).toFixed(1))
        : 0;

    const trendStats = await this.prisma.$queryRaw<
      Array<{ day: string; count: string | number }>
    >`
      SELECT 
        TO_CHAR("timestamp", 'YYYY-MM-DD') as day,
        COUNT(*) as count
      FROM "FeedbackEvent"
      WHERE "eventType" = 'feedback_submitted'
        AND "timestamp" >= ${last7DaysDate}
      GROUP BY TO_CHAR("timestamp", 'YYYY-MM-DD')
    `;

    const trendMap = new Map(trendStats.map((t) => [t.day, Number(t.count)]));

    const last7Days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      last7Days.push({
        date: dateStr,
        count: trendMap.get(dateStr) || 0,
      });
    }

    return {
      totalFeedbacksAllTime: totalFeedbacks,
      last7DaysEvents,
      avgFeedbackEventsPerDay: parseFloat(avgPerDay.toFixed(2)),
      positiveFeedbackPercentage,
      ratingDistribution,
      last7Days,
    };
  }

  /**
   * GET /analytics/system/errors
   */
  async getSystemErrors() {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [errorCount, totalRequests, errors] = await Promise.all([
      this.prisma.systemMetric.count({
        where: { eventType: 'api_error', timestamp: { gte: last24h } },
      }),
      this.prisma.systemMetric.count({
        where: { timestamp: { gte: last24h } },
      }),
      this.prisma.systemMetric.findMany({
        where: { eventType: 'api_error', timestamp: { gte: last24h } },
        orderBy: { timestamp: 'desc' },
        take: 50,
        select: { id: true, eventType: true, metadata: true, timestamp: true },
      }),
    ]);

    const errorRate =
      totalRequests > 0
        ? parseFloat(((errorCount / totalRequests) * 100).toFixed(2))
        : 0;

    return {
      period: 'last_24h',
      totalRequests,
      errorCount,
      errorRate: `${errorRate}%`,
      recentErrors: errors,
    };
  }

  /**
   * GET /analytics/system/health
   */
  async getSystemHealth() {
    const last1h = new Date(Date.now() - 60 * 60 * 1000);

    const [stats, errorCount, totalRequests] = await Promise.all([
      this.prisma.$queryRaw<Array<{ avg_val: string | number }>>`
        SELECT AVG(CAST(metadata->>'responseTimeMs' AS numeric)) as avg_val
        FROM "SystemMetric"
        WHERE "timestamp" >= ${last1h}
      `,
      this.prisma.systemMetric.count({
        where: { eventType: 'api_error', timestamp: { gte: last1h } },
      }),
      this.prisma.systemMetric.count({
        where: { timestamp: { gte: last1h } },
      }),
    ]);

    const statsVal = stats[0]?.avg_val;
    const avgLatency = statsVal ? Math.round(Number(statsVal)) : 0;
    const errorRate =
      totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;
    const successRate = 100 - errorRate;

    return {
      status: errorRate > 5 ? 'degraded' : 'healthy',
      avgLatencyMs: avgLatency,
      errorRate: parseFloat(errorRate.toFixed(2)),
      successRate: parseFloat(successRate.toFixed(2)),
      totalRequestsLastHour: totalRequests,
    };
  }

  /**
   * GET /analytics/ai/performance
   * Exposes avg planner generation time, feedback influence rate,
   * and ranking adjustment % for dashboard consumption.
   * @param days - number of days to look back (default 7)
   */
  async getAIPerformanceMetrics(days: number = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // ── 1. GENERATION TIME ───────────────────────────────────────────────
    // Sourced from planner_generated events which store durationMs in metadata
    const [generationStats, totalRequests] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          avg_ms: string | number;
          min_ms: string | number;
          max_ms: string | number;
        }>
      >`
        SELECT
          AVG(CAST(metadata->>'durationMs' AS numeric))  AS avg_ms,
          MIN(CAST(metadata->>'durationMs' AS numeric))  AS min_ms,
          MAX(CAST(metadata->>'durationMs' AS numeric))  AS max_ms
        FROM "PlannerEvent"
        WHERE "eventType" = 'planner_generated'
          AND "timestamp"  >= ${since}
          AND metadata->>'durationMs' IS NOT NULL
      `,
      this.prisma.plannerEvent.count({
        where: {
          eventType: 'planner_generated',
          timestamp: { gte: since },
        },
      }),
    ]);

    const gs = generationStats[0];
    const avgMs = gs?.avg_ms ? Math.round(Number(gs.avg_ms)) : 0;
    const minMs = gs?.min_ms ? Math.round(Number(gs.min_ms)) : 0;
    const maxMs = gs?.max_ms ? Math.round(Number(gs.max_ms)) : 0;

    // ── 2. FEEDBACK & PREFERENCE INFLUENCE ──────────────────────────────
    // Sourced from ai_decision_factors events (logged per trip-plan session)
    const decisionEvents = await this.prisma.plannerEvent.findMany({
      where: {
        eventType: 'ai_decision_factors',
        timestamp: { gte: since },
      },
      select: { metadata: true },
    });

    let totalFeedbackPct = 0;
    let totalPreferencePct = 0;
    let totalTrustScore = 0;
    let sampledSessions = 0;

    for (const event of decisionEvents) {
      const meta = event.metadata as Record<string, unknown>;
      const summary = meta?.summary as Record<string, unknown> | undefined;
      if (!summary) continue;

      const fb = Number(summary['avgFeedbackInfluencePct'] ?? 0);
      const pref = Number(summary['avgPreferenceInfluencePct'] ?? 0);
      const trust = Number(summary['avgTrustScore'] ?? 0);

      if (
        Number.isFinite(fb) &&
        Number.isFinite(pref) &&
        Number.isFinite(trust)
      ) {
        totalFeedbackPct += fb;
        totalPreferencePct += pref;
        totalTrustScore += trust;
        sampledSessions++;
      }
    }

    const avgFeedbackInfluencePct =
      sampledSessions > 0
        ? parseFloat((totalFeedbackPct / sampledSessions).toFixed(2))
        : 0;
    const avgPreferenceInfluencePct =
      sampledSessions > 0
        ? parseFloat((totalPreferencePct / sampledSessions).toFixed(2))
        : 0;
    const avgTrustScore =
      sampledSessions > 0
        ? parseFloat((totalTrustScore / sampledSessions).toFixed(4))
        : 0;

    // ── 3. RANKING ADJUSTMENTS ───────────────────────────────────────────
    // Aggregate boost reasons + compute avg adjustment % across all activities
    let totalActivities = 0;
    let totalAdjustmentScore = 0;
    let totalFallbackSessions = 0;
    const reasonCounts: Record<string, number> = {};

    for (const event of decisionEvents) {
      const meta = event.metadata as Record<string, unknown>;

      // Track fallback sessions
      if (meta?.['usedFallback'] === true) totalFallbackSessions++;

      const activities = Array.isArray(meta?.['activities'])
        ? (meta['activities'] as Record<string, unknown>[])
        : [];

      for (const activity of activities) {
        totalActivities++;

        // Compute adjustment % for this activity:
        // (finalScore - baseScore) / baseScore * 100
        const base = Number(activity['baseScore'] ?? 0);
        const final = Number(activity['finalScore'] ?? 0);
        if (base > 0) {
          totalAdjustmentScore += Math.abs((final - base) / base) * 100;
        }

        // Aggregate boost reasons
        const adjustments = Array.isArray(activity['adjustments'])
          ? (activity['adjustments'] as string[])
          : [];

        for (const adj of adjustments) {
          // Normalise to reason prefix (strip the numeric +/- value)
          const key = adj.replace(/[:\s]+[+-]?[\d.]+\)?.*$/, '').trim();
          if (key) reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
        }
      }
    }

    const avgRankingAdjustmentPct =
      totalActivities > 0
        ? parseFloat((totalAdjustmentScore / totalActivities).toFixed(2))
        : 0;

    const fallbackRate =
      decisionEvents.length > 0
        ? parseFloat(
            ((totalFallbackSessions / decisionEvents.length) * 100).toFixed(2),
          )
        : 0;

    const topBoostReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    // ── 4. DAILY TREND (generation time + request count) ────────────────
    const trendStats = await this.prisma.$queryRaw<
      Array<{ day: string; avg_ms: string | number; requests: string | number }>
    >`
      SELECT
        TO_CHAR("timestamp", 'YYYY-MM-DD')                              AS day,
        AVG(CAST(metadata->>'durationMs' AS numeric))                   AS avg_ms,
        COUNT(*)                                                        AS requests
      FROM "PlannerEvent"
      WHERE "eventType" = 'planner_generated'
        AND "timestamp"  >= ${since}
        AND metadata->>'durationMs' IS NOT NULL
      GROUP BY TO_CHAR("timestamp", 'YYYY-MM-DD')
      ORDER BY day ASC
    `;

    const trend = trendStats.map((row) => ({
      date: row.day,
      avgMs: Math.round(Number(row.avg_ms)),
      requests: Number(row.requests),
    }));

    // ── 5. RESPONSE ──────────────────────────────────────────────────────
    return {
      period: `last_${days}_days`,
      generationTime: {
        avgMs,
        minMs,
        maxMs,
        totalRequests,
      },
      feedbackInfluence: {
        avgFeedbackInfluencePct,
        avgPreferenceInfluencePct,
        avgTrustScore,
        sampledFromSessions: sampledSessions,
      },
      rankingAdjustments: {
        avgRankingAdjustmentPct,
        totalActivitiesAnalysed: totalActivities,
        fallbackRate,
        topBoostReasons,
      },
      trend,
    };
  }
}
