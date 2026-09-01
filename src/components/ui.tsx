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

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-lg border border-stone-200 bg-white p-4 shadow-sm", className)}>
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
  const styles = {
    primary: "bg-brand-700 text-white hover:bg-brand-800",
    secondary: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
    danger: "bg-red-700 text-white hover:bg-red-800",
    ghost: "text-stone-600 hover:bg-stone-100",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      className={clsx(
        "rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60",
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
