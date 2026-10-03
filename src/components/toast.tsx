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
          className="toast-in fixed inset-x-4 bottom-[calc(max(12px,env(safe-area-inset-bottom))+92px)] z-[60] mx-auto flex max-w-md items-center justify-between gap-3 rounded-[22px] bg-[rgba(15,23,48,.82)] px-4 py-3 text-sm font-medium text-white shadow-[0_12px_32px_-8px_rgba(15,23,48,.45)] backdrop-blur-xl backdrop-saturate-150"
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
