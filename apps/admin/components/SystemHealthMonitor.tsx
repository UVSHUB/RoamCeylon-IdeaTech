"use client";

import { useEffect, useState } from "react";

// Defines the data structure returned by GET /analytics/system/health
interface HealthData {
  status: string;
  avgLatencyMs: number;
  errorRate: number;
  successRate: number;
  totalRequestsLastHour: number;
}

interface HealthResponse {
  statusCode: number;
  success: boolean;
  timestamp: string;
  path: string;
  data: HealthData;
}

export function SystemHealthMonitor() {
  const [isHighLoad, setIsHighLoad] = useState(false);

  useEffect(() => {
    // Define Thresholds
    const SYSTEM_HIGH_LOAD_MS = 5000;
    const ERROR_RATE_THRESHOLD = 5;

    const checkHealth = async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001"}/analytics/system/health`,
          {
            // Prevent Next.js from aggressively caching this particular client fetch
            cache: "no-store",
          },
        );

        if (res.ok) {
          const json: HealthResponse = await res.json();
          const { avgLatencyMs, errorRate, status } = json.data;

          const loadStatus =
            status !== "healthy" ||
            avgLatencyMs > SYSTEM_HIGH_LOAD_MS ||
            errorRate > ERROR_RATE_THRESHOLD;

          setIsHighLoad(loadStatus);
        } else {
          // If the health endpoint is failing (e.g., 502 Bad Gateway/timeout), assume high load
          setIsHighLoad(true);
        }
      } catch {
        // Network connection refused or timeout means backend is essentially unreachable
        setIsHighLoad(true);
      }
    };

    // Initial check immediately on mount
    checkHealth();

    // Setup polling every 30 seconds
    const intervalId = setInterval(checkHealth, 30000);

    return () => clearInterval(intervalId);
  }, []);

  if (!isHighLoad) return null;

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-900 shadow-sm transition-all animate-in fade-in zoom-in duration-300">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
      </span>
      System under high load
    </span>
  );
}
