# Sprint 8: AI Learning Baseline & Weights Snapshot
**Date Locked:** February 26, 2026
**Phase:** End of Month 2 / Sprint 8

## 1. Current Ranking Weights (Multipliers)
We have transitioned from flat score additions to a multiplicative weighting system to ensure base quality remains the primary driver of recommendations.

* **Base Confidence Score Range:** `0.1` to `1.0`
* **Liked Category Boost:** `x 1.15` (15% boost for general category affinity)
* **Explicit Past Interaction Boost:** `x 1.25` (25% boost for specific places visited/saved)

## 2. Feedback Influence Thresholds (Safeguards)
To prevent extreme user feedback from breaking the trip generation algorithm (Bias & Drift).

* **Disliked Category Penalty (Soft Penalty):** `x 0.80` (20% reduction, ensuring high-quality places > 0.4 threshold can still survive).
* **Absolute Minimum Confidence Threshold:** `0.4` (Any destination dropping below this after penalties is strictly filtered out).
* **Math Floor Constraint:** Minimum clamp of `0.1` applied to prevent zero-multiplication bugs downstream.

## 3. Baseline Metrics & System Behaviors
These behaviors have been proven via automated test suites and serve as the baseline for Month 3 tracking.

* **Quality > Personalization:** A low-quality destination (e.g., score `0.2`) matched with a user preference (`x 1.15`) will max out at `0.23` and be correctly discarded by the `0.4` threshold.
* **Drift Protection:** The system will successfully generate a valid itinerary even if a user explicitly dislikes 75% of available categories, by relying on remaining neutral categories and top-tier penalized items.
* **Bias Protection:** The system caps category monopolization. A 7-hour day will naturally force diversity once the local inventory of a single "obsessed" category is exhausted.