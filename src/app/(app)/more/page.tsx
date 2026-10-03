"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/more/income", title: "Extra income", sub: "Freelance, bonus, refunds: split into goals", icon: "💰" },
  { href: "/more/loan", title: "Loan", sub: "Payoff, prepayments, what-if", icon: "🏦" },
  { href: "/more/settings", title: "Settings", sub: "Budget, cards, categories, plan, export", icon: "⚙️" },
];

export default function MorePage() {
  async function signOut() {
    await createClient().auth.signOut();
    location.replace("/login");
  }
  return (
    <div className="space-y-3 pt-2">
      <h1 className="text-2xl font-bold">More</h1>
      <ul className="space-y-2">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex min-h-16 items-center gap-3 rounded-2xl bg-surface p-3 shadow-sm">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-bg text-xl">{l.icon}</span>
              <span className="flex-1">
                <span className="block font-medium">{l.title}</span>
                <span className="block text-xs text-muted">{l.sub}</span>
              </span>
              <span className="text-muted" aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
      <button onClick={signOut} className="h-12 w-full rounded-2xl bg-surface font-medium text-bad shadow-sm">
        Sign out
      </button>
    </div>
  );
}
