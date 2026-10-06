"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * Reads the session the browser already has (no server round trip), so every app screen can be
 * a static page served from the CDN. Data stays protected by Row Level Security in the database.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseEnv) {
      location.replace("/login");
      return;
    }
    const sb = createClient();
    sb.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session) setUserId(data.session.user.id);
      else location.replace("/login");
    });
    const { data } = sb.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === "SIGNED_OUT" || !session) location.replace("/login");
      else setUserId(session.user.id);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!userId) return null; // a few milliseconds while the stored session is read
  return <AppShell userId={userId}>{children}</AppShell>;
}
