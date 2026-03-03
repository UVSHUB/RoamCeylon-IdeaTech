// apps/backend/src/modules/planner/planner-feedback.spec.ts
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { PlannerService } from './planner.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FeedbackMappingService } from '../feedback/feedback-mapping.service';
import { PlannerAggregationService } from './planner-aggregation.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException } from '@nestjs/common';

describe.skip('PlannerService - Feedback', () => {
  let service: PlannerService;

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockPrismaService = {
    savedTrip: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    plannerFeedback: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
  };

  const mockFeedbackMappingService = {
    processFeedback: jest.fn(),
  };

  const mockAggregationService = {
    aggregateTripFeedback: jest.fn(),
    aggregateByDestination: jest.fn(),
    aggregateByCategory: jest.fn(),
    invalidateCache: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlannerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        {
          provide: FeedbackMappingService,
          useValue: mockFeedbackMappingService,
        },
        {
          provide: PlannerAggregationService,
          useValue: mockAggregationService,
        },
      ],
    }).compile();

    service = module.get<PlannerService>(PlannerService);

    jest.clearAllMocks();
  });

  describe('submitFeedback', () => {
    const userId = 'test-user-123';
    const tripId = 'test-trip-uuid';
    const feedbackValue = 5;

    const mockTrip = {
      id: tripId,
      userId,
      name: 'My Trip',
      destination: 'Colombo',
      startDate: new Date('2024-03-01'),
      endDate: new Date('2024-03-05'),
      itinerary: {},
      preferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockFeedback = {
      id: 1,
      userId,
      tripId,
      feedbackValue,
      createdAt: new Date(),
    };

    it('should successfully submit feedback for own trip', async () => {
      mockPrismaService.savedTrip.findUnique.mockResolvedValue(mockTrip);
      mockPrismaService.plannerFeedback.upsert.mockResolvedValue(mockFeedback);

      const result = await service.submitFeedback(
        userId,
        tripId,
        feedbackValue,
      );

      expect(result).toEqual(mockFeedback);
      expect(mockPrismaService.savedTrip.findUnique).toHaveBeenCalledWith({
        where: { id: tripId },
      });
      expect(mockPrismaService.plannerFeedback.upsert).toHaveBeenCalledWith({
        where: { unique_user_trip_feedback: { userId, tripId } },
        update: { feedbackValue },
        create: { userId, tripId, feedbackValue },
      });
      expect(mockFeedbackMappingService.processFeedback).toHaveBeenCalledWith(
        userId,
        tripId,
        { rating: feedbackValue },
      );
    });

    it('should throw BadRequestException if trip not found', async () => {
      mockPrismaService.savedTrip.findUnique.mockResolvedValue(null);

      await expect(
        service.submitFeedback(userId, tripId, feedbackValue),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.submitFeedback(userId, tripId, feedbackValue),
      ).rejects.toThrow(`Trip with ID ${tripId} not found.`);
      expect(mockPrismaService.plannerFeedback.upsert).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if user does not own the trip', async () => {
      // Note: getTrip() returns null when the userId does not match the trip owner
      // (it hides the trip rather than throwing access denied), so submitFeedback
      // will throw "Trip not found" — not "Access denied" — for unauthorized users.
      const differentUserId = 'different-user-456';
      const mockTripOwnedByOther = { ...mockTrip, userId: differentUserId };
      mockPrismaService.savedTrip.findUnique.mockResolvedValue(
        mockTripOwnedByOther,
      );

      await expect(
        service.submitFeedback(userId, tripId, feedbackValue),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.submitFeedback(userId, tripId, feedbackValue),
      ).rejects.toThrow(`Trip with ID ${tripId} not found.`);
      expect(mockPrismaService.plannerFeedback.upsert).not.toHaveBeenCalled();
    });

    it('should reject feedbackValue less than 1', async () => {
      mockPrismaService.savedTrip.findUnique.mockResolvedValue(mockTrip);

      await expect(service.submitFeedback(userId, tripId, 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.submitFeedback(userId, tripId, 0)).rejects.toThrow(
        'Feedback value must be between 1 and 5.',
      );
    });

    it('should reject feedbackValue greater than 5', async () => {
      mockPrismaService.savedTrip.findUnique.mockResolvedValue(mockTrip);

      await expect(service.submitFeedback(userId, tripId, 6)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.submitFeedback(userId, tripId, 6)).rejects.toThrow(
        'Feedback value must be between 1 and 5.',
      );
    });

    // ============================================================
    // FUTURE TESTS FOR OBJECT-BASED FEEDBACK (commented out)
    // Uncomment when submitFeedback supports objects like { rating, comment, categories }
    // ============================================================

    /*
    it('should accept feedback with only rating', async () => {
      const simpleFeedback = { rating: 4 };
      mockPrismaService.savedTrip.findUnique.mockResolvedValue(mockTrip);
      mockPrismaService.plannerFeedback.upsert.mockResolvedValue({
        ...mockFeedback,
        feedbackValue: simpleFeedback,
      });

      const result = await service.submitFeedback(userId, tripId, simpleFeedback);

      expect(result.feedbackValue).toEqual(simpleFeedback);
    });

    it('should accept feedback with only comment', async () => {
      const commentOnlyFeedback = { comment: 'Needs improvement' };
      mockPrismaService.savedTrip.findUnique.mockResolvedValue(mockTrip);
      mockPrismaService.plannerFeedback.upsert.mockResolvedValue({
        ...mockFeedback,
        feedbackValue: commentOnlyFeedback,
      });

      const result = await service.submitFeedback(userId, tripId, commentOnlyFeedback);

      expect(result.feedbackValue).toEqual(commentOnlyFeedback);
    });

    it('should update existing feedback instead of creating duplicate', async () => {
      const firstFeedback = { rating: 4, comment: 'Good' };
      const updatedFeedback = { rating: 5, comment: 'Excellent!' };

      mockPrismaService.savedTrip.findUnique.mockResolvedValue(mockTrip);

      // First submission
      mockPrismaService.plannerFeedback.upsert.mockResolvedValue({
        ...mockFeedback,
        feedbackValue: firstFeedback,
      });
      await service.submitFeedback(userId, tripId, firstFeedback);

      // Second submission (update)
      mockPrismaService.plannerFeedback.upsert.mockResolvedValue({
        ...mockFeedback,
        feedbackValue: updatedFeedback,
      });
      const result = await service.submitFeedback(userId, tripId, updatedFeedback);

      expect(result.feedbackValue).toEqual(updatedFeedback);
      expect(mockPrismaService.plannerFeedback.upsert).toHaveBeenCalledTimes(2);
    });
    */
  });
});
