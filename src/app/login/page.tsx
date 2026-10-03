"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(
    typeof window !== "undefined" && location.search.includes("error=link")
      ? "That link didn't work. Request a new one, or enter the 6-digit code from the email."
      : null,
  );

  if (!hasSupabaseEnv) {
    return (
      <Shell>
        <p className="text-sm text-muted">
          Supabase isn&apos;t configured. Copy <b>.env.local.example</b> to <b>.env.local</b>, fill in your project URL and
          anon key, then restart the dev server.
        </p>
      </Shell>
    );
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) return setMsg(error.message);
    setStep("code");
    setMsg("Check your email. Tap the link, or type the 6-digit code here.");
  }

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      return setMsg(error.message);
    }
    location.replace("/");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) {
      setBusy(false);
      return setMsg(error.message);
    }
    location.replace("/");
  }

  return (
    <Shell>
      {step === "password" ? (
        <form onSubmit={signInPassword} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base outline-none focus:border-mint"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base outline-none focus:border-mint"
          />
          <button disabled={busy} className="h-12 w-full rounded-2xl bg-mint font-semibold text-navy active:scale-[.98] disabled:opacity-60">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" onClick={() => setStep("email")} className="w-full text-sm text-muted">
            Email me a link instead
          </button>
        </form>
      ) : step === "email" ? (
        <form onSubmit={sendLink} className="space-y-3">
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base outline-none focus:border-mint"
          />
          <button disabled={busy} className="h-12 w-full rounded-2xl bg-mint font-semibold text-navy active:scale-[.98] disabled:opacity-60">
            {busy ? "Sending…" : "Email me a login link"}
          </button>
          <button type="button" onClick={() => setStep("password")} className="w-full text-sm text-muted">
            Sign in with a password
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={8}
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-center text-xl tracking-[.4em] outline-none focus:border-mint"
          />
          <button disabled={busy || code.length < 6} className="h-12 w-full rounded-2xl bg-mint font-semibold text-navy active:scale-[.98] disabled:opacity-60">
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button type="button" onClick={() => setStep("email")} className="w-full text-sm text-muted">
            Use a different email
          </button>
        </form>
      )}
      {msg && <p className="mt-4 text-sm text-muted">{msg}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6">
      <div className="mb-8">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-navy text-2xl font-bold text-mint">₹</div>
        <h1 className="text-3xl font-bold tracking-tight">Spends</h1>
        <p className="mt-1 text-muted">Log it in 5 seconds. Stay inside ₹500 a day.</p>
      </div>
      {children}
    </main>
  );
}
