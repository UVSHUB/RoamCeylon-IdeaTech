import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TrendMonitoringService {
  private readonly logger = new Logger(TrendMonitoringService.name);

  private readonly DEGRADATION_DROP_THRESHOLD = 15; // 15% drop over 7 days triggers warning
  private readonly MINIMUM_SAMPLE_SIZE = 5;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs automatically every week (Sunday at Midnight)
   * Tracks weekly positivity, planner stability, and detects slow degradation.
   */
  @Cron(CronExpression.EVERY_WEEK)
  async monitorWeeklyTrendsAndDrift() {
    this.logger.log('📊 Starting Automated Weekly Trend & Drift Monitor...');

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    try {
      // 1. Fetch Rolling Window Data
      const recentFeedback = await this.prisma.plannerFeedback.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
      });

      const pastFeedback = await this.prisma.plannerFeedback.findMany({
        where: { createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      });

      // 2. Calculate Positivity
      const recentPositivity = this.getPositivity(recentFeedback);
      const pastPositivity = this.getPositivity(pastFeedback);

      this.logger.log(
        `📅 Past 7-14 Days Positivity: ${pastPositivity.toFixed(1)}%`,
      );
      this.logger.log(
        `📅 Last 7 Days Positivity: ${recentPositivity.toFixed(1)}%`,
      );

      // 3. Detect Slow Degradation
      if (
        pastFeedback.length >= this.MINIMUM_SAMPLE_SIZE &&
        recentFeedback.length >= this.MINIMUM_SAMPLE_SIZE
      ) {
        const drop = pastPositivity - recentPositivity;

        if (drop >= this.DEGRADATION_DROP_THRESHOLD) {
          this.logger.warn(
            `❌ AI DEGRADATION DETECTED: Positivity dropped by ${drop.toFixed(1)}% (Threshold: ${this.DEGRADATION_DROP_THRESHOLD}%).`,
          );
        } else {
          this.logger.log(
            `✅ Feedback trend is stable. Positivity changed by ${drop > 0 ? '-' : '+'}${Math.abs(drop).toFixed(1)}%.`,
          );
        }
      } else {
        this.logger.log(
          `⚠️ Not enough data this week to confidently calculate degradation.`,
        );
      }

      // 4. Planner Success Stability Check
      const totalCategories = await this.prisma.userCategoryWeight.count();

      if (totalCategories === 0 && recentFeedback.length > 0) {
        this.logger.warn(
          '❌ STABILITY FLAG: Users are rating trips, but the AI is failing to save ranking weights.',
        );
      } else {
        this.logger.log(
          '✅ Planner ranking mechanics are actively updating and stable.',
        );
      }
    } catch (error) {
      this.logger.error('Failed to run automated trend monitoring', error);
    }
  }

  private getPositivity(feedbackList: { feedbackValue: unknown }[]): number {
    let positiveCount = 0;
    let totalValid = 0;

    feedbackList.forEach((f) => {
      const rating = this.extractRating(f.feedbackValue);
      if (typeof rating === 'number') {
        totalValid++;
        if (rating >= 4) positiveCount++;
      }
    });
    return totalValid === 0 ? 0 : (positiveCount / totalValid) * 100;
  }

  private extractRating(raw: unknown): number | undefined {
    if (typeof raw === 'number') return raw;
    if (raw && typeof raw === 'object' && 'rating' in raw) {
      const { rating } = raw as { rating: unknown };
      if (typeof rating === 'number') return rating;
    }
    return undefined;
  }
}
