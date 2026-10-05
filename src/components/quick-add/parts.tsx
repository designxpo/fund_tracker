"use client";

import { inr } from "@/lib/money";
import type { Card, StorePlanItem } from "@/lib/types";

/** Pill-style segmented control (Daily / Planned / Unplanned, Now / On card bill). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "md" | "sm";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`rounded-full bg-ink/[.06] p-0.5 font-semibold ${size === "md" ? "mb-2 grid grid-cols-3 text-[13px]" : "flex text-xs"}`}
    >
      {options.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full transition ${size === "md" ? "h-8" : "h-7 px-3"} ${
            value === o.key ? "bg-white text-ink shadow-[0_2px_8px_-2px_rgba(20,38,79,.25)]" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Surprise buffer is short: pick the plan line (or, confirmed, the Emergency fund) that covers it. */
export function CoverDialog({
  shortfall,
  options,
  hasEmergency,
  busy,
  onCover,
  onCancel,
}: {
  shortfall: number;
  options: { item: StorePlanItem; available: number }[];
  hasEmergency: boolean;
  busy: boolean;
  onCover: (item: StorePlanItem | "emergency") => void;
  onCancel: () => void;
}) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div role="alertdialog" aria-label="Cover the shortfall" className="rounded-2xl border border-bad/30 bg-bad/[.07] p-3">
      <p className="text-sm">
        Your Surprise buffer is <b>{inr(shortfall)} short</b>. Take it from this cycle&apos;s plan:
      </p>
      {offline && <p className="mt-1 text-xs text-warn">You&apos;re offline: connect to move money between funds.</p>}
      <ul className="mt-2 space-y-1.5">
        {options.map(({ item, available }) => (
          <li key={item.id}>
            <button
              disabled={busy || available < shortfall || offline}
              onClick={() => onCover(item)}
              className="flex h-11 w-full items-center justify-between rounded-xl bg-white/80 px-3 text-sm disabled:opacity-40"
            >
              <span className="font-medium">{item.name}</span>
              <span className="text-muted">
                {inr(available)} → {inr(Math.max(0, available - shortfall))}
                {item.done ? " · already moved" : ""}
              </span>
            </button>
          </li>
        ))}
        {options.length === 0 && <li className="text-xs text-muted">No plan items left to reduce this cycle.</li>}
      </ul>
      <div className="mt-2 flex items-center justify-between">
        <button onClick={onCancel} className="h-10 text-sm text-muted">
          Cancel
        </button>
        {hasEmergency && (
          <button disabled={busy || offline} onClick={() => onCover("emergency")} className="h-10 text-xs font-medium text-bad underline disabled:opacity-40">
            Use Emergency fund instead…
          </button>
        )}
      </div>
    </div>
  );
}

/** A daily spend would push the card past its monthly cap: switch cards or keep it. */
export function CapConfirm({
  card,
  reachesTo,
  switchTo,
  onSwitch,
  onKeep,
}: {
  card: Card | undefined;
  reachesTo: number;
  switchTo: Card | undefined;
  onSwitch: () => void;
  onKeep: () => void;
}) {
  return (
    <div role="alertdialog" className="rounded-2xl border border-warn/50 bg-warn/10 p-3">
      <p className="text-sm">
        <b>{card?.nickname}</b> would reach {inr(reachesTo)} of its {inr(card?.monthly_cap ?? 0)} cap.
        {switchTo ? ` Use ${switchTo.nickname} instead?` : ""}
      </p>
      <div className="mt-2 flex gap-2">
        {switchTo && (
          <button onClick={onSwitch} className="h-11 flex-1 rounded-xl bg-navy text-sm font-semibold text-white">
            Switch to {switchTo.nickname}
          </button>
        )}
        <button onClick={onKeep} className="h-11 flex-1 rounded-xl border border-line text-sm font-medium">
          Keep {card?.nickname}
        </button>
      </div>
    </div>
  );
}
