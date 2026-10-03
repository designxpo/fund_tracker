"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type T = { msg: string; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(t: T) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<(T & { n: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((next: T) => {
    clearTimeout(timer.current);
    setT({ ...next, n: Date.now() });
    timer.current = setTimeout(() => setT(null), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div
          key={t.n}
          role="status"
          className="toast-in fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[60] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-navy px-4 py-3 text-sm text-white shadow-xl"
        >
          <span>{t.msg}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                setT(null);
              }}
              className="shrink-0 font-semibold text-mint"
            >
              {t.action.label}
            </button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
