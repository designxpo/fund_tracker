"use client";

import { useRef, useState } from "react";
import { inr } from "@/lib/money";

const REVEAL = 88;

export function SpendRow({
  icon,
  title,
  subtitle,
  amount,
  onTap,
  onDelete,
}: {
  icon: string;
  title: string;
  subtitle: string;
  amount: number;
  onTap: () => void;
  onDelete: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; base: number } | null>(null);
  const moved = useRef(false);

  const down = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, base: dx };
    moved.current = false;
    setDragging(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const d = e.clientX - start.current.x;
    if (Math.abs(d) > 6) moved.current = true;
    setDx(Math.max(-REVEAL * 1.6, Math.min(0, start.current.base + d)));
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (dx < -REVEAL * 1.4) onDelete();
    else setDx(dx < -REVEAL / 2 ? -REVEAL : 0);
  };

  return (
    <li className="relative overflow-hidden rounded-2xl bg-bad shadow-[0_6px_18px_-12px_rgba(20,38,79,.3)]">
      <button
        onClick={onDelete}
        tabIndex={dx === 0 ? -1 : 0}
        className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center text-sm font-semibold text-white"
      >
        Delete
      </button>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={() => {
          if (moved.current) return;
          if (dx !== 0) setDx(0);
          else onTap();
        }}
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : "transform .2s ease-out", touchAction: "pan-y" }}
        className="relative flex min-h-16 cursor-pointer items-center gap-3 bg-surface-solid px-3 py-2"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-bg text-xl">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-xs text-muted">{subtitle}</span>
        </span>
        <span className="font-semibold tabular-nums">{inr(amount)}</span>
      </div>
    </li>
  );
}
