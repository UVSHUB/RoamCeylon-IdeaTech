import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Metrics data structure
 */
interface MetricData {
  endpoint: string;
  duration: number;
  timestamp: Date;
  statusCode: number;
}

/**
 * Interceptor for planner-specific performance monitoring
 * Implements Day 46 Task 3: Performance & Stability Check
 */
@Injectable()
export class PlannerMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PlannerMetricsInterceptor.name);
  private readonly SLOW_QUERY_THRESHOLD = 200; // ms, tighter than global 500ms
  private static recentMetrics: MetricData[] = [];
  private readonly MAX_METRICS_MEMORY = 100;

  constructor() {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const response = context.switchToHttp().getResponse();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const endpoint = `${request.method} ${request.url}`;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const statusCode = (response.statusCode as number | undefined) ?? 0;

          // Log slow queries
          if (duration > this.SLOW_QUERY_THRESHOLD) {
            this.logger.warn(
              `⚠️  Slow planner endpoint: ${endpoint} took ${duration}ms`,
            );
          }

          // Store metric in memory (circular buffer)
          const metric: MetricData = {
            endpoint,
            duration,
            timestamp: new Date(),
            statusCode,
          };

          PlannerMetricsInterceptor.recentMetrics.push(metric);
          if (
            PlannerMetricsInterceptor.recentMetrics.length >
            this.MAX_METRICS_MEMORY
          ) {
            PlannerMetricsInterceptor.recentMetrics.shift(); // Remove oldest
          }

          // Persist metric (stored in in-memory circular buffer above)
          this.persistMetric();
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `Error in ${endpoint} after ${duration}ms`,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            err?.stack,
          );
        },
      }),
    );
  }

  /**
   * Persist metric — stored in-memory circular buffer only.
   * The plannerMetadata DB table does not exist in the current schema.
   */
  private persistMetric(): void {
    // No-op: metrics are already stored in this.recentMetrics above.
    // Extend this method if a DB metrics table is added in future.
  }

  /**
   * Get performance statistics from recent metrics
   */
  getPerformanceStats(): {
    totalRequests: number;
    averageResponseTime: number;
    slowQueryCount: number;
    endpointBreakdown: Record<string, { count: number; avgDuration: number }>;
  } {
    if (PlannerMetricsInterceptor.recentMetrics.length === 0) {
      return {
        totalRequests: 0,
        averageResponseTime: 0,
        slowQueryCount: 0,
        endpointBreakdown: {},
      };
    }

    const totalRequests = PlannerMetricsInterceptor.recentMetrics.length;
    const totalDuration = PlannerMetricsInterceptor.recentMetrics.reduce(
      (sum, m) => sum + m.duration,
      0,
    );
    const averageResponseTime = totalDuration / totalRequests;
    const slowQueryCount = PlannerMetricsInterceptor.recentMetrics.filter(
      (m) => m.duration > this.SLOW_QUERY_THRESHOLD,
    ).length;

    // Endpoint breakdown
    const endpointMap = new Map<
      string,
      { durations: number[]; count: number }
    >();

    for (const metric of PlannerMetricsInterceptor.recentMetrics) {
      if (!endpointMap.has(metric.endpoint)) {
        endpointMap.set(metric.endpoint, { durations: [], count: 0 });
      }
      const data = endpointMap.get(metric.endpoint)!;
      data.durations.push(metric.duration);
      data.count++;
    }

    const endpointBreakdown: Record<
      string,
      { count: number; avgDuration: number }
    > = {};

    for (const [endpoint, data] of endpointMap.entries()) {
      const avgDuration =
        data.durations.reduce((sum, d) => sum + d, 0) / data.durations.length;
      endpointBreakdown[endpoint] = {
        count: data.count,
        avgDuration: Number(avgDuration.toFixed(2)),
      };
    }

    return {
      totalRequests,
      averageResponseTime: Number(averageResponseTime.toFixed(2)),
      slowQueryCount,
      endpointBreakdown,
    };
  }
}
