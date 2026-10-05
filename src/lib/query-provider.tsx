"use client";

import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

/**
 * One shared, persisted cache for everything that isn't the offline spend queue
 * (plans, goals, loan, income, planner). Screens reading the same key share one fetch,
 * the last-known data survives reloads/offline, and any write refreshes every screen.
 */
export function QueryProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, gcTime: 24 * 60 * 60 * 1000, retry: 1, networkMode: "offlineFirst" },
        },
      }),
  );
  const [persister] = useState(() =>
    createSyncStoragePersister({
      key: `spends:queries:${userId}`,
      storage: typeof window === "undefined" ? undefined : window.localStorage,
    }),
  );
  return (
    <PersistQueryClientProvider client={client} persistOptions={{ persister, maxAge: 7 * 24 * 60 * 60 * 1000, buster: "v1" }}>
      {children}
    </PersistQueryClientProvider>
  );
}
