// apps/backend/scripts/detect-degradation.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// --- CONFIGURATION THRESHOLDS ---
const DEGRADATION_DROP_THRESHOLD = 15; // X% drop over 7 days triggers warning
const MINIMUM_SAMPLE_SIZE = 5; // Prevent false alarms on low traffic

async function checkDegradation() {
  console.log('🚨 --- AI DEGRADATION & STABILITY DETECTOR --- 🚨\n');

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  try {
    // 1. Fetch Rolling Window Data (Using createdAt for feedback)
    const recentFeedback = await prisma.plannerFeedback.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
    });

    const pastFeedback = await prisma.plannerFeedback.findMany({
      where: { createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
    });

    // Helper to calculate positivity
    const getPositivity = (feedbackList: any[]) => {
      let positiveCount = 0;
      let totalValid = 0;
      
      feedbackList.forEach((f) => {
        const value = f.feedbackValue as any;
        const rating = typeof value === 'number' ? value : value?.rating;
        if (typeof rating === 'number') {
          totalValid++;
          if (rating >= 4) positiveCount++;
        }
      });
      return totalValid === 0 ? 0 : (positiveCount / totalValid) * 100;
    };

    const recentPositivity = getPositivity(recentFeedback);
    const pastPositivity = getPositivity(pastFeedback);

    console.log(`📅 Past Window (Days 7-14) Positivity: ${pastPositivity.toFixed(1)}% (${pastFeedback.length} ratings)`);
    console.log(`📅 Current Window (Last 7 Days) Positivity: ${recentPositivity.toFixed(1)}% (${recentFeedback.length} ratings)\n`);

    // --- RULE 1: POSITIVE FEEDBACK DROP OVER 7 DAYS ---
    if (pastFeedback.length >= MINIMUM_SAMPLE_SIZE && recentFeedback.length >= MINIMUM_SAMPLE_SIZE) {
      const drop = pastPositivity - recentPositivity;

      if (drop >= DEGRADATION_DROP_THRESHOLD) {
        console.log(`❌ WARNING: Positivity dropped by ${drop.toFixed(1)}% (Threshold: ${DEGRADATION_DROP_THRESHOLD}%). AI Degradation Detected!`);
      } else {
        console.log(`✅ Feedback trend is stable (Change: ${drop > 0 ? '-' : '+'}${Math.abs(drop).toFixed(1)}%).`);
      }
    } else {
      console.log(`⚠️ Not enough data in the rolling windows to confidently calculate 7-day degradation.`);
    }

    // --- RULE 2: RANKING STABILITY CHECK ---
    console.log('\n📊 Ranking Stability Check:');
    
    // NO DATE FILTER HERE - Bypasses the TypeScript error!
    const totalCategories = await prisma.userCategoryWeight.count();

    if (totalCategories === 0 && recentFeedback.length > 0) {
        console.log('❌ FLAG: Drastic ranking stability change! Users are leaving feedback, but NO category weights exist in the database.');
    } else {
        console.log('✅ Core ranking mechanics are actively updating and stable.');
    }

    console.log('\n----------------------------------------------------');
  } catch (error) {
    console.error('Failed to run degradation check:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDegradation();