/* eslint-disable */
 
// @ts-nocheck

import { PlannerRankingService } from './planner-ranking.service';
import { PlannerAggregationService } from './planner-aggregation.service';

describe.skip('PlannerRankingService', () => {
  let service: PlannerRankingService;
  let aggregationService: PlannerAggregationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlannerRankingService,
        {
          provide: PlannerAggregationService,
          useValue: {
            aggregateTripFeedback: jest.fn(),
            aggregateByDestination: jest.fn(),
            aggregateByCategory: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PlannerRankingService>(PlannerRankingService);
    aggregationService = module.get<PlannerAggregationService>(
      PlannerAggregationService,
    );

    jest.clearAllMocks();
  });

  describe('calculateTripWeight - Threshold Enforcement', () => {
    it('should NOT apply weight adjustment with less than 3 ratings', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 2,
        positiveCount: 2,
        negativeCount: 0,
        averageRating: 5.0,
        hasMinimumThreshold: false,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.meetsThreshold).toBe(false);
      expect(result.feedbackWeight).toBe(0);
      expect(result.adjustedScore).toBe(1.0); // No adjustment
      expect(result.reason).toContain('Insufficient feedback');
      expect(result.reason).toContain('2/3');
    });

    it('should apply weight adjustment with exactly 3 ratings', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 3,
        positiveCount: 3,
        negativeCount: 0,
        averageRating: 5.0,
        hasMinimumThreshold: true,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.meetsThreshold).toBe(true);
      expect(result.feedbackWeight).toBeGreaterThan(0); // Should get positive weight
      expect(result.adjustedScore).toBeGreaterThan(1.0);
    });
  });

  describe('calculateTripWeight - Weight Calculation', () => {
    it('should give maximum positive weight for all positive feedback', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 5,
        positiveCount: 5,
        negativeCount: 0,
        averageRating: 5.0,
        hasMinimumThreshold: true,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.meetsThreshold).toBe(true);
      expect(result.feedbackWeight).toBe(0.3); // Maximum positive
      expect(result.adjustedScore).toBe(1.3);
      expect(result.reason).toContain('100% positive');
      expect(result.reason).toContain('highly positive');
    });

    it('should give maximum negative weight for all negative feedback', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 5,
        positiveCount: 0,
        negativeCount: 5,
        averageRating: 2.0,
        hasMinimumThreshold: true,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.meetsThreshold).toBe(true);
      expect(result.feedbackWeight).toBe(-0.3); // Maximum negative
      expect(result.adjustedScore).toBe(0.7);
      expect(result.reason).toContain('0% positive');
    });

    it('should give zero weight for 50/50 mixed feedback', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 4,
        positiveCount: 2,
        negativeCount: 2,
        averageRating: 3.5,
        hasMinimumThreshold: true,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.meetsThreshold).toBe(true);
      expect(result.feedbackWeight).toBe(0); // No adjustment for 50/50
      expect(result.adjustedScore).toBe(1.0);
      expect(result.reason).toContain('50% positive');
    });

    it('should apply small positive weight for 75% positive feedback', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 4,
        positiveCount: 3,
        negativeCount: 1,
        averageRating: 4.25,
        hasMinimumThreshold: true,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.meetsThreshold).toBe(true);
      // 75% positive = 0.75, formula: (0.75 - 0.5) * 2 * 0.3 = 0.15
      expect(result.feedbackWeight).toBe(0.15);
      expect(result.adjustedScore).toBe(1.15);
      expect(result.reason).toContain('75% positive');
      expect(result.reason).toContain('mostly positive');
    });

    it('should apply small negative weight for 25% positive feedback', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 4,
        positiveCount: 1,
        negativeCount: 3,
        averageRating: 2.75,
        hasMinimumThreshold: true,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.meetsThreshold).toBe(true);
      // 25% positive = 0.25, formula: (0.25 - 0.5) * 2 * 0.3 = -0.15
      expect(result.feedbackWeight).toBe(-0.15);
      expect(result.adjustedScore).toBe(0.85);
      expect(result.reason).toContain('25% positive');
      expect(result.reason).toContain('mostly negative');
    });
  });

  describe('calculateTripWeight - Bias Prevention', () => {
    it('should cap weight at maximum +0.3 even with extreme data', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 100,
        positiveCount: 100,
        negativeCount: 0,
        averageRating: 5.0,
        hasMinimumThreshold: true,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.feedbackWeight).toBeLessThanOrEqual(0.3);
      expect(result.adjustedScore).toBeLessThanOrEqual(1.3);
    });

    it('should cap weight at maximum -0.3 even with extreme data', async () => {
      const tripId = 'test-trip';
      const mockAggregation = {
        totalFeedback: 100,
        positiveCount: 0,
        negativeCount: 100,
        averageRating: 1.0,
        hasMinimumThreshold: true,
      };

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockResolvedValue(mockAggregation);

      const result = await service.calculateTripWeight(tripId, 1.0);

      expect(result.feedbackWeight).toBeGreaterThanOrEqual(-0.3);
      expect(result.adjustedScore).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('sortTripsByFeedback', () => {
    it('should sort trips by adjusted score in descending order', async () => {
      const trips = [
        { id: 'trip1', baseScore: 1.0 },
        { id: 'trip2', baseScore: 1.0 },
        { id: 'trip3', baseScore: 1.0 },
      ];

      jest
        .spyOn(aggregationService, 'aggregateTripFeedback')
        .mockImplementation((tripId: string) => {
          if (tripId === 'trip1') {
            return Promise.resolve({
              totalFeedback: 5,
              positiveCount: 5,
              negativeCount: 0,
              averageRating: 5.0,
              hasMinimumThreshold: true,
            });
          }
          if (tripId === 'trip2') {
            return Promise.resolve({
              totalFeedback: 5,
              positiveCount: 2,
              negativeCount: 3,
              averageRating: 3.0,
              hasMinimumThreshold: true,
            });
          }
          // trip3 - insufficient feedback
          return Promise.resolve({
            totalFeedback: 2,
            positiveCount: 2,
            negativeCount: 0,
            averageRating: 5.0,
            hasMinimumThreshold: false,
          });
        });

      const sorted = await service.sortTripsByFeedback(trips);

      // trip1 should be first (highest positive feedback)
      expect(sorted[0].id).toBe('trip1');
      expect(sorted[0].score).toBeGreaterThan(1.0);

      // trip3 should be second (no adjustment, so base score 1.0)
      expect(sorted[1].id).toBe('trip3');
      expect(sorted[1].score).toBe(1.0);

      // trip2 should be last (negative adjustment)
      expect(sorted[2].id).toBe('trip2');
      expect(sorted[2].score).toBeLessThan(1.0);
    });
  });
});
