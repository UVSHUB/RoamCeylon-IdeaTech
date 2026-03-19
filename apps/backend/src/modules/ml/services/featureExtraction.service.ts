import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as cron from 'node-cron';

const prisma = new PrismaClient(); // Or use a persistent PrismaService if available

@Injectable()
export class FeatureExtractionService implements OnModuleInit {
  private readonly logger = new Logger(FeatureExtractionService.name);

  onModuleInit() {
    this.logger.log('Initializing Feature Extraction Cron Job...');
    cron.schedule('0 */12 * * *', async () => {
      this.logger.log('Running scheduled feature extraction job...');
      await this.generateUserFeatures();
    });
  }

  async generateUserFeatures(userId?: string) {
    this.logger.log(`Starting feature extraction pipeline${userId ? ` for user ${userId}` : ''}...`);

    try {
      // 1. Fetch user events
      const events = await prisma.userBehaviorEvent.findMany({
        where: userId ? { userId } : undefined,
      });

      if (!events.length) {
        this.logger.log('No new events to process.');
        return;
      }

      // 2. Group by user and category
      const userCategoryCounts = new Map<string, Record<string, number>>();
      const feedbackCounts = new Map<string, { positive: number; negative: number }>();
      const destinationScores = new Map<string, { category: string; popularity: number }>();

      for (const event of events) {
        const uid = event.userId;
        const metadata = (event.metadata as any) || {};
        
        // Ensure data quality: Handle missing metadata and normalize categories
        if (!metadata) continue;

        let category = metadata.category ? String(metadata.category).toLowerCase().trim() : null;
        let destinationId = metadata.destinationId ? String(metadata.destinationId) : null;

        // Count category interactions
        if (category) {
          if (!userCategoryCounts.has(uid)) {
            userCategoryCounts.set(uid, { cultural: 0, adventure: 0, relaxation: 0 });
          }
          const userCounts = userCategoryCounts.get(uid)!;
          if (category.includes('cultur')) userCounts.cultural += 1;
          else if (category.includes('adventur')) userCounts.adventure += 1;
          else if (category.includes('relax')) userCounts.relaxation += 1;
        }

        // Count feedback
        if (event.eventType === 'feedback') {
          if (!feedbackCounts.has(uid)) {
            feedbackCounts.set(uid, { positive: 0, negative: 0 });
          }
          const userFeedback = feedbackCounts.get(uid)!;
          if (metadata.rating > 3 || metadata.type === 'positive') userFeedback.positive += 1;
          else if (metadata.rating <= 3 || metadata.type === 'negative') userFeedback.negative += 1;
        }

        // Destination popularity score
        if (destinationId && category) {
          if (!destinationScores.has(destinationId)) {
            destinationScores.set(destinationId, { category, popularity: 0 });
          }
          const dest = destinationScores.get(destinationId)!;
          // E.g., a trip_click gives +1 pointing to that destination's popularity
          if (event.eventType === 'trip_click' || event.eventType === 'view') dest.popularity += 1;
          else if (event.eventType === 'save') dest.popularity += 3;
        }
      }

      // 3. Update feature tables
      
      // Update User Interest Profiles
      for (const [uid, scores] of userCategoryCounts) {
        await prisma.userInterestProfile.upsert({
          where: { userId: uid },
          create: {
            userId: uid,
            culturalScore: scores.cultural,
            adventureScore: scores.adventure,
            relaxationScore: scores.relaxation,
          },
          update: {
            culturalScore: { increment: scores.cultural },
            adventureScore: { increment: scores.adventure },
            relaxationScore: { increment: scores.relaxation },
            updatedAt: new Date(),
          },
        });
      }

      // Update Destination Category Scores
      for (const [destId, data] of destinationScores) {
        await prisma.destinationCategoryScore.upsert({
          where: { destinationId: destId },
          create: {
            destinationId: destId,
            category: data.category,
            popularityScore: data.popularity,
          },
          update: {
            popularityScore: { increment: data.popularity },
            updatedAt: new Date(),
          },
        });
      }

      // Update Feedback Summary
      for (const [uid, feedback] of feedbackCounts) {
        await prisma.feedbackSummary.upsert({
          where: { userId: uid },
          create: {
            userId: uid,
            positiveFeedback: feedback.positive,
            negativeFeedback: feedback.negative,
          },
          update: {
            positiveFeedback: { increment: feedback.positive },
            negativeFeedback: { increment: feedback.negative },
            updatedAt: new Date(),
          },
        });
      }

      this.logger.log(`Successfully generated ML features${userId ? ` for user ${userId}` : ''}.`);
    } catch (error) {
      this.logger.error('Error generating user features', error);
    }
  }
}
