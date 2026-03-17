// apps/backend/src/modules/feedback/ranking.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FeedbackRankingService {
  private readonly logger = new Logger(FeedbackRankingService.name);

  // CONFIDENCE CONTROL
  private readonly CONFIDENCE_K = 10;

  // TRUST MULTIPLIER BOUNDS
  private readonly TRUST_MIN = 0.8;
  private readonly TRUST_RANGE = 0.4; // trust effect max ±20%

  // GLOBAL PERSONALIZATION CAP
  private readonly MAX_PERSONALIZATION_FACTOR = 1.5; // +50%
  private readonly MIN_PERSONALIZATION_FACTOR = 0.7; // -30%

  constructor(private readonly prisma: PrismaService) {}

  // ==================================================
  // PERSONALIZATION METRICS FOR EXPLANATIONS
  // ==================================================

  async getPersonalizationMetrics(userId: string, category: string) {
    const [userSignal, totalFeedback, userCategoryWeights] = await Promise.all([
      this.prisma.userFeedbackSignal.findUnique({
        where: { userId },
      }),
      this.prisma.plannerFeedback.count({
        where: { userId },
      }),
      this.prisma.userCategoryWeight.findUnique({
        where: {
          userId_category: { userId, category },
        },
      }),
    ]);

    const trustScore = userSignal?.trustScore ?? 0.5;

    // Confidence Scaling
    const confidence = totalFeedback / (totalFeedback + this.CONFIDENCE_K);

    const effectiveTrust = trustScore * confidence;

    // Bounded Trust Multiplier
    const trustMultiplier = this.TRUST_MIN + this.TRUST_RANGE * effectiveTrust;

    this.logger.log(
      `[LearningMetrics] Ranking Start: userId=${userId}, trustScore=${trustScore.toFixed(
        4,
      )}, confidence=${confidence.toFixed(
        4,
      )}, trustMultiplier=${trustMultiplier.toFixed(
        4,
      )}, totalFeedback=${totalFeedback}`,
    );

    const categoryMultiplier = userCategoryWeights?.weight ?? 1;

    return {
      trustScore,
      confidence,
      trustMultiplier,
      categoryMultiplier,
      feedbackCount: totalFeedback,
    };
  }

  // ==================================================
  // Rank Trips
  // ==================================================

  async rankTrips(
    userId: string,
    trips: { id: string; baseScore: number; category: string }[],
  ) {
    const metricsCache = new Map<string, any>();

    const rankedTrips = await Promise.all(
      trips.map(async (trip) => {
        if (!metricsCache.has(trip.category)) {
          metricsCache.set(
            trip.category,
            await this.getPersonalizationMetrics(userId, trip.category),
          );
        }

        const metrics = metricsCache.get(trip.category) as {
          categoryMultiplier: number;
          trustMultiplier: number;
        };

        const rawFactor = metrics.categoryMultiplier * metrics.trustMultiplier;

        const safeFactor = Math.max(
          this.MIN_PERSONALIZATION_FACTOR,
          Math.min(rawFactor, this.MAX_PERSONALIZATION_FACTOR),
        );

        const finalScore = trip.baseScore * safeFactor;

        return { ...trip, finalScore };
      }),
    );
    rankedTrips.sort((a, b) => b.finalScore - a.finalScore);

    return rankedTrips;
  }

  // ==================================================
  // Compute Score for Single Trip
  // ==================================================

  async computeTripScore(
    userId: string,
    baseScore: number,
    category: string,
  ): Promise<number> {
    const metrics = await this.getPersonalizationMetrics(userId, category);

    const rawFactor = metrics.categoryMultiplier * metrics.trustMultiplier;

    const safeFactor = Math.max(
      this.MIN_PERSONALIZATION_FACTOR,
      Math.min(rawFactor, this.MAX_PERSONALIZATION_FACTOR),
    );

    const finalScore = baseScore * safeFactor;

    const adjustmentMagnitude = Math.abs(finalScore - baseScore);

    this.logger.log(
      `[LearningMetrics] Score Computed: userId=${userId}, category=${category}, baseScore=${baseScore.toFixed(
        3,
      )}, trustMultiplier=${metrics.trustMultiplier.toFixed(
        4,
      )}, categoryMultiplier=${metrics.categoryMultiplier.toFixed(
        3,
      )}, rawFactor=${rawFactor.toFixed(3)}, safeFactor=${safeFactor.toFixed(
        3,
      )}, finalScore=${finalScore.toFixed(
        3,
      )}, adjustmentMagnitude=${adjustmentMagnitude.toFixed(3)}`,
    );

    return finalScore;
  }
}
