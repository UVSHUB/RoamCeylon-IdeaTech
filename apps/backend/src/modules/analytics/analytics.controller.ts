// apps/backend/src/modules/analytics/analytics.controller.ts

import { Controller, Get, UseInterceptors, Query } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseInterceptors(CacheInterceptor)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /analytics/planner/daily
   * Returns planner event counts for today, grouped by event type.
   */
  @Get('planner/daily')
  @CacheTTL(60000) // 1 minute
  async getPlannerDailyStats() {
    return this.analyticsService.getPlannerDailyStats();
  }

  /**
   * GET /analytics/feedback/rate
   * Returns feedback submission rate and 7-day breakdown.
   */
  @Get('feedback/rate')
  @CacheTTL(60000) // 1 minute
  async getFeedbackRate() {
    return this.analyticsService.getFeedbackRate();
  }

  /**
   * GET /analytics/system/errors
   * Returns system error count and error rate for the last 24 hours.
   */
  @Get('system/errors')
  @CacheTTL(60000) // 1 minute
  async getSystemErrors() {
    return this.analyticsService.getSystemErrors();
  }

  /**
   * GET /analytics/system/health
   * Returns system health including latency and error rates.
   */
  @Get('system/health')
  @CacheTTL(60000) // 1 minute
  async getSystemHealth() {
    return this.analyticsService.getSystemHealth();
  }

  /**
   * GET /analytics/ai/performance
   * Exposes AI performance metrics for dashboard:
   *   - Avg planner generation time
   *   - Feedback influence rate
   *   - Ranking adjustment %
   *
   * @param days - look-back window in days (default: 7, max: 90)
   *
   * Example:
   *   GET /analytics/ai/performance
   *   GET /analytics/ai/performance?days=30
   */
  @Get('ai/performance')
  @CacheTTL(120000) // 2 minutes — slightly longer since AI metrics are less time-sensitive
  async getAIPerformance(@Query('days') days?: string) {
    const parsedDays = Number(days);
    const lookbackDays =
      Number.isInteger(parsedDays) && parsedDays > 0
        ? Math.min(parsedDays, 90)
        : 7;

    return this.analyticsService.getAIPerformanceMetrics(lookbackDays);
  }
}
