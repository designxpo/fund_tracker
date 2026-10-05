"use client";

import { createClient } from "@/lib/supabase/client";
import { ok, useData } from "@/lib/use-data";

type Row = { id: string; happened_at: string; kind: string; message: string; url: string | null };

/** The last few problems the app recorded (sync rejections, crashes, failed actions). */
export function RecentErrors() {
  const sb = createClient();
  const { data, reload } = useData("client-errors", async () =>
    ok(await sb.from("client_errors").select("id, happened_at, kind, message, url").order("happened_at", { ascending: false }).limit(10)) as Row[],
  );
  if (!data) return null;
  if (data.length === 0) return <p className="text-xs text-muted">No app errors recorded. 👍</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line text-xs">
        {data.map((e) => (
          <li key={e.id} className="py-1.5">
            <span className="font-semibold text-bad">{e.kind}</span> · {new Date(e.happened_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
            {e.url ? ` · ${e.url}` : ""}
            <span className="block break-words text-muted">{e.message}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={async () => {
          await sb.from("client_errors").delete().not("id", "is", null);
          await reload();
        }}
        className="h-9 text-xs text-muted underline"
      >
        Clear
      </button>
    </div>
  );
}
