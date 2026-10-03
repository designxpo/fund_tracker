"use client";

import { StoreProvider } from "@/lib/store";
import { ToastProvider } from "@/components/toast";
import { QuickAddProvider, useQuickAdd } from "@/components/quick-add";
import { BottomNav } from "@/components/bottom-nav";
import { PlusIcon } from "@/components/icons";

function Fab() {
  const { open } = useQuickAdd();
  return (
    <button
      aria-label="Add spend"
      onClick={() => open()}
      className="fixed bottom-[calc(max(12px,env(safe-area-inset-bottom))+84px)] right-[max(20px,calc(50%-14rem+20px))] z-40 grid h-16 w-16 place-items-center rounded-full bg-navy text-white shadow-[0_1px_0_rgba(255,255,255,.25)_inset,0_12px_28px_-6px_rgba(20,38,79,.55)] outline outline-1 -outline-offset-1 outline-white/20 transition active:scale-90"
    >
      <PlusIcon />
    </button>
  );
}

export function AppShell({ userId, children }: { userId: string; children: React.ReactNode }) {
  return (
    <StoreProvider userId={userId}>
      <ToastProvider>
        <QuickAddProvider>
          <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-44 pt-[max(16px,env(safe-area-inset-top))]">{children}</div>
          <Fab />
          <BottomNav />
        </QuickAddProvider>
      </ToastProvider>
    </StoreProvider>
  );
}
