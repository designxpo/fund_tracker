"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { cycleEnd, isBirthdayWindow, sumBetween, summarize, suggestCardId } from "@/lib/budget";
import { inr } from "@/lib/money";
import { spendImpact } from "@/lib/alerts";
import type { Spend } from "@/lib/types";

type QA = { open: (editing?: Spend) => void };
const QACtx = createContext<QA>({ open: () => {} });
export const useQuickAdd = () => useContext(QACtx);

/** Distance between the layout viewport bottom and the on-screen keyboard top. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

const cleanAmount = (v: string) => {
  const s = v.replace(/[^\d.]/g, "");
  const [i, ...rest] = s.split(".");
  return rest.length ? `${i}.${rest.join("").slice(0, 2)}` : i;
};

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const { cards, categories, spends, cycle, today, settings, addSpend, updateSpend } = useStore();
  const toast = useToast();
  const inset = useKeyboardInset();
  const amountRef = useRef<HTMLInputElement>(null);

  const [isOpen, setOpen] = useState(false);
  const [editing, setEditing] = useState<Spend | null>(null);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [pickedCard, setPickedCard] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [date, setDate] = useState("");
  const [allCats, setAllCats] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState("");

  const open = (spend?: Spend) => {
    // Synchronous so focus() below still counts as part of the tap (iOS needs this to raise the keyboard).
    flushSync(() => {
      setEditing(spend ?? null);
      setAmount(spend ? String(spend.amount) : "");
      setCategoryId(spend?.category_id ?? null);
      setPickedCard(spend?.card_id ?? null);
      setNote(spend?.note ?? "");
      setShowNote(Boolean(spend?.note));
      setDate(spend?.spent_on ?? today);
      setAllCats(false);
      setConfirmedKey("");
      setOpen(true);
    });
    amountRef.current?.focus({ preventScroll: true });
  };

  const close = () => {
    amountRef.current?.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
    setOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  const amt = parseFloat(amount) || 0;
  const category = categories.find((c) => c.id === categoryId);
  const birthdayCard = isBirthdayWindow(settings?.birthday, today) ? settings?.birthday_card_id : null;
  const suggestedId = suggestCardId(category, amt, birthdayCard);
  const cardId = pickedCard ?? suggestedId;
  const card = cards.find((c) => c.id === cardId);
  const suggested = cards.find((c) => c.id === suggestedId);

  // Most-used categories first (this cycle), then configured order.
  const sortedCats = useMemo(() => {
    const counts = new Map<string, number>();
    spends.forEach((s) => s.category_id && counts.set(s.category_id, (counts.get(s.category_id) ?? 0) + 1));
    return [...categories].sort(
      (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.sort_order - b.sort_order,
    );
  }, [categories, spends]);
  const visibleCats = allCats ? sortedCats : sortedCats.slice(0, 6);

  const canSave = amt > 0 && !!categoryId;

  // Live preview: what would this spend do to today / this week / this cycle?
  const impact = useMemo(() => {
    if (!cycle || !(amt > 0) || !isOpen) return null;
    const others = spends.filter((s) => s.id !== editing?.id);
    const draft = { amount: amt, spent_on: date || today, card_id: null };
    return spendImpact(summarize(others, cycle, today), summarize([...others, draft], cycle, today));
  }, [cycle, amt, isOpen, spends, editing?.id, date, today]);

  // Would this spend push the chosen card past its monthly cap?
  const cardSpentBefore =
    card && cycle
      ? sumBetween(
          spends.filter((s) => s.id !== editing?.id),
          cycle.starts_on,
          cycleEnd(cycle.starts_on, cycle.ends_on),
          card.id,
        )
      : 0;
  const overCap = !!card && card.monthly_cap > 0 && cardSpentBefore + amt > card.monthly_cap;
  const overKey = `${cardId}:${amt}`;
  const needsConfirm = overCap && confirmedKey !== overKey;
  const switchTo = overCap
    ? cards.find(
        (c) =>
          c.id !== cardId &&
          c.monthly_cap > 0 &&
          sumBetween(
            spends.filter((s) => s.id !== editing?.id),
            cycle!.starts_on,
            cycleEnd(cycle!.starts_on, cycle!.ends_on),
            c.id,
          ) + amt <= c.monthly_cap,
      ) ?? cards.find((c) => c.id !== cardId && c.monthly_cap <= 0)
    : undefined;

  const save = () => {
    if (!canSave || !cycle) return;
    if (needsConfirm) return; // the confirm bar handles this case
    const payload = {
      amount: amt,
      category_id: categoryId,
      card_id: cardId,
      note: note.trim() || null,
      spent_on: date || today,
    };
    let next: Spend[];
    if (editing) {
      updateSpend(editing.id, payload);
      next = spends.map((s) => (s.id === editing.id ? { ...s, ...payload } : s));
    } else {
      const created = addSpend(payload);
      next = [...spends, created];
    }
    const left = summarize(next, cycle, today).leftToday;
    const tail = left >= 0 ? `${inr(left)} left today` : `${inr(-left)} over today`;
    toast({ msg: `${inr(amt)} · ${category?.name} · ${card?.nickname ?? "No card"} — ${tail}` });
    close();
  };

  return (
    <QACtx.Provider value={{ open }}>
      {children}
      <div
        className="fixed inset-0 z-50"
        aria-hidden={!isOpen}
        style={{
          visibility: isOpen ? "visible" : "hidden",
          transitionProperty: "visibility",
          transitionDuration: "0s",
          transitionDelay: isOpen ? "0s" : ".25s",
        }}
      >
        <button
          aria-label="Close"
          tabIndex={-1}
          onClick={close}
          className={`absolute inset-0 bg-[rgba(15,23,48,.22)] transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0"}`}
        />
        <div
          role="dialog"
          aria-label={editing ? "Edit spend" : "Add spend"}
          className="glass-chrome absolute inset-x-0 mx-auto flex max-w-md flex-col rounded-t-[32px] transition-transform duration-300 ease-[cubic-bezier(.2,.9,.25,1)]"
          style={{
            bottom: inset,
            transform: isOpen ? "none" : "translateY(100%)",
            maxHeight: `calc(100dvh - ${inset}px - 16px)`,
          }}
        >
          <div className="overflow-y-auto px-5 pt-3">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink/15" />

            <label className="flex items-baseline gap-1 border-b border-line pb-2">
              <span className="text-3xl font-semibold text-muted">₹</span>
              <input
                ref={amountRef}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(cleanAmount(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && save()}
                enterKeyHint="done"
                className="w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-line"
              />
            </label>
            {impact && (
              <p role={impact.level === "over" ? "alert" : undefined} className={`mt-1.5 text-sm ${impact.level === "over" ? "font-medium text-bad" : "text-muted"}`}>
                {impact.level === "over" ? "⛔ " : ""}
                {impact.text}
              </p>
            )}

            <Chips>
              {visibleCats.map((c) => (
                <Chip key={c.id} active={c.id === categoryId} onClick={() => setCategoryId(c.id)}>
                  <span aria-hidden>{c.icon}</span> {c.name}
                </Chip>
              ))}
              {sortedCats.length > 6 && (
                <Chip onClick={() => setAllCats((v) => !v)} muted>
                  {allCats ? "Less" : "More…"}
                </Chip>
              )}
            </Chips>

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">Card</p>
            <Chips>
              {cards.map((c) => (
                <Chip key={c.id} active={c.id === cardId} onClick={() => setPickedCard(c.id)}>
                  {c.nickname}
                  {c.id === suggestedId && categoryId && (
                    <span className="ml-1.5 rounded-full bg-mint/25 px-1.5 py-0.5 text-[10px] font-semibold text-good">
                      Best card
                    </span>
                  )}
                </Chip>
              ))}
            </Chips>
            {suggested && card && suggested.id !== card.id && category && (
              <p className="mt-2 text-xs text-warn">
                Tip: {suggested.nickname} is the better card for {category.name.toLowerCase()}.
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 pb-3">
              {showNote ? (
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint"
                />
              ) : (
                <button onClick={() => setShowNote(true)} className="h-11 rounded-xl border border-line px-3 text-sm text-muted">
                  + Note
                </button>
              )}
              <label className="relative flex h-11 items-center rounded-xl border border-line px-3 text-sm text-muted">
                {date === today ? "Today" : date}
                <input
                  type="date"
                  value={date}
                  max={today}
                  onChange={(e) => setDate(e.target.value || today)}
                  className="absolute inset-0 opacity-0"
                  aria-label="Date"
                />
              </label>
            </div>
          </div>

          <div className="px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-1">
            {canSave && needsConfirm ? (
              <div role="alertdialog" className="rounded-2xl border border-warn/50 bg-warn/10 p-3">
                <p className="text-sm">
                  <b>{card?.nickname}</b> would reach {inr(cardSpentBefore + amt)} of its {inr(card?.monthly_cap ?? 0)} cap.
                  {switchTo ? ` Use ${switchTo.nickname} instead?` : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  {switchTo && (
                    <button
                      onClick={() => setPickedCard(switchTo.id)}
                      className="h-11 flex-1 rounded-xl bg-navy text-sm font-semibold text-white"
                    >
                      Switch to {switchTo.nickname}
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmedKey(overKey)}
                    className="h-11 flex-1 rounded-xl border border-line text-sm font-medium"
                  >
                    Keep {card?.nickname}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={save}
                disabled={!canSave}
                className="h-14 w-full rounded-full bg-navy text-lg font-semibold text-white shadow-[0_10px_24px_-10px_rgba(20,38,79,.6)] transition active:scale-[.98] disabled:opacity-40"
              >
                {editing ? "Update" : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </QACtx.Provider>
  );
}

const Chips = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-3 flex flex-wrap gap-2">{children}</div>
);

function Chip({
  active,
  muted,
  onClick,
  children,
}: {
  active?: boolean;
  muted?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-11 items-center rounded-full border px-4 text-[15px] transition active:scale-95 ${
        active
          ? "border-navy bg-navy text-white shadow-[0_6px_16px_-8px_rgba(20,38,79,.7)]"
          : muted
            ? "border-transparent text-muted"
            : "border-white/80 bg-white/60 text-ink"
      }`}
    >
      {children}
    </button>
  );
}
