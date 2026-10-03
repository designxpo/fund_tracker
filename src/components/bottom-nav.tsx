"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, HomeIcon, MoreIcon, TargetIcon, WalletIcon } from "@/components/icons";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/insights", label: "Insights", Icon: ChartIcon },
  { href: "/salary", label: "Salary", Icon: WalletIcon },
  { href: "/goals", label: "Goals", Icon: TargetIcon },
  { href: "/more", label: "More", Icon: MoreIcon },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-ink" : "text-muted"}`}
              >
                <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? "bg-mint/30" : ""}`}>
                  <Icon />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
