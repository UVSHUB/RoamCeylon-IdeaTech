// apps/backend/src/utils/planningHeuristics.ts

// --- TYPES ---
export interface TripDestination {
  id: string;
  order: number;
  placeName: string;
  shortDescription: string;
  coordinates?: { latitude: number; longitude: number };
  metadata: {
    duration: string;
    category: 'adventure' | 'relaxation' | 'culture' | 'shopping' | 'food';
    bestTimeToVisit?: string;
  };
  confidenceScore?: number;
  selectionReason?: 'preference' | 'popular';
}

// --- PERSONALIZATION INTERFACE ---
export interface UserPersonalizationProfile {
  likedCategories: string[];
  previouslyVisitedIds: string[];
  dislikedCategories?: string[];
}

// --- CONFIGURATION ---
const MAX_HOURS_PER_DAY = 7;
const MIN_CONFIDENCE_THRESHOLD = 0.4;

// --- WEIGHTING SYSTEM (Calibrated Multipliers) ---
const MULTIPLIER_LIKED_CATEGORY = 1.15; // 15% boost for likes
const MULTIPLIER_PAST_INTERACTION = 1.25; // 25% boost for history
const MULTIPLIER_DISLIKE_PENALTY = 0.8; // 20% reduction (Safeguard)
const DIVERSITY_PENALTY_BASE = 0.5; // 50% penalty for repeating a category in the same day

// --- HELPER: Haversine Distance ---
export const getDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// --- HELPER: Parse Duration ---
const parseDuration = (durationStr?: string): number => {
  if (!durationStr) return 2;
  const lower = durationStr.toLowerCase();
  if (lower.includes('half')) return 4;
  if (lower.includes('full')) return 8;
  const match = lower.match(/(\d+)/);
  return match ? parseInt(match[0], 10) : 2;
};

// --- HELPER: Apply Personalization Signals (Weight Calibration) ---
const calculatePersonalizedScore = (
  place: TripDestination,
  profile?: UserPersonalizationProfile,
): { score: number; reason: 'preference' | 'popular' } => {
  let score = place.confidenceScore || 0;
  let reason: 'preference' | 'popular' = 'popular';

  if (!profile) return { score, reason };

  // 1. Positive Signal
  if (profile.likedCategories.includes(place.metadata.category)) {
    score *= MULTIPLIER_LIKED_CATEGORY;
    reason = 'preference';
  }

  // 2. Explicit Interest
  if (profile.previouslyVisitedIds.includes(place.id)) {
    score *= MULTIPLIER_PAST_INTERACTION;
    reason = 'preference';
  }

  // 3. Negative Signal
  if (profile.dislikedCategories?.includes(place.metadata.category)) {
    score *= MULTIPLIER_DISLIKE_PENALTY;
  }

  // CALIBRATION: Ensure scores stay within a stable math range
  return { score: Math.max(0.1, Math.min(score, 1.8)), reason };
};

// --- MAIN ALGORITHM ---
export const distributeActivitiesAcrossDays = (
  allDestinations: TripDestination[],
  numberOfDays: number,
  userProfile?: UserPersonalizationProfile,
): TripDestination[][] => {
  const pool = allDestinations
    .map((d) => {
      const { score, reason } = calculatePersonalizedScore(d, userProfile);
      return {
        ...d,
        confidenceScore: score,
        selectionReason: reason,
        _hours: parseDuration(d.metadata.duration),
        _assigned: false,
      };
    })
    .filter((d) => {
      if (!d.coordinates) return false;
      return (d.confidenceScore || 0) >= MIN_CONFIDENCE_THRESHOLD;
    });

  // Initial sort by best overall score
  pool.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0));

  const dayPlans: TripDestination[][] = [];

  for (let day = 0; day < numberOfDays; day++) {
    const currentDay: TripDestination[] = [];
    let currentDayHours = 0;

    const anchorIndex = pool.findIndex((p) => !p._assigned);
    if (anchorIndex === -1) break;

    const anchor = pool[anchorIndex];
    anchor._assigned = true;
    currentDay.push(anchor);
    currentDayHours += anchor._hours;

    while (currentDayHours < MAX_HOURS_PER_DAY) {
      let bestCandidateIdx = -1;
      let highestDynamicScore = -Infinity; // Replaces 'minDistance' with dynamic scoring
      const lastPlace = currentDay[currentDay.length - 1];

      pool.forEach((candidate, idx) => {
        if (
          candidate._assigned ||
          !candidate.coordinates ||
          !lastPlace.coordinates
        )
          return;

        if (currentDayHours + candidate._hours <= MAX_HOURS_PER_DAY) {
          const dist = getDistanceKm(
            lastPlace.coordinates.latitude,
            lastPlace.coordinates.longitude,
            candidate.coordinates.latitude,
            candidate.coordinates.longitude,
          );

          // 1. DIVERSITY CHECK: How many times is this category already in today's plan?
          const categoryRepetitions = currentDay.filter(
            (p) => p.metadata.category === candidate.metadata.category,
          ).length;

          // 2. APPLY REPETITION PENALTY: Score drops by 50% for every repetition
          const diversityPenalty = Math.pow(
            DIVERSITY_PENALTY_BASE,
            categoryRepetitions,
          );

          // 3. DISTANCE MULTIPLIER: Closer is better (convert distance to a 0.1 - 1.0 multiplier)
          const distanceMultiplier = Math.max(0.1, 1 - dist / 20);

          // 4. FINAL DYNAMIC SCORE
          const dynamicScore =
            (candidate.confidenceScore || 0) *
            diversityPenalty *
            distanceMultiplier;

          if (dynamicScore > highestDynamicScore) {
            highestDynamicScore = dynamicScore;
            bestCandidateIdx = idx;
          }
        }
      });

      if (bestCandidateIdx !== -1) {
        const candidate = pool[bestCandidateIdx];
        candidate._assigned = true;
        currentDay.push(candidate);
        currentDayHours += candidate._hours;
      } else {
        break; // No more items fit in this day
      }
    }
    dayPlans.push(currentDay);
  }

  return dayPlans;
};
