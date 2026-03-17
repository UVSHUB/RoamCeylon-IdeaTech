// apps/backend/src/modules/planner/planner.service.ts
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import {
  PlannerAggregationService,
  FeedbackAggregation,
  DestinationFeedback,
} from './planner-aggregation.service';
import { FeedbackMappingService } from '../feedback/feedback-mapping.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { randomUUID } from 'crypto';

export interface SavedTrip {
  id: string;
  userId: string;
  name: string | null;
  destination: string | null;
  startDate: Date | null;
  endDate: Date | null;
  itinerary: any;
  preferences?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlannerFeedbackEntry {
  id: string;
  userId: string;
  tripId: string;
  feedbackValue: number;
  createdAt: Date;
  plannerMeta?: any;
  versionNo?: number;
}

@Injectable()
export class PlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feedbackMappingService: FeedbackMappingService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly aggregationService: PlannerAggregationService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private normalizePreferences(
    prefs?: Record<string, any>,
  ): Record<string, any> {
    if (!prefs) {
      return {
        budget: 'medium',
        interests: [],
        travelStyle: 'relaxed',
        accessibility: false,
      };
    }

    // Validate and normalize preferences
    const normalized = {
      budget: prefs.budget || 'medium',
      interests: Array.isArray(prefs.interests) ? prefs.interests : [],
      travelStyle: prefs.travelStyle || 'relaxed',
      accessibility: !!prefs.accessibility,
    };

    // Validate interests array length
    if (normalized.interests.length > 20) {
      throw new BadRequestException(
        'Too many interests specified. Maximum is 20.',
      );
    }

    return normalized;
  }

