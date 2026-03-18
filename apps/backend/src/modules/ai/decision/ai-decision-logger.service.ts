// apps/backend/src/modules/ai/decision/ai-decision-logger.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsService } from '../../analytics/analytics.service';
import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivityDecisionFactors {
  placeName: string;
  category: string;
  day: number;
  timeSlot?: string;

  // Raw scores
  baseScore: number;
  finalScore: number;
  personalizationBoost: number;

  // Derived influence percentages
  preferenceInfluencePct: number; // how much preferences moved the score
  feedbackInfluencePct: number; // how much user feedback history moved the score

  // Learning signal
  trustScore: number;
  trustMultiplier: number;
  categoryMultiplier: number;
  feedbackCount: number;

  // Confidence
  confidenceLevel: string;

  // Detailed adjustments list from rankingDetails
  adjustments: string[];
}

export interface TripPlanDecisionLog {
  sessionId: string;
  userId?: string;
  destination: string;
  totalDays: number;
  planConfidence: string;
  usedFallback: boolean;
  preferencesProvided: string[];
  preferencesMatched: string[];
  activities: ActivityDecisionFactors[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AIDecisionLoggerService {
  private readonly logger = new Logger(AIDecisionLoggerService.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Logs all AI ranking decision factors for a trip plan request.
   * Stored as a single PlannerEvent row with structured metadata.
   * Non-blocking — failures are caught and logged, never thrown.
   */
  async logTripPlanDecisions(log: TripPlanDecisionLog): Promise<void> {
    try {
      const summary = this.computeSummary(log.activities);

      const metadata = {
        sessionId: log.sessionId,
        destination: log.destination,
        totalDays: log.totalDays,
        planConfidence: log.planConfidence,
        usedFallback: log.usedFallback,
        preferencesProvided: log.preferencesProvided,
        preferencesMatched: log.preferencesMatched,
        summary,
        activities: log.activities,
      };

      await this.analyticsService.recordEvent(
        'planner',
        'ai_decision_factors',
        log.userId,
        metadata,
        `decision_${log.sessionId}`,
        new Date(),
      );

      this.logger.log(
        `[AIDecisionLog] Logged decision factors for session=${log.sessionId} ` +
          `destination=${log.destination} activities=${log.activities.length} ` +
          `avgPreferenceInfluence=${summary.avgPreferenceInfluencePct.toFixed(1)}% ` +
          `avgFeedbackInfluence=${summary.avgFeedbackInfluencePct.toFixed(1)}%`,
      );
    } catch (err) {
      // Non-blocking — observability logging should never break the main flow
      this.logger.error(
        `[AIDecisionLog] Failed to log decision factors: ${(err as Error).message}`,
      );
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private computeSummary(activities: ActivityDecisionFactors[]) {
    if (activities.length === 0) {
      return {
        totalActivities: 0,
        avgBaseScore: 0,
        avgFinalScore: 0,
        avgPersonalizationBoost: 0,
        avgPreferenceInfluencePct: 0,
        avgFeedbackInfluencePct: 0,
        avgTrustScore: 0,
        avgCategoryMultiplier: 0,
        categoriesRanked: [],
        topBoostReasons: [],
      };
    }

    const avg = (arr: number[]) =>
      parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4));

    // Count most frequent adjustment reasons across all activities
    const allAdjustments = activities.flatMap((a) => a.adjustments);
    const reasonCounts: Record<string, number> = {};
    for (const adj of allAdjustments) {
      // Normalise to just the reason prefix (strip the numeric value)
      const key = adj.replace(/[+-][\d.]+\)?$/, '').trim();
      reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
    }
    const topBoostReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    return {
      totalActivities: activities.length,
      avgBaseScore: avg(activities.map((a) => a.baseScore)),
      avgFinalScore: avg(activities.map((a) => a.finalScore)),
      avgPersonalizationBoost: avg(
        activities.map((a) => a.personalizationBoost),
      ),
      avgPreferenceInfluencePct: avg(
        activities.map((a) => a.preferenceInfluencePct),
      ),
      avgFeedbackInfluencePct: avg(
        activities.map((a) => a.feedbackInfluencePct),
      ),
      avgTrustScore: avg(activities.map((a) => a.trustScore)),
      avgCategoryMultiplier: avg(activities.map((a) => a.categoryMultiplier)),
      categoriesRanked: [...new Set(activities.map((a) => a.category))],
      topBoostReasons,
    };
  }

  // ─── Static helpers (used by ai.controller.ts to build the log) ─────────────

  /**
   * Computes influence percentages from raw scores.
   *
   * preferenceInfluencePct:
   *   What % of the final score came from preference boosts?
   *   = (finalScore - baseScore_after_confidence) / finalScore * 100
   *   Capped at 100%.
   *
   * feedbackInfluencePct:
   *   What % of the final score came from personalization (feedback history)?
   *   = personalizationBoost / finalScore * 100
   *   Capped at 100%.
   */
  static computeInfluencePcts(
    baseScore: number,
    finalScore: number,
    personalizationBoost: number,
  ): { preferenceInfluencePct: number; feedbackInfluencePct: number } {
    if (finalScore <= 0) {
      return { preferenceInfluencePct: 0, feedbackInfluencePct: 0 };
    }

    // Total score lift from base
    const totalLift = Math.max(0, finalScore - baseScore);

    // Feedback boost is known exactly
    const feedbackBoost = Math.max(0, personalizationBoost);

    // Preference boost = remaining lift after removing feedback boost
    const preferenceBoost = Math.max(0, totalLift - feedbackBoost);

    const preferenceInfluencePct = parseFloat(
      Math.min((preferenceBoost / finalScore) * 100, 100).toFixed(1),
    );

    const feedbackInfluencePct = parseFloat(
      Math.min((feedbackBoost / finalScore) * 100, 100).toFixed(1),
    );

    return { preferenceInfluencePct, feedbackInfluencePct };
  }

  /**
   * Generates a unique session ID for grouping all activities
   * from a single /trip-plan request.
   */
  static generateSessionId(): string {
    return randomUUID();
  }
}
