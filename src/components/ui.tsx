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
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
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
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "overflow-x-auto rounded-lg border border-stone-200 bg-white p-4 shadow-sm",
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
} as const;

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
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

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center">
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
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
