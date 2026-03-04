import {
  distributeActivitiesAcrossDays,
  TripDestination,
} from './planningHeuristics';

describe('Multi-Day Planning Algorithm', () => {
  const MOCK_DATA: TripDestination[] = [
    {
      id: '1',
      placeName: 'Main Temple',
      shortDescription: '',
      order: 0,
      coordinates: { latitude: 7.29, longitude: 80.64 },
      confidenceScore: 0.99,
      metadata: { duration: '3 hours', category: 'culture' },
    },
    {
      id: '2',
      placeName: 'Nearby Lake',
      shortDescription: '',
      order: 0,
      coordinates: { latitude: 7.292, longitude: 80.642 },
      confidenceScore: 0.8,
      metadata: { duration: '2 hours', category: 'relaxation' },
    },
    {
      id: 'TRASH',
      placeName: 'Trash Place',
      shortDescription: '',
      order: 0,
      coordinates: { latitude: 7.29, longitude: 80.64 },
      confidenceScore: 0.1,
      metadata: { duration: '1 hour', category: 'relaxation' },
    },
  ];

  const MOCK_PERSONALIZATION_DATA: TripDestination[] = [
    {
      id: 'culture-1',
      placeName: 'Ancient Temple',
      order: 0,
      shortDescription: '',
      coordinates: { latitude: 0, longitude: 0 },
      confidenceScore: 0.6,
      metadata: { duration: '2h', category: 'culture' },
    },
    {
      id: 'food-1',
      placeName: 'Street Food Market',
      order: 0,
      shortDescription: '',
      coordinates: { latitude: 0, longitude: 1 },
      confidenceScore: 0.6,
      metadata: { duration: '2h', category: 'food' },
    },
  ];

  it('balances days AND filters out low-confidence items', () => {
    const plan = distributeActivitiesAcrossDays(MOCK_DATA, 2);
    expect(plan[0][0].placeName).toBe('Main Temple');
    expect(plan[0][0].selectionReason).toBe('popular');
  });

  it('prioritizes categories based on user history', () => {
    const foodiePlan = distributeActivitiesAcrossDays(
      MOCK_PERSONALIZATION_DATA,
      1,
      { likedCategories: ['food'], previouslyVisitedIds: [] },
    );
    expect(foodiePlan[0][0].placeName).toBe('Street Food Market');
  });

  it('correctly tags the "Why" (Reasoning Check)', () => {
    const foodiePlan = distributeActivitiesAcrossDays(
      MOCK_PERSONALIZATION_DATA,
      1,
      { likedCategories: ['food'], previouslyVisitedIds: [] },
    );
    expect(foodiePlan[0][0].selectionReason).toBe('preference');
  });

  it('applies a soft penalty to dislikes (The Safeguard Test)', () => {
    const mixedBag: TripDestination[] = [
      {
        id: 'bad-shop',
        placeName: 'Mediocre Mall',
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0 },
        confidenceScore: 0.45,
        metadata: { duration: '1h', category: 'shopping' },
      },
      {
        id: 'good-shop',
        placeName: 'World Famous Mall',
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0.1 },
        confidenceScore: 0.9,
        metadata: { duration: '1h', category: 'shopping' },
      },
    ];

    const result = distributeActivitiesAcrossDays(mixedBag, 1, {
      likedCategories: [],
      previouslyVisitedIds: [],
      dislikedCategories: ['shopping'],
    });

    const placeNames = result.flat().map((p) => p.placeName);
    expect(placeNames).toContain('World Famous Mall');
    expect(placeNames).not.toContain('Mediocre Mall');
  });

  it('ensures personalization multipliers do not override core quality', () => {
    const balanceData: TripDestination[] = [
      {
        id: 'trash-food',
        placeName: 'Terrible Food Cart',
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0 },
        confidenceScore: 0.2,
        metadata: { duration: '1h', category: 'food' },
      },
      {
        id: 'great-culture',
        placeName: 'Amazing Museum',
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0.1 },
        confidenceScore: 0.9,
        metadata: { duration: '2h', category: 'culture' },
      },
    ];

    const plan = distributeActivitiesAcrossDays(balanceData, 1, {
      likedCategories: ['food'],
      previouslyVisitedIds: [],
    });

    const placeNames = plan.flat().map((p) => p.placeName);
    expect(placeNames).toContain('Amazing Museum');
    expect(placeNames).not.toContain('Terrible Food Cart');
  });

  it('generates consistent itineraries for the same query multiple times (No Chaos)', () => {
    const runs: TripDestination[][][] = [];

    for (let i = 0; i < 5; i++) {
      runs.push(distributeActivitiesAcrossDays(MOCK_DATA, 2));
    }

    const baseRunString = JSON.stringify(runs[0]);

    for (let i = 1; i < 5; i++) {
      expect(JSON.stringify(runs[i])).toBe(baseRunString);
    }

    expect(runs[0][0][0].placeName).toBe('Main Temple');
  });

  // --- SPRINT 8: BIAS & DRIFT TESTING ---
  describe('Bias and Drift Prevention', () => {
    const DIVERSE_MOCK_DATA: TripDestination[] = [
      {
        id: 'f1',
        placeName: 'Local Market',
        confidenceScore: 0.8,
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0 },
        metadata: { duration: '2h', category: 'food' },
      },
      {
        id: 'f2',
        placeName: 'Street Food Alley',
        confidenceScore: 0.8,
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0.01 },
        metadata: { duration: '2h', category: 'food' },
      },
      {
        id: 'c1',
        placeName: 'Grand Museum',
        confidenceScore: 0.9,
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0.02 },
        metadata: { duration: '2h', category: 'culture' },
      },
      {
        id: 's1',
        placeName: 'Souvenir Shop',
        confidenceScore: 0.85,
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0.03 },
        metadata: { duration: '1h', category: 'shopping' },
      },
      {
        id: 'r1',
        placeName: 'Sunset Park',
        confidenceScore: 0.95,
        order: 0,
        shortDescription: '',
        coordinates: { latitude: 0, longitude: 0.04 },
        metadata: { duration: '2h', category: 'relaxation' },
      },
    ];

    it('prevents drift: still creates a valid trip even if the user hates most categories', () => {
      // The "Hater" User
      const haterPlan = distributeActivitiesAcrossDays(DIVERSE_MOCK_DATA, 1, {
        likedCategories: [],
        previouslyVisitedIds: [],
        dislikedCategories: ['culture', 'shopping', 'food'],
      });

      const day1 = haterPlan[0];
      expect(day1.length).toBeGreaterThan(0);

      // Because relaxation wasn't disliked, and Sunset Park is 0.95, it should be the anchor
      expect(day1[0].placeName).toBe('Sunset Park');
    });

    it('prevents bias: ensures diversity even if the user obsessively likes one category', () => {
      // The "Obsessive" User
      const obsessivePlan = distributeActivitiesAcrossDays(
        DIVERSE_MOCK_DATA,
        1,
        {
          likedCategories: ['food'],
          previouslyVisitedIds: [],
          dislikedCategories: [],
        },
      );

      const categories = obsessivePlan[0].map((p) => p.metadata.category);

      // It should include food because they love it
      expect(categories).toContain('food');

      // BUT it must not ONLY be food (the 2 food spots take 4 hours, leaving room in a 7-hour day)
      // The system should naturally fill the gap with high-quality diverse spots (like the 0.95 Park or 0.9 Museum)
      const is100PercentFood = categories.every((cat) => cat === 'food');
      expect(is100PercentFood).toBe(false); // Diversity survives!
    });
  });
});
