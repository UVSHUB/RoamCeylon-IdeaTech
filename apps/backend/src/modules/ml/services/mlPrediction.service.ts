import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface MLPredictionRequest {
  user_id: string;
  user_features?: {
    cultural_score?: number;
    adventure_score?: number;
    relaxation_score?: number;
  };
  destinations: { id: string; category: string }[];
}

export interface MLPredictionResponse {
  recommendations: {
    destination_id: string;
    ml_score: number;
  }[];
}

@Injectable()
export class MlPredictionService {
  private readonly logger = new Logger(MlPredictionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates ML predictions. Falls back to features passed in the request if provided,
   * otherwise fetches from the database.
   */
  async getMLRecommendations(
    dto: MLPredictionRequest,
  ): Promise<MLPredictionResponse | null> {
    const { user_id, destinations } = dto;
    let features = dto.user_features;

    // Load from DB if features not provided
    if (!features) {
      const userProfile = await this.prisma.userInterestProfile.findUnique({
        where: { userId: user_id },
      });

      if (!userProfile) {
        this.logger.warn(
          `No features found for ${user_id}. Returning null for fallback.`,
        );
        return null;
      }

      features = {
        cultural_score: userProfile.culturalScore,
        adventure_score: userProfile.adventureScore,
        relaxation_score: userProfile.relaxationScore,
      };
    }

    const predictions = destinations.map((dest) => {
      let score = 0;
      const cat = dest.category?.toLowerCase() || '';

      if (cat.includes('cultur')) score = features?.cultural_score || 0;
      else if (cat.includes('adventur')) score = features?.adventure_score || 0;
      else if (cat.includes('relax')) score = features?.relaxation_score || 0;
      else
        score =
          ((features?.cultural_score || 0) + (features?.adventure_score || 0)) /
          2; // Default mock average

      // Mock normalization of feature scoring bounds
      let normalizedScore = 0.5 + score * 0.05;
      normalizedScore = Math.min(Math.max(normalizedScore, 0.1), 0.99);

      return {
        destination_id: dest.id,
        ml_score: Number(normalizedScore.toFixed(2)),
      };
    });

    // Sort descending by ml_score
    predictions.sort((a, b) => b.ml_score - a.ml_score);

    return { recommendations: predictions };
  }
}
