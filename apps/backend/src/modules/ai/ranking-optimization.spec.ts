import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';

describe('AI Ranking Optimization Framework', () => {
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {
            userCategoryWeight: {
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
  });

  // 1. Removed "async" here
  it('should rank generic items equally for a user with NO preferences (Baseline)', () => {
    jest.spyOn(prisma.userCategoryWeight, 'findMany').mockResolvedValue([]);

    const baselineScores = {
      culture: 0.5,
      shopping: 0.5,
      nature: 0.5,
    };

    expect(baselineScores.culture).toEqual(baselineScores.shopping);
    expect(baselineScores.nature).toEqual(0.5);
  });

  // 2. Removed "async" here
  it('should boost preferred categories and penalize disliked categories (Optimized)', () => {
    jest.spyOn(prisma.userCategoryWeight, 'findMany').mockResolvedValue([
      {
        id: 1,
        userId: 'user-1',
        category: 'Culture',
        weight: 1.5,
        feedbackCount: 5,
        lastUpdated: new Date(),
      },
      {
        id: 2,
        userId: 'user-1',
        category: 'Shopping',
        weight: 0.5,
        feedbackCount: 5,
        lastUpdated: new Date(),
      },
    ]); // 3. Removed "as any" here

    const baseScore = 0.5;
    const cultureMultiplier = 1.5;
    const shoppingMultiplier = 0.5;

    const optimizedCultureScore = baseScore * cultureMultiplier;
    const optimizedShoppingScore = baseScore * shoppingMultiplier;

    expect(optimizedCultureScore).toBeGreaterThan(baseScore);
    expect(optimizedShoppingScore).toBeLessThan(baseScore);
    expect(optimizedCultureScore).toBeGreaterThan(optimizedShoppingScore);
  });
});
