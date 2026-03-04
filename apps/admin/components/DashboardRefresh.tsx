'use client';

import { useEffect, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

interface DashboardRefreshProps {
  intervalMs?: number;
}

export function DashboardRefresh({ intervalMs = 60000 }: DashboardRefreshProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRefresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  useEffect(() => {
    if (!intervalMs) return;

    const interval = setInterval(() => {
      handleRefresh();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [intervalMs, handleRefresh]);

  return (
    <button 
      onClick={handleRefresh}
      disabled={isPending}
      className={`px-4 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors shadow-sm flex items-center gap-2 ${isPending ? 'opacity-70 cursor-not-allowed' : ''}`}
    >
      <RefreshCw className={`w-4 h-4 ${isPending ? 'animate-spin' : ''}`} />
      Refresh Data
    </button>
  );
}
