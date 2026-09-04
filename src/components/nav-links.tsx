"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { NavIcon } from "@/components/nav-icon";
import { accentFor } from "@/lib/nav-colors";
import type { NavItem } from "@/lib/navigation";

/**
 * A spinner that appears on the link you just clicked, for as long as the
 * navigation is in flight. Pages here are server-rendered against a remote
 * database, so a click is never instant; without this the app looked frozen
 * and people clicked again, queueing a second slow request.
 *
 * useLinkStatus only works inside a <Link>, hence the separate component.
 */
function NavSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Loading"
      className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600"
    />
  );
}

/**
 * Shared between the desktop sidebar and the mobile disclosure menu. Highlights
 * the current section so people always know where they are — the previous
 * version had no active state at all.
 */
export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const accent = accentFor(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex min-h-11 items-center gap-3 rounded-md border-l-[3px] px-2.5 py-2 text-sm transition-colors",
                active
                  ? clsx(accent.activeBg, accent.activeBorder, accent.activeText, "font-semibold")
                  : "border-transparent font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900",
              )}
            >
              <NavIcon name={item.icon} className={clsx("h-4 w-4 shrink-0", active ? accent.activeIcon : "text-stone-400")} />
              {item.label}
              <NavSpinner />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
