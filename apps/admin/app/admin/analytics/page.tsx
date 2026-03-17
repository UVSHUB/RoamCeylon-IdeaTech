import { MetricCard } from "../../../components/ui/MetricCard";
import { LineChart } from "../../../components/charts/LineChart";
import { BarChart } from "../../../components/charts/BarChart";
import {
  Map, Cpu, Star, AlertTriangle,
  MousePointerClick, Globe, PenLine, CheckCircle2, XCircle,
} from 'lucide-react';
import {
  getPlannerDailyStats,
  getFeedbackRate,
  getSystemErrors,
  getEngagementStats,
  type EngagementEventType,
} from "../../../lib/api";
import { DashboardRefresh } from "../../../components/DashboardRefresh";
import { SystemHealthMonitor } from "../../../components/SystemHealthMonitor";
import { PersonalizedRecommendations } from "../../../components/recommendations/PersonalizedRecommendations";

export const revalidate = 60; // 60 seconds Cache for page level revalidation

// ─── Engagement event display config ─────────────────────────────────────────
const ENGAGEMENT_EVENTS: {
  key: EngagementEventType;
  label: string;
  icon: React.ReactNode;
  colorVariant: 'blue' | 'purple' | 'emerald' | 'rose' | 'orange';
}[] = [
  { key: 'trip_clicked',       label: 'Trips Clicked',        icon: <MousePointerClick className="w-5 h-5" />, colorVariant: 'blue' },
  { key: 'destination_viewed', label: 'Destinations Viewed',  icon: <Globe className="w-5 h-5" />,             colorVariant: 'purple' },
  { key: 'planner_edit',       label: 'Planner Edits',        icon: <PenLine className="w-5 h-5" />,           colorVariant: 'orange' },
  { key: 'trip_accepted',      label: 'Trips Accepted',       icon: <CheckCircle2 className="w-5 h-5" />,      colorVariant: 'emerald' },
  { key: 'trip_rejected',      label: 'Trips Rejected',       icon: <XCircle className="w-5 h-5" />,           colorVariant: 'rose' },
];

