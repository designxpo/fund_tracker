"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Tiny fetch-on-mount hook for screens that read straight from Supabase. */
/** `key` re-runs the fetch when it changes (e.g. the current cycle id). */
export function useData<T>(fetcher: () => Promise<T>, key = "") {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fn = useRef(fetcher);
  useEffect(() => {
    fn.current = fetcher;
  });

  const reload = useCallback(async () => {
    try {
      setData(await fn.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Couldn't load");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, key]);

  return { data, error, reload, loading: data === null && !error };
}

/** Throws PostgREST errors so callers can use try/catch with useData. */
export function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
