import { Test, TestingModule } from '@nestjs/testing';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { SearchService } from './retrieval/search.service';
import { TripStoreService } from './trips/trip-store.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TripPlanRequestDto } from './ai.controller';
import { Request } from 'express';

// Mock dependencies
const mockAIService = {
  getAllEmbeddings: jest.fn(),
  generateDummyEmbedding: jest.fn(),
  search: jest.fn().mockResolvedValue([]),
  isPartialMatch: jest.fn().mockReturnValue(true),
};

const mockSearchService = {
  getConfidence: jest.fn().mockReturnValue('High'),
  searchEmbeddingsWithMetadataFromEmbedding: jest.fn(),
};

const mockTripStoreService = {
  getByIdForUser: jest.fn(),
  getLatestForUser: jest.fn(),
  getUserTravelPace: jest.fn(),
  getUserCategoryPreferences: jest.fn(),
  getUserFrequentPlaces: jest.fn(),
  getRecentUserSelections: jest.fn(),
  getUserAvoidedCategories: jest.fn().mockResolvedValue([]),
};

describe.skip('AI Planner Consistency & Preferences', () => {
  let controller: AIController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AIController],
      providers: [
        { provide: AIService, useValue: mockAIService },
        { provide: SearchService, useValue: mockSearchService },
        { provide: TripStoreService, useValue: mockTripStoreService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AIController>(AIController);
  });

  describe('Preference Handling', () => {
    it('should use defaults when preferences are missing', async () => {
      // Setup mock data to ensure we don't hit fallback
      mockAIService.getAllEmbeddings.mockResolvedValue([]);
      const mockItem = {
        id: '1',
        title: 'Place A',
        content: 'Description A',
        score: 0.9,
      };
      mockAIService.search.mockResolvedValue([mockItem]);

      const request: TripPlanRequestDto = {
        destination: 'Kandy',
        startDate: '2026-03-01',
        endDate: '2026-03-03',
        preferences: [], // Empty preferences
      };

      const result = await controller.tripPlanEnhanced(
        { user: { id: 'test-user' }, headers: {} } as unknown as Request,
        request,
      );

      expect(result.plan).toBeDefined();
      expect(result.plan.summary.preferencesMatched).toEqual([]);
      // Should still generate a plan (even if fallback or basic)
      expect(result.plan.dayByDayPlan.length).toBeGreaterThan(0);
    });

    it('should prioritize items matching preferences', async () => {
      // Mock search results: one history item, one nature item
      const historyItem = {
        id: '1',
        title: 'Ancient Temple',
        content: 'History and culture of the ancient temple',
        score: 0.8,
      };
      const natureItem = {
        id: '2',
        title: 'Forest Park',
        content: 'Trees and nature',
        score: 0.8,
      };

      mockAIService.search.mockResolvedValue([historyItem, natureItem]);

      const requestWithHistory: TripPlanRequestDto = {
        destination: 'Kandy',
        startDate: '2026-03-01',
        endDate: '2026-03-01',
        preferences: ['history'],
      };

      const result = await controller.tripPlanEnhanced(
        { user: { id: 'test-user' }, headers: {} } as unknown as Request,
        requestWithHistory,
      );

      // Find if history item is prioritized or improved in score/ranking logic internally
      // Since we can't easily inspect internal variables, we check if the explanation mentions the match
      const planActivity = result.plan.dayByDayPlan[0].activities.find(
        (a) => a.placeName === 'Ancient Temple',
      );

      expect(planActivity).toBeDefined();
      // The explanation should mention it matches interests
      expect(JSON.stringify(planActivity?.explanation)).toContain(
        'matches your interest',
      );
    });
  });

  describe('Consistency Checks', () => {
    it('should return identical plans for identical requests', async () => {
      const itemA = {
        id: '1',
        title: 'Temple',
        content: 'A temple',
        score: 0.85,
      };
      const itemB = { id: '2', title: 'Lake', content: 'A lake', score: 0.82 };

      mockAIService.search.mockResolvedValue([itemA, itemB]);

      const request: TripPlanRequestDto = {
        destination: 'Kandy',
        startDate: '2026-03-01',
        endDate: '2026-03-02',
        preferences: ['culture'],
      };

      const result1 = await controller.tripPlanEnhanced(
        { user: { id: 'user-1' }, headers: {} } as unknown as Request,
        request,
      );
      const result2 = await controller.tripPlanEnhanced(
        { user: { id: 'user-1' }, headers: {} } as unknown as Request,
        request,
      );

      // Deep equality check
      expect(result1).toEqual(result2);
    });
  });
});
