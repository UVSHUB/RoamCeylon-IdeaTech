import {
  Controller,
  Get,
  Post,
  Query,
  Logger,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

import { AIService } from './ai.service';
import { EmbeddingItem } from './embeddings/embedding.service';
import { SearchService } from './retrieval/search.service';
import { preprocessQuery } from './embeddings/embedding.utils';
import { STOP_WORDS } from '../../constants/stop-words';
import {
  ALGORITHM_VERSION,
  LOCK_DATE,
  LOCK_STATUS,
  PLANNER_CONFIG,
} from './planner.constants';

import { TripStoreService, SavedTrip } from './trips/trip-store.service';
import { PlannerService } from '../planner/planner.service';
import { AnalyticsService } from '../analytics/analytics.service';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
  };
}

interface LogActivityDto {
  placeId: string;
  placeName: string;
  category: string;
  action: 'selected' | 'removed';
}

/* -------------------- TYPES -------------------- */

export interface SearchResultItem {
  rank: number;
  id: number | string;
  title: string;
  content: string;
  score: number;
  confidence?: 'High' | 'Medium' | 'Low';
  metadata?: unknown;
}

export interface SearchResponseDto {
  query: string;
  results: SearchResultItem[];
  message?: string;
}

export interface TripPlanRequestDto {
  destination: string;
  startDate: string;
  endDate: string;
  preferences?: string[];

  // Saved Trip Context integration
  useSavedContext?: boolean; // default true
  mode?: 'new' | 'refine'; // default 'refine'
  tripId?: string; // optional specific trip refinement
}

interface RankingDetails {
  baseScore: number;
  personalizationBoost: number;
  confidenceMultiplier: number;
  finalScore: number;
  adjustments: string[];
}

interface ScoredResult extends SearchResultItem {
  priorityScore: number;
  rankingDetails: RankingDetails;
  matchedPreferences: string[];
}

type ItineraryCategory =
  | 'Arrival'
  | 'Sightseeing'
  | 'Culture'
  | 'History'
  | 'Nature'
  | 'Beach'
  | 'Adventure'
  | 'Relaxation';

type ConfidenceLevel = 'High' | 'Medium' | 'Low';

type ServiceError = { message: string };

interface ExplanationContext {
  destination?: string;
  dayNumber: number;
  totalDays: number;
  activityIndex: number;
  activitiesInDay: number;
  preferences?: string[];
  novelty?: 'High' | 'Medium' | 'Low';
  isFallback?: boolean;
  timeSlot?: 'Morning' | 'Afternoon' | 'Evening';
}

interface RichExplanation {
  selectionReason: string;
  rankingFactors: {
    relevanceScore: number;
    confidenceLevel: string;
    categoryMatch?: boolean;
    preferenceMatch?: string[];
    novelty?: string;
  };
  whyThisPlace?: string[];
  whyThisDay?: string[];
  whyThisTimeSlot?: string[];
  tips?: string[];
  hasPositiveFeedback?: boolean;
}

interface ItineraryItemDto {
  order: number;
  placeName: string;
  shortDescription: string;
  category: ItineraryCategory;
  confidenceScore?: 'High' | 'Medium' | 'Low';
  explanation?: RichExplanation;
}

interface DayPlan {
  day: number;
  date: string; // YYYY-MM-DD
  theme: string;
  themeExplanation?: string;
  activities: EnhancedItineraryItemDto[];
  groupingReason?: string;
}

interface EnhancedItineraryItemDto extends ItineraryItemDto {
  dayNumber: number;
  timeSlot?: 'Morning' | 'Afternoon' | 'Evening';
  estimatedDuration?: string;
  priority: number;
  dayPlacementReason?: string;
}

interface TripPlanResponseDto {
  plan: {
    destination: string;
    dates: { start: string; end: string }; // YYYY-MM-DD
    totalDays: number;
    dayByDayPlan: DayPlan[];
    summary: {
      totalActivities: number;
      categoriesIncluded: ItineraryCategory[];
      preferencesMatched: string[];
      planConfidence: 'High' | 'Medium' | 'Low';
      usedFallback: boolean;
      tripId?: string;
      versionNo?: number;
      usedSavedContext?: boolean;
      sourceTripId?: string;

      feedback?: {
        previousRating: number | null;
        feedbackCount: number;
      } | null;
    };
  };
  message: string;
}

type FrequentPlace = { placeId: string; placeName: string };
type RecentSelection = { placeId: string; category: string };
type CategoryPref = { category: string; count: number };

/* -------------------- CONTROLLER -------------------- */

@Controller('ai')
@UseGuards(ThrottlerGuard)
export class AIController {
  private readonly logger = new Logger(AIController.name);

  private readonly CONFIDENCE_THRESHOLDS = PLANNER_CONFIG.CONFIDENCE;

  private readonly PREFERENCE_WEIGHTS = {
    TITLE_DIRECT_MATCH: 0.4,
    CONTENT_DIRECT_MATCH: 0.25,
    CATEGORY_MAPPED_MATCH: 0.15,
    MULTIPLE_MATCH_BONUS: 0.2,
  };

  private readonly FALLBACK_MESSAGES = {
    NO_HIGH_CONFIDENCE:
      'No high-confidence matches found. Showing best available results.',
    NO_MATCHES:
      'No relevant items found. Please try refining your search with different keywords.',
    LOW_QUALITY:
      'Search results have low confidence scores. Consider adding more specific details to your query.',
    PARTIAL_RESULTS:
      'Only partial results available. Some recommendations may not strongly match your preferences.',
    USED_FALLBACK_ITINERARY:
      'Not enough strong matches found. A basic fallback itinerary was generated. Add 1–2 preferences (e.g., "beach", "history") or nearby town names for better results.',
  };

  private readonly INTEREST_CATEGORY_MAP: Record<string, ItineraryCategory[]> =
    {
      nature: ['Nature'],
      history: ['History', 'Culture', 'Sightseeing'],
      culture: ['Culture', 'History', 'Sightseeing'],
      adventure: ['Adventure', 'Nature'],
      beach: ['Beach', 'Relaxation'],
      beaches: ['Beach', 'Relaxation'],
      relaxation: ['Relaxation', 'Beach'],
      sightseeing: ['Sightseeing', 'Culture', 'History'],
      food: ['Culture', 'Relaxation'],
      shopping: ['Sightseeing', 'Culture'],
      nightlife: ['Sightseeing', 'Relaxation'],

      arrival: ['Arrival'],
      sightseeing_day: ['Sightseeing'],
      culture_day: ['Culture'],
      history_day: ['History'],
      nature_day: ['Nature'],
      beach_day: ['Beach'],
      relaxation_day: ['Relaxation'],
      adventure_day: ['Adventure'],
    };

  /* --------------------------------------------------
      ENERGY MODEL (Deterministic)
  -------------------------------------------------- */
  private readonly CATEGORY_ENERGY_SCORE: Record<string, number> = {
    adventure: 3,
    nature: 3,
    sightseeing: 2,
    culture: 2,
    history: 2,
    shopping: 2,
    nightlife: 2,
    beach: 1,
    relaxation: 1,
    food: 1,
  };

  private readonly LOCATION_REGION_HINTS: Record<string, string[]> = {
    galle: [
      'galle',
      'galle fort',
      'unawatuna',
      'hikkaduwa',
      'mirissa',
      'weligama',
      'bentota',
    ],
    colombo: ['colombo', 'negombo', 'mount lavinia'],
    kandy: ['kandy', 'peradeniya'],
    sigiriya: ['sigiriya', 'dambulla', 'polonnaruwa'],
    nuwaraeliya: ['nuwara eliya', 'ella', 'haputale'],
    yala: ['yala', 'tissamaharama', 'kirinda'],
    trincomalee: ['trincomalee', 'nilaveli', 'uppuveli'],
  };

  private readonly collator = new Intl.Collator('en', {
    numeric: true,
    sensitivity: 'base',
  });

  private readonly EPS = 1e-6;

  /* ==================== DATE FIX HELPERS ==================== */

  // Convert any input date string into YYYY-MM-DD using LOCAL calendar day.
  private toDateOnly(input: unknown): string {
    if (typeof input !== 'string') return '';
    const s = input.trim();
    if (!s) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Parse date-only into LOCAL Date at noon to avoid TZ edge shifts.
  private parseLocalDate(input: unknown): Date {
    const dateOnly = this.toDateOnly(input);
    if (!dateOnly) return new Date();
    const [y, m, d] = dateOnly.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  // Format Date as YYYY-MM-DD using LOCAL fields.
  private formatLocalDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Add days in local time safely.
  private addDaysLocal(base: Date, addDays: number): Date {
    const d = new Date(base);
    d.setDate(d.getDate() + addDays);
    return d;
  }

  /* ==================== DETERMINISM HELPERS ==================== */

  private stableId(a: unknown): string {
    if (typeof a === 'string') return a;
    if (typeof a === 'number') return Number.isFinite(a) ? String(a) : '';
    if (typeof a === 'bigint') return a.toString();
    if (typeof a === 'boolean') return a ? 'true' : 'false';
    return '';
  }

  private q(
    n: number,
    decimals: number = PLANNER_CONFIG.CONSISTENCY.SCORE_PRECISION,
  ): number {
    if (!Number.isFinite(n)) return 0;
    const p = Math.pow(10, decimals);
    return Math.round(n * p) / p;
  }

  private isServiceError(v: unknown): v is ServiceError {
    return (
      typeof v === 'object' &&
      v !== null &&
      'message' in v &&
      typeof (v as { message: unknown }).message === 'string'
    );
  }

  private normalizeConfidence(
    minConfidence?: string,
  ): 'High' | 'Medium' | 'Low' {
    return minConfidence === 'High' ||
      minConfidence === 'Medium' ||
      minConfidence === 'Low'
      ? minConfidence
      : 'Medium';
  }

  private safeString(v: unknown): string | null {
    return typeof v === 'string' && v.trim().length ? v : null;
  }

  private asFrequentPlaces(raw: unknown): FrequentPlace[] {
    if (!Array.isArray(raw)) return [];
    const out: FrequentPlace[] = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const placeId = this.safeString((item as { placeId?: unknown }).placeId);
      const placeName = this.safeString(
        (item as { placeName?: unknown }).placeName,
      );
      if (placeId && placeName) out.push({ placeId, placeName });
    }

    // deterministic ordering
    return out.sort((a, b) => this.collator.compare(a.placeId, b.placeId));
  }

  private asRecentSelections(raw: unknown): RecentSelection[] {
    if (!Array.isArray(raw)) return [];
    const out: RecentSelection[] = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const placeId = this.safeString((item as { placeId?: unknown }).placeId);
      const category = this.safeString(
        (item as { category?: unknown }).category,
      );
      if (placeId && category) out.push({ placeId, category });
    }

    // deterministic ordering
    return out.sort(
      (a, b) =>
        this.collator.compare(a.placeId, b.placeId) ||
        this.collator.compare(a.category, b.category),
    );
  }

