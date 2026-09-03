/**
 * Small, consistent, accessible UI kit (Tailwind). Kept deliberately compact so
 * a small team can maintain it. All interactive elements are keyboard-usable
 * native elements; status chips never rely on color alone.
 */
import { clsx } from "clsx";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
  badge,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Optional status/stage badge shown next to the title. */
  badge?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-5">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
          {badge}
        </div>
        {subtitle ? <p className="mt-1 text-sm text-stone-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Cards hold the wide tables on most screens. `overflow-x-auto` keeps a table
 * that is wider than the viewport scrolling *inside* its own card instead of
 * pushing the whole page sideways — which is what made columns disappear off
 * the right edge on an iPad in portrait.
 */
/** Thin top accent stripe used by <Card accent="…">. Literal classes only, so Tailwind's scanner can see them. */
const cardAccents = {
  brand: "border-t-brand-600",
  amber: "border-t-amber-500",
  blue: "border-t-blue-500",
  violet: "border-t-violet-500",
  teal: "border-t-teal-500",
  orange: "border-t-orange-500",
  rose: "border-t-rose-500",
  green: "border-t-green-500",
  indigo: "border-t-indigo-500",
  fuchsia: "border-t-fuchsia-500",
  slate: "border-t-slate-500",
  cyan: "border-t-cyan-500",
  yellow: "border-t-yellow-500",
  stone: "border-t-stone-400",
} as const;

export function Card({
  children,
  className,
  accent,
}: {
  children: ReactNode;
  className?: string;
  /** Optional colored top stripe — use to give a section its own visual identity. */
  accent?: keyof typeof cardAccents;
}) {
  return (
    <div
      className={clsx(
        "overflow-x-auto rounded-lg border border-stone-200 bg-white p-4 shadow-sm",
        accent ? clsx("border-t-4", cardAccents[accent]) : null,
        className,
      )}
    >
      {children}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-stone-100 text-stone-700 border-stone-200",
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-800 border-red-200",
  blue: "bg-sky-50 text-sky-800 border-sky-200",
  brand: "bg-brand-50 text-brand-800 border-brand-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  cyan: "bg-cyan-50 text-cyan-800 border-cyan-200",
  orange: "bg-orange-50 text-orange-800 border-orange-200",
  violet: "bg-violet-50 text-violet-800 border-violet-200",
  indigo: "bg-indigo-50 text-indigo-800 border-indigo-200",
  teal: "bg-teal-50 text-teal-800 border-teal-200",
  fuchsia: "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-stone-200 text-stone-500">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

/** Soft colored icon chip — used on dashboard tiles and section headers to give each area a memorable color. */
const iconTones = {
  brand: "bg-brand-100 text-brand-700",
  amber: "bg-amber-100 text-amber-700",
  blue: "bg-blue-100 text-blue-700",
  violet: "bg-violet-100 text-violet-700",
  teal: "bg-teal-100 text-teal-700",
  orange: "bg-orange-100 text-orange-700",
  rose: "bg-rose-100 text-rose-700",
  green: "bg-green-100 text-green-700",
  indigo: "bg-indigo-100 text-indigo-700",
  fuchsia: "bg-fuchsia-100 text-fuchsia-700",
  slate: "bg-slate-200 text-slate-700",
  cyan: "bg-cyan-100 text-cyan-700",
  yellow: "bg-yellow-100 text-yellow-700",
  stone: "bg-stone-200 text-stone-600",
} as const;

export type IconTone = keyof typeof iconTones;

export function IconChip({
  children,
  tone = "brand",
  size = "md",
}: {
  children: ReactNode;
  tone?: IconTone;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12" }[size];
  return (
    <div className={clsx("flex shrink-0 items-center justify-center rounded-lg", sizeClass, iconTones[tone])}>
      {children}
    </div>
  );
}

/** A single glanceable number with a label and colored icon — for dashboards and summary rows. */
export function StatTile({
  label,
  value,
  icon,
  tone = "brand",
  href,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: IconTone;
  href?: string;
}) {
  const content = (
    <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm transition-colors">
      <IconChip tone={tone}>{icon}</IconChip>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-tight text-stone-900">{value}</p>
        <p className="truncate text-xs font-medium text-stone-500">{label}</p>
      </div>
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block rounded-lg hover:-translate-y-0.5 hover:shadow-md focus-visible:-translate-y-0.5 transition-transform">
        {content}
      </a>
    );
  }
  return content;
}

export function Button({
  children,
  variant = "primary",
  type = "button",
  disabled,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  /**
   * Buttons read as physical controls: a raised edge, a border that survives
   * high-contrast and forced-colors modes, and a press that visibly moves.
   * `min-h-11` is 44px — Apple's minimum touch target, which matters because
   * most of the shop works from a shared iPad rather than a mouse.
   */
  const styles = {
    primary:
      "border border-brand-800 bg-brand-700 text-white shadow-sm hover:bg-brand-800 active:bg-brand-900",
    secondary:
      "border border-stone-300 bg-white text-stone-800 shadow-sm hover:bg-stone-50 active:bg-stone-100",
    danger: "border border-red-800 bg-red-700 text-white shadow-sm hover:bg-red-800 active:bg-red-900",
    ghost: "border border-transparent text-stone-700 hover:bg-stone-100 active:bg-stone-200",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      className={clsx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold",
        "transition-[background-color,box-shadow,transform] duration-75",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
        "active:translate-y-px active:shadow-none",
        "disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none",
        styles,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm shadow-sm disabled:bg-stone-100";

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-stone-900">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