export default async function AnalyticsPage() {
  // All data fetches run in parallel; each fails gracefully to null
  const [plannerDaily, feedbackRate, systemErrors, engagementStats] = await Promise.all([
    getPlannerDailyStats(),
    getFeedbackRate(),
    getSystemErrors(),
    getEngagementStats(),
  ]);

  // Aggregate stats from the Daily Planner Metrics
  const breakdown = plannerDaily?.breakdown || [];
  const plannerGenerated = breakdown.find(p => p.eventType === 'planner_generated')?.count || 0;
  
  // Format Response Time 
  const avgResponseMs = plannerDaily?.avgResponseTimeMs || 0;
  const avgResponseFormatted = avgResponseMs > 1000 
    ? `${(avgResponseMs / 1000).toFixed(1)}s` 
    : `${avgResponseMs}ms`;

  // Formatting for charts
  const plannerTrendData = plannerDaily?.last7Days?.map(day => ({
    date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    usage: day.count
  })) || [];

  const feedbackDistributionData = feedbackRate?.ratingDistribution?.map(stat => ({
    rating: `${stat.rating} Stars`,
    count: stat.count
  })) || [];

  // Resolve counts for each engagement event from the summary breakdown
  const engagementBreakdown = engagementStats?.breakdown || [];
  function getEventCount(eventKey: EngagementEventType): string {
    const found = engagementBreakdown.find(e => e.eventType === eventKey);
    return found ? found.count.toLocaleString() : '—';
  }

  // Define Thresholds for server-side warnings list
  const ERROR_RATE_THRESHOLD = 5; // %
  const RESPONSE_TIME_THRESHOLD = 2000; // ms
  const POSITIVE_FEEDBACK_THRESHOLD = 80; // %

  const warnings = [];
  const parsedErrorRate = typeof systemErrors?.errorRate === 'string' 
    ? parseFloat(systemErrors.errorRate) 
    : (systemErrors?.errorRate || 0);

  if (systemErrors && parsedErrorRate > ERROR_RATE_THRESHOLD) {
    warnings.push({
      id: 'error_rate',
      message: `System error rate is high (${systemErrors.errorRate}).`,
      type: 'critical'
    });
  }
  if (avgResponseMs > RESPONSE_TIME_THRESHOLD) {
    warnings.push({
      id: 'response_time',
      message: `Average response time degraded (${avgResponseFormatted}). Expected < ${RESPONSE_TIME_THRESHOLD}ms.`,
      type: 'warning'
    });
  }
  if (feedbackRate && feedbackRate.positiveFeedbackPercentage < POSITIVE_FEEDBACK_THRESHOLD) {
    warnings.push({
      id: 'feedback',
      message: `Positive AI feedback dropped below threshold (${feedbackRate.positiveFeedbackPercentage}%).`,
      type: 'warning'
    });
  }

  return (
    <div className="space-y-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
            <SystemHealthMonitor />
          </div>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">
            Track user engagement and platform metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-4 py-2 text-sm font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-sm">
            Export Report
          </button>
          <DashboardRefresh intervalMs={60000} />
        </div>
      </div>

      {/* Warning Banners */}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-3">
          {warnings.map((warning) => (
            <div 
              key={warning.id} 
              className={`flex items-center gap-3 p-4 rounded-lg border shadow-sm ${
                warning.type === 'critical' 
                  ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-400 border-rose-200 dark:border-rose-900' 
                  : 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-900'
              }`}
            >
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm font-medium">{warning.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Core Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Planner Requests (Today)"
          value={plannerDaily ? plannerGenerated.toString() : "Unavailable"}
          icon={<Cpu className="w-5 h-5" />}
          colorVariant="blue"
        />
        <MetricCard
          title="Positive Feedback"
          value={`${feedbackRate?.positiveFeedbackPercentage || 0}%`}
          icon={<Star className="w-5 h-5" />}
          colorVariant="emerald"
        />
        <MetricCard
          title="Avg Response Time"
          value={plannerDaily ? avgResponseFormatted : "Unavailable"}
          icon={<Map className="w-5 h-5" />}
          colorVariant="purple"
          sparklineData={plannerDaily?.recentResponseTimes}
        />
        <MetricCard
          title="System Errors (24h)"
          value={systemErrors?.errorCount?.toString() || '0'}
          icon={<AlertTriangle className="w-5 h-5" />}
          trend={systemErrors ? { value: parsedErrorRate, label: "error rate" } : undefined}
          colorVariant="rose"
        />
      </div>

      {/* ─── Engagement Events — ML Training Signals ───────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Engagement Events
          </h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
            ML Signals
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {ENGAGEMENT_EVENTS.map(({ key, label, icon, colorVariant }) => (
            <MetricCard
              key={key}
              title={label}
              value={getEventCount(key)}
              icon={icon}
              colorVariant={colorVariant}
            />
          ))}
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Main Line Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col">
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="font-semibold text-lg">Planner Usage</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Total trips generated over the last 7 days.</p>
          </div>
          <div className="p-6 flex-1 w-full min-h-[350px]">
            {plannerDaily ? (
              <LineChart
                data={plannerTrendData}
                index="date"
                categories={['usage']}
                colors={['#3b82f6']}
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center h-full min-h-[300px] space-y-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
                <AlertTriangle className="w-10 h-10 text-amber-500 mb-2 opacity-80" />
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">Planner metrics unavailable</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
                  The system is currently experiencing high latency. Service graceful degradation is active.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Bar Chart */}
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col">
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="font-semibold text-lg">Feedback Breakdown</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Distribution of 1-5 star ratings.</p>
          </div>
          <div className="p-6 flex-1 w-full min-h-[350px]">
             <BarChart
              data={feedbackDistributionData}
              index="rating"
              categories={['count']}
              colors={['#10b981']}
            />
          </div>
        </div>
      </div>

      {/* ─── Personalized Recommendations ──────────────────────────────────── */}
      <PersonalizedRecommendations />
    </div>
  );
}
