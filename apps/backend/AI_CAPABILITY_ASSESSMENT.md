# AI Capability Assessment & Next Phase Roadmap

**Date:** March 8, 2026
**Document Status:** Strategic Planning / Forward-Looking
**Current System State:** Rule-based heuristics (Frozen Baseline: Month 3)

## Overview
With the Month 3 baseline officially frozen—including strict weight calibration, diversity penalties, and learning influence caps—the AI Planner has reached the limit of its current static, rule-based architecture. To scale personalization and accuracy further, the system must evolve. This document outlines the strategic transition toward a dynamic, predictive recommendation engine.

---

## 1. Transition to an ML-Based Ranking Model

**The Limitation:** The current system relies on static mathematical multipliers (e.g., `1.15x` for likes, `0.5x` for repetition). While stable and highly predictable, this approach cannot learn complex, non-linear relationships between different users, locations, and historical trends.

**The Upgrade:** Transition from heuristic math to a predictive Machine Learning model (such as Collaborative Filtering or Gradient Boosted Decision Trees).

**Implementation Path:**
* **Data Aggregation:** Begin collecting the current structured data (user profiles, trip feedback, location metadata) to build a robust training dataset.
* **Predictive Modeling:** Train a model to predict the probability of a user rating a trip highly, basing recommendations on historical data from users with similar profiles.
* **Architecture Shift:** Replace the local `planningHeuristics.ts` scoring loops with an API call to a dedicated ML microservice (e.g., a Python backend utilizing FastAPI and scikit-learn).

---

## 2. Behavioral User Profiling

**The Limitation:** Currently, the system's learning mechanism is strictly explicit. It only updates preferences when a user actively submits a star rating or manually clicks a "like/dislike" button.

**The Upgrade:** Implement implicit learning by tracking how the user naturally behaves and interacts with the itinerary inside the app.

**Implementation Path:**
* **Dwell Time Tracking:** Measure how long a user reviews a specific itinerary day before hitting "regenerate."
* **Interaction Rates:** Track the "Edit Rate" (how often a user manually deletes or swaps a suggested location) and "Click-Through Rate" (how often they click a location to read its full description).
* **Automated Weight Adjustment:** Feed these implicit behavioral signals back into the database to silently adjust the `UserCategoryWeight` without requiring manual user feedback forms.

---

## 3. Context-Aware Recommendations

**The Limitation:** The AI currently builds trips in a vacuum, relying solely on static distance and category preferences. It is unaware of real-world, real-time conditions.

**The Upgrade:** Inject real-time, situational context into the scoring algorithm *before* generating the itinerary to ensure practical, executable plans.

**Implementation Path:**
* **Weather Integration:** Connect to a live weather API. If rain is forecasted, dynamically penalize "Nature/Beach" categories and heavily boost "Indoor/Museum" categories.
* **Temporal & Operational Awareness:** Prioritize "Food/Cafe" locations specifically around standard meal times (12:00 PM and 7:00 PM) and restrict "Nightlife" locations to post-8:00 PM slots. Factor in live opening/closing hours.
* **Dynamic Pacing:** Allow users to select a "Trip Pace" (e.g., Relaxed vs. Action-Packed). This setting will dynamically alter the `MAX_HOURS_PER_DAY` limit and adjust travel distance tolerances accordingly.