  async saveTrip(userId: string, tripData: CreateTripDto): Promise<SavedTrip> {
    // Validation is now handled by class-validator decorators
    // Additional business logic validation can be added here

    const normalizedPrefs = this.normalizePreferences(tripData.preferences);

    // createdAt uses @default(now()), updatedAt uses @updatedAt — neither needs manual supply
    const result = await this.prisma.savedTrip.create({
      data: {
        id: randomUUID(),
        userId,
        name: tripData.name || 'My Trip',
        destination: tripData.destination || 'Sri Lanka',
        startDate: new Date(tripData.startDate),
        endDate: new Date(tripData.endDate),
        itinerary: tripData.itinerary as object,
        preferences: normalizedPrefs,
      },
    });

    // Validating & Storing User History (Day 40 Task)
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { preferences: normalizedPrefs },
      });
    } catch (e) {
      // Non-blocking error for user preference update
      console.warn('Failed to update user preferences history', e);
    }

    await this.cacheManager.del(`planner_history_${userId}`);

    // Fire Analytics Event: trip_saved
    this.analyticsService
      .recordEvent(
        'planner',
        'trip_saved',
        userId,
        {
          tripId: result.id,
          destination: result.destination,
        },
        `trip_save_${result.id}`,
        new Date(),
      )
      .catch((e) => console.error('Failed to record trip_saved event', e));

    return result as SavedTrip;
  }

  async getTrip(userId: string, tripId: string): Promise<SavedTrip | null> {
    const cacheKey = `trip_${tripId}`;
    const cachedTrip = await this.cacheManager.get<SavedTrip>(cacheKey);

    if (cachedTrip) {
      if (cachedTrip.userId !== userId) {
        throw new Error('Access denied');
      }
      return cachedTrip;
    }

    const trip = await this.prisma.savedTrip.findUnique({
      where: { id: tripId },
    });

    if (!trip || trip.userId !== userId) {
      return null;
    }

    await this.cacheManager.set(cacheKey, trip, 300000); // 5 minutes TTL
    return trip;
  }

  async getHistory(userId: string): Promise<SavedTrip[]> {
    const cacheKey = `planner_history_${userId}`;
    const cachedData = await this.cacheManager.get<SavedTrip[]>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const history = await this.prisma.savedTrip.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    await this.cacheManager.set(cacheKey, history, 300000); // 5 minutes
    return history;
  }

  async updateTrip(
    userId: string,
    tripId: string,
    data: UpdateTripDto,
  ): Promise<SavedTrip> {
    // Validation is now handled by class-validator decorators

    const trip = (await this.prisma.savedTrip.findUnique({
      where: {
        id: tripId,
      },
    })) as SavedTrip | null;

    if (!trip) {
      throw new BadRequestException(
        `Trip with ID ${tripId} not found. Please check the trip ID and try again.`,
      );
    }

    if (trip.userId !== userId) {
      throw new BadRequestException(
        'Access denied. You can only update your own trips.',
      );
    }

    // Invalidate caches
    await this.cacheManager.del(`planner_history_${userId}`);
    await this.cacheManager.del(`trip_${tripId}`);

    const normalizedPrefs = this.normalizePreferences(data.preferences);

    // updatedAt is handled automatically by @updatedAt
    const updatedTrip = (await this.prisma.savedTrip.update({
      where: {
        id: tripId,
      },
      data: {
        name: data.name,
        destination: data.destination,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        itinerary: data.itinerary as object,
        preferences: normalizedPrefs,
      },
    })) as SavedTrip;

    // Cache the updated trip immediately
    await this.cacheManager.set(`trip_${tripId}`, updatedTrip, 300000);

    return updatedTrip;
  }

  async deleteTrip(userId: string, tripId: string): Promise<SavedTrip> {
    const trip = await this.prisma.savedTrip.findUnique({
      where: {
        id: tripId,
      },
    });

    if (!trip) {
      throw new BadRequestException(
        `Trip with ID ${tripId} not found. Please check the trip ID and try again.`,
      );
    }

    if (trip.userId !== userId) {
      throw new BadRequestException(
        'Access denied. You can only delete your own trips.',
      );
    }

    // Invalidate caches
    await this.cacheManager.del(`planner_history_${userId}`);
    await this.cacheManager.del(`trip_${tripId}`);

    return await this.prisma.savedTrip.delete({
      where: { id: tripId },
    });
  }

  /**
   * Fetches title+content text from the embeddings table for a given destination.
   * This gives the richest signal for category inference since embeddings contain
   * real place descriptions seeded from the AI planner data.
   *
   * Example: destination="Ella" → finds rows where title/content contains "ella"
   * → returns "Ella Rock hiking trail panoramic views Nine Arch Bridge..."
   */
  private async fetchEmbeddingTextForDestination(
    destination: string,
  ): Promise<string> {
    if (!destination || destination.length < 2) return '';

    try {
      const dest = `%${destination.toLowerCase()}%`;
      const rows = await this.prisma.$queryRaw<
        Array<{ title: string | null; content: string | null }>
      >`
        SELECT title, content
        FROM embeddings
        WHERE LOWER(title) LIKE ${dest}
           OR LOWER(content) LIKE ${dest}
        LIMIT 10
      `;

      return rows
        .map((r) => `${r.title ?? ''} ${r.content ?? ''}`)
        .join(' ')
        .trim();
    } catch {
      // Non-blocking — if embeddings table is empty or query fails,
      // fall back to destination + itinerary text only
      return '';
    }
  }

  /**
   * Infers a valid ItineraryCategory from a destination name and optional
   * itinerary content using keyword scoring — no hardcoded place list needed.
   *
   * Strategy:
   * 1. Score each category by how many of its keywords appear in the text
   * 2. Return the highest scoring category
   * 3. Fall back to 'Sightseeing' if nothing matches
   *
   * This works for ANY destination worldwide, not just Sri Lanka.
   */
  private inferCategoryFromDestination(
    destination?: string,
    itineraryText?: string,
  ): string {
    if (!destination) return 'Sightseeing';

    // Combine destination + itinerary text for richer signal
    const text = `${destination} ${itineraryText ?? ''}`.toLowerCase();

    // Keyword → category scoring map
    // Each array contains keywords that strongly signal that category
    const CATEGORY_KEYWORDS: Record<string, string[]> = {
      Beach: [
        'beach',
        'surf',
        'coast',
        'bay',
        'shore',
        'sea',
        'ocean',
        'lagoon',
        'coral',
        'snorkel',
        'dive',
        'wave',
        'sand',
        'pier',
        'marina',
        'cove',
        'inlet',
        'swimming',
      ],
      Nature: [
        'forest',
        'jungle',
        'wildlife',
        'park',
        'reserve',
        'nature',
        'waterfall',
        'lake',
        'river',
        'mountain',
        'hill',
        'valley',
        'tea',
        'plantation',
        'botanical',
        'garden',
        'bird',
        'elephant',
        'leopard',
        'safari',
        'trail',
        'peak',
        'summit',
        'rock',
        'flora',
        'fauna',
        'eco',
        'national park',
      ],
      Adventure: [
        'adventure',
        'hike',
        'hiking',
        'trek',
        'trekking',
        'climb',
        'rafting',
        'kayak',
        'zipline',
        'rappel',
        'cycle',
        'cycling',
        'extreme',
        'sport',
        'camp',
        'camping',
        'expedition',
        'waterfall hike',
        'mountain bike',
      ],
      History: [
        'fort',
        'ruins',
        'ancient',
        'historical',
        'heritage',
        'temple',
        'kovil',
        'stupa',
        'dagoba',
        'palace',
        'kingdom',
        'dynasty',
        'archaeological',
        'monument',
        'citadel',
        'castle',
        'mosque',
        'colonial',
        'war',
        'battlefield',
        'museum',
        'relic',
      ],
      Culture: [
        'culture',
        'cultural',
        'festival',
        'art',
        'craft',
        'dance',
        'music',
        'ceremony',
        'ritual',
        'tradition',
        'local',
        'market',
        'bazaar',
        'food',
        'cuisine',
        'cooking',
        'city',
        'town',
        'urban',
        'gallery',
        'performance',
        'theatre',
      ],
      Relaxation: [
        'spa',
        'wellness',
        'resort',
        'relax',
        'retreat',
        'yoga',
        'meditation',
        'ayurveda',
        'massage',
        'luxury',
        'serene',
        'peaceful',
        'tranquil',
        'quiet',
        'calm',
        'slow',
      ],
      Sightseeing: [
        'viewpoint',
        'view',
        'scenic',
        'landmark',
        'attraction',
        'tourist',
        'sight',
        'visit',
        'explore',
        'tour',
        'panorama',
        'famous',
        'popular',
        'highlight',
        'must-see',
      ],
    };

    // Score each category
    const scores: Record<string, number> = {};

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      scores[category] = keywords.filter((kw) => text.includes(kw)).length;
    }

    // Find highest scoring category
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

    // Only use the match if at least 1 keyword was found
    if (best && best[1] > 0) {
      return best[0];
    }

    return 'Sightseeing';
  }

  async submitFeedback(
    userId: string,
    tripId: string,
    feedbackValue: number,
  ): Promise<any> {
    if (feedbackValue < 1 || feedbackValue > 5) {
      throw new BadRequestException('Feedback value must be between 1 and 5.');
    }

    const tripData = await this.prisma.savedTrip.findFirst({
      where: { id: tripId },
      select: { id: true, destination: true, itinerary: true, name: true },
    });

    if (!tripData) {
      throw new BadRequestException(`Trip with ID ${tripId} not found.`);
    }

    const feedback = await this.prisma.plannerFeedback.upsert({
      where: {
        unique_user_trip_feedback: {
          userId,
          tripId,
        },
      },
      update: { feedbackValue: { rating: feedbackValue } },
      create: { userId, tripId, feedbackValue: { rating: feedbackValue } },
    });

    // Infer category using 3 sources of text (richest signal first):
    // 1. Embeddings table: real place descriptions seeded from AI planner data
    // 2. SavedTrip.itinerary: the stops/activities stored with the trip
    // 3. SavedTrip.destination: the destination name itself (fallback)
    const embeddingText = await this.fetchEmbeddingTextForDestination(
      tripData.destination ?? '',
    );
    const itineraryText = JSON.stringify(tripData.itinerary ?? '');
    const category = this.inferCategoryFromDestination(
      tripData.destination ?? undefined,
      `${embeddingText} ${itineraryText}`,
    );

    await this.feedbackMappingService.processFeedback(
      userId,
      feedbackValue,
      category,
    );

    // Fire Analytics Event: feedback_submitted
    this.analyticsService
      .recordEvent(
        'feedback',
        'feedback_submitted',
        userId,
        {
          tripId,
          rating: feedbackValue,
        },
        `feedback_${userId}_${tripId}_${Date.now()}`,
        new Date(),
      )
      .catch((e) =>
        console.error('Failed to record feedback_submitted event', e),
      );

    return feedback;
  }

  /**
   * Get aggregated feedback for a specific trip
   */
  async getFeedbackAggregation(tripId: string): Promise<FeedbackAggregation> {
    return this.aggregationService.aggregateTripFeedback(tripId);
  }

  /**
   * Get aggregated feedback by destination
   */
  async getDestinationFeedback(
    destination: string,
  ): Promise<DestinationFeedback> {
    return this.aggregationService.aggregateByDestination(destination);
  }

  /**
   * Get aggregated feedback by category
   */
  async getCategoryFeedback(category: string): Promise<FeedbackAggregation> {
    return this.aggregationService.aggregateByCategory(category);
  }

  /**
   * Invalidate feedback cache when new feedback is submitted
   */
  async invalidateFeedbackCache(
    tripId: string,
    destination?: string,
  ): Promise<void> {
    await this.aggregationService.invalidateCache(tripId, destination);
  }

  async getFeedback(
    userId: string,
    tripId: string,
  ): Promise<PlannerFeedbackEntry[]> {
    const trip = await this.prisma.savedTrip.findUnique({
      where: { id: tripId },
    });
    if (!trip || trip.userId !== userId) {
      throw new BadRequestException('Access denied.');
    }

    const feedbackEntries = await this.prisma.plannerFeedback.findMany({
      where: { userId, tripId },
      orderBy: { createdAt: 'desc' },
    });

    // const latestVersion = await this.prisma.tripVersion.findFirst({
    //   where: { tripId },
    //   orderBy: { versionNo: 'desc' },
    // });

    return feedbackEntries.map((entry) => ({
      ...entry,
      id: entry.id.toString(),
      feedbackValue:
        entry.feedbackValue !== null ? Number(entry.feedbackValue) : 0,
      // plannerMeta: latestVersion?.aiMeta ?? null,
      // versionNo: latestVersion?.versionNo ?? null,
    }));
  }
}
