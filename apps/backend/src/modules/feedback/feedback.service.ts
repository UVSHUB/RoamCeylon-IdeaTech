// apps/backend/src/modules/feedback/feedback.service.ts

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FeedbackMappingService } from './feedback-mapping.service';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);
  private readonly LEARNING_COOLDOWN_HOURS = 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly feedbackMappingService: FeedbackMappingService,
  ) {}

  async submitFeedback(
    userId: string,
    tripId: string,
    rating: number,
    category?: string,
  ) {
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Feedback rating must be between 1 and 5');
    }

    const existing = await this.prisma.plannerFeedback.findUnique({
      where: {
        unique_user_trip_feedback: {
          userId,
          tripId,
        },
      },
    });

    const now = new Date();
    let shouldTriggerLearning = false;

    if (!existing) {
      // First submission
      shouldTriggerLearning = true;

      this.logger.log(
        `[Learning] First feedback submitted: user=${userId}, trip=${tripId}`,
      );
    } else {
      const previousRating = this.extractRating(existing.feedbackValue);

      const hoursSinceLastUpdate =
        (now.getTime() - existing.updatedAt.getTime()) / (1000 * 60 * 60);

      const ratingChanged = previousRating !== rating;
      const cooldownPassed =
        hoursSinceLastUpdate >= this.LEARNING_COOLDOWN_HOURS;

      if (ratingChanged && cooldownPassed) {
        shouldTriggerLearning = true;

        this.logger.log(
          `[Learning] Edit accepted: user=${userId}, trip=${tripId}, prev=${previousRating}, new=${rating}`,
        );
      } else {
        this.logger.warn(
          `[AntiGaming] Learning blocked: user=${userId}, trip=${tripId}, ratingChanged=${ratingChanged}, cooldownPassed=${cooldownPassed}`,
        );
      }
    }

    // Always save latest rating
    await this.prisma.plannerFeedback.upsert({
      where: {
        unique_user_trip_feedback: {
          userId,
          tripId,
        },
      },
      create: {
        userId,
        tripId,
        feedbackValue: { rating },
      },
      update: {
        feedbackValue: { rating },
        // DO NOT touch createdAt
      },
    });

    if (shouldTriggerLearning) {
      await this.feedbackMappingService.processFeedback(
        userId,
        rating,
        category,
      );

      // NEW SPRINT 8 TASK: Trigger drift check asynchronously so it doesn't block the user's request
      this.checkSystemDriftWarning().catch((err) =>
        this.logger.error('Failed to run drift detection check', err),
      );
    }
  }

  // --- NEW SPRINT 8 TASK: AI Drift Early Detection ---
  private async checkSystemDriftWarning() {
    // Fetch all feedback to calculate the baseline
    const allFeedback = await this.prisma.plannerFeedback.findMany({
      select: { feedbackValue: true },
    });

    // We need a statistically significant amount of data before sounding the alarm
    const MINIMUM_FEEDBACK_COUNT = 50;
    const DRIFT_THRESHOLD_PERCENT = 70; // X%

    if (allFeedback.length < MINIMUM_FEEDBACK_COUNT) return;

    let positiveCount = 0;
    let validCount = 0;

    for (const item of allFeedback) {
      const rating = this.extractRating(item.feedbackValue);
      if (rating !== undefined) {
        validCount++;
        // We consider 4 and 5 star ratings as "Positive"
        if (rating >= 4) {
          positiveCount++;
        }
      }
    }

    if (validCount < MINIMUM_FEEDBACK_COUNT) return;

    const positivityRate = (positiveCount / validCount) * 100;

    if (positivityRate < DRIFT_THRESHOLD_PERCENT) {
      this.logger.warn(
        `🚨 AI DRIFT WARNING: System positivity has dropped to ${positivityRate.toFixed(1)}%! ` +
          `Only ${positiveCount} positive ratings out of ${validCount} total.`,
      );
    }
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
