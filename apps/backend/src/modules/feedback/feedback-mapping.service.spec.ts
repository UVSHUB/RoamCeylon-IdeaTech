import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackMappingService } from './feedback-mapping.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('Feedback Mapping Impact Measurement', () => {
  let service: FeedbackMappingService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackMappingService,
        {
          provide: PrismaService,
          useValue: {
            userCategoryWeight: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            plannerFeedback: {
              findMany: jest.fn().mockResolvedValue([]), // Mock trust score dependency
            },
            userFeedbackSignal: {
              upsert: jest.fn(), // Mock trust score dependency
            },
          },
        },
      ],
    }).compile();

    service = module.get<FeedbackMappingService>(FeedbackMappingService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should increase weight ONLY after MIN_FEEDBACK threshold is met', async () => {
    const userId = 'user-123';
    const category = 'Nature';

    // Mock the existing weight at baseline 1.0, but with 3 prior feedbacks!
    jest.spyOn(prisma.userCategoryWeight, 'findUnique').mockResolvedValue({
      id: 1,
      userId,
      category,
      weight: 1.0,
      feedbackCount: 3, // Meets the threshold for learning
      lastUpdated: new Date(),
    });

    const updateSpy = jest.spyOn(prisma.userCategoryWeight, 'update');

    // Simulate 5-star rating (the 4th rating)
    await service.processFeedback(userId, 5, category);

    // Verify that update was called to increase the weight
    expect(updateSpy).toHaveBeenCalled();
    const updateArgs = updateSpy.mock.calls[0][0];

    // The new weight should be 1.1 (1.0 + 0.1 CATEGORY_DELTA)
    expect(updateArgs.data.weight).toBe(1.1);
    expect(updateArgs.data.feedbackCount).toBe(4);
  });
});
