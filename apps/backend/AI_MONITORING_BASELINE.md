# AI Monitoring & Drift Baseline (Month 3)
**Date Locked:** March 2, 2026
**Purpose:** Serves as the immutable reference point for future AI upgrades to ensure performance does not degrade over time.

## 1. Current Ranking & Bias Weights
These are the exact weights currently active in the production environment.
* **Liked Category Boost:** `x 1.15`
* **Past Interaction Boost:** `x 1.25`
* **Dislike Safeguard Penalty:** `x 0.80`
* **Extreme Bias Suppression Threshold:** Weight `< 0.6` (Triggers BiasMonitor)
* **Over-Weighted Bias Threshold:** Weight `> 1.8` (Triggers BiasMonitor)

## 2. Drift Detection Thresholds
These thresholds dictate when the automated systems classify the AI as "drifting" away from optimal performance.
* **System Positivity Baseline:** Ratings of 4 or 5 stars are considered "Positive".
* **Minimum Sample Size:** `5` ratings per 7-day window (prevents false alarms from low traffic).
* **Early Warning Threshold (Absolute):** If overall system positivity drops `< 70%`.
* **Degradation Drop Threshold (Relative):** `15%` drop in positivity between the current 7-day window and the previous 7-day window.

## 3. Automated Alert Conditions
The following conditions will trigger `Logger.warn` or `Logger.error` events in the server logs:
1. **Instant Feedback Pulse:** Triggers asynchronously after a user submits feedback if the absolute system positivity drops below `70%`.
2. **Weekly Degradation Scan:** A Cron job runs weekly to compare 7-day rolling windows. Triggers if the `15%` relative drop threshold is breached.
3. **Planner Stability Flag:** Triggers during the weekly scan if users are successfully rating trips, but the `UserCategoryWeight` database table is empty (indicating a failure in the ranking mechanics pipeline).