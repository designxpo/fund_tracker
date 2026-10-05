import { createClient } from "@/lib/supabase/client";
import { reportError } from "@/lib/report-error";

/**
 * Call a database function. Every multi-step money action (tick a plan line, settle the month,
 * cover a shortfall, log income…) is one Postgres function, so it either fully happens or not at all.
 */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) {
    reportError("action", error.message, `${fn}(${JSON.stringify(args).slice(0, 500)})`);
    throw new Error(error.message);
  }
  return data as T;
}
