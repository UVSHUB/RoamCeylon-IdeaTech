// apps/backend/src/modules/analytics/analytics.controller.ts

import { Controller, Get, UseInterceptors } from '@nestjs/common';
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
}
