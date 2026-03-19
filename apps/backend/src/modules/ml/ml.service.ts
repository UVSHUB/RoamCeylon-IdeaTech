import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackBehaviorDto } from './dto/track-behavior.dto';

@Injectable()
export class MlService {
  constructor(private readonly prisma: PrismaService) { }

  async trackBehavior(dto: TrackBehaviorDto) {
    try {
      const event = await this.prisma.userBehaviorEvent.create({
        data: {
          userId: dto.user_id,
          eventType: dto.event_type,
          itemId: dto.item_id,
          metadata: dto.metadata || {},
        },
      });
      return { success: true, eventId: event.id };
    } catch (error) {
      throw new InternalServerErrorException('Failed to track behavior event');
    }
  }

  async getPersonalizedRecommendations(userId: string) {
    // DO NOT use ML yet - return static/simple rule-based recommendations.
    // For now, we will return a static set of recommendations for the user.
    const recommendations = [
      {
        item_id: 'trip_001',
        title: 'Sigiriya Rock Fortress',
        score: 0.92,
        reason: 'Because you liked cultural destinations',
      },
      {
        item_id: 'trip_002',
        title: 'Ella Scenic Tour',
        score: 0.87,
        reason: 'Popular among similar users',
      },
    ];

    // Log the recommendations shown to the user
    try {
      await Promise.all(
        recommendations.map((rec) =>
          this.prisma.recommendationLog.create({
            data: {
              userId,
              itemId: rec.item_id,
              score: rec.score,
            },
          }),
        ),
      );
    } catch (error) {
      console.error('Failed to log recommendations:', error);
      // We do not throw an error here because saving logs should not break the user experience
    }

    return {
      user_id: userId,
      recommendations,
    };
  }
}