  private asCategoryPrefs(raw: unknown): CategoryPref[] {
    if (!Array.isArray(raw)) return [];
    const out: CategoryPref[] = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const category = this.safeString(
        (item as { category?: unknown }).category,
      );
      const countRaw = (item as { count?: unknown }).count;
      const count =
        typeof countRaw === 'number' && Number.isFinite(countRaw)
          ? countRaw
          : 0;
      if (category) out.push({ category, count });
    }

    // deterministic ordering
    return out.sort(
      (a, b) =>
        this.collator.compare(a.category, b.category) || b.count - a.count,
    );
  }

  // Prevent one preference from dominating scoring
  private capByBaseQuality(baseScore: number, cap: number): number {
    // low quality -> smaller cap, high quality -> closer to cap
    // baseScore is typically 0..1
    const factor = Math.min(Math.max((baseScore - 0.5) / 0.5, 0), 1); // maps 0.5..1 -> 0..1
    return cap * (0.35 + 0.65 * factor); // at least 35% of cap
  }

  // Normalize boost when many preferences are provided (avoid "more prefs = always better")
  private normalizeByPrefCount(boost: number, prefCount: number): number {
    if (prefCount <= 0) return boost;
    // sublinear scaling: 1 pref = 1.0, 4 prefs ~= 0.5 multiplier
    const scale = 1 / Math.sqrt(prefCount);
    return boost * Math.min(1, Math.max(0.4, scale));
  }

  private async buildFeedbackSignal(
    userId?: string,
    tripId?: string,
  ): Promise<{
    previousRating: number | null;
    feedbackCount: number;
  } | null> {
    if (!userId || !tripId) return null;

    const entries = await this.plannerService.getFeedback(userId, tripId);

    if (!entries.length) {
      return { previousRating: null, feedbackCount: 0 };
    }

    const latest = entries[0]; // properly typed now

    return {
      previousRating: latest.feedbackValue ?? null,
      feedbackCount: entries.length,
    };
  }

  constructor(
    private readonly aiService: AIService,
    private readonly searchService: SearchService,
    private readonly tripStore: TripStoreService,
    private readonly plannerService: PlannerService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Get('health')
  getHealth() {
    return {
      message: 'AI Planner Module Operational',
      algorithm: {
        version: ALGORITHM_VERSION,
        status: LOCK_STATUS,
        locked_since: LOCK_DATE,
        changes_allowed: 'Critical bug fixes only',
      },
    };
  }

  /* -------------------- NORMALIZATION -------------------- */

  private normalizeText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeLower(value: unknown): string {
    return this.normalizeText(value).toLowerCase();
  }

  private normalizePreferences(prefs?: string[]): string[] {
    if (!Array.isArray(prefs)) return [];
    const normalized = prefs.map((p) => this.normalizeText(p)).filter(Boolean);

    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of normalized) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  private mergePreferencesDeterministic(a: string[], b: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of [...a, ...b]) {
      const t = this.normalizeText(p);
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  private shouldUseSavedContext(body: TripPlanRequestDto): boolean {
    return body.useSavedContext !== false && body.mode !== 'new';
  }

  // FIXED: uses LOCAL parsing to avoid UTC shift
  private clampDayCount(startDateStr: string, endDateStr: string): number {
    const start = this.parseLocalDate(startDateStr);
    const end = this.parseLocalDate(endDateStr);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;

    const diffDays =
      Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return Math.max(1, diffDays);
  }

  /* ---------- Validate & Preprocess ---------- */

  private validateAndPreprocess(
    query: unknown,
  ): { cleaned: string; tokens: string[] } | string {
    if (typeof query !== 'string') return 'Invalid query format.';
    const trimmed = query.trim();
    if (!trimmed) return 'Query cannot be empty.';

    const cleaned = preprocessQuery(trimmed);
    if (!cleaned) return 'Query contains no valid searchable characters.';

    if (cleaned.length < PLANNER_CONFIG.SEARCH.MIN_QUERY_LENGTH) {
      return 'Query too short (minimum 3 characters).';
    }

    if (cleaned.length > PLANNER_CONFIG.SEARCH.MAX_QUERY_LENGTH) {
      return 'Query too long (maximum 300 characters).';
    }

    const tokens = cleaned.split(/\s+/);
    const meaningfulTokens = tokens.filter((t) => !STOP_WORDS.has(t));
    if (meaningfulTokens.length === 0) {
      return 'Query contains no meaningful searchable terms.';
    }

    return { cleaned, tokens: meaningfulTokens };
  }

  private filterByConfidenceThreshold(
    results: SearchResultItem[],
    minConfidence: 'High' | 'Medium' | 'Low' = 'Medium',
  ): { filtered: SearchResultItem[]; fallbackMessage?: string } {
    if (results.length === 0) {
      return {
        filtered: [],
        fallbackMessage: this.FALLBACK_MESSAGES.NO_MATCHES,
      };
    }

    const thresholdMap = {
      High: this.CONFIDENCE_THRESHOLDS.HIGH,
      Medium: this.CONFIDENCE_THRESHOLDS.MEDIUM,
      Low: this.CONFIDENCE_THRESHOLDS.MINIMUM,
    };
    const threshold = thresholdMap[minConfidence];

    const filtered = results.filter((item) => (item.score ?? 0) >= threshold);

    let fallbackMessage: string | undefined;

    if (filtered.length === 0) {
      fallbackMessage = this.FALLBACK_MESSAGES.NO_MATCHES;
    } else if (
      minConfidence === 'High' &&
      !filtered.some((r) => r.confidence === 'High')
    ) {
      fallbackMessage = this.FALLBACK_MESSAGES.NO_HIGH_CONFIDENCE;
    } else if (minConfidence === 'High') {
      const highConfidenceCount = filtered.filter(
        (r) => r.confidence === 'High',
      ).length;
      if (highConfidenceCount < filtered.length * 0.5) {
        fallbackMessage = this.FALLBACK_MESSAGES.PARTIAL_RESULTS;
      }
    }

    const avgScore =
      filtered.reduce((sum, r) => sum + (r.score || 0), 0) / filtered.length;

    if (
      !fallbackMessage &&
      avgScore < PLANNER_CONFIG.THRESHOLDS.AVG_SCORE_LOW_QUALITY
    ) {
      fallbackMessage = this.FALLBACK_MESSAGES.LOW_QUALITY;
    }

    return { filtered, fallbackMessage };
  }

  private validatePreferences(preferences?: string[]): {
    valid: boolean;
    warning?: string;
  } {
    if (!preferences || preferences.length === 0) {
      return {
        valid: true,
        warning: 'No preferences specified. Showing popular attractions.',
      };
    }

    const lowerPrefs = preferences.map((p) => p.toLowerCase());
    for (const [a, b] of PLANNER_CONFIG.VALIDATION.CONFLICTING_PAIRS) {
      if (lowerPrefs.includes(a) && lowerPrefs.includes(b)) {
        return {
          valid: true,
          warning: `Preferences "${a}" and "${b}" may conflict. We'll balance both, but consider focusing on one style.`,
        };
      }
    }

    const hasVague = preferences.some((p) =>
      PLANNER_CONFIG.VALIDATION.VAGUE_TERMS.some((v) =>
        p.toLowerCase().includes(v),
      ),
    );

    if (hasVague) {
      return {
        valid: false,
        warning:
          'Please be more specific. Instead of "things to do", try "hiking", "temples", or "beaches".',
      };
    }

    return { valid: true };
  }

  /* ---------- In-memory cosine search ---------- */

  private async executeSearch(query: unknown): Promise<SearchResponseDto> {
    const totalStart = process.hrtime.bigint();

    const originalQuery = typeof query === 'string' ? query.trim() : '';
    if (!originalQuery) {
      return {
        query: '',
        results: [],
        message:
          'Please enter a destination or interest (e.g., "beaches in Galle", "temples", "wildlife").',
      };
    }

    const validated = this.validateAndPreprocess(query);
    if (typeof validated === 'string') {
      const helpfulMessage = validated.includes('too short')
        ? `${validated} Try "Sigiriya", "Ella hiking", or "beach resorts".`
        : validated;

      return { query: originalQuery, results: [], message: helpfulMessage };
    }

    const { cleaned, tokens: queryTokens } = validated;
    const queryComplexity = queryTokens.length * cleaned.length;

    const embeddingStart = process.hrtime.bigint();
    const queryVector = this.aiService.generateDummyEmbedding(cleaned, 1536);
    const embeddingEnd = process.hrtime.bigint();
    const embeddingTimeMs = Number(embeddingEnd - embeddingStart) / 1_000_000;

    const searchStart = process.hrtime.bigint();
    let rawResults: (EmbeddingItem & { score: number })[] = [];
    try {
      rawResults = await this.aiService.search(queryVector, 20);
    } catch (error) {
      this.logger.error(`Vector search failed: ${(error as Error).message}`);
      rawResults = [];
    }
    const searchEnd = process.hrtime.bigint();
    const searchTimeMs = Number(searchEnd - searchStart) / 1_000_000;

    const mappedResults = rawResults.map((item) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      score: item.score,
      confidence: this.searchService.getConfidence(item.score),
      normalizedText: `${item.title} ${item.content}`.toLowerCase().trim(),
    }));

    const keywordFiltered = mappedResults.filter((item) => {
      const text = item.normalizedText;
      const matchedTokens = queryTokens.filter(
        (token) =>
          text.includes(token) || this.aiService.isPartialMatch(token, text),
      );
      return matchedTokens.length > 0;
    });

    const rowsAfterGate = keywordFiltered.length;

    if (rowsAfterGate === 0 && rawResults.length > 0) {
      return {
        query: cleaned,
        results: [],
        message: 'No strong matches found (keywords missing).',
      };
    }
    if (rowsAfterGate === 0) {
      return {
        query: cleaned,
        results: [],
        message: 'No strong matches found.',
      };
    }

    const scored = keywordFiltered
      .filter((item) => item.score >= this.CONFIDENCE_THRESHOLDS.MINIMUM)
      .sort((a, b) => {
        const diff = this.q(b.score) - this.q(a.score);
        if (Math.abs(diff) > this.EPS) return diff;
        return this.collator.compare(this.stableId(a.id), this.stableId(b.id));
      })
      .slice(0, 5)
      .map((item, idx) => ({
        rank: idx + 1,
        ...item,
      }));

    const { filtered, fallbackMessage } = this.filterByConfidenceThreshold(
      scored,
      'Medium',
    );

    const totalEnd = process.hrtime.bigint();
    const totalTimeMs = Number(totalEnd - totalStart) / 1_000_000;

    this.logger.log(
      `[SEARCH METRICS]
  Query           : "${originalQuery}"
  Tokens          : ${queryTokens.length}
  Query Complexity: ${queryComplexity}
  Rows Scanned    : ${rawResults.length} (Vector Top-K)
  Rows After Gate : ${rowsAfterGate}
  Vector Gen Time : ${embeddingTimeMs.toFixed(2)} ms
  Search Exec Time: ${searchTimeMs.toFixed(2)} ms
  Total Time      : ${totalTimeMs.toFixed(2)} ms`,
    );

    return {
      query: originalQuery,
      results: filtered.map((item, idx) => ({ ...item, rank: idx + 1 })),
      message: fallbackMessage,
    };
  }

  /* ---------- REST endpoints ---------- */

  @Get('search')
  async search(@Query('query') query: unknown): Promise<SearchResponseDto> {
    return this.executeSearch(query);
  }

  @Get('search/vector')
  async searchVector(
    @Query('q') q: unknown,
    @Query('limit') limit?: string,
    @Query('minConfidence') minConfidence?: string,
  ): Promise<SearchResponseDto> {
    const validated = this.validateAndPreprocess(q);
    if (typeof validated === 'string') {
      return {
        query: typeof q === 'string' ? q : '',
        results: [],
        message: validated,
      };
    }

    const { cleaned } = validated;

    const parsedLimit = Number(limit);
    const lim =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 20)
        : 10;

    const embedding = this.aiService.generateDummyEmbedding(cleaned, 1536);

    const raw: unknown =
      await this.searchService.searchEmbeddingsWithMetadataFromEmbedding(
        embedding,
        lim,
      );

    if (Array.isArray(raw)) {
      const confidenceLevel = this.normalizeConfidence(minConfidence);

      const { filtered, fallbackMessage } = this.filterByConfidenceThreshold(
        raw as SearchResultItem[],
        confidenceLevel,
      );

      return {
        query: cleaned,
        results: filtered,
        message: fallbackMessage,
      };
    }

    if (this.isServiceError(raw)) {
      return {
        query: cleaned,
        results: [],
        message: raw.message,
      };
    }

    return {
      query: cleaned,
      results: [],
      message: 'Search failed due to an unexpected response format.',
    };
  }

  /* ---------- Seed ---------- */

  @Post('seed')
  async seedDatabase(): Promise<{ message: string }> {
    try {
      await this.aiService.seedEmbeddingsFromAiPlanner();
      return { message: 'Seeding completed successfully!' };
    } catch {
      return { message: 'Seeding failed.' };
    }
  }

  /* ---------- Debug ---------- */

  @Get('debug/embedding')
  debugEmbedding(@Query('text') text: string) {
    const cleaned = preprocessQuery(text);
    const embedding = this.aiService.generateDummyEmbedding(cleaned, 1536);

    return {
      cleanedQuery: cleaned,
      embedding,
      dimension: embedding.length,
      min: Math.min(...embedding),
      max: Math.max(...embedding),
    };
  }

  /* ==================== EXPLANATION HELPERS ==================== */

  private inferRegion(text?: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    for (const [region, keys] of Object.entries(this.LOCATION_REGION_HINTS)) {
      if (keys.some((k) => lower.includes(k))) return region;
    }
    return null;
  }

  private computeNovelty(
    normalizedText: string,
    seenSet: Set<string>,
  ): 'High' | 'Medium' | 'Low' {
    if (seenSet.has(normalizedText)) return 'Low';
    return normalizedText.length > 120 ? 'High' : 'Medium';
  }

  private extractMatchedPreferences(
    result: SearchResultItem,
    preferences?: string[],
  ): { matched: string[]; titleMatches: number; contentMatches: number } {
    const matched: string[] = [];
    let titleMatches = 0;
    let contentMatches = 0;

    if (!preferences?.length) return { matched, titleMatches, contentMatches };

    const titleLower = result.title.toLowerCase();
    const contentLower = result.content.toLowerCase();

    for (const pref of preferences) {
      const p = pref.toLowerCase();
      if (titleLower.includes(p) || contentLower.includes(p)) {
        matched.push(pref);
        if (titleLower.includes(p)) titleMatches++;
        if (contentLower.includes(p)) contentMatches++;
        continue;
      }

      const mappedCategories = this.INTEREST_CATEGORY_MAP[p] || [];
      for (const category of mappedCategories) {
        const catLower = category.toLowerCase();
        if (titleLower.includes(catLower) || contentLower.includes(catLower)) {
          matched.push(pref);
          if (titleLower.includes(catLower)) titleMatches++;
          if (contentLower.includes(catLower)) contentMatches++;
          break;
        }
      }
    }

    return { matched, titleMatches, contentMatches };
  }

  private buildRichExplanation(
    result: SearchResultItem,
    priorityScore: number,
    category: ItineraryCategory,
    ctx: ExplanationContext,
  ): RichExplanation {
    const score = result.score ?? 0;
    const confidence = (result.confidence ?? 'Low') as ConfidenceLevel;
    const { matched } = this.extractMatchedPreferences(result, ctx.preferences);

    const energyScore =
      matched.length > 0
        ? (this.CATEGORY_ENERGY_SCORE[matched[0].toLowerCase()] ?? 2)
        : 2;
    const whyPlace: string[] = [];
    const whyDay: string[] = [];
    const whyTime: string[] = [];
    const tips: string[] = [];

    /* -------------------------------------------------- */
    /*   Fallback (keep minimal and factual)            */
    /* -------------------------------------------------- */
    if (ctx.isFallback) {
      return {
        selectionReason:
          'Included to ensure your itinerary remains complete despite limited strong matches.',
        rankingFactors: {
          relevanceScore: 0,
          confidenceLevel: 'Low',
          categoryMatch: false,
          novelty: 'Low',
        },
        whyThisPlace: ['Limited preference-aligned results were available'],
        tips: ['Try adding more specific interests for better matches'],
      };
    }

    /* -------------------------------------------------- */
    /*  Preference Faithfulness                        */
    /* -------------------------------------------------- */
    if (matched.length > 0) {
      whyPlace.push(
        `Matches your interest in ${matched.slice(0, 2).join(', ')}`,
      );
    }

    /* -------------------------------------------------- */
    /* Score + Confidence (NO exaggeration)          */
    /* -------------------------------------------------- */
    if (confidence === 'High') {
      whyPlace.push('Strong relevance based on search scoring');
    } else if (confidence === 'Medium') {
      whyPlace.push('Good relevance based on search scoring');
    } else {
      whyPlace.push('Included based on overall ranking score');
    }

    /* -------------------------------------------------- */
    /* Destination Region Alignment                   */
    /* -------------------------------------------------- */
    const destRegion = this.inferRegion(ctx.destination);
    const placeRegion = this.inferRegion(`${result.title} ${result.content}`);

    if (destRegion && placeRegion && destRegion !== placeRegion) {
      whyPlace.push('Located outside your main destination area');
      tips.push('Consider travel time if staying within one region');
    }

    /* -------------------------------------------------- */
    /* Day Placement (aligned with planner logic)     */
    /* -------------------------------------------------- */
    if (ctx.dayNumber === 1 && ctx.activityIndex === 0) {
      whyDay.push('Scheduled first to ease into your trip');
    } else if (ctx.dayNumber === ctx.totalDays) {
      whyDay.push('Placed toward the end of your itinerary');
    } else {
      whyDay.push('Balanced within your trip schedule');
    }

    /* -------------------------------------------------- */
    /* Time Slot (Energy-aware explanation)              */
    /* -------------------------------------------------- */

    if (energyScore === 3) {
      whyPlace.push('Classified as a higher-energy activity');

      if (ctx.timeSlot === 'Morning') {
        whyTime.push(
          'Scheduled in the morning when energy levels are typically higher',
        );
      } else {
        whyTime.push('Placed earlier in the day due to its active nature');
      }
    } else if (energyScore === 1) {
      whyPlace.push('Classified as a relaxing or lower-energy experience');

      if (ctx.timeSlot === 'Evening') {
        whyTime.push('Scheduled later in the day to allow a more relaxed pace');
      } else {
        whyTime.push('Placed at a calmer time of day');
      }
    } else {
      whyPlace.push('Balanced activity with moderate energy level');

      if (ctx.timeSlot === 'Morning') {
        whyTime.push('Assigned to the morning slot');
      } else if (ctx.timeSlot === 'Afternoon') {
        whyTime.push('Assigned to the afternoon slot');
      } else if (ctx.timeSlot === 'Evening') {
        whyTime.push('Assigned to the evening slot');
      }
    }

    /* -------------------------------------------------- */
    /* Practical Tips (category-driven only)          */
    /* -------------------------------------------------- */
    const titleLower = result.title.toLowerCase();

    if (category === 'Beach') {
      tips.push('Bring sun protection and water');
    }

    if (category === 'Nature' || category === 'Adventure') {
      tips.push('Wear comfortable walking shoes');
    }

    if (category === 'Culture' || category === 'History') {
      if (
        titleLower.includes('temple') ||
        titleLower.includes('kovil') ||
        titleLower.includes('church') ||
        titleLower.includes('mosque')
      ) {
        tips.push('Dress modestly when visiting religious sites');
      }
    }

    /* -------------------------------------------------- */
    /* Selection Summary (strictly factual)           */
    /* -------------------------------------------------- */
    const summaryParts: string[] = [];

    if (matched.length > 0) {
      summaryParts.push(
        `it aligns with your interest in ${matched.slice(0, 2).join(' and ')}`,
      );
    }

    summaryParts.push(
      confidence === 'High' || confidence === 'Medium'
        ? 'it ranked well in search scoring'
        : 'it was selected based on available ranking results',
    );

    return {
      selectionReason: `This was selected because ${summaryParts.join(' and ')}.`,
      rankingFactors: {
        relevanceScore: score,
        confidenceLevel: confidence,
        categoryMatch: matched.length > 0,
        preferenceMatch: matched.length ? matched : undefined,
        novelty: ctx.novelty,
      },
      whyThisPlace: whyPlace,
      whyThisDay: whyDay.length ? whyDay : undefined,
      whyThisTimeSlot: whyTime.length ? whyTime : undefined,
      tips: tips.length ? tips : undefined,
    };
  }

  private async buildRichExplanationPersonalized(
    result: SearchResultItem,
    priorityScore: number,
    category: ItineraryCategory,
    ctx: ExplanationContext,
    userId?: string,
  ): Promise<RichExplanation> {
    const baseExplanation = this.buildRichExplanation(
      result,
      priorityScore,
      category,
      ctx,
    );

    if (userId) {
      try {
        /* -------------------------------------------------- */
        /*   POSITIVE FEEDBACK INFLUENCE                      */
        /* -------------------------------------------------- */
        // Check if user has previously rated trips to this destination highly
        const positiveDestinations =
          await this.tripStore.getUserPositiveFeedbackDestinations(userId);

        const currentDestLower = (ctx.destination || '').toLowerCase();
        const matchesOverallDest = positiveDestinations.some(
          (d) => d && currentDestLower.includes(d.toLowerCase()),
        );

        // Also check if this specific place title matches a positive destination (unlikely for city names but possible)
        const resultTitleLower = result.title.toLowerCase();
        const matchesTitle = positiveDestinations.some(
          (d) => d && resultTitleLower.includes(d.toLowerCase()),
        );

        if (matchesOverallDest) {
          baseExplanation.hasPositiveFeedback = true;
          baseExplanation.whyThisPlace = [
            `Based on your positive experience in ${ctx.destination}`,
            ...(baseExplanation.whyThisPlace || []),
          ];
        } else if (matchesTitle) {
          baseExplanation.hasPositiveFeedback = true;
          baseExplanation.whyThisPlace = [
            `Based on your positive experience with similar destinations`,
            ...(baseExplanation.whyThisPlace || []),
          ];
        }

        /* -------------------------------------------------- */
        /*   EXISTING PERSONALIZATION LOGIC                   */
        /* -------------------------------------------------- */

        const frequentPlacesRaw =
          await this.tripStore.getUserFrequentPlaces(userId);
        const frequentPlaces = this.asFrequentPlaces(frequentPlacesRaw);

        const isFrequent = frequentPlaces.some(
          (p) => p.placeId === String(result.id),
        );

        if (isFrequent) {
          baseExplanation.whyThisPlace = [
            '⭐ You have shown interest in this before',
            ...(baseExplanation.whyThisPlace || []),
          ];
        }

        const categoryPrefs =
          await this.tripStore.getUserCategoryPreferences(userId);
        const matchingPref = categoryPrefs.find((p) =>
          category.toLowerCase().includes(p.category.toLowerCase()),
        );

        if (matchingPref && matchingPref.count >= 3) {
          baseExplanation.whyThisPlace?.push(
            `Based on your ${matchingPref.count} previous ${matchingPref.category} selections`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Personalization explanation failed: ${(error as Error).message}`,
        );
      }
    }

    return baseExplanation;
  }

  /* ==================== PRIORITY / SCORING ==================== */

  private getTripLengthType(dayCount: number): 'short' | 'medium' | 'long' {
    if (dayCount <= PLANNER_CONFIG.TRIP_LENGTH.SHORT_MAX) return 'short';
    if (dayCount <= PLANNER_CONFIG.TRIP_LENGTH.MEDIUM_MAX) return 'medium';
    return 'long';
  }

  private isValidDestination(destination?: string): boolean {
    const trimmed = this.normalizeLower(destination);
    if (!trimmed || trimmed.length < 3) return false;
    const invalidValues = ['unknown', 'n/a', 'none'];
    return !invalidValues.includes(trimmed);
  }

  private calculatePreferenceBoost(
    result: SearchResultItem,
    preferences: string[],
    rankingDetails: RankingDetails,
  ): number {
    let boost = 0;
    const titleLower = result.title.toLowerCase();
    const contentLower = result.content.toLowerCase();
    const baseScore = result.score || 0;

    // Cap per single preference (prevents "beach" from dominating)
    const PER_PREF_CAP = 0.45; // controller-only, not in constants file
    const TOTAL_PREF_CAP = 0.9; // total preference influence before normalization

    const matchedPrefs: Array<{
      pref: string;
      location: string;
      boost: number;
    }> = [];

    for (const pref of preferences) {
      const prefLower = pref.toLowerCase();
      let prefBoost = 0;
      let location = '';

      if (titleLower.includes(prefLower)) {
        prefBoost += this.PREFERENCE_WEIGHTS.TITLE_DIRECT_MATCH;
        location = 'title';
      } else if (contentLower.includes(prefLower)) {
        prefBoost += this.PREFERENCE_WEIGHTS.CONTENT_DIRECT_MATCH;
        location = 'content';
      } else {
        const mappedCategories = this.INTEREST_CATEGORY_MAP[prefLower] || [];
        for (const category of mappedCategories) {
          const categoryLower = category.toLowerCase();
          if (
            titleLower.includes(categoryLower) ||
            contentLower.includes(categoryLower)
          ) {
            prefBoost += this.PREFERENCE_WEIGHTS.CATEGORY_MAPPED_MATCH;
            location = `mapped to ${category}`;
            break;
          }
        }
      }

      // HARD per-pref cap
      if (prefBoost > 0) {
        const capped = Math.min(prefBoost, PER_PREF_CAP);
        boost += capped;
        matchedPrefs.push({
          pref,
          location: location || 'match',
          boost: capped,
        });
      }
    }

    // Multi-match bonus, but also cap it
    if (matchedPrefs.length > 1) {
      const rawBonus =
        (matchedPrefs.length - 1) *
        this.PREFERENCE_WEIGHTS.MULTIPLE_MATCH_BONUS;

      // Keep multi bonus from overpowering
      const multiBonus = Math.min(rawBonus, 0.35);
      boost += multiBonus;

      rankingDetails.adjustments.push(
        `Multi-preference bonus: ${matchedPrefs.length} matches (+${multiBonus.toFixed(2)})`,
      );
    }

    // Total preference cap (before normalization)
    boost = Math.min(boost, TOTAL_PREF_CAP);

    // Scale down preference influence if baseScore is low (relevance-first)
    const qualityCap = this.capByBaseQuality(baseScore, TOTAL_PREF_CAP);
    boost = Math.min(boost, qualityCap);

    // Normalize if user gives many preferences
    boost = this.normalizeByPrefCount(boost, preferences.length);

    if (matchedPrefs.length > 0) {
      const details = matchedPrefs
        .slice(0, 6)
        .map((m) => `${m.pref} (${m.location}: +${m.boost})`)
        .join(', ');
      rankingDetails.adjustments.push(`Preferences (capped): ${details}`);
    }

    return boost;
  }

  private getEnergyScoreForItem(item: ScoredResult): number {
    const matched = item.matchedPreferences;

    if (!matched || matched.length === 0) {
      return 2; // neutral default
    }

    // Take highest energy among matched categories
    const energies = matched.map(
      (cat) => this.CATEGORY_ENERGY_SCORE[cat.toLowerCase()] ?? 2,
    );

    return Math.max(...energies);
  }

  private scoreResultsByPreferences(
    results: SearchResultItem[],
    preferences?: string[],
    dayCount?: number,
    destination?: string,
  ): ScoredResult[] {
    const tripType = dayCount ? this.getTripLengthType(dayCount) : undefined;
    const dest = this.normalizeLower(destination);

    const scored = results
      .map((result) => {
        const baseScore = result.score ?? 0.5;
        let priorityScore = baseScore;

        const rankingDetails: RankingDetails = {
          baseScore,
          personalizationBoost: 0,
          confidenceMultiplier: 1,
          finalScore: baseScore,
          adjustments: [],
        };

        /* -------------------- CONFIDENCE MULTIPLIER -------------------- */
        const confidenceMultiplier =
          PLANNER_CONFIG.SCORING.CONFIDENCE_MULTIPLIERS[
            result.confidence ?? 'Low'
          ];

        priorityScore *= confidenceMultiplier;
        rankingDetails.confidenceMultiplier = confidenceMultiplier;

        const text = `${result.title} ${result.content}`.toLowerCase();

        const boostMultiplier =
          baseScore < PLANNER_CONFIG.SCORING.MIN_BASE_SCORE
            ? PLANNER_CONFIG.SCORING.LOW_QUALITY_MULTIPLIER
            : 1.0;

        /* -------------------- PROXIMITY BOOSTS -------------------- */
        if (dest && dest.length >= PLANNER_CONFIG.SEARCH.MIN_QUERY_LENGTH) {
          const titleLower = result.title.toLowerCase();
          const contentLower = result.content.toLowerCase();

          const hasDestInTitle = titleLower.includes(dest);
          const hasDestInContent = contentLower.includes(dest);
          const hasNearMetadata = text.includes('near:') && text.includes(dest);

          if (hasDestInTitle) {
            const boost =
              PLANNER_CONFIG.SCORING.PROXIMITY_BOOSTS.TITLE * boostMultiplier;
            priorityScore += boost;
            rankingDetails.adjustments.push(
              `Proximity (title): +${boost.toFixed(2)}`,
            );
          } else if (hasNearMetadata) {
            const boost =
              PLANNER_CONFIG.SCORING.PROXIMITY_BOOSTS.METADATA *
              boostMultiplier;
            priorityScore += boost;
            rankingDetails.adjustments.push(
              `Proximity (metadata): +${boost.toFixed(2)}`,
            );
          } else if (hasDestInContent) {
            const boost =
              PLANNER_CONFIG.SCORING.PROXIMITY_BOOSTS.CONTENT * boostMultiplier;
            priorityScore += boost;
            rankingDetails.adjustments.push(
              `Proximity (content): +${boost.toFixed(2)}`,
            );
          }

          if (
            (hasDestInTitle || hasNearMetadata) &&
            (result.score ?? 0) >= PLANNER_CONFIG.THRESHOLDS.HIGH_SCORE_COMBO
          ) {
            const comboBoost = PLANNER_CONFIG.SCORING.PROXIMITY_BOOSTS.COMBO;
            priorityScore += comboBoost;
            rankingDetails.adjustments.push(
              `High score combo: +${comboBoost.toFixed(2)}`,
            );
          }
        }

        /* -------------------- PREFERENCE BOOST -------------------- */
        let matchedPreferences: string[] = [];
        if (preferences && preferences.length > 0) {
          const preferenceBoost = this.calculatePreferenceBoost(
            result,
            preferences,
            rankingDetails,
          );

          const prefSoftener = result.confidence === 'Low' ? 0.6 : 1.0;
          if (prefSoftener !== 1.0) {
            rankingDetails.adjustments.push(
              'Preference softener applied (Low confidence)',
            );
          }

          const appliedPrefBoost =
            preferenceBoost * boostMultiplier * prefSoftener;

          priorityScore += appliedPrefBoost;

          const prefCap =
            baseScore *
            PLANNER_CONFIG.CONSISTENCY.MAX_PERSONALIZATION_INFLUENCE;

          if (appliedPrefBoost > prefCap) {
            const over = appliedPrefBoost - prefCap;
            priorityScore -= over;
            rankingDetails.adjustments.push(
              `Preference cap: -${this.q(over, 4).toFixed(4)} (cap=${this.q(prefCap, 4).toFixed(4)})`,
            );
          }

          // Extract matched preferences ONCE here
          const extracted = this.extractMatchedPreferences(result, preferences);
          matchedPreferences = extracted.matched ?? [];
        }

        /* -------------------- ENERGY BOOST -------------------- */
        if (matchedPreferences.length > 0) {
          const energyScore =
            this.CATEGORY_ENERGY_SCORE[matchedPreferences[0].toLowerCase()] ??
            2;

          const energyBoost =
            energyScore === 3 ? 0.03 : energyScore === 1 ? 0.015 : 0.02;

          priorityScore += energyBoost;

          rankingDetails.adjustments.push(
            `Energy alignment boost: +${energyBoost.toFixed(2)}`,
          );
        }

        /* -------------------- TRIP OPTIMIZATION -------------------- */
        if (tripType === 'short') {
          if (text.match(/fort|temple|kovil|church|museum|beach/)) {
            const boost =
              PLANNER_CONFIG.SCORING.TRIP_OPTIMIZATION.SHORT_BOOST *
              boostMultiplier;
            priorityScore += boost;
            rankingDetails.adjustments.push(
              `Short trip boost: +${boost.toFixed(2)}`,
            );
          }
        }

        if (tripType === 'long') {
          if (text.match(/nature|park|wildlife|relax|spa|garden/)) {
            const boost =
              PLANNER_CONFIG.SCORING.TRIP_OPTIMIZATION.LONG_BOOST *
              boostMultiplier;
            priorityScore += boost;
            rankingDetails.adjustments.push(
              `Long trip boost: +${boost.toFixed(2)}`,
            );
          }
        }

        /* -------------------- RELEVANCE CEILING -------------------- */
        const maxFinal = this.q(
          baseScore +
            baseScore *
              PLANNER_CONFIG.CONSISTENCY.MAX_PERSONALIZATION_INFLUENCE,
        );

        if (priorityScore > maxFinal) {
          rankingDetails.adjustments.push(
            `Relevance ceiling applied: ${this.q(priorityScore, 4).toFixed(4)} -> ${this.q(maxFinal, 4).toFixed(4)}`,
          );
          priorityScore = maxFinal;
        }

        /* -------------------- GLOBAL CAP -------------------- */
        priorityScore = Math.min(
          priorityScore,
          PLANNER_CONFIG.SCORING.MAX_PRIORITY,
        );

        rankingDetails.finalScore = priorityScore;

        return {
          ...result,
          priorityScore,
          rankingDetails,
          matchedPreferences,
        };
      })
      .sort((a, b) => {
        const scoreDiff = this.q(b.priorityScore) - this.q(a.priorityScore);
        if (Math.abs(scoreDiff) > this.EPS) return scoreDiff;

        if (a.confidence !== b.confidence) {
          const order = { High: 3, Medium: 2, Low: 1 };
          return (order[b.confidence!] ?? 0) - (order[a.confidence!] ?? 0);
        }

        return this.collator.compare(this.stableId(a.id), this.stableId(b.id));
      });

    return scored;
  }

  /* ==================== PERSONALIZATION (Interest + Pace + Deterministic) ==================== */

  private async calculatePersonalizationBoost(
    result: SearchResultItem,
    userId?: string,
    preferences?: string[],
    userPace?: 'relaxed' | 'moderate' | 'active',
  ): Promise<number> {
    if (!userId) return 0;

    // CONSISTENCY LOCK: don't personalize low-quality items
    const baseScore = result.score || 0;
    if (baseScore < PLANNER_CONFIG.PERSONALIZATION.MIN_BASE_SCORE) return 0;

    let boost = 0;
    const resultText = `${result.title} ${result.content}`.toLowerCase();

    // 1) INTEREST ALIGNMENT (exact / related)
    if (preferences?.length) {
      for (const pref of preferences) {
        const prefLower = pref.toLowerCase();

        if (resultText.includes(prefLower)) {
          boost += PLANNER_CONFIG.RANKING.INTEREST_MATCH.EXACT;
          break; // apply once
        }

        const mappedCategories = this.INTEREST_CATEGORY_MAP[prefLower] || [];
        const hasRelated = mappedCategories.some((cat) =>
          resultText.includes(cat.toLowerCase()),
        );
        if (hasRelated) {
          boost += PLANNER_CONFIG.RANKING.INTEREST_MATCH.RELATED;
        }
      }
    }

    try {
      // infer category for pace + behavior signals
      const category = this.inferCategoryFromText(
        result.title,
        result.content,
        preferences,
      );

      // 2) PACE COMPATIBILITY
      if (userPace) {
        const paceKey = userPace.toUpperCase() as
          | 'RELAXED'
          | 'MODERATE'
          | 'ACTIVE';
        const paceConfig = PLANNER_CONFIG.RANKING.PACE_MODIFIERS[paceKey];
        if (paceConfig?.PREFER_CATEGORIES.includes(category)) {
          boost += paceConfig.BOOST;
        }
      }

      // 3) BEHAVIORAL SIGNALS: frequent category
      const categoryPrefs =
        await this.tripStore.getUserCategoryPreferences(userId);
      const matchingPref = categoryPrefs.find((p) =>
        category.toLowerCase().includes(p.category.toLowerCase()),
      );
      if (matchingPref) {
        const normalizedCount = Math.min(matchingPref.count / 10, 1);
        boost +=
          PLANNER_CONFIG.RANKING.BEHAVIOR_WEIGHTS.FREQUENT_CATEGORY *
          normalizedCount;
      }

      // 4) RECENT ENGAGEMENT (if implemented in TripStoreService)
      // Safe-guard: if method doesn't exist at runtime, catch below.
      const recentSelectionsRaw =
        await this.tripStore.getRecentUserSelections?.(userId);

      if (Array.isArray(recentSelectionsRaw)) {
        const recentSelections = recentSelectionsRaw.filter(
          (
            s,
          ): s is { placeId: string; category: string; timestamp: string } => {
            if (!s || typeof s !== 'object') return false;

            const o = s as Record<string, unknown>;
            return (
              typeof o.placeId === 'string' &&
              typeof o.category === 'string' &&
              typeof o.timestamp === 'string'
            );
          },
        );

        const categoryLower = category.toLowerCase();
        const resultIdStr = String(result.id);

        const hasRecent = recentSelections.some(
          (s) =>
            s.placeId === resultIdStr ||
            s.category.toLowerCase() === categoryLower,
        );

        if (hasRecent) {
          boost += PLANNER_CONFIG.RANKING.BEHAVIOR_WEIGHTS.RECENT_SELECTION;
        }
      }

      // 5) AVOIDED CATEGORY (negative)
      const avoided = await this.tripStore.getUserAvoidedCategories?.(userId);
      if (Array.isArray(avoided)) {
        if (
          avoided
            .map((x: string) => x.toLowerCase())
            .includes(category.toLowerCase())
        ) {
          boost += PLANNER_CONFIG.RANKING.BEHAVIOR_WEIGHTS.AVOIDED_CATEGORY;
        }
      }

      // Legacy: frequent places boost
      const frequentPlaces = await this.tripStore.getUserFrequentPlaces(userId);
      const isFrequentPlace = frequentPlaces.some(
        (p) => p.placeId === String(result.id),
      );
      if (isFrequentPlace) {
        boost += PLANNER_CONFIG.PERSONALIZATION.PAST_INTERACTION_WEIGHT;
      } else {
        const hasRelatedPlace = frequentPlaces.some((p) =>
          resultText.includes(p.placeName.toLowerCase().split(' ')[0]),
        );
        if (hasRelatedPlace) boost += 0.1;
      }
    } catch (error) {
      this.logger.error(
        `Preference-aware ranking failed for user ${userId}: ${(error as Error).message}`,
      );
    }

    // CONSISTENCY LOCK: hard cap
    const cappedBoost = Math.min(
      boost,
      PLANNER_CONFIG.PERSONALIZATION.MAX_BOOST,
    );

    // CONSISTENCY LOCK: boost cannot dominate base quality
    const maxAllowedBoost =
      baseScore * PLANNER_CONFIG.CONSISTENCY.MAX_PERSONALIZATION_INFLUENCE;

    return Math.min(cappedBoost, maxAllowedBoost);
  }

  private async scoreResultsByPreferencesPersonalized(
    results: SearchResultItem[],
    preferences?: string[],
    dayCount?: number,
    destination?: string,
    userId?: string,
  ): Promise<ScoredResult[]> {
    const baseScored = this.scoreResultsByPreferences(
      results,
      preferences,
      dayCount,
      destination,
    );

    if (!userId) return baseScored;

    // Get pace deterministically (single fetch)
    let userPace: 'relaxed' | 'moderate' | 'active' | undefined;
    try {
      userPace = await this.tripStore.getUserTravelPace(userId);
      this.logger.log(`[ranking] userId=${userId} pace=${userPace}`);
    } catch (error) {
      this.logger.warn(`Failed to get user pace: ${(error as Error).message}`);
    }

    const personalizedScored = await Promise.all(
      baseScored.map(async (item) => {
        const personalizationBoost = await this.calculatePersonalizationBoost(
          item,
          userId,
          preferences,
          userPace,
        );

        // CONSISTENCY LOCK: fixed precision rounding
        const finalScore = this.q(item.priorityScore + personalizationBoost);

        const baseScore = item.score || 0;

        // Ceiling: personalization cannot move item beyond a relevance-bound max
        const maxFinal = this.q(
          baseScore +
            baseScore *
              PLANNER_CONFIG.CONSISTENCY.MAX_PERSONALIZATION_INFLUENCE,
        );

        const boundedFinal = Math.min(finalScore, maxFinal);

        return {
          ...item,
          priorityScore: boundedFinal,
          rankingDetails: {
            ...item.rankingDetails,
            personalizationBoost: this.q(personalizationBoost),
            userPace,
            relevanceCeiling: maxFinal, // optional debug info
          },
        };
      }),
    );

    return personalizedScored.sort((a, b) => {
      const diff = this.q(b.priorityScore) - this.q(a.priorityScore);
      if (Math.abs(diff) > this.EPS) return diff;
      return this.collator.compare(this.stableId(a.id), this.stableId(b.id));
    });
  }

  /* ==================== FALLBACK BUILDERS ==================== */

  private estimateDuration(category: ItineraryCategory): string {
    const durations: Record<ItineraryCategory, string> = {
      Arrival: '2-3 hours',
      Sightseeing: '2-4 hours',
      Culture: '2-3 hours',
      History: '2-4 hours',
      Nature: '3-5 hours',
      Adventure: '3-6 hours',
      Beach: '2-4 hours',
      Relaxation: '2-3 hours',
    };
    return durations[category];
  }

  private assignSingleDaySlot(
    energy: number,
    ratio: number,
  ): 'Morning' | 'Afternoon' | 'Evening' {
    // High energy prefers earlier but not all morning
    if (energy === 3) {
      if (ratio < 0.4) return 'Morning';
      if (ratio < 0.75) return 'Afternoon';
      return 'Evening';
    }

    // Relax prefers later but not all evening
    if (energy === 1) {
      if (ratio < 0.3) return 'Afternoon';
      return 'Evening';
    }

    // Neutral natural flow
    if (ratio < 0.33) return 'Morning';
    if (ratio < 0.66) return 'Afternoon';
    return 'Evening';
  }

  private getDayEnergyProfile(
    dayNumber: number,
    totalDays: number,
  ): 'moderate' | 'high' | 'relaxed' {
    if (totalDays === 1) return 'high';

    // Arrival day
    if (dayNumber === 1) return 'moderate';

    // Last day
    if (dayNumber === totalDays) return 'relaxed';

    // Middle days
    return 'high';
  }

  private assignMultiDaySlot(
    energy: number,
    ratio: number,
    dayType: 'moderate' | 'high' | 'relaxed',
  ): 'Morning' | 'Afternoon' | 'Evening' {
    // ---------------- HIGH ENERGY DAY ----------------
    if (dayType === 'high') {
      if (energy === 3) {
        if (ratio < 0.5) return 'Morning';
        return 'Afternoon';
      }

      if (energy === 1) {
        if (ratio > 0.6) return 'Evening';
        return 'Afternoon';
      }
    }

    // ---------------- MODERATE DAY ----------------
    if (dayType === 'moderate') {
      if (energy === 3 && ratio < 0.3) return 'Morning';
      if (energy === 1 && ratio > 0.6) return 'Evening';
    }

    // ---------------- RELAXED DAY ----------------
    if (dayType === 'relaxed') {
      // Only ONE high energy early
      if (energy === 3 && ratio < 0.3) return 'Morning';
      // Spread neutral + relax naturally
      if (ratio < 0.5) return 'Afternoon';
      return 'Evening';
    }

    // Default fallback distribution
    if (ratio < 0.33) return 'Morning';
    if (ratio < 0.66) return 'Afternoon';
    return 'Evening';
  }

  private assignTimeSlot(
    item: ScoredResult,
    activityIndex: number,
    totalActivitiesInDay: number,
    dayNumber: number,
    totalDays: number,
  ): 'Morning' | 'Afternoon' | 'Evening' {
    // Edge case safety
    if (totalActivitiesInDay <= 0) return 'Afternoon';
    const energy = this.getEnergyScoreForItem(item);

    // Single activity → energy based
    if (totalActivitiesInDay === 1) {
      if (energy === 3) return 'Morning';
      if (energy === 1) return 'Evening';
      return 'Afternoon';
    }

    const ratio =
      totalActivitiesInDay > 1 ? activityIndex / (totalActivitiesInDay - 1) : 0;

    // -----------------------------
    // SINGLE DAY TRIP
    // -----------------------------
    if (totalDays === 1) {
      return this.assignSingleDaySlot(energy, ratio);
    }

    // -----------------------------
    // MULTI DAY TRIP
    // -----------------------------
    const dayType = this.getDayEnergyProfile(dayNumber, totalDays);

    return this.assignMultiDaySlot(energy, ratio, dayType);
  }

  /* --------------------------------------------------
     MULTI-DAY TRIP (Balanced flow logic)
    -------------------------------------------------- */
  // // If only one activity that day → schedule by energy
  // if (totalActivitiesInDay === 1) {
  //   if (energy === 3) return 'Morning';
  //   if (energy === 1) return 'Evening';
  //   return 'Afternoon';
  // }

  // // If two activities → split by energy naturally
  // if (totalActivitiesInDay === 2) {
  //   if (energy === 3) return activityIndex === 0 ? 'Morning' : 'Afternoon';
  //   if (energy === 1) return activityIndex === 0 ? 'Afternoon' : 'Evening';
  //   return activityIndex === 0 ? 'Morning' : 'Afternoon';
  // }

  // /* --------------------------------------------------
  //    3+ Activities → Energy + Natural Flow Hybrid
  // -------------------------------------------------- */

  // const ratio = activityIndex / (totalActivitiesInDay - 1);

  // // High energy prefers early
  // if (energy === 3) {
  //   if (ratio < 0.5) return 'Morning';
  //   return 'Afternoon';
  // }

  // // Low energy prefers late
  // if (energy === 1) {
  //   if (ratio < 0.5) return 'Afternoon';
  //   return 'Evening';
  // }

  // // Neutral energy → standard distribution
  // if (ratio < 0.4) return 'Morning';
  // if (ratio < 0.7) return 'Afternoon';
  // return 'Evening';
  // }

  private createFallbackItinerary(
    dayCount: number,
    startDate: string,
    destination?: string,
  ): DayPlan[] {
    const dayPlans: DayPlan[] = [];
    const baseDate = this.parseLocalDate(startDate);

    for (let day = 1; day <= dayCount; day++) {
      const dayDate = this.addDaysLocal(baseDate, day - 1);

      const fallbackCategory: ItineraryCategory =
        day === 1 ? 'Arrival' : 'Sightseeing';
      const fallbackTimeSlot: 'Morning' | 'Afternoon' =
        day === 1 ? 'Afternoon' : 'Morning';

      const fallbackActivity: EnhancedItineraryItemDto = {
        order: 1,
        dayNumber: day,
        placeName: destination || 'Destination',
        shortDescription:
          day === 1
            ? 'Arrival and check-in at accommodation. Explore nearby area.'
            : `Explore ${destination || 'the destination'} at your own pace. Visit local attractions and landmarks.`,
        category: fallbackCategory,
        timeSlot: fallbackTimeSlot,
        estimatedDuration: '3-4 hours',
        confidenceScore: 'Low',
        priority: 0.3,
        explanation: this.buildRichExplanation(
          {
            rank: 1,
            id: 'fallback',
            title: destination || 'Destination',
            content: 'Fallback activity',
            score: 0,
            confidence: 'Low',
          },
          0.3,
          fallbackCategory,
          {
            destination,
            dayNumber: day,
            totalDays: dayCount,
            activityIndex: 0,
            activitiesInDay: 1,
            isFallback: true,
            timeSlot: fallbackTimeSlot,
          },
        ),
      };

      dayPlans.push({
        day,
        date: this.formatLocalDate(dayDate),
        theme: day === 1 ? 'Arrival Day' : 'Exploration',
        activities: [fallbackActivity],
        groupingReason: 'Fallback day plan (not enough strong matches found).',
        themeExplanation:
          'A basic structure was created due to limited strong matches.',
      });
    }

    return dayPlans;
  }

  private createSingleDayFallback(
    day: number,
    destination?: string,
  ): EnhancedItineraryItemDto {
    const isDay1 = day === 1;
    const category: ItineraryCategory = isDay1 ? 'Arrival' : 'Sightseeing';
    const timeSlot: 'Morning' | 'Afternoon' = isDay1 ? 'Afternoon' : 'Morning';

    return {
      order: 1,
      dayNumber: day,
      placeName: destination || 'Destination',
      shortDescription: isDay1
        ? 'Arrival and check-in at accommodation. Explore nearby area.'
        : `Explore ${destination || 'the destination'} at your own pace. Visit local landmarks and attractions.`,
      category,
      timeSlot,
      estimatedDuration: '3-4 hours',
      confidenceScore: 'Low',
      priority: 0.3,
      explanation: this.buildRichExplanation(
        {
          rank: 1,
          id: 'fallback',
          title: destination || 'Destination',
          content: 'Fallback activity',
          score: 0,
          confidence: 'Low',
        },
        0.3,
        category,
        {
          destination,
          dayNumber: day,
          totalDays: day,
          activityIndex: 0,
          activitiesInDay: 1,
          isFallback: true,
          timeSlot,
        },
      ),
    };
  }

  /* ==================== CATEGORY / DIVERSITY ==================== */

  private inferCategoryFromText(
    title: string,
    content: string,
    preferences?: string[],
  ): ItineraryCategory {
    const lower = `${title} ${content}`.toLowerCase();

    if (preferences?.length) {
      for (const pref of preferences) {
        const pl = pref.toLowerCase();
        if (lower.includes(pl)) {
          const mapped = this.INTEREST_CATEGORY_MAP[pl];
          if (mapped?.length) return mapped[0];
        }
      }
    }

    if (lower.includes('beach') || lower.includes('surf')) return 'Beach';
    if (
      lower.includes('fort') ||
      lower.includes('historical') ||
      lower.includes('ruins') ||
      lower.includes('temple') ||
      lower.includes('kovil') ||
      lower.includes('church')
    )
      return 'History';
    if (lower.includes('museum') || lower.includes('culture')) return 'Culture';
    if (
      lower.includes('park') ||
      lower.includes('wildlife') ||
      lower.includes('forest') ||
      lower.includes('nature')
    )
      return 'Nature';
    if (
      lower.includes('adventure') ||
      lower.includes('hiking') ||
      lower.includes('rafting')
    )
      return 'Adventure';

    return 'Sightseeing';
  }

  private categoryCache = new Map<string | number, ItineraryCategory>();

  private determineActivityCategory(
    title: string,
    content: string,
    dayNumber: number,
    activityIndex: number,
    preferences?: string[],
    resultId?: string | number,
  ): ItineraryCategory {
    if (resultId && this.categoryCache.has(resultId)) {
      return this.categoryCache.get(resultId)!;
    }

    let category = this.inferCategoryFromText(title, content, preferences);

    if (!category || category === 'Sightseeing') {
      const rotationPattern: ItineraryCategory[] = [
        'Sightseeing',
        'History',
        'Culture',
        'Nature',
        'Beach',
        'Relaxation',
        'Adventure',
      ];
      category =
        rotationPattern[(dayNumber + activityIndex) % rotationPattern.length];
    }

    if (resultId) this.categoryCache.set(resultId, category);
    return category;
  }

  private selectDiverseActivities(
    scoredResults: Array<SearchResultItem & { priorityScore: number }>,
    maxCount: number,
    preferences?: string[],
  ): SearchResultItem[] {
    const selected: SearchResultItem[] = [];
    const categoryCount: Record<string, number> = {};
    const textSet = new Set<string>();

    const maxPerCategory = Math.ceil(
      maxCount / PLANNER_CONFIG.DIVERSITY.CATEGORY_DIVISOR,
    );

    const sorted = [...scoredResults].sort((a, b) => {
      const aScore = this.q(a.priorityScore);
      const bScore = this.q(b.priorityScore);
      const diff = bScore - aScore;

      const epsilon = Math.pow(10, -PLANNER_CONFIG.CONSISTENCY.SCORE_PRECISION);
      if (Math.abs(diff) > epsilon) return diff;

      return this.collator.compare(this.stableId(a.id), this.stableId(b.id));
    });

    for (const result of sorted) {
      if (selected.length >= maxCount) break;

      const textKey = `${result.title} ${result.content}`.toLowerCase();
      if (textSet.has(textKey)) continue;

      const category = this.inferCategoryFromText(
        result.title,
        result.content,
        preferences,
      );
      const currentCount = categoryCount[category] || 0;

      if (currentCount < maxPerCategory) {
        selected.push(result);
        categoryCount[category] = currentCount + 1;
        textSet.add(textKey);
      }
    }

    return selected;
  }

  /* ==================== DAY PLANNING HELPERS ==================== */

  private allocateAcrossDays(
    activities: SearchResultItem[],
    dayCount: number,
    maxPerDay: number,
  ): SearchResultItem[][] {
    const buckets: SearchResultItem[][] = Array.from(
      { length: dayCount },
      () => [],
    );

    activities.forEach((item, index) => {
      const dayIndex = index % dayCount;
      if (buckets[dayIndex].length < maxPerDay) buckets[dayIndex].push(item);
    });

    return buckets;
  }

  private generateDayTheme(activities: EnhancedItineraryItemDto[]): {
    theme: string;
    explanation: string;
  } {
    if (!activities?.length) {
      return {
        theme: 'Free Day',
        explanation:
          'No specific activities planned - explore at your own pace.',
      };
    }

    const categories = activities
      .map((a) => (a.category || '').trim().toLowerCase())
      .filter(Boolean);

    const unique = Array.from(new Set(categories));

    if (unique.length === 1) {
      const category = unique[0];
      const themes: Record<string, { theme: string; explanation: string }> = {
        arrival: {
          theme: 'Arrival Day',
          explanation: 'Take it easy - settle in and get your bearings.',
        },
        beach: {
          theme: 'Beach Day',
          explanation: 'Enjoy the coast and soak up the sun.',
        },
        culture: {
          theme: 'Cultural Day',
          explanation: 'Dive into local traditions and heritage.',
        },
        history: {
          theme: 'History Day',
          explanation: 'Explore historical sites and stories.',
        },
        nature: {
          theme: 'Nature Day',
          explanation: 'Get outdoors and enjoy natural beauty.',
        },
        adventure: {
          theme: 'Adventure Day',
          explanation: 'Active experiences for the adventurous.',
        },
        relaxation: {
          theme: 'Relaxation Day',
          explanation: 'Take it slow and recharge.',
        },
        sightseeing: {
          theme: 'Sightseeing Day',
          explanation: 'See the highlights and must-visit spots.',
        },
      };

      return (
        themes[category] || {
          theme: 'Exploration Day',
          explanation: `Focus on ${category} activities today.`,
        }
      );
    }

    const hasAny = (cats: string[]) => cats.some((c) => unique.includes(c));

    if (hasAny(['arrival'])) {
      if (hasAny(['beach']))
        return {
          theme: 'Arrival & Beach',
          explanation: 'Start with check-in, then relax by the water.',
        };
      if (hasAny(['culture', 'sightseeing']))
        return {
          theme: 'Arrival & Exploration',
          explanation: 'Settle in and see some nearby highlights.',
        };
      return {
        theme: 'Arrival Day',
        explanation: 'Get oriented and ease into your trip.',
      };
    }

    if (hasAny(['beach']) && hasAny(['relaxation']))
      return {
        theme: 'Beach & Chill',
        explanation: 'Coastal relaxation and downtime.',
      };
    if (hasAny(['culture']) && hasAny(['history']))
      return {
        theme: 'Culture & History',
        explanation: 'Explore heritage sites and local traditions.',
      };
    if (hasAny(['nature']) && hasAny(['adventure']))
      return {
        theme: 'Nature & Adventure',
        explanation: 'Outdoor activities in beautiful settings.',
      };
    if (hasAny(['culture']) && hasAny(['nature']))
      return {
        theme: 'Culture & Nature',
        explanation: 'Balance cultural sites with natural beauty.',
      };

    if (hasAny(['sightseeing'])) {
      if (hasAny(['beach']))
        return {
          theme: 'Sights & Beach',
          explanation: 'Mix of landmarks and coastal relaxation.',
        };
      if (hasAny(['nature']))
        return {
          theme: 'Sights & Nature',
          explanation: 'Combine must-see spots with natural beauty.',
        };
    }

    if (unique.length >= 3)
      return {
        theme: 'Mixed Day',
        explanation: `Variety of ${unique.length} different experiences today.`,
      };

    return {
      theme: 'Discovery Day',
      explanation: `Mix of ${unique.join(' and ')} activities.`,
    };
  }

  private generateGroupingExplanation(
    activities: EnhancedItineraryItemDto[],
  ): string {
    if (activities.length === 0) return 'No activities scheduled.';

    if (activities.length === 1) {
      const activity = activities[0];
      if (activity.priority > 0.7)
        return 'Single focused activity that matches your preferences well.';
      return 'One main activity for the day.';
    }

    const categories = activities.map((a) => a.category);
    const uniqueCategories = Array.from(new Set(categories));

    if (uniqueCategories.length === 1)
      return `All ${categories[0].toLowerCase()} activities - keeping the day focused.`;
    if (uniqueCategories.length === 2)
      return `${uniqueCategories[0]} and ${uniqueCategories[1]} pair well together.`;
    return `${uniqueCategories.length} different types of activities for a well-rounded day.`;
  }

  private generateDayPlacementExplanation(
    dayNumber: number,
    activity: EnhancedItineraryItemDto,
    totalDays: number,
    dayActivities: EnhancedItineraryItemDto[],
  ): string {
    if (dayNumber === 1) {
      if (activity.category === 'Arrival')
        return 'First day activity - easy after traveling.';
      return 'Good starter activity for day one.';
    }
    if (dayNumber === totalDays)
      return 'Final day highlight to end your trip well.';

    if (activity.category === 'Beach' || activity.category === 'Relaxation')
      return 'Placed here to give you a break mid-trip.';
    if (activity.category === 'Adventure' || activity.category === 'Nature')
      return "Scheduled when you'll have good energy.";

    const sameCategoryCount = dayActivities.filter(
      (a) => a.category === activity.category,
    ).length;
    if (sameCategoryCount > 1)
      return `Grouped with other ${activity.category.toLowerCase()} activities for better flow.`;

    if (activity.priority >= 0.85)
      return 'Placed mid-trip as a highlight experience.';
    return 'Works well with your other activities this day.';
  }

  /* ==================== MAIN ITINERARY GENERATION ==================== */

  private async generateItinerary(
    searchResults: SearchResultItem[],
    dayCount: number,
    startDate: string,
    preferences?: string[],
    destination?: string,
    userId?: string,
  ): Promise<{ plans: DayPlan[]; usedFallback: boolean }> {
    const startItin = process.hrtime.bigint();

    const filteredResults = searchResults.filter((result) => {
      if (!result.score || result.score < this.CONFIDENCE_THRESHOLDS.MINIMUM)
        return false;
      if (!result.content || result.content.length < 20) return false;
      return true;
    });

    if (filteredResults.length === 0) {
      return {
        plans: this.createFallbackItinerary(dayCount, startDate, destination),
        usedFallback: true,
      };
    }

    const scored = await this.scoreResultsByPreferencesPersonalized(
      filteredResults,
      preferences,
      dayCount,
      destination,
      userId,
    );

    // Pace-based max activities/day (deterministic)
    let MAX_PER_DAY: number =
      dayCount === 1
        ? PLANNER_CONFIG.ACTIVITIES.MAX_PER_DAY_SHORT
        : PLANNER_CONFIG.ACTIVITIES.MAX_PER_DAY_LONG;

    if (userId) {
      try {
        const pace = await this.tripStore.getUserTravelPace(userId);
        const paceKey = pace.toUpperCase() as 'RELAXED' | 'MODERATE' | 'ACTIVE';
        const paceConfig = PLANNER_CONFIG.RANKING.PACE_MODIFIERS[paceKey];
        if (paceConfig) MAX_PER_DAY = paceConfig.MAX_ACTIVITIES_PER_DAY;

        this.logger.log(
          `[itinerary] userId=${userId} pace=${pace} maxPerDay=${MAX_PER_DAY}`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to apply user pace: ${(error as Error).message}`,
        );
      }
    }

    const maxTotalActivities = Math.min(
      dayCount * MAX_PER_DAY,
      PLANNER_CONFIG.ACTIVITIES.MAX_TOTAL,
      scored.length,
    );

    const selectedResults = this.selectDiverseActivities(
      scored,
      maxTotalActivities,
      preferences,
    );
    const dayBuckets = this.allocateAcrossDays(
      selectedResults,
      dayCount,
      MAX_PER_DAY,
    );

    const dayPlans: DayPlan[] = [];
    const baseDate = this.parseLocalDate(startDate);
    const seenText = new Set<string>();

    for (let day = 1; day <= dayCount; day++) {
      const dayDate = this.addDaysLocal(baseDate, day - 1);

      const bucket = dayBuckets[day - 1] ?? [];
      const activitiesForDay: EnhancedItineraryItemDto[] = [];

      for (let i = 0; i < bucket.length; i++) {
        const result = bucket[i];
        const scoredResult = scored.find((s) => s.id === result.id);
        const priorityScore = scoredResult?.priorityScore || 0;

        const category = this.determineActivityCategory(
          result.title,
          result.content,
          day,
          i,
          preferences,
          result.id,
        );

        const normalizedText = `${result.title} ${result.content}`
          .toLowerCase()
          .trim();
        const novelty = this.computeNovelty(normalizedText, seenText);
        seenText.add(normalizedText);

        const totalDays = dayCount;

        if (!scoredResult) {
          continue; // should never happen, but safe guard
        }

        const timeSlot = this.assignTimeSlot(
          scoredResult,
          i,
          bucket.length,
          day,
          totalDays,
        );

        const activityItem: EnhancedItineraryItemDto = {
          order: i + 1,
          dayNumber: day,
          placeName: result.title,
          shortDescription: result.content,
          category,
          timeSlot,
          estimatedDuration: this.estimateDuration(category),
          confidenceScore: result.confidence || 'Low',
          priority: this.q(priorityScore, 2),
          explanation: await this.buildRichExplanationPersonalized(
            result,
            priorityScore,
            category,
            {
              destination,
              dayNumber: day,
              totalDays: dayCount,
              activityIndex: i,
              activitiesInDay: bucket.length,
              preferences,
              novelty,
              isFallback: false,
              timeSlot,
            },
            userId,
          ),
        };

        activitiesForDay.push(activityItem);

        activityItem.dayPlacementReason = this.generateDayPlacementExplanation(
          day,
          activityItem,
          dayCount,
          activitiesForDay,
        );
      }

      if (activitiesForDay.length === 0) {
        activitiesForDay.push(this.createSingleDayFallback(day, destination));
      }

      if (day === 1 && activitiesForDay.length > 0) {
        activitiesForDay[0].category = 'Arrival';
        activitiesForDay[0].timeSlot = 'Afternoon';
        activitiesForDay[0].estimatedDuration = '2-3 hours';
      }

      const themeData = this.generateDayTheme(activitiesForDay);
      const groupingReason = this.generateGroupingExplanation(activitiesForDay);

      dayPlans.push({
        day,
        date: this.formatLocalDate(dayDate),
        theme: themeData.theme,
        themeExplanation: themeData.explanation,
        groupingReason,
        activities: activitiesForDay,
      });
    }

    const endItin = process.hrtime.bigint();
    const totalItinTime = Number(endItin - startItin) / 1_000_000;
    this.logger.log(
      `[PERF] generateItinerary took ${totalItinTime.toFixed(2)}ms`,
    );

    return { plans: dayPlans, usedFallback: false };
  }

  /* ==================== META / REGION GATE ==================== */

  private extractMeta(content: string): { near: string[]; region?: string } {
    const nearMatch = content.match(/Near:\s*([^\n]+)/i);
    const regionMatch = content.match(/Region:\s*([^\n]+)/i);

    const near = nearMatch
      ? nearMatch[1]
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const region = regionMatch
      ? regionMatch[1].trim().toLowerCase()
      : undefined;

    return { near, region };
  }

  private getDestinationRegion(destination?: string): string | undefined {
    const dest = this.normalizeLower(destination);
    if (!dest) return undefined;

    const map: Record<string, string> = {
      galle: 'south',
      'galle fort': 'south',
      unawatuna: 'south',
      hikkaduwa: 'south',
      mirissa: 'south',
      bentota: 'south',
      kandy: 'kandy',
      sigiriya: 'cultural_triangle',
      dambulla: 'cultural_triangle',
      trincomalee: 'east_coast',
      nilaveli: 'east_coast',
      nuwara: 'hill_country',
      'nuwara eliya': 'hill_country',
      ella: 'hill_country',
      yala: 'safari_south',
      udawalawe: 'safari_south',
    };

    return map[dest];
  }

  private gateByNearOrRegion(
    results: SearchResultItem[],
    destination?: string,
  ): SearchResultItem[] {
    const dest = this.normalizeLower(destination);
    if (!dest || dest.length < 3) return results;

    const destRegion = this.getDestinationRegion(dest);
    const destTokens = dest.split(/\s+/).filter(Boolean);

    const kept = results.filter((r) => {
      const text = `${r.title} ${r.content}`.toLowerCase();
      const { near, region } = this.extractMeta(text);

      const nearHit = destTokens.some((t) => near.includes(t));
      const regionHit = destRegion && region && region === destRegion;
      const directHit = destTokens.some((t) => text.includes(t));

      return nearHit || regionHit || directHit;
    });

    return kept.length > 0 ? kept : results;
  }

  /* ==================== SUMMARY / MESSAGING ==================== */

  private computePlanConfidence(
    dayByDayPlan: DayPlan[],
  ): 'High' | 'Medium' | 'Low' {
    const all = dayByDayPlan.flatMap((d) => d.activities);
    if (all.length === 0) return 'Low';

    const high = all.filter((a) => a.confidenceScore === 'High').length;
    const medium = all.filter((a) => a.confidenceScore === 'Medium').length;

    if (high >= Math.max(1, Math.ceil(all.length * 0.4))) return 'High';
    if (high + medium >= Math.max(1, Math.ceil(all.length * 0.6)))
      return 'Medium';
    return 'Low';
  }

  private computePreferencesMatched(
    preferences: string[],
    dayByDayPlan: DayPlan[],
  ): string[] {
    if (!preferences.length) return [];

    const allCategories = dayByDayPlan.flatMap((d) =>
      d.activities.map((a) => a.category),
    );
    const categoriesSet = new Set(allCategories.map((c) => c.toLowerCase()));

    const matched: string[] = [];

    for (const pref of preferences) {
      const key = pref.toLowerCase();
      const mapped = this.INTEREST_CATEGORY_MAP[key];

      if (mapped?.length) {
        const ok = mapped.some((c) => categoriesSet.has(c.toLowerCase()));
        if (ok) matched.push(pref);
        continue;
      }

      if (categoriesSet.has(key)) matched.push(pref);
    }

    const seen = new Set<string>();
    return matched.filter((m) => {
      const k = m.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private buildFinalMessage(
    usedFallback: boolean,
    planConfidence: 'High' | 'Medium' | 'Low',
    preferencesMatched: string[],
  ): string {
    if (usedFallback) {
      return 'We created a basic plan, but found limited strong matches. Try adding specific interests (like "beach" or "temples") or nearby town names for better results.';
    }

    if (planConfidence === 'High') {
      if (preferencesMatched.length > 0) {
        return `Great! We found strong matches for ${preferencesMatched.join(', ')}.`;
      }
      return 'Great! We found strong suggestions for your destination.';
    }

    if (planConfidence === 'Medium') {
      if (preferencesMatched.length > 0) {
        return `Good matches found for ${preferencesMatched.join(', ')}. Some activities have lower confidence.`;
      }
      return 'We found some good options, though some have lower confidence.';
    }

    return 'We found limited strong matches. Try adding more specific preferences or nearby locations for better suggestions.';
  }

  /* ==================== TRIP PLAN ENDPOINT (Saved Trip Context Integrated) ==================== */

  @Post('trip-plan')
  async tripPlanEnhanced(
    @Req() req: Request,
    @Body() body: TripPlanRequestDto,
  ): Promise<TripPlanResponseDto> {
    const authUserId = (req as AuthenticatedRequest).user?.id;
    const headerUserId =
      (req.headers['x-user-id'] as string | undefined) || undefined;
    const userId: string | undefined = authUserId || headerUserId;

    const startTotal = process.hrtime.bigint();

    const prefValidation = this.validatePreferences(body.preferences);

    if (!prefValidation.valid) {
      const destination = this.normalizeText(body.destination) || 'Unknown';
      const start =
        this.toDateOnly(body.startDate) || this.formatLocalDate(new Date());
      const end = this.toDateOnly(body.endDate) || start;

      return {
        plan: {
          destination,
          dates: { start, end },
          totalDays: this.clampDayCount(start, end),
          dayByDayPlan: [],
          summary: {
            totalActivities: 0,
            categoriesIncluded: [],
            preferencesMatched: [],
            planConfidence: 'Low',
            usedFallback: false,
            usedSavedContext: false,
          },
        },
        message: prefValidation.warning || 'Invalid preferences provided.',
      };
    }

    let savedTrip: SavedTrip | null = null;

    if (userId && this.shouldUseSavedContext(body)) {
      try {
        savedTrip = body.tripId
          ? await this.tripStore.getByIdForUser(userId, body.tripId)
          : await this.tripStore.getLatestForUser(userId);
      } catch {
        savedTrip = null;
      }
    }

    const usedSavedContext = Boolean(savedTrip);
    const sourceTripId = savedTrip?.id;

    const destinationRaw =
      this.normalizeText(body.destination) ||
      (savedTrip ? this.normalizeText(savedTrip.destination) : '');

    const destination = destinationRaw || 'Unknown';
    const destinationLower = this.normalizeLower(destinationRaw);

    const startDateStr =
      this.toDateOnly(body.startDate) ||
      (savedTrip ? this.toDateOnly(savedTrip.startDate) : '') ||
      this.formatLocalDate(new Date());

    const endDateStr =
      this.toDateOnly(body.endDate) ||
      (savedTrip ? this.toDateOnly(savedTrip.endDate) : '') ||
      startDateStr;

    const preferencesFromBody = this.normalizePreferences(body.preferences);
    const preferencesFromSaved = savedTrip
      ? this.normalizePreferences(savedTrip.preferences)
      : [];

    const preferences = savedTrip
      ? this.mergePreferencesDeterministic(
          preferencesFromSaved,
          preferencesFromBody,
        )
      : preferencesFromBody;

    const dayCount = this.clampDayCount(startDateStr, endDateStr);

    // ===============================
    // NORMAL SEARCH FLOW ONLY SHOWN
    // ===============================

    const searchTerms = [
      destinationLower,
      'attractions',
      'places to visit',
      ...preferences.map((p) => p.toLowerCase()),
    ];

    const query = searchTerms.join(' ');
    const searchResults = await this.executeSearch(query);
    const gated = this.gateByNearOrRegion(
      searchResults.results,
      destinationLower,
    );

    const { plans: dayByDayPlan, usedFallback } = await this.generateItinerary(
      gated,
      dayCount,
      startDateStr,
      preferences,
      destinationLower,
      userId,
    );

    const allCategoriesInPlan = dayByDayPlan.flatMap((d) =>
      d.activities.map((a) => a.category),
    );

    const preferencesMatched = this.computePreferencesMatched(
      preferences,
      dayByDayPlan,
    );

    const planConfidence = this.computePlanConfidence(dayByDayPlan);

    const response: TripPlanResponseDto = {
      plan: {
        destination,
        dates: { start: startDateStr, end: endDateStr },
        totalDays: dayCount,
        dayByDayPlan,
        summary: {
          totalActivities: dayByDayPlan.reduce(
            (sum, d) => sum + d.activities.length,
            0,
          ),
          categoriesIncluded: [...new Set(allCategoriesInPlan)],
          preferencesMatched,
          planConfidence,
          usedFallback,
          usedSavedContext,
        },
      },
      message: this.buildFinalMessage(
        usedFallback,
        planConfidence,
        preferencesMatched,
      ),
    };

    let savedMeta: { tripId: string; versionNo: number } | null = null;

    if (userId) {
      try {
        const feedbackSignal = await this.buildFeedbackSignal(
          userId,
          savedTrip?.id,
        );

        const saved = await this.tripStore.saveTripVersion({
          userId,
          tripId: savedTrip?.id,
          destination: response.plan.destination,
          startDate: startDateStr,
          endDate: endDateStr,
          preferences,
          planJson: response.plan,
          aiMeta: {
            model: 'gpt-4.1-mini',
            temperature: 0,
            plannerVersion: ALGORITHM_VERSION,
            feedbackSignal,
          },
        });

        savedMeta = {
          tripId: saved.tripId,
          versionNo: saved.versionNo,
        };
      } catch (e) {
        this.logger.error(
          `[trip-plan] saveTripVersion failed: ${(e as Error).message}`,
        );
      }
    }

    // ===============================
    // Attach metadata + feedback
    // ===============================
    type FeedbackSignal = {
      previousRating: number | null;
      feedbackCount: number;
    } | null;

    let feedbackResponse: FeedbackSignal = null;

    if (userId && savedMeta?.tripId) {
      feedbackResponse = await this.buildFeedbackSignal(
        userId,
        savedMeta.tripId,
      );
    }

    response.plan.summary = {
      ...response.plan.summary,
      tripId: savedMeta?.tripId,
      versionNo: savedMeta?.versionNo,
      sourceTripId,
      feedback: feedbackResponse,
    };

    const endTotal = process.hrtime.bigint();
    const totalTime = Number(endTotal - startTotal) / 1_000_000;

    if (userId) {
      this.analyticsService
        .recordEvent(
          'planner',
          'planner_generated',
          userId,
          {
            tripId: savedMeta?.tripId,
            destination: response.plan.destination,
            durationMs: totalTime,
          },
          crypto.randomUUID(),
          new Date(),
        )
        .catch((e) =>
          console.error('Failed to record planner_generated event', e),
        );
    }

    this.logger.log(`[PERF] tripPlanEnhanced took ${totalTime.toFixed(2)}ms`);

    return response;
  }

  @Post('log-activity')
  async logActivity(
    @Req() req: Request,
    @Body() body: LogActivityDto,
  ): Promise<{ success: boolean }> {
    const userId =
      (req as AuthenticatedRequest).user?.id ||
      (req.headers['x-user-id'] as string | undefined);

    if (!userId) {
      this.logger.warn('[log-activity] No userId provided');
      return { success: false };
    }

    try {
      await this.tripStore.logActivityInteraction({
        userId,
        placeId: body.placeId,
        placeName: body.placeName,
        category: body.category,
        action: body.action,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `[log-activity] userId=${userId} place=${body.placeName} action=${body.action}`,
      );
      return { success: true };
    } catch (error) {
      this.logger.error(`[log-activity] Failed: ${(error as Error).message}`);
      return { success: false };
    }
  }
}
