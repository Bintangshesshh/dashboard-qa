"use client";
/** Workspace state: loads suites, categories, runs; provides mutation helpers */

import { useCallback, useEffect, useState } from 'react';
import type { Category, Suite, Run } from './types';
import * as api from './api';

interface UseWorkspaceOptions {
  token: string;
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

export function useWorkspace({ token, authenticated }: UseWorkspaceOptions): UseWorkspaceResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);

  const refresh = useCallback(async () => {
    const authToken = token || undefined;
    const [rows, history, cats] = await Promise.all([
      api.listSuites(authToken),
      api.listRuns({ limit: 50, offset: 0 }, authToken),
      api.listCategories(authToken).catch(() => [] as Category[]),
    ]);
    const all = await Promise.all(
      (rows as Suite[]).map(async s => ({
        ...s,
        cases: await api.listCases(s.id, authToken),
      })),
    );
    setSuites(all);
    setRuns(history);
    setTotalRuns(history.length >= 50 ? history.length + 1 : history.length);
    setCategories(cats);
  }, [token]);

  const loadMoreRuns = useCallback(async () => {
    const more = await api.listRuns({ limit: 50, offset: runs.length }, token || undefined);
    setRuns(prev => {
      const ids = new Set(prev.map(r => r.id));
      return [...prev, ...more.filter(r => !ids.has(r.id))];
    });
    if (more.length < 50) setTotalRuns(runs.length + more.length);
  }, [runs.length, token]);

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
      api.listRuns({ limit: 50, offset: 0 }, token || undefined)
        .then(latest => {
          setRuns(prev => {
            // Merge latest with existing (keep pagination items)
            const map = new Map(prev.map(r => [r.id, r]));
            for (const r of latest) map.set(r.id, r);
            return [...map.values()].sort((a, b) =>
              (b.createdAt || '').localeCompare(a.createdAt || ''),
            );
          });
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [authenticated, refresh, token]);

  return { categories, suites, runs, totalRuns, setRuns, refresh, loadMoreRuns, updateRunInList };
}
