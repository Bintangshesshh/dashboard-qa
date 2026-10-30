"use client";
/** Workspace state: loads suites, categories, runs; provides mutation helpers */

import { useCallback, useEffect, useState } from 'react';
import type { Category, Suite, Run } from './types';
import * as api from './api';

interface UseWorkspaceOptions {
  authenticated: boolean;
}

interface UseWorkspaceResult {
  categories: Category[];
  suites: Suite[];
  runs: Run[];
  totalRuns: number;
  setRuns: React.Dispatch<React.SetStateAction<Run[]>>;
  refresh: () => Promise<void>;
  loadMoreRuns: () => Promise<void>;
  updateRunInList: (run: Run) => void;
}

export function useWorkspace({ authenticated }: UseWorkspaceOptions): UseWorkspaceResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);

  const refresh = useCallback(async () => {
    const [rows, history, cats] = await Promise.all([
      api.listSuites(),
      api.listRunsPage({ limit: 50, offset: 0 }),
      api.listCategories().catch(() => [] as Category[]),
    ]);
    const all = await Promise.all(
      (rows as Suite[]).map(async s => ({
        ...s,
        cases: await api.listCases(s.id),
      })),
    );
    setSuites(all);
    setRuns(history.runs);
    setTotalRuns(history.total);
    setCategories(cats);
  }, []);

  const loadMoreRuns = useCallback(async () => {
    const page = await api.listRunsPage({ limit: 50, offset: runs.length });
    setRuns(prev => {
      const ids = new Set(prev.map(r => r.id));
      return [...prev, ...page.runs.filter(r => !ids.has(r.id))];
    });
    setTotalRuns(page.total);
  }, [runs.length]);

  const updateRunInList = useCallback((run: Run) => {
    setRuns(prev => {
      const idx = prev.findIndex(r => r.id === run.id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = run;
      return next;
    });
  }, []);

  // Poll runs every 4 seconds
  useEffect(() => {
    if (!authenticated) return;
    refresh().catch(() => {});
    const id = setInterval(() => {
      api.listRunsPage({ limit: 50, offset: 0 })
        .then(page => {
          setTotalRuns(page.total);
          setRuns(prev => {
            // Merge latest with existing (keep pagination items)
            const map = new Map(prev.map(r => [r.id, r]));
            for (const r of page.runs) map.set(r.id, r);
            return [...map.values()].sort((a, b) =>
              (b.createdAt || '').localeCompare(a.createdAt || ''),
            );
          });
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [authenticated, refresh]);

  return { categories, suites, runs, totalRuns, setRuns, refresh, loadMoreRuns, updateRunInList };
}
