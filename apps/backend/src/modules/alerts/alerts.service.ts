import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async evaluateHealthRules() {
    this.logger.log('Running Scheduled Health Evaluation...');

    try {
      // 1. Fetch current metrics
      const health = await this.analyticsService.getSystemHealth();
      const feedback = await this.analyticsService.getFeedbackRate();

      // 2. Evaluate Rule: avg_response_time > 1200ms
      if (health.avgLatencyMs > 1200) {
        await this.triggerAlert(
          'high_latency',
          'warning',
          health.avgLatencyMs,
          1200,
        );
      } else {
        await this.resolveAlert('high_latency');
      }

      // 3. Evaluate Rule: error_rate > 3%
      if (health.errorRate > 3) {
        await this.triggerAlert(
          'high_error_rate',
          'critical',
          health.errorRate,
          3,
        );
      } else {
        await this.resolveAlert('high_error_rate');
      }

      // 4. Evaluate Rule: feedback_positive_rate < 50%
      // Only evaluate if there is recent feedback to avoid false positives on low volume
      if (
        feedback.last7DaysEvents > 0 &&
        feedback.positiveFeedbackPercentage < 50
      ) {
        await this.triggerAlert(
          'low_feedback_score',
          'warning',
          feedback.positiveFeedbackPercentage,
          50,
        );
      } else {
        await this.resolveAlert('low_feedback_score');
      }
    } catch (error) {
      this.logger.error(
        `Health evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async triggerAlert(
    type: string,
    severity: string,
    metricValue: number,
    threshold: number,
  ) {
    // Check if an unresolved alert of this type already exists
    const existing = await this.prisma.systemAlert.findFirst({
      where: {
        type,
        resolvedAt: null,
      },
    });

    if (existing) {
      // If it exists, we could optionally update the latest metric value,
      // but to prevent spam, we won't create a new row.
      this.logger.debug(`Alert ${type} is already active. Skipping creation.`);
      return;
    }

    // Insert new alert
    await this.prisma.systemAlert.create({
      data: {
        type,
        severity,
        metricValue,
        threshold,
      },
    });

    this.logger.warn(
      `🚨 ALERT TRIGGERED: [${severity.toUpperCase()}] ${type} (Value: ${metricValue}, Threshold: ${threshold})`,
    );
  }

  private async resolveAlert(type: string) {
    // Find all unresolved alerts of this type
    const activeAlerts = await this.prisma.systemAlert.findMany({
      where: {
        type,
        resolvedAt: null,
      },
    });

    if (activeAlerts.length === 0) return;

    // Mark them as resolved
    await this.prisma.systemAlert.updateMany({
      where: {
        type,
        resolvedAt: null,
      },
      data: {
        resolvedAt: new Date(),
      },
    });

    this.logger.log(`✅ Alert Resolved: ${type} is back to normal.`);
  }
}
