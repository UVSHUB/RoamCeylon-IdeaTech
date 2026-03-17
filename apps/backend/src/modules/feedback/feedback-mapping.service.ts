// apps/backend/src/modules/feedback/feedback-mapping.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FeedbackMappingService {
  private readonly logger = new Logger(FeedbackMappingService.name);

  // CONTROLLED LEARNING CONSTANTS
  private readonly DECAY_LAMBDA = 0.02;
  private readonly PRIOR = 2;
  private readonly CATEGORY_DELTA = 0.1;
  private readonly CATEGORY_MIN = 0.5;
  private readonly CATEGORY_MAX = 2;
  private readonly MIN_FEEDBACK_FOR_CATEGORY_LEARNING = 3;

  constructor(private readonly prisma: PrismaService) {}

  async processFeedback(
    userId: string,
    rating: number,
    category?: string,
  ): Promise<void> {
    this.logger.log(
      `[LearningMetrics] Processing feedback: userId=${userId}, rating=${rating}, category=${category ?? 'none'}`,
    );

    await this.recalculateTrustScore(userId);

    if (category) {
      await this.updateCategoryWeight(userId, category, rating);
    }
  }

  // ==============================
  // TRUST SCORE (Decay + Bayesian)
  // ==============================

  private async recalculateTrustScore(userId: string): Promise<void> {
    const feedbacks = await this.prisma.plannerFeedback.findMany({
      where: { userId },
      select: { feedbackValue: true, createdAt: true },
    });

    if (feedbacks.length === 0) return;

    const now = new Date();

    let weightedPositive = 0;
    let weightedNegative = 0;

    // Raw counts for display in UserFeedbackSignal.
    // Recalculated from scratch each time to stay accurate
    // even when old feedback is edited (upsert replaces rating).
    // Ratings: 4-5 = positive, 1-2 = negative, 3 = neutral
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;

    for (const fb of feedbacks) {
      const rating = this.extractRating(fb.feedbackValue);
      if (!rating) continue;

      const daysOld =
        (now.getTime() - fb.createdAt.getTime()) / (1000 * 60 * 60 * 24);

      const decayWeight = Math.exp(-this.DECAY_LAMBDA * daysOld);

      if (rating >= 4) {
        weightedPositive += decayWeight;
        positiveCount++;
      } else if (rating <= 2) {
        weightedNegative += decayWeight;
        negativeCount++;
      } else {
        // rating === 3 → neutral
        neutralCount++;
      }
    }

    const trustScore =
      (weightedPositive + this.PRIOR) /
      (weightedPositive + weightedNegative + this.PRIOR * 2);

    const safeTrust = Math.max(0, Math.min(trustScore, 1));

    this.logger.log(
      `[LearningMetrics] TrustScore recalculated for ${userId}: ` +
        `positive=${positiveCount}, negative=${negativeCount}, neutral=${neutralCount}, ` +
        `trustScore=${safeTrust.toFixed(4)}`,
    );

    await this.prisma.userFeedbackSignal.upsert({
      where: { userId },
      create: {
        userId,
        trustScore: safeTrust,
        positiveCount,
        negativeCount,
        neutralCount,
      },
      update: {
        trustScore: safeTrust,
        positiveCount,
        negativeCount,
        neutralCount,
      },
    });
  }

  // ==============================
  // CATEGORY LEARNING (STRICT)
  // ==============================

  private async updateCategoryWeight(
    userId: string,
    category: string,
    rating: number,
  ) {
    const existing = await this.prisma.userCategoryWeight.findUnique({
      where: { userId_category: { userId, category } },
    });

    // If no record → initialize but DO NOT learn yet
    if (!existing) {
      await this.prisma.userCategoryWeight.create({
        data: {
          userId,
          category,
          weight: 1, // start neutral
          feedbackCount: 1,
        },
      });
      return;
    }

    const feedbackCount = existing.feedbackCount + 1;

    // Still below learning threshold → only count
    if (feedbackCount <= this.MIN_FEEDBACK_FOR_CATEGORY_LEARNING) {
      await this.prisma.userCategoryWeight.update({
        where: { userId_category: { userId, category } },
        data: { feedbackCount },
      });
      return;
    }

    // Learning starts only after threshold
    const delta =
      rating >= 4
        ? this.CATEGORY_DELTA
        : rating <= 2
          ? -this.CATEGORY_DELTA
          : 0;

    const newWeightRaw = existing.weight + delta;

    const newWeight = Math.max(
      this.CATEGORY_MIN,
      Math.min(newWeightRaw, this.CATEGORY_MAX),
    );

    await this.prisma.userCategoryWeight.update({
      where: { userId_category: { userId, category } },
      data: {
        weight: newWeight,
        feedbackCount,
      },
    });
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
