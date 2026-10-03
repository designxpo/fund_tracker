"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";

const field = "mt-1 h-12 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink outline-none focus:border-mint";

export default function PasswordPage() {
  const router = useRouter();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const valid = pw.length >= 8 && pw === confirm;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    toast({ msg: "Password updated. Use it next time you sign in." });
    router.replace("/more");
  }

  return (
    <div className="space-y-4 pt-2">
      <div>
        <Link href="/more" className="text-sm text-muted">‹ More</Link>
        <h1 className="text-2xl font-bold">Set a new password</h1>
      </div>
      <form onSubmit={save} className="space-y-3 rounded-2xl bg-surface p-4">
        <label className="block text-xs text-muted">
          New password (at least 8 characters)
          <input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className={field} />
        </label>
        {tooShort && <p className="text-xs text-warn">Needs at least 8 characters.</p>}
        <label className="block text-xs text-muted">
          Type it again
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
        </label>
        {mismatch && <p className="text-xs text-warn">The two passwords don&apos;t match.</p>}
        {err && <p className="text-sm text-bad">{err}</p>}
        <button disabled={!valid || busy} className="h-12 w-full rounded-full bg-navy font-semibold text-white disabled:opacity-40">
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </div>
  );
}
