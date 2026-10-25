"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, HistoryIcon, HomeIcon, MoreIcon, WalletIcon } from "@/components/icons";

// Goals lives under More (it's opened less often than History).
const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon, also: [] as string[] },
  { href: "/insights", label: "Insights", Icon: ChartIcon, also: [] },
  { href: "/history", label: "History", Icon: HistoryIcon, also: [] },
  { href: "/salary", label: "Salary", Icon: WalletIcon, also: [] },
  { href: "/more", label: "More", Icon: MoreIcon, also: ["/goals"] },
];

/** Floating glass capsule tab bar; content scrolls underneath it. */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 px-4">
      <ul className="glass-chrome mx-auto flex max-w-md rounded-[30px] p-1.5">
        {TABS.map(({ href, label, Icon, also }) => {
          const active = href === "/" ? path === "/" : [href, ...also].some((p) => path.startsWith(p));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-[24px] text-[10.5px] font-semibold tracking-wide transition-colors duration-200 active:scale-95 ${
                  active ? "bg-white/90 text-navy shadow-[0_2px_10px_-2px_rgba(20,38,79,.18)]" : "text-muted"
                }`}
              >
                <Icon />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
