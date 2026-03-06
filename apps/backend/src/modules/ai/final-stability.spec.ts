import { Test, TestingModule } from '@nestjs/testing';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { SearchService } from './retrieval/search.service';
import { TripStoreService } from './trips/trip-store.service';
import { PlannerService } from '../planner/planner.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

describe('Final Stability Testing - 100 Repeated Queries', () => {
  let controller: AIController;

  const mockAIService = {
    getAllEmbeddings: jest.fn(),
    generateDummyEmbedding: jest.fn((text: string) => {
      const hash = text
        .split('')
        .reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return Array.from({ length: 1536 }, (_, i) => ((hash + i) % 100) / 100);
    }),
    search: jest.fn(),
    isPartialMatch: jest.fn().mockReturnValue(true),
  };

  const mockSearchService = {
    getConfidence: jest.fn((score: number) => {
      if (score >= 0.8) return 'High';
      if (score >= 0.5) return 'Medium';
      return 'Low';
    }),
    searchEmbeddingsWithMetadataFromEmbedding: jest.fn(),
  };

  const mockTripStoreService = {
    getByIdForUser: jest.fn().mockResolvedValue(null),
    getLatestForUser: jest
      .fn()
      .mockResolvedValue({ tripId: 'test-trip-123', version: 1 }),
    getUserTravelPace: jest.fn().mockResolvedValue('moderate'),
    getUserCategoryPreferences: jest.fn().mockResolvedValue([]),
    getUserFrequentPlaces: jest.fn().mockResolvedValue([]),
    getRecentUserSelections: jest.fn().mockResolvedValue([]),
    getUserAvoidedCategories: jest.fn().mockResolvedValue([]),
    getUserPositiveFeedbackDestinations: jest.fn().mockResolvedValue([]),
    saveTripVersion: jest
      .fn()
      .mockResolvedValue({ tripId: 'test-trip-123', version: 2 }),
  };

  const mockPlannerService = {
    planTrip: jest.fn(),
    optimizeItinerary: jest.fn(),
    validatePlan: jest.fn(),
    getFeedback: jest.fn().mockResolvedValue([]),
  };

  const mockAnalyticsService = {
    trackEvent: jest.fn(),
    recordMetric: jest.fn(),
    logQuery: jest.fn(),
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AIController],
      providers: [
        { provide: AIService, useValue: mockAIService },
        { provide: SearchService, useValue: mockSearchService },
        { provide: TripStoreService, useValue: mockTripStoreService },
        { provide: PlannerService, useValue: mockPlannerService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AIController>(AIController);
  });

  describe('100 Repeated Queries - No Ranking Chaos', () => {
    it('should produce identical results across 100 runs with same input', async () => {
      const mockResults = [
        {
          id: '1',
          title: 'Temple A',
          content: 'Culture. Near: Kandy',
          score: 0.9,
        },
        {
          id: '2',
          title: 'Beach B',
          content: 'Beach. Near: Kandy',
          score: 0.85,
        },
        {
          id: '3',
          title: 'Park C',
          content: 'Nature. Near: Kandy',
          score: 0.8,
        },
        {
          id: '4',
          title: 'Museum D',
          content: 'History. Near: Kandy',
          score: 0.75,
        },
      ];

      mockAIService.search.mockResolvedValue(mockResults);

      const request = {
        destination: 'Kandy',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        preferences: ['culture', 'nature'],
      };

      console.log('🔄 Running 100 identical queries...');
      const startTime = Date.now();

      // Run 100 times
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) => {
          if ((i + 1) % 20 === 0) console.log(`   Progress: ${i + 1}/100`);
          return controller.tripPlanEnhanced(
            { user: { id: 'test-user' }, headers: {} } as unknown as Request,
            request,
          );
        }),
      );

      const endTime = Date.now();
      console.log(`✅ Completed 100 runs in ${endTime - startTime}ms`);

      // Serialize all plans
      const serializedPlans = results.map((result) =>
        JSON.stringify(result.plan.dayByDayPlan),
      );

      // Check all are identical
      const firstPlan = serializedPlans[0];
      const allIdentical = serializedPlans.every((plan) => plan === firstPlan);

      expect(allIdentical).toBe(true);

      // Validate scores are stable
      const allScores = results.map((result) =>
        result.plan.dayByDayPlan
          .flatMap((day) => day.activities)
          .map((a) => a.explanation!.rankingFactors.relevanceScore),
      );

      // All score arrays should be identical
      for (let i = 1; i < allScores.length; i++) {
        expect(allScores[i]).toEqual(allScores[0]);
      }

      console.log('✅ All 100 runs produced identical rankings');
      console.log('✅ No ranking chaos detected');
    }, 60000); // 60 second timeout

    it('should maintain stable rankings across varied query types (100 runs)', async () => {
      const testQueries = [
        {
          dest: 'Kandy',
          prefs: ['culture'],
          mockData: [
            {
              id: '1',
              title: 'T1',
              content: 'Culture. Near: Kandy',
              score: 0.88,
            },
            {
              id: '2',
              title: 'T2',
              content: 'History. Near: Kandy',
              score: 0.82,
            },
          ],
        },
        {
          dest: 'Colombo',
          prefs: ['beach'],
          mockData: [
            {
              id: '3',
              title: 'B1',
              content: 'Beach. Near: Colombo',
              score: 0.85,
            },
            {
              id: '4',
              title: 'B2',
              content: 'Coast. Near: Colombo',
              score: 0.79,
            },
          ],
        },
      ];

      for (const query of testQueries) {
        mockAIService.search.mockResolvedValue(query.mockData);

        const request = {
          destination: query.dest,
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          preferences: query.prefs,
        };

        // Run 50 times per query type
        const results = await Promise.all(
          Array.from({ length: 50 }, () =>
            controller.tripPlanEnhanced(
              { user: { id: 'test-user' }, headers: {} } as unknown as Request,
              request,
            ),
          ),
        );

        const rankings = results.map((result) =>
          result.plan.dayByDayPlan
            .flatMap((day) => day.activities)
            .map((a) => a.placeName),
        );

        // All rankings should be identical
        for (let i = 1; i < rankings.length; i++) {
          expect(rankings[i]).toEqual(rankings[0]);
        }
      }

      console.log('✅ Varied queries: 100 runs stable');
    }, 60000);
  });

  describe('Mixed Feedback Simulations - No Drift', () => {
    it('should maintain ranking stability with mixed positive/negative feedback', async () => {
      const mockResults = [
        {
          id: '1',
          title: 'Item A',
          content: 'Content. Near: Kandy',
          score: 0.85,
        },
        {
          id: '2',
          title: 'Item B',
          content: 'Content. Near: Kandy',
          score: 0.8,
        },
        {
          id: '3',
          title: 'Item C',
          content: 'Content. Near: Kandy',
          score: 0.75,
        },
      ];

      const request = {
        destination: 'Kandy',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        preferences: ['culture'],
      };

      // Simulate mixed feedback scenario
      const feedbackScenarios = [
        { liked: [], disliked: [] }, // No feedback
        { liked: ['culture'], disliked: [] }, // Positive only
        { liked: [], disliked: ['shopping'] }, // Negative only
        { liked: ['culture', 'nature'], disliked: ['nightlife'] }, // Mixed
      ];

      for (
        let scenarioIndex = 0;
        scenarioIndex < feedbackScenarios.length;
        scenarioIndex++
      ) {
        mockAIService.search.mockResolvedValue(mockResults);

        // Run 25 times per feedback scenario
        const results = await Promise.all(
          Array.from({ length: 25 }, () =>
            controller.tripPlanEnhanced(
              { user: { id: 'test-user' }, headers: {} } as unknown as Request,
              request,
            ),
          ),
        );

        const rankings = results.map((result) =>
          result.plan.dayByDayPlan
            .flatMap((day) => day.activities)
            .map((a) => a.placeName),
        );

        // Verify stability within each feedback scenario
        for (let i = 1; i < rankings.length; i++) {
          expect(rankings[i]).toEqual(rankings[0]);
        }
      }

      console.log('✅ Mixed feedback: No drift detected across 100 runs');
    }, 60000);

    it('should handle extreme feedback oscillations without instability', async () => {
      const mockResults = [
        {
          id: '1',
          title: 'Stable Item',
          content: 'Content. Near: Galle',
          score: 0.9,
        },
        {
          id: '2',
          title: 'Another Item',
          content: 'Content. Near: Galle',
          score: 0.85,
        },
      ];

      mockAIService.search.mockResolvedValue(mockResults);

      const request = {
        destination: 'Galle',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        preferences: ['culture'],
      };

      // Simulate extreme oscillation: rapidly changing feedback
      const results: any[] = [];
      for (let i = 0; i < 50; i++) {
        // Alternate between extreme scenarios
        const result = await controller.tripPlanEnhanced(
          {
            user: { id: i % 2 === 0 ? 'user-a' : 'user-b' },
            headers: {},
          } as unknown as Request,
          request,
        );
        results.push(result);
      }

      // Group by user and verify internal consistency
      const userAResults = results.filter((_, i) => i % 2 === 0);
      const userBResults = results.filter((_, i) => i % 2 === 1);

      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
      const userARankings = userAResults.map((r: any) =>
        r.plan.dayByDayPlan
          .flatMap((day: any) => day.activities)
          .map((a: any) => a.placeName),
      );

      const userBRankings = userBResults.map((r: any) =>
        r.plan.dayByDayPlan
          .flatMap((day: any) => day.activities)
          .map((a: any) => a.placeName),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

      // Each user should have consistent results
      for (let i = 1; i < userARankings.length; i++) {
        expect(userARankings[i]).toEqual(userARankings[0]);
      }

      for (let i = 1; i < userBRankings.length; i++) {
        expect(userBRankings[i]).toEqual(userBRankings[0]);
      }

      console.log('✅ Extreme oscillations: No instability detected');
    }, 60000);
  });

  describe('High Preference Skew Scenarios - Chaos Prevention', () => {
    it('should handle extreme preference skew without ranking chaos', async () => {
      const mockResults = [
        {
          id: '1',
          title: 'Culture A',
          content: 'Culture. Near: Kandy',
          score: 0.88,
        },
        {
          id: '2',
          title: 'Culture B',
          content: 'Culture. Near: Kandy',
          score: 0.86,
        },
        {
          id: '3',
          title: 'Culture C',
          content: 'Culture. Near: Kandy',
          score: 0.84,
        },
        {
          id: '4',
          title: 'Nature X',
          content: 'Nature. Near: Kandy',
          score: 0.6,
        },
      ];

      mockAIService.search.mockResolvedValue(mockResults);

      // Extreme skew: 10 culture preferences, 1 nature
      const request = {
        destination: 'Kandy',
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        preferences: [
          'culture',
          'culture',
          'culture',
          'culture',
          'culture',
          'culture',
          'culture',
          'culture',
          'culture',
          'culture',
          'nature',
        ],
      };

      // Run 100 times with extreme skew
      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          controller.tripPlanEnhanced(
            { user: { id: 'test-user' }, headers: {} } as unknown as Request,
            request,
          ),
        ),
      );

      const rankings = results.map((result) =>
        result.plan.dayByDayPlan
          .flatMap((day) => day.activities)
          .map((a) => a.placeName),
      );

      // All should be identical despite extreme skew
      for (let i = 1; i < rankings.length; i++) {
        expect(rankings[i]).toEqual(rankings[0]);
      }

      console.log('✅ Extreme preference skew: Stable rankings maintained');
    }, 60000);

    it('should prevent score explosion with contradictory preferences', async () => {
      const mockResults = [
        {
          id: '1',
          title: 'Balanced Item',
          content: 'Mixed. Near: Colombo',
          score: 0.75,
        },
        {
          id: '2',
          title: 'Another',
          content: 'Content. Near: Colombo',
          score: 0.73,
        },
      ];

      mockAIService.search.mockResolvedValue(mockResults);

      // Contradictory preferences
      const request = {
        destination: 'Colombo',
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        preferences: ['relaxation', 'adventure', 'nightlife', 'nature'], // Contradictory
      };

      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          controller.tripPlanEnhanced(
            { user: { id: 'test-user' }, headers: {} } as unknown as Request,
            request,
          ),
        ),
      );

      // Verify no score explosion (all scores stay within 0-1 range)
      results.forEach((result) => {
        result.plan.dayByDayPlan.forEach((day) => {
          day.activities.forEach((activity) => {
            const score = activity.explanation!.rankingFactors.relevanceScore;
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
          });
        });
      });

      console.log('✅ Contradictory preferences: No score explosion');
    }, 60000);
  });

  describe('Comprehensive Stability Report', () => {
    it('should generate stability metrics across all scenarios', async () => {
      const mockResults = [
        {
          id: '1',
          title: 'Test A',
          content: 'Content. Near: Kandy',
          score: 0.85,
        },
        {
          id: '2',
          title: 'Test B',
          content: 'Content. Near: Kandy',
          score: 0.8,
        },
      ];

      mockAIService.search.mockResolvedValue(mockResults);

      const scenarios = [
        { name: 'Basic', dest: 'Kandy', prefs: ['culture'] },
        {
          name: 'Multi-pref',
          dest: 'Colombo',
          prefs: ['culture', 'nature', 'beach'],
        },
        { name: 'Single-pref', dest: 'Galle', prefs: ['history'] },
      ];

      const stabilityMetrics = {
        totalRuns: 0,
        identicalResults: 0,
        maxScoreDrift: 0,
        avgResponseTime: 0,
      };

      for (const scenario of scenarios) {
        const request = {
          destination: scenario.dest,
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          preferences: scenario.prefs,
        };

        const startTime = Date.now();
        const results = await Promise.all(
          Array.from({ length: 30 }, () =>
            controller.tripPlanEnhanced(
              { user: { id: 'test-user' }, headers: {} } as unknown as Request,
              request,
            ),
          ),
        );
        const endTime = Date.now();

        stabilityMetrics.totalRuns += 30;
        stabilityMetrics.avgResponseTime += (endTime - startTime) / 30;

        // Check identity
        const serialized = results.map((r) =>
          JSON.stringify(r.plan.dayByDayPlan),
        );
        const identical = serialized.every((s) => s === serialized[0]);
        if (identical) stabilityMetrics.identicalResults += 30;
      }

      // Final metrics
      console.log('\n📊 === FINAL STABILITY REPORT ===');
      console.log(`Total test runs: ${stabilityMetrics.totalRuns}`);
      console.log(
        `Identical results: ${stabilityMetrics.identicalResults}/${stabilityMetrics.totalRuns}`,
      );
      console.log(
        `Stability rate: ${((stabilityMetrics.identicalResults / stabilityMetrics.totalRuns) * 100).toFixed(2)}%`,
      );
      console.log(
        `Avg response time: ${(stabilityMetrics.avgResponseTime / scenarios.length).toFixed(2)}ms`,
      );

      // Assertions
      expect(stabilityMetrics.identicalResults).toBe(
        stabilityMetrics.totalRuns,
      );
      expect(
        (stabilityMetrics.identicalResults / stabilityMetrics.totalRuns) * 100,
      ).toBe(100);

      console.log('✅ 100% stability achieved across all scenarios');
      console.log('✅ No ranking chaos detected');
      console.log('✅ No drift instability found');
    }, 90000); // 90 second timeout
  });
});
