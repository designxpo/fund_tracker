"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { addDays, cycleEnd, dailyOnly, isBirthdayWindow, parseYmd, sumBetween, summarize, suggestCardId } from "@/lib/budget";
import { rpc } from "@/lib/rpc";
import { CapConfirm, CoverDialog, Segmented } from "@/components/quick-add/parts";
import { inr } from "@/lib/money";
import { spendImpact } from "@/lib/alerts";
import { isDaily, type FundSettle, type Spend, type SpendType, type StorePlanItem } from "@/lib/types";

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

const TYPES: { key: SpendType; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "planned", label: "Planned" },
  { key: "unplanned", label: "Unplanned" },
];


const shortDate = (iso: string) => parseYmd(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const addMonthsIso = (iso: string, months: number) => {
  const d = parseYmd(iso);
  d.setMonth(d.getMonth() + months);
  return addDays(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, 0);
};

const cleanAmount = (v: string) => {
  const s = v.replace(/[^\d.]/g, "");
  const [i, ...rest] = s.split(".");
  return rest.length ? `${i}.${rest.join("").slice(0, 2)}` : i;
};

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const { cards, categories, spends, cycle, today, settings, goals, planItems, addSpend, updateSpend, reload } = useStore();
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
  const [spendType, setSpendType] = useState<SpendType>("daily");
  const [fundId, setFundId] = useState<string | null>(null);
  const [covering, setCovering] = useState(false);
  const [settleChoice, setSettleChoice] = useState<FundSettle | null>(null); // null = decide from the card
  const [busy, setBusy] = useState(false);

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
      setSpendType(spend?.spend_type ?? "daily");
      setFundId(spend?.spend_type === "planned" ? (spend.goal_id ?? null) : null);
      setCovering(false);
      setSettleChoice(spend && !isDaily(spend) ? (spend.fund_settle ?? "now") : null);
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

  // Funds: planned → a sinking fund, unplanned → the Surprise buffer used by this cycle's plan.
  const sinkingFunds = goals.filter((g) => g.kind === "sinking").sort((a, b) => (a.next_due_date ?? "9") .localeCompare(b.next_due_date ?? "9"));
  const buffer = goals.find((g) => g.role === "buffer") ?? goals.find((g) => g.kind === "buffer");
  const emergency = goals.find((g) => g.role === "emergency");
  const fund =
    spendType === "planned" ? (sinkingFunds.find((g) => g.id === fundId) ?? sinkingFunds[0]) : spendType === "unplanned" ? buffer : undefined;
  // Paid by credit card → the fund pays when the card bill is paid; cash/UPI/debit → it pays now.
  const onCreditCard = !!card && card.monthly_cap > 0;
  const settle: FundSettle = settleChoice ?? (onCreditCard ? "bill" : "now");
  // What the fund really has free (balance minus what it already owes on card bills).
  // When editing, this spend's own amount is already counted in there: add it back.
  const fundAvail = fund
    ? fund.available + (editing && !isDaily(editing) && editing.goal_id === fund.id ? Number(editing.amount) : 0)
    : 0;
  const shortfall = spendType === "unplanned" && settle === "now" ? Math.max(0, amt - fundAvail) : 0;

  // Most-used categories first (this cycle), then configured order.
  const sortedCats = useMemo(() => {
    const counts = new Map<string, number>();
    spends.forEach((s) => s.category_id && counts.set(s.category_id, (counts.get(s.category_id) ?? 0) + 1));
    return [...categories].sort(
      (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.sort_order - b.sort_order,
    );
  }, [categories, spends]);
  const visibleCats = allCats ? sortedCats : sortedCats.slice(0, 6);

  const canSave = amt > 0 && !!categoryId && (spendType === "daily" || !!fund);

  // Live preview: what would this spend do to today / this week / this cycle?
  const impact = useMemo(() => {
    if (!cycle || !(amt > 0) || !isOpen || spendType !== "daily") return null;
    const others = spends.filter((s) => s.id !== editing?.id);
    const draft = { amount: amt, spent_on: date || today, card_id: null };
    return spendImpact(summarize(others, cycle, today), summarize([...others, draft], cycle, today));
  }, [cycle, amt, isOpen, spends, editing?.id, date, today, spendType]);

  // Would this spend push the chosen card past its monthly cap?
  const capSpends = dailyOnly(spends.filter((s) => s.id !== editing?.id));
  const cardSpentBefore =
    card && cycle
      ? sumBetween(
          capSpends,
          cycle.starts_on,
          cycleEnd(cycle.starts_on, cycle.ends_on),
          card.id,
        )
      : 0;
  const overCap = spendType === "daily" && !!card && card.monthly_cap > 0 && cardSpentBefore + amt > card.monthly_cap;
  const overKey = `${cardId}:${amt}`;
  const needsConfirm = overCap && confirmedKey !== overKey;
  const switchTo = overCap
    ? cards.find(
        (c) =>
          c.id !== cardId &&
          c.monthly_cap > 0 &&
          sumBetween(
            capSpends,
            cycle!.starts_on,
            cycleEnd(cycle!.starts_on, cycle!.ends_on),
            c.id,
          ) + amt <= c.monthly_cap,
      ) ?? cards.find((c) => c.id !== cardId && c.monthly_cap <= 0)
    : undefined;

  const save = () => {
    if (!canSave || !cycle) return;
    if (needsConfirm) return; // the confirm bar handles this case
    if (shortfall > 0) return setCovering(true); // buffer can't cover it: pick where the rest comes from
    commit();
  };

  const commit = () => {
    if (!cycle) return;
    const payload = {
      amount: amt,
      category_id: categoryId,
      card_id: cardId,
      note: note.trim() || null,
      spent_on: date || today,
      spend_type: spendType,
      goal_id: spendType === "daily" ? null : (fund?.id ?? null),
      fund_settle: spendType === "daily" ? ("now" as const) : settle,
      fund_settled_on:
        spendType !== "daily" && settle === "now" && editing?.fund_settle === "bill" ? today : settle === "now" ? (editing?.fund_settled_on ?? null) : null,
    };
    let next: Spend[];
    if (editing) {
      updateSpend(editing.id, payload);
      next = spends.map((s) => (s.id === editing.id ? { ...s, ...payload } : s));
    } else {
      const created = addSpend(payload);
      next = [...spends, created];
    }
    let msg: string;
    if (spendType === "daily") {
      const left = summarize(next, cycle, today).leftToday;
      msg = `${inr(amt)} · ${category?.name} · ${card?.nickname ?? "No card"} — ${left >= 0 ? `${inr(left)} left today` : `${inr(-left)} over today`}`;
    } else if (settle === "bill" && fund) {
      msg = `${inr(amt)} on ${card?.nickname ?? "card"} · ${fund.name} pays it when you settle the bill · daily budget untouched`;
    } else if (spendType === "planned" && fund) {
      const movesDue = fund.next_due_date && !(editing && editing.spend_type === "planned" && editing.goal_id === fund.id);
      msg = `${inr(amt)} from ${fund.name} → ${inr(fundAvail - amt)} left${movesDue ? ` · next due ${shortDate(addMonthsIso(fund.next_due_date!, fund.cycle_months ?? 1))}` : ""}`;
    } else {
      msg = `${inr(amt)} from ${fund?.name ?? "Surprise buffer"} → ${inr(Math.max(0, fundAvail - amt))} left · daily budget untouched`;
    }
    toast({ msg });
    setCovering(false);
    close();
  };

  /** Move the shortfall into the buffer from a plan line (or, if confirmed, the Emergency fund), then save. One DB call. */
  async function coverFrom(item: StorePlanItem | "emergency") {
    if (!buffer) return;
    if (item === "emergency") {
      if (!emergency) return;
      if (!confirm(`Take ${inr(shortfall)} from your Emergency fund to cover this? Only do this for a real emergency.`)) return;
    }
    setBusy(true);
    try {
      await rpc("cover_shortfall", {
        p_buffer: buffer.id,
        p_amount: shortfall,
        p_item: item === "emergency" ? null : item.id,
        p_goal: item === "emergency" ? emergency!.id : null,
      });
      void reload();
      commit();
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Couldn't move the money" });
    } finally {
      setBusy(false);
    }
  }

  const coverOptions = planItems
    .filter((i) => (i.kind === "savings" || i.kind === "prepayment") && i.goal_id !== emergency?.id)
    .map((i) => ({ item: i, available: i.done ? (i.actual ?? i.planned) : i.planned }))
    .filter((o) => o.available > 0)
    // Trip fund first, then loan prepayment, then other savings; biggest first within each.
    .sort((a, b) => {
      const rank = (o: { item: StorePlanItem }) =>
        goals.find((g) => g.id === o.item.goal_id)?.role === "trip" ? 0 : o.item.kind === "prepayment" ? 1 : 2;
      return rank(a) - rank(b) || b.available - a.available;
    });

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

            <Segmented
              label="Spend type"
              options={TYPES}
              value={spendType}
              onChange={(t) => {
                setSpendType(t);
                setCovering(false);
              }}
            />

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
            {spendType === "planned" &&
              (sinkingFunds.length === 0 ? (
                <p className="mt-1.5 text-sm text-warn">No sinking funds yet. Add one under Goals first.</p>
              ) : (
                <>
                  <Chips>
                    {sinkingFunds.map((f) => (
                      <Chip key={f.id} active={fund?.id === f.id} onClick={() => setFundId(f.id)}>
                        {f.name} · {inr(Math.round(f.available))}
                      </Chip>
                    ))}
                  </Chips>
                  {fund && amt > 0 && (
                    <p className={`mt-1.5 text-sm ${fundAvail - amt < 0 ? "font-medium text-warn" : "text-muted"}`}>
                      {fund.name}: {inr(fundAvail)} free → {inr(fundAvail - amt)}
                      {fundAvail - amt < 0 ? " (more than the fund holds)" : ""} · daily budget untouched
                    </p>
                  )}
                </>
              ))}
            {spendType === "unplanned" && (
              <p className={`mt-1.5 text-sm ${shortfall > 0 ? "font-medium text-bad" : "text-muted"}`}>
                {buffer
                  ? settle === "bill"
                    ? `On the card bill: Surprise buffer pays it when you settle (${inr(fundAvail)} free now) · daily budget untouched`
                    : shortfall > 0
                      ? `Surprise buffer has ${inr(fundAvail)}: ${inr(shortfall)} short. You'll pick where the rest comes from.`
                      : `From Surprise buffer: ${inr(fundAvail)}${amt > 0 ? ` → ${inr(fundAvail - amt)}` : " available"} · daily budget untouched`
                  : "No Surprise buffer found."}
              </p>
            )}
            {spendType !== "daily" && fund && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-muted">Take from {fund.name}:</span>
                <Segmented
                  label="When the fund pays"
                  size="sm"
                  options={[
                    { key: "now", label: "Now" },
                    { key: "bill", label: "On card bill" },
                  ]}
                  value={settle}
                  onChange={(v) => {
                    setSettleChoice(v);
                    setCovering(false);
                  }}
                />
              </div>
            )}
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
            {covering && shortfall > 0 ? (
              <CoverDialog
                shortfall={shortfall}
                options={coverOptions}
                hasEmergency={!!emergency}
                busy={busy}
                onCover={coverFrom}
                onCancel={() => setCovering(false)}
              />
            ) : canSave && needsConfirm ? (
              <CapConfirm
                card={card}
                reachesTo={cardSpentBefore + amt}
                switchTo={switchTo}
                onSwitch={() => switchTo && setPickedCard(switchTo.id)}
                onKeep={() => setConfirmedKey(overKey)}
              />
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
