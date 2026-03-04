# AI Drift Detection & Degradation Strategy
**Phase:** Month 3 Planning
**Goal:** Define how we monitor the AI in production to ensure it is learning correctly, not degrading over time.

## 1. How We Detect If the AI Gets Worse (The Metrics)
We cannot just rely on users clicking "thumbs down" (explicit feedback). Most users just leave if the app is bad. We must track **Implicit Feedback**.

* **Metric A: The "Re-Roll" Rate**
  * *What it is:* How often a user clicks "Generate Trip" and then immediately deletes it or generates a new one without saving.
  * *Why it matters:* High re-rolls mean the AI completely missed the user's intent.
* **Metric B: The "Manual Edit" Rate**
  * *What it is:* The percentage of AI-suggested destinations the user manually swaps out or deletes from the final itinerary.
  * *Why it matters:* If the AI is good, users keep its suggestions. If they are constantly deleting stops, the AI's ranking logic is drifting away from human preference.
* **Metric C: Average Output Confidence Score**
  * *What it is:* The average `confidenceScore` of the items actually placed into the final itinerary.
  * *Why it matters:* If this number drops, it means the algorithm is struggling to find high-quality matches and is settling for mediocre (0.4 - 0.5) places to fill the 7-hour day.

## 2. What Thresholds Indicate Degradation (The Alarms)
We will compare live traffic against our **Sprint 8 Baseline**. If any of these thresholds are breached over a 7-day rolling average, it triggers a "Drift Alert" requiring manual developer review.

* **Threshold 1 (Re-Rolls):** `> 30%` 
  * *Action:* If 1 in 3 trips are instantly rejected, our category mapping or personalization weights are failing.
* **Threshold 2 (Edit Rate):** `> 25% of itinerary changed`
  * *Action:* If users are deleting 1/4th of the AI's suggestions, the `WEIGHT_DISLIKE_PENALTY` may be too weak, or base quality scores are outdated.
* **Threshold 3 (Confidence Drop):** `Average Score < 0.65`
  * *Action:* If the average trip score drops below 0.65, it means our database lacks inventory for specific user profiles, or the personalization filters are too aggressive (excluding too many good places).

## 3. The Recovery Plan
If a threshold is breached:
1. Temporarily disable personalization multipliers (revert to pure Base Quality sorting).
2. Analyze the failed itineraries to see which category or user profile is causing the mathematical collapse.
3. Adjust the `MULTIPLIER` constants in `planningHeuristics.ts`.

## 4. Advanced Drift Detection (Statistical Structure)
**Phase:** Month 3 / Month 4 Roadmapping
**Goal:** Move beyond flat averages and detect subtle shifts in data distributions over time. (Structural plan, pre-ML implementation).

### A. The Concept: Baseline vs. Rolling Windows
Instead of a static threshold, the system will compare a **Reference Window** (e.g., the Sprint 8 Baseline) against a **Current Window** (e.g., the last 7 days).

### B. What Distributions We Will Track
We need to snapshot and store the "shape" of our outputs weekly.
1. **Category Output Distribution:** * *Baseline Example:* 30% Culture, 30% Food, 20% Relaxation, 20% Adventure.
   * *Drift Signal:* If "Food" suddenly jumps to 60% of all generated trips, the AI has become biased, even if users aren't complaining yet.
2. **Confidence Score Histogram:**
   * *Baseline Example:* 60% of places have a score `> 0.8`, 30% are `0.6 - 0.8`, 10% are `< 0.6`.
   * *Drift Signal:* If the `> 0.8` bucket drops to 20%, the system is scraping the bottom of the barrel to fill itineraries.

### C. The Structural Architecture (How we will build it)
1. **The Snapshot Cron Job:** * A weekly scheduled task (`@Cron`) that aggregates the week's generated trips and saves the distributions into a new `SystemMetricsSnapshot` database table.
2. **The Statistical Comparison (PSI):**
   * We will implement a lightweight **Population Stability Index (PSI)** calculation.
   * PSI is a simple math formula used in finance and basic data science to measure how much a population has shifted over time.
   * *PSI < 0.1:* No significant change (Healthy).
   * *PSI 0.1 - 0.2:* Minor shift (Monitor).
   * *PSI > 0.2:* Significant shift (Trigger Advanced Drift Alert).

### D. Actionable Next Steps for Next Sprint
1. Create Prisma schema for `SystemMetricsSnapshot`.
2. Write the Cron job to populate it weekly.
3. Write a pure-math utility function to calculate PSI between two snapshots.