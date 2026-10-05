"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Read data through the shared query cache. `name` + `key` identify it: screens using the same
 * pair share one fetch (e.g. "planner" for Goals, a goal's page and Income).
 */
export function useData<T>(name: string, fetcher: () => Promise<T>, key = "") {
  const q = useQuery({ queryKey: [name, key], queryFn: fetcher });
  return {
    data: q.data ?? null,
    error: q.error ? q.error.message : null,
    loading: q.isPending,
    reload: async () => {
      await q.refetch();
    },
  };
}

/** Throws PostgREST errors so callers can use try/catch with useData. */
export function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
