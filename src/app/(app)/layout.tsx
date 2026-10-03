import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!hasSupabaseEnv) redirect("/login");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  return <AppShell userId={data.claims.sub}>{children}</AppShell>;
}
