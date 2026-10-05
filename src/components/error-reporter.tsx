"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

/** Catches errors nothing else handled and records them. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError("unhandled", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportError("unhandled", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
