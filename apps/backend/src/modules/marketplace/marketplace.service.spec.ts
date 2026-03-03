import { Test, TestingModule } from '@nestjs/testing';
import { MarketplaceService } from './marketplace.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('MarketplaceService', () => {
  let service: MarketplaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<MarketplaceService>(MarketplaceService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCategories', () => {
    it('should return cached categories if available', async () => {
      const cachedCategories = [{ id: '1', name: 'Cached' }];
      mockCacheManager.get.mockResolvedValue(cachedCategories); // Cache returns raw array (as per service logic) or wrapped?
      // Wait, service logic: if (cached) return { data: cached ... }
      // So cache STORES raw array.
      // Service returns Wrapper.

      const result = await service.getCategories();
      expect(result.data).toEqual(cachedCategories);
      expect(mockCacheManager.get).toHaveBeenCalledWith(
        'marketplace:categories',
      );
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('should return and cache categories if not cached', async () => {
      mockCacheManager.get.mockResolvedValue(null);

      const result = await service.getCategories();
      expect(result.data).toHaveLength(4); // Based on hardcoded data
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'marketplace:categories',
        expect.any(Array),
        3600000,
      );
    });
  });

  describe('getProducts', () => {
    it('should return cached products if available', async () => {
      const cachedProducts = [{ id: '101', name: 'Product' }];
      mockCacheManager.get.mockResolvedValue(cachedProducts);

      const result = await service.getProducts();
      expect(result.data).toEqual(cachedProducts);
      expect(mockCacheManager.get).toHaveBeenCalledWith(
        'marketplace:products:all',
      );
    });

    it('should filter by category and cache', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      const category = 'Souvenirs';

      const result = await service.getProducts(category);
      // Service returns { data: [...] }
      expect(result.data[0].category).toBe(category);
      expect(mockCacheManager.get).toHaveBeenCalledWith(
        `marketplace:products:cat:${category}`,
      );
      expect(mockCacheManager.set).toHaveBeenCalled();
    });
  });
});
