import { Sparkles, Brain, Clock, TrendingUp } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface RecommendationItem {
  id: string;
  title: string;
  description: string;
  score?: number;       // ML confidence score 0-1
  tag?: string;         // e.g. "Trending", "Personalized", "Popular"
  destinationId?: string;
}

interface PersonalizedRecommendationsProps {
  /** ML results will be wired here later. Empty array triggers skeleton. */
  items?: RecommendationItem[];
  /** Shows animated skeleton cards when true (for loading states). */
  isLoading?: boolean;
  /** Section title override */
  title?: string;
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3 animate-pulse">
      <div className="h-3 w-3/5 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
      <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full" />
      <div className="h-2 w-4/5 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
      <div className="mt-auto flex justify-between items-center pt-2">
        <div className="h-5 w-16 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
        <div className="h-5 w-10 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
      </div>
    </div>
  );
}

// ─── Populated Card ───────────────────────────────────────────────────────────
function RecommendationCard({ item }: { item: RecommendationItem }) {
  const confidencePct = item.score != null ? Math.round(item.score * 100) : null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-2 hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group">
      {item.tag && (
        <span className="inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400">
          <TrendingUp className="w-3 h-3" />
          {item.tag}
        </span>
      )}
      <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 leading-snug group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
        {item.title}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
        {item.description}
      </p>
      {confidencePct != null && (
        <div className="mt-auto pt-3 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-400 dark:bg-violet-500 rounded-full transition-all duration-700"
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-[10px] font-medium text-zinc-400 tabular-nums">
            {confidencePct}%
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Empty / Coming Soon State ────────────────────────────────────────────────
function ComingSoonState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-14 gap-4 text-center">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-violet-200 dark:bg-violet-900/40 opacity-50" />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
          <Brain className="w-7 h-7 text-violet-500 dark:text-violet-400" />
        </span>
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-zinc-900 dark:text-zinc-100">ML Engine Warming Up</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
          Personalized recommendations will appear here once the ML pipeline is connected.
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
        <Clock className="w-3.5 h-3.5" />
        Coming soon
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
/**
 * PersonalizedRecommendations
 *
 * Displays ML-driven personalized recommendation cards on the analytics
 * dashboard. Currently renders placeholder/skeleton state — the `items` prop
 * will be populated once the ML pipeline is connected.
 *
 * @param items       Array of recommendation results from ML backend.
 * @param isLoading   Shows animated skeleton cards when true.
 * @param title       Optional section title override.
 */
export function PersonalizedRecommendations({
  items = [],
  isLoading = false,
  title = 'Personalized Recommendations',
}: PersonalizedRecommendationsProps) {
  const SKELETON_COUNT = 3;

  return (
    <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="p-2 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400">
            <Sparkles className="w-5 h-5" />
          </span>
          <div>
            <h3 className="font-semibold text-lg leading-tight">{title}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              AI-powered suggestions tailored per user behaviour
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800">
          <Brain className="w-3 h-3" />
          ML Powered
        </span>
      </div>

      {/* Cards grid */}
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkeletonCard key={i} />
          ))
        ) : items.length > 0 ? (
          items.map((item) => <RecommendationCard key={item.id} item={item} />)
        ) : (
          <ComingSoonState />
        )}
      </div>
    </section>
  );
}
