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
}
