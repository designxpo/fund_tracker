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
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] right-[max(20px,calc(50%-14rem+20px))] z-40 grid h-16 w-16 place-items-center rounded-full bg-mint text-navy shadow-[0_8px_24px_rgba(79,224,173,.45)] transition active:scale-90"
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
