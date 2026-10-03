"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/supabase/env";

type Step = "password" | "link" | "code" | "forgot";

const field = "h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base outline-none focus:border-mint";
const primary = "h-12 w-full rounded-full bg-navy font-semibold text-white active:scale-[.98] disabled:opacity-60";
const secondary = "h-11 w-full text-sm font-medium text-muted";

/** Supabase's raw messages, made actionable. */
function friendly(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password. Tap “Forgot password?” to set a new one.";
  if (m.includes("rate limit")) return "Too many emails sent in the last hour. Wait a bit, or sign in with your password.";
  if (m.includes("signups not allowed") || m.includes("sign-ups are closed")) return "This app is private: only the owner's email can sign in.";
  return message;
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(
    typeof window !== "undefined" && location.search.includes("error=link")
      ? "That link didn't work or expired. Sign in with your password, or request a new link."
      : null,
  );

  if (!hasSupabaseEnv) {
    return (
      <Shell>
        <p className="text-sm text-muted">
          Supabase isn&apos;t configured. Copy <b>.env.local.example</b> to <b>.env.local</b>, fill in your project URL and
          publishable key, then restart the dev server.
        </p>
      </Shell>
    );
  }

  const go = (s: Step) => {
    setStep(s);
    setMsg(null);
  };

  async function run(fn: () => Promise<{ error: { message: string } | null }>, onOk: () => void) {
    setBusy(true);
    setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) return setMsg(friendly(error.message));
    onOk();
  }

  const sb = () => createClient();
  const emailInput = (autoFocus = false) => (
    <input
      type="email"
      required
      autoFocus={autoFocus}
      autoComplete="email"
      placeholder="you@email.com"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      className={field}
    />
  );

  return (
    <Shell>
      {step === "password" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => sb().auth.signInWithPassword({ email: email.trim(), password }), () => location.replace("/"));
          }}
          className="space-y-3"
        >
          {emailInput(true)}
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          <button disabled={busy} className={primary}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="flex justify-between">
            <button type="button" onClick={() => go("forgot")} className="h-11 text-sm font-medium text-navy">
              Forgot password?
            </button>
            <button type="button" onClick={() => go("link")} className="h-11 text-sm font-medium text-muted">
              Email me a link instead
            </button>
          </div>
        </form>
      )}

      {step === "forgot" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                sb().auth.resetPasswordForEmail(email.trim(), {
                  redirectTo: `${location.origin}/auth/callback?next=/more/password`,
                }),
              () => setMsg("Check your email for a reset link. Open it in this browser, then choose a new password."),
            );
          }}
          className="space-y-3"
        >
          <p className="text-sm text-muted">We&apos;ll email you a link to set a new password.</p>
          {emailInput(true)}
          <button disabled={busy} className={primary}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <button type="button" onClick={() => go("password")} className={secondary}>
            Back to sign in
          </button>
        </form>
      )}

      {step === "link" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => sb().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${location.origin}/auth/callback` } }),
              () => {
                setStep("code");
                setMsg("Check your email and tap the link (open it in this browser).");
              },
            );
          }}
          className="space-y-3"
        >
          {emailInput(true)}
          <button disabled={busy} className={primary}>
            {busy ? "Sending…" : "Email me a login link"}
          </button>
          <button type="button" onClick={() => go("password")} className={secondary}>
            Sign in with password instead
          </button>
        </form>
      )}

      {step === "code" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" }), () => location.replace("/"));
          }}
          className="space-y-3"
        >
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder="6-digit code (if your email has one)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${field} text-center`}
          />
          <button disabled={busy || code.length < 6} className={primary}>
            {busy ? "Checking…" : "Sign in with code"}
          </button>
          <button type="button" onClick={() => go("password")} className={secondary}>
            Sign in with password instead
          </button>
        </form>
      )}

      {msg && (
        <p role="status" className="mt-4 rounded-2xl bg-surface px-4 py-3 text-sm">
          {msg}
        </p>
      )}
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
