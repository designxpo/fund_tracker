import { Suspense } from "react";
import { GoalDetailView } from "./view";

// /goals/goal?id=… keeps this a static page (a /goals/[id] route would render on the server per visit).
export default function GoalDetailPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-3xl bg-surface" />}>
      <GoalDetailView />
    </Suspense>
  );
}
