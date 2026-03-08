import apiService from './api';
import { retryWithBackoff } from '../utils/networkUtils';

export interface TripPlanRequest {
  destination: string;
  duration: string; // e.g., '3 days'
  budget: string; // e.g., 'Medium', 'Low', 'High'
  interests?: string[];
  // Saved Trip Context integration
  useSavedContext?: boolean; // default true
  mode?: 'new' | 'refine'; // default 'refine'
  tripId?: string; // optional specific trip refinement
}

export interface TripActivity {
  description: string;
  coordinate?: [number, number]; // [longitude, latitude]
  dayNumber?: number;
  
  // Preference-aware data from backend
  category?: string; // 'Culture', 'Nature', 'Beach', etc.
  matchedPreferences?: string[]; // User preferences that matched this activity
  hasPositiveFeedback?: boolean; // NEW: Positive feedback influence
  confidenceScore?: 'High' | 'Medium' | 'Low';
  tips?: string[]; // Helpful tips from backend
}

export interface TripDay {
  day: number;
  activities: TripActivity[];
}

export interface TripPlanResponse {
  destination: string;
  duration: string;
  budget: string;
  itinerary: TripDay[];
  // Version tracking (from backend)
  tripId?: string;
  versionNo?: number;
  usedSavedContext?: boolean;
}

  // Backend response interfaces
interface BackendActivity {
  placeName: string;
  shortDescription: string;
  category?: string;
  confidenceScore?: 'High' | 'Medium' | 'Low';
  explanation?: {
    rankingFactors?: {
      preferenceMatch?: string[];
    };
    hasPositiveFeedback?: boolean;
    tips?: string[];
  };
}

interface BackendDayPlan {
  day: number;
  activities: BackendActivity[];
}

interface BackendTripPlanBody {
  plan: {
    destination: string;
    totalDays: number;
    dates: { start: string; end: string };
    dayByDayPlan: BackendDayPlan[];
    summary: any;
  };
  message: string;
}

interface BackendResponseWrapper {
  statusCode: number;
  success: boolean;
  data: BackendTripPlanBody;
}

class AIService {
  private lastRequestKey: string | null = null;
  private cachedResponse: TripPlanResponse | null = null;

  async generateTripPlan(request: TripPlanRequest): Promise<TripPlanResponse> {
    try {
      // 1. Generate a cache key based on meaningful preferences
      const cacheKey = JSON.stringify({
        destination: request.destination?.trim().toLowerCase(),
        duration: request.duration,
        budget: request.budget,
        // Sort interests so order doesn't matter
        interests: request.interests ? [...request.interests].sort() : [],
        // Context fields
        useSavedContext: request.useSavedContext,
        mode: request.mode,
        tripId: request.tripId
      });

      // 2. Check if we have a valid cache hit
      if (this.cachedResponse && this.lastRequestKey === cacheKey) {
        return this.cachedResponse;
      }

      // Parse duration to calculate dates
      const durationStr = request.duration || '1';
      // extract number from string (e.g. "3 days" -> 3)
      const dayCount = parseInt(durationStr) || 1;

      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(startDate.getDate() + dayCount - 1); // -1 because start==end is 1 day

      const payload = {
        destination: request.destination,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        preferences: request.interests || [],
        // Include saved context parameters
        useSavedContext: request.useSavedContext,
        mode: request.mode,
        tripId: request.tripId,
      };

      // Fetch data matching the BACKEND structure
      const wrapper = await retryWithBackoff(
        () => apiService.post<BackendResponseWrapper>('/ai/trip-plan', payload),
        {
          maxAttempts: 3,
          initialDelay: 1000,
        }
      );

      const backendData = wrapper.data;

      // Helper to generate mock coordinates near Kandy (7.2906, 80.6337)
      // purely for demonstration until backend provides real coords
      const getMockCoordinates = (index: number): [number, number] => {
        const baseLat = 7.2906;
        const baseLng = 80.6337;
        // spread out by ~1-2km randomly
        const latOffset = (Math.random() - 0.5) * 0.04; 
        const lngOffset = (Math.random() - 0.5) * 0.04;
        return [baseLng + lngOffset, baseLat + latOffset];
      };

      // Adapter: Convert Backend Response to Frontend Response
      // Safely map itinerary, handling partial/malformed data
      const safeItinerary = (backendData.plan.dayByDayPlan || []).map((day) => ({
          day: day.day,
          activities: (day.activities || []).map((act, idx) => {
             if (!act) return null; // Skip invalid activities

             // Logic to avoid generic names like "Kandy"
             const destLower = (backendData.plan.destination || '').toLowerCase().trim();
             const placeLower = (act.placeName || '').toLowerCase().trim();
             
             // If place name is just the destination name (e.g. "Kandy" == "Kandy"), use description
             const shouldUseDescription = placeLower === destLower || placeLower.includes(destLower);
             
             const finalDescription = shouldUseDescription && act.shortDescription 
                ? act.shortDescription 
                : (act.placeName || 'Unknown Activity');

             return {
                description: finalDescription,
                coordinate: getMockCoordinates(idx), // Inject mock coordinate
                // Map preference-aware data from backend
                category: act.category || 'General',
                matchedPreferences: act.explanation?.rankingFactors?.preferenceMatch || [],
                hasPositiveFeedback: act.explanation?.hasPositiveFeedback,
                confidenceScore: act.confidenceScore,
                tips: act.explanation?.tips || [],
             };
          }).filter(Boolean) as TripActivity[], // Filter out nulls
      }));

      // Edge Case: Handling "Empty planner results"
      // If the AI returns 0 days or 0 activities total
      const totalActivities = safeItinerary.reduce((sum, day) => sum + day.activities.length, 0);
      
      if (safeItinerary.length === 0 || totalActivities === 0) {
        throw new Error('We could not generate a plan for these preferences. Please try adjusting your destination or interests.');
      }

      const mappedResponse: TripPlanResponse = {
        destination: backendData.plan.destination || request.destination,
        duration: String(backendData.plan.totalDays || safeItinerary.length),
        budget: request.budget || 'Medium', 
        // Version tracking
        tripId: backendData.plan.summary?.tripId,
        versionNo: backendData.plan.summary?.versionNo,
        usedSavedContext: backendData.plan.summary?.usedSavedContext,
        itinerary: safeItinerary,
      };

      // 3. Update Cache
      this.lastRequestKey = cacheKey;
      this.cachedResponse = mappedResponse;

      return mappedResponse;
    } catch (error) {
      throw error;
    }
  }
}

export const aiService = new AIService();
export default aiService;
