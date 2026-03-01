import { Injectable, Logger } from '@nestjs/common';
import {
  PlannerAggregationService,
  FeedbackAggregation,
} from './planner-aggregation.service';

export interface ScoringComponent {
  name: string;
  value: number;
  reason: string;
}

/**
 * Result of the new modular scoring pipeline
 */
export interface RankingResult {
  baseScore: number;
  finalScore: number;
  components: ScoringComponent[];
  meetsThreshold: boolean; // inherited from feedback requirement
}

/**
 * Service for ranking with controlled weight adjustment
 * Implements Day 46 Task 2: Controlled Weight Adjustment
 */
@Injectable()
export class PlannerRankingService {
  private readonly logger = new Logger(PlannerRankingService.name);
  private readonly MINIMUM_RATING_THRESHOLD = 3;
  private readonly MAX_WEIGHT_ADJUSTMENT = 0.3;
  private readonly MIN_WEIGHT_ADJUSTMENT = -0.3;

  constructor(private readonly aggregationService: PlannerAggregationService) {}

  /**
   * Main pipeline resolver: Evaluates the modular scoring components
   * Base Score + Preference Weight + Feedback Influence + Context Bonus = Final Rank
   */
  async calculateTripScore(
    tripId: string,
    baseScore: number = 1.0,
    context?: { weekend?: boolean; userPreferences?: Record<string, number> },
  ): Promise<RankingResult> {
    const components: ScoringComponent[] = [];

    // 1. Base Score (already provided, just mapping it to component for tracing)
    components.push({
      name: 'Base Score',
      value: baseScore,
      reason: 'Initial baseline relevance',
    });

    // 2. Preference Scoring
    const prefScore = this.calculatePreferenceScore(context?.userPreferences);
    if (prefScore.value !== 0) components.push(prefScore);

    // 3. Feedback Scoring
    const feedbackScore = await this.calculateFeedbackScore(tripId);
    if (feedbackScore.value !== 0) components.push(feedbackScore);

    // 4. Context Scoring
    const contextScore = this.calculateContextScore(context);
    if (contextScore.value !== 0) components.push(contextScore);

    // Calculate Final Score
    let finalScore = components.reduce((sum, comp) => sum + comp.value, 0);
    // Clamp to prevent negative ranking
    finalScore = Math.max(0, finalScore);

    // Add Ranking Debug Logs for internal analysis
    this.logger.debug(`--- Ranking Debug Log for Trip [${tripId}] ---`);
    components.forEach((c) => {
      this.logger.debug(
        `[${c.name}]: ${c.value > 0 ? '+' : ''}${c.value.toFixed(3)} - ${c.reason}`,
      );
    });
    this.logger.debug(`=> Final Ranking Score: ${finalScore.toFixed(3)}`);
    this.logger.debug(`---------------------------------------------`);

    return {
      baseScore,
      finalScore: Number(finalScore.toFixed(3)),
      components,
      meetsThreshold: true, // simplified for pipeline trace
    };
  }

  /**
   * Component: Preference Score (Mocked / Optional evaluation)
   */
  private calculatePreferenceScore(
    userPreferences?: Record<string, number>,
  ): ScoringComponent {
    // If we had preferences mapping to destination/category, logic goes here.
    // For now, returning a static 0 or slight boost based on existence.
    const hasPrefs = userPreferences && Object.keys(userPreferences).length > 0;
    const value = hasPrefs ? 0.05 : 0;
    return {
      name: 'Preference Weight',
      value,
      reason: hasPrefs
        ? 'User has defined preferences boosting general engagement'
        : 'No strong preferences defined',
    };
  }

  /**
   * Component: Context Score (Seasonality / Timing)
   */
  private calculateContextScore(context?: {
    weekend?: boolean;
  }): ScoringComponent {
    const isWeekend = context?.weekend;
    const value = isWeekend ? 0.1 : 0;
    return {
      name: 'Context Bonus',
      value,
      reason: isWeekend
        ? 'Weekend context bonus applied'
        : 'Standard weekday context',
    };
  }

  /**
   * Component: Feedback Score
   */
  private async calculateFeedbackScore(
    tripId: string,
  ): Promise<ScoringComponent> {
    const aggregation =
      await this.aggregationService.aggregateTripFeedback(tripId);

    if (aggregation.totalFeedback < this.MINIMUM_RATING_THRESHOLD) {
      return {
        name: 'Feedback Influence',
        value: 0,
        reason: `Insufficient feedback (${aggregation.totalFeedback}/${this.MINIMUM_RATING_THRESHOLD} required)`,
      };
    }

    const totalWithRatings =
      aggregation.positiveCount + aggregation.negativeCount;
    const positiveRatio =
      totalWithRatings > 0 ? aggregation.positiveCount / totalWithRatings : 0.5;

    let feedbackWeight = (positiveRatio - 0.5) * 2 * this.MAX_WEIGHT_ADJUSTMENT;
    feedbackWeight = Math.max(
      this.MIN_WEIGHT_ADJUSTMENT,
      Math.min(this.MAX_WEIGHT_ADJUSTMENT, feedbackWeight),
    );

    const percentPositive = (positiveRatio * 100).toFixed(0);
    const sentiment =
      positiveRatio >= 0.7
        ? 'highly positive'
        : positiveRatio >= 0.5
          ? 'mostly positive'
          : positiveRatio >= 0.3
            ? 'mixed'
            : 'mostly negative';

    return {
      name: 'Feedback Influence',
      value: Number(feedbackWeight.toFixed(3)),
      reason: `${aggregation.totalFeedback} ratings (${percentPositive}% positive, avg ${aggregation.averageRating.toFixed(1)}/5) - ${sentiment}`,
    };
  }

  /**
   * Calculate weight adjustment for a trip (Legacy wrapper mapping to new pipeline)
   */
  async calculateTripWeight(
    tripId: string,
    baseScore: number = 1.0,
  ): Promise<RankingResult> {
    return this.calculateTripScore(tripId, baseScore);
  }

  /**
   * Calculate weight adjustment for a destination
   */
  async calculateDestinationWeight(
    destination: string,
    baseScore: number = 1.0,
  ): Promise<RankingResult> {
    const aggregation =
      await this.aggregationService.aggregateByDestination(destination);

    return this.createStandaloneFeedbackResult(
      baseScore,
      aggregation,
      'destination',
    );
  }

  /**
   * Calculate weight adjustment for a category
   */
  async calculateCategoryWeight(
    category: string,
    baseScore: number = 1.0,
  ): Promise<RankingResult> {
    const aggregation =
      await this.aggregationService.aggregateByCategory(category);

    return this.createStandaloneFeedbackResult(
      baseScore,
      aggregation,
      'category',
    );
  }

  /**
   * Helper to wrap legacy aggregation outputs into a Pipeline RankingResult array
   */
  private createStandaloneFeedbackResult(
    baseScore: number,
    aggregation: FeedbackAggregation,
    type: string,
  ): RankingResult {
    const components: ScoringComponent[] = [
      {
        name: 'Base Score',
        value: baseScore,
        reason: `Initial baseline relevance for ${type}`,
      },
    ];

    if (aggregation.totalFeedback < this.MINIMUM_RATING_THRESHOLD) {
      components.push({
        name: 'Feedback Influence',
        value: 0,
        reason: `Insufficient feedback (${aggregation.totalFeedback}/${this.MINIMUM_RATING_THRESHOLD} required)`,
      });
    } else {
      const totalWithRatings =
        aggregation.positiveCount + aggregation.negativeCount;
      const positiveRatio =
        totalWithRatings > 0
          ? aggregation.positiveCount / totalWithRatings
          : 0.5;

      let feedbackWeight =
        (positiveRatio - 0.5) * 2 * this.MAX_WEIGHT_ADJUSTMENT;
      feedbackWeight = Math.max(
        this.MIN_WEIGHT_ADJUSTMENT,
        Math.min(this.MAX_WEIGHT_ADJUSTMENT, feedbackWeight),
      );

      const percentPositive = (positiveRatio * 100).toFixed(0);
      components.push({
        name: 'Feedback Influence',
        value: Number(feedbackWeight.toFixed(3)),
        reason: `${aggregation.totalFeedback} ratings (${percentPositive}% positive, avg ${aggregation.averageRating.toFixed(1)}/5)`,
      });
    }

    let finalScore = components.reduce((sum, comp) => sum + comp.value, 0);
    finalScore = Math.max(0, finalScore);

    return {
      baseScore,
      finalScore: Number(finalScore.toFixed(3)),
      components,
      meetsThreshold:
        aggregation.totalFeedback >= this.MINIMUM_RATING_THRESHOLD,
    };
  }

  // ApplyWeightAdjustment and GenerateReason removed, fully replaced by modular pipeline methods.

  /**
   * Batch calculate weights for multiple trips
   * Useful for ranking multiple trip suggestions
   */
  async calculateBatchWeights(
    tripIds: string[],
    baseScore: number = 1.0,
  ): Promise<Map<string, RankingResult>> {
    const results = new Map<string, RankingResult>();

    // Use Promise.all for parallel processing
    const adjustments = await Promise.all(
      tripIds.map(async (tripId) => ({
        tripId,
        adjustment: await this.calculateTripWeight(tripId, baseScore),
      })),
    );

    for (const { tripId, adjustment } of adjustments) {
      results.set(tripId, adjustment);
    }

    return results;
  }

  /**
   * Sort trips by adjusted scores
   */
  async sortTripsByFeedback(
    trips: Array<{ id: string; baseScore?: number }>,
  ): Promise<Array<{ id: string; score: number; adjustment: RankingResult }>> {
    const scoredTrips = await Promise.all(
      trips.map(async (trip) => {
        const adjustment = await this.calculateTripWeight(
          trip.id,
          trip.baseScore || 1.0,
        );
        return {
          id: trip.id,
          score: adjustment.finalScore,
          adjustment,
        };
      }),
    );

    // Sort by adjusted score (descending)
    return scoredTrips.sort((a, b) => b.score - a.score);
  }
}
