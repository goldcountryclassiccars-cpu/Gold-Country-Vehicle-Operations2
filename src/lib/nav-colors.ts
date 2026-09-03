/**
 * Each section of the app gets its own accent color, used consistently for
 * its sidebar icon, its active-nav highlight, and its dashboard tile. The
 * repetition is deliberate — color becomes a mnemonic ("Vehicles is blue,
 * Work Orders is orange") that helps people scan the sidebar and dashboard
 * faster than reading labels alone.
 *
 * Tailwind's class scanner needs full literal class strings in source, so
 * every combination below is spelled out rather than built with template
 * strings — do not refactor this into `bg-${color}-100`.
 */
import type { IconTone } from "@/components/ui";

export type AccentKey = IconTone;

interface AccentStyle {
  /** Dashboard tile / section icon chip. */
  chipBg: string;
  chipText: string;
  /** Active sidebar row. */
  activeBg: string;
  activeBorder: string;
  activeText: string;
  activeIcon: string;
}

export const ACCENT_STYLES: Record<AccentKey, AccentStyle> = {
  brand: {
    chipBg: "bg-brand-100",
    chipText: "text-brand-700",
    activeBg: "bg-brand-50",
    activeBorder: "border-brand-600",
    activeText: "text-brand-900",
    activeIcon: "text-brand-700",
  },
  amber: {
    chipBg: "bg-amber-100",
    chipText: "text-amber-700",
    activeBg: "bg-amber-50",
    activeBorder: "border-amber-500",
    activeText: "text-amber-900",
    activeIcon: "text-amber-600",
  },
  blue: {
    chipBg: "bg-blue-100",
    chipText: "text-blue-700",
    activeBg: "bg-blue-50",
    activeBorder: "border-blue-500",
    activeText: "text-blue-900",
    activeIcon: "text-blue-600",
  },
  violet: {
    chipBg: "bg-violet-100",
    chipText: "text-violet-700",
    activeBg: "bg-violet-50",
    activeBorder: "border-violet-500",
    activeText: "text-violet-900",
    activeIcon: "text-violet-600",
  },
  teal: {
    chipBg: "bg-teal-100",
    chipText: "text-teal-700",
    activeBg: "bg-teal-50",
    activeBorder: "border-teal-500",
    activeText: "text-teal-900",
    activeIcon: "text-teal-600",
  },
  orange: {
    chipBg: "bg-orange-100",
    chipText: "text-orange-700",
    activeBg: "bg-orange-50",
    activeBorder: "border-orange-500",
    activeText: "text-orange-900",
    activeIcon: "text-orange-600",
  },
  rose: {
    chipBg: "bg-rose-100",
    chipText: "text-rose-700",
    activeBg: "bg-rose-50",
    activeBorder: "border-rose-500",
    activeText: "text-rose-900",
    activeIcon: "text-rose-600",
  },
  green: {
    chipBg: "bg-green-100",
    chipText: "text-green-700",
    activeBg: "bg-green-50",
    activeBorder: "border-green-500",
    activeText: "text-green-900",
    activeIcon: "text-green-600",
  },
  indigo: {
    chipBg: "bg-indigo-100",
    chipText: "text-indigo-700",
    activeBg: "bg-indigo-50",
    activeBorder: "border-indigo-500",
    activeText: "text-indigo-900",
    activeIcon: "text-indigo-600",
  },
  fuchsia: {
    chipBg: "bg-fuchsia-100",
    chipText: "text-fuchsia-700",
    activeBg: "bg-fuchsia-50",
    activeBorder: "border-fuchsia-500",
    activeText: "text-fuchsia-900",
    activeIcon: "text-fuchsia-600",
  },
  slate: {
    chipBg: "bg-slate-100",
    chipText: "text-slate-700",
    activeBg: "bg-slate-50",
    activeBorder: "border-slate-500",
    activeText: "text-slate-900",
    activeIcon: "text-slate-600",
  },
  cyan: {
    chipBg: "bg-cyan-100",
    chipText: "text-cyan-700",
    activeBg: "bg-cyan-50",
    activeBorder: "border-cyan-500",
    activeText: "text-cyan-900",
    activeIcon: "text-cyan-600",
  },
  yellow: {
    chipBg: "bg-yellow-100",
    chipText: "text-yellow-700",
    activeBg: "bg-yellow-50",
    activeBorder: "border-yellow-500",
    activeText: "text-yellow-900",
    activeIcon: "text-yellow-600",
  },
  stone: {
    chipBg: "bg-stone-200",
    chipText: "text-stone-600",
    activeBg: "bg-stone-100",
    activeBorder: "border-stone-400",
    activeText: "text-stone-900",
    activeIcon: "text-stone-600",
  },
};

/** href -> accent key. Every entry in NAV_ITEMS should have one. */
const NAV_ACCENT_KEY: Record<string, AccentKey> = {
  "/dashboard": "brand",
  "/my-work": "amber",
  "/vehicles": "blue",
  "/pipeline": "violet",
  "/inspections": "teal",
  "/work-orders": "orange",
  "/expenses": "rose",
  "/profitability": "green",
  "/media": "indigo",
  "/sales": "fuchsia",
  "/documents": "slate",
  "/reports": "cyan",
  "/archive": "yellow",
  "/admin": "stone",
};

export function accentKeyFor(href: string): AccentKey {
  return NAV_ACCENT_KEY[href] ?? "brand";
}

export function accentFor(href: string): AccentStyle {
  return ACCENT_STYLES[accentKeyFor(href)];
}
