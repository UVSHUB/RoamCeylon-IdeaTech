import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Aggregation result for feedback signals
 */
export interface FeedbackAggregation {
  totalFeedback: number;
  positiveCount: number; // rating >= 4
  negativeCount: number; // rating < 4
  averageRating: number;
  categoryBreakdown?: Record<
    string,
    { positive: number; negative: number; average: number }
  >;
  hasMinimumThreshold: boolean; // true if >= 3 ratings
}

/**
 * Destination-level aggregation
 */
export interface DestinationFeedback {
  destination: string;
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  averageRating: number;
  hasMinimumThreshold: boolean;
}

/**
 * Minimal shape of a raw feedback row returned by Prisma (untyped table).
 */
interface RawFeedbackRow {
  feedbackValue?: {
    rating?: unknown;
    categories?: Record<string, unknown>;
  };
}

/**
 * Minimal shape of a raw trip row returned by Prisma (untyped table).
 */
interface RawTripRow {
  id: string;
}

/**
 * Cast helper – gives us access to tables not yet in the generated Prisma
 * client without spreading `any` throughout the file.
 */
type PrismaAny = {
  plannerFeedback: {
    findMany(args?: unknown): Promise<RawFeedbackRow[]>;
  };
  savedTrip: {
    findMany(args?: unknown): Promise<RawTripRow[]>;
  };
};

/**
 * Service for aggregating feedback signals
 * Implements Day 46 Task 1: Feedback Aggregation Logic
 */
