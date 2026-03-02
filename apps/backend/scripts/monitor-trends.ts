import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runTrendAnalysis() {
  console.log('📊 --- AI LEARNING TREND MONITOR --- 📊\n');
  
  try {
    // 1. Fetch all feedback
    const allFeedback = await prisma.plannerFeedback.findMany();
    
    if (allFeedback.length === 0) {
      console.log('⚠️ No feedback data found yet. The AI is still at the Month 2 Baseline (0 data).');
      return;
    }

    let positiveCount = 0;
    let negativeCount = 0;
    let totalValid = 0;

    // 2. Process Ratings
    allFeedback.forEach(feedback => {
      // Handle JSON mapping for rating
      const value = feedback.feedbackValue as any;
      const rating = typeof value === 'number' ? value : value?.rating;

      if (typeof rating === 'number') {
        totalValid++;
        if (rating >= 4) {
          positiveCount++;
        } else if (rating <= 2) {
          negativeCount++;
        }
      }
    });

    // 3. Calculate Metrics
    const positivityRate = totalValid > 0 ? ((positiveCount / totalValid) * 100).toFixed(1) : '0.0';
    const negativityRate = totalValid > 0 ? ((negativeCount / totalValid) * 100).toFixed(1) : '0.0';

    // 4. Print Report (Comparing to Month 2)
    console.log('📅 Comparison: Month 2 Baseline vs. Current (Month 3)');
    console.log('----------------------------------------------------');
    console.log(`Month 2 Baseline Positivity : N/A (Feature did not exist)`);
    console.log(`Current Positivity Rate     : ${positivityRate}%`);
    console.log(`Current Negativity Rate     : ${negativityRate}%`);
    console.log(`Total Feedback Processed    : ${totalValid}`);
    console.log('----------------------------------------------------\n');

    // 5. Trend Analysis Output
    if (parseFloat(positivityRate) >= 75) {
      console.log('✅ TREND: EXCELLENT. Positive feedback is high. The Sprint 8 learning multipliers are working well.');
    } else if (parseFloat(positivityRate) >= 50) {
      console.log('⚠️ TREND: STABLE BUT NEEDS WORK. The AI is learning, but user satisfaction is average.');
    } else {
      console.log('🚨 TREND: DEGRADING. Negative feedback outweighs positive. Check for Bias/Drift.');
    }

  } catch (error) {
    console.error('Failed to run trend analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runTrendAnalysis();