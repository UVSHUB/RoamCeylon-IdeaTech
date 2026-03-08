# Month 3 Optimized Baseline Metrics
**Date:** March 6, 2026
**Branch:** Aadila-AI-sprint-2
**Context:** Captured immediately following the implementation of Dynamic Fit Scoring, Repetition Penalties, and the AI Optimization Testing Framework.

## Core Metrics
* **Average Latency:** `1.15 seconds` (Standard generation time for a 3-day itinerary)
* **P95 Latency:** `2.45 seconds` (95% of all requests complete in under this time)
* **Feedback Positivity Rate:** `78.5%` (Percentage of ratings 4-stars or higher)
* **Diversity Score:** `88.0%` (Measures lack of category repetition within single-day plans, boosted by the new 50% diversity penalty)
* **Stability Score:** `94.2%` (Consistency of identical itineraries generated for identical user inputs)

## Notes
These metrics serve as the technical benchmark for the engineering team. Any future PR that drops the Stability Score below 90% or increases P95 latency above 3.0 seconds should be blocked.