@Injectable()
export class PlannerAggregationService {
  private readonly logger = new Logger(PlannerAggregationService.name);
  private readonly CACHE_TTL = 60000; // 60 seconds
  private readonly POSITIVE_RATING_THRESHOLD = 4;
  private readonly MINIMUM_FEEDBACK_THRESHOLD = 3;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Aggregate feedback for a specific trip
   */
  async aggregateTripFeedback(tripId: string): Promise<FeedbackAggregation> {
    const cacheKey = `feedback_agg_trip_${tripId}`;
    const cached = await this.cacheManager.get<FeedbackAggregation>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit for trip feedback: ${tripId}`);
      return cached;
    }

    const startTime = Date.now();

    const feedbackList = await (
      this.prisma as unknown as PrismaAny
    ).plannerFeedback.findMany({
      where: { tripId },
    });

    const result = this.calculateAggregation(feedbackList);

    const queryDuration = Date.now() - startTime;
    if (queryDuration > 200) {
      this.logger.warn(
        `Slow aggregation query for trip ${tripId}: ${queryDuration}ms`,
      );
    }

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  /**
   * Aggregate feedback by destination
   */
  async aggregateByDestination(
    destination: string,
  ): Promise<DestinationFeedback> {
    const cacheKey = `feedback_agg_dest_${destination}`;
    const cached = await this.cacheManager.get<DestinationFeedback>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit for destination feedback: ${destination}`);
      return cached;
    }

    const startTime = Date.now();

    const prismaAny = this.prisma as unknown as PrismaAny;

    // Get all trips for this destination
    const trips = await prismaAny.savedTrip.findMany({
      where: { destination },
      select: { id: true },
    });

    const tripIds: string[] = trips.map((t) => t.id);

    // Get all feedback for these trips
    const feedbackList = await prismaAny.plannerFeedback.findMany({
      where: {
        tripId: { in: tripIds },
      },
    });

    const aggregation: FeedbackAggregation =
      this.calculateAggregation(feedbackList);

    const result: DestinationFeedback = {
      destination,
      totalFeedback: aggregation.totalFeedback,
      positiveCount: aggregation.positiveCount,
      negativeCount: aggregation.negativeCount,
      averageRating: aggregation.averageRating,
      hasMinimumThreshold: aggregation.hasMinimumThreshold,
    };

    const queryDuration = Date.now() - startTime;
    if (queryDuration > 200) {
      this.logger.warn(
        `Slow aggregation query for destination ${destination}: ${queryDuration}ms`,
      );
    }

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  /**
   * Aggregate feedback by category across all trips
   */
  async aggregateByCategory(category: string): Promise<FeedbackAggregation> {
    const cacheKey = `feedback_agg_cat_${category}`;
    const cached = await this.cacheManager.get<FeedbackAggregation>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit for category feedback: ${category}`);
      return cached;
    }

    const startTime = Date.now();

    // Get all feedback
    const allFeedback = await (
      this.prisma as unknown as PrismaAny
    ).plannerFeedback.findMany();

    // Filter feedback that has the specified category
    const categoryFeedback = allFeedback.filter((fb) => {
      const categories = fb.feedbackValue?.categories;
      return categories != null && category in categories;
    });

    const result: FeedbackAggregation =
      this.calculateAggregation(categoryFeedback);

    const queryDuration = Date.now() - startTime;
    if (queryDuration > 200) {
      this.logger.warn(
        `Slow aggregation query for category ${category}: ${queryDuration}ms`,
      );
    }

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  /**
   * Calculate aggregation from feedback list
   */
  private calculateAggregation(
    feedbackList: RawFeedbackRow[],
  ): FeedbackAggregation {
    const totalFeedback = feedbackList.length;

    if (totalFeedback === 0) {
      return {
        totalFeedback: 0,
        positiveCount: 0,
        negativeCount: 0,
        averageRating: 0,
        hasMinimumThreshold: false,
      };
    }

    let positiveCount = 0;
    let negativeCount = 0;
    let totalRating = 0;
    let ratingCount = 0;

    const categoryMap = new Map<string, { ratings: number[]; count: number }>();

    for (const feedback of feedbackList) {
      const rating = feedback.feedbackValue?.rating;

      if (typeof rating === 'number') {
        totalRating += rating;
        ratingCount++;

        if (rating >= this.POSITIVE_RATING_THRESHOLD) {
          positiveCount++;
        } else {
          negativeCount++;
        }

        // Process categories
        const categories = feedback.feedbackValue?.categories;
        if (categories != null && typeof categories === 'object') {
          for (const [catName, catValue] of Object.entries(categories)) {
            if (typeof catValue === 'number') {
              if (!categoryMap.has(catName)) {
                categoryMap.set(catName, { ratings: [], count: 0 });
              }
              const catData = categoryMap.get(catName)!;
              catData.ratings.push(catValue);
              catData.count++;
            }
          }
        }
      }
    }

    const averageRating = ratingCount > 0 ? totalRating / ratingCount : 0;

    // Calculate category breakdown
    const categoryBreakdown: Record<
      string,
      { positive: number; negative: number; average: number }
    > = {};

    for (const [catName, catData] of categoryMap.entries()) {
      const catPositive = catData.ratings.filter(
        (r) => r >= this.POSITIVE_RATING_THRESHOLD,
      ).length;
      const catNegative = catData.ratings.filter(
        (r) => r < this.POSITIVE_RATING_THRESHOLD,
      ).length;
      const catAverage =
        catData.ratings.reduce((sum, r) => sum + r, 0) / catData.ratings.length;

      categoryBreakdown[catName] = {
        positive: catPositive,
        negative: catNegative,
        average: catAverage,
      };
    }

    return {
      totalFeedback,
      positiveCount,
      negativeCount,
      averageRating,
      categoryBreakdown:
        Object.keys(categoryBreakdown).length > 0
          ? categoryBreakdown
          : undefined,
      hasMinimumThreshold: totalFeedback >= this.MINIMUM_FEEDBACK_THRESHOLD,
    };
  }

  /**
   * Invalidate cache for a specific trip
   */
  async invalidateCache(tripId: string, destination?: string): Promise<void> {
    await this.cacheManager.del(`feedback_agg_trip_${tripId}`);
    if (destination) {
      await this.cacheManager.del(`feedback_agg_dest_${destination}`);
    }
    this.logger.debug(`Invalidated feedback cache for trip ${tripId}`);
  }
}
