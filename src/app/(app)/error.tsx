"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError("crash", error, error.digest);
  }, [error]);

  return (
    <div className="space-y-3 pt-6">
      <h1 className="text-xl font-bold">Something went wrong on this screen</h1>
      <p className="rounded-2xl bg-surface p-4 text-sm text-muted">
        It&apos;s been recorded. Your spends are safe: anything logged offline is still queued.
        <span className="mt-2 block font-mono text-xs text-bad">{error.message}</span>
      </p>
      <button onClick={() => retry()} className="h-12 w-full rounded-full bg-navy font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
