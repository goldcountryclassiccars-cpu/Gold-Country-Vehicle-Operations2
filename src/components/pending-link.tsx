"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

function Spinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Loading"
      className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600"
    />
  );
}

/**
 * A Link that shows a spinner on itself while its navigation is in flight.
 *
 * Use it for the big obvious targets — dashboard tiles, stat tiles — where a
 * click that appears to do nothing for a second or two is the difference
 * between "loading" and "broken".
 */
export function PendingLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`relative ${className ?? ""}`}>
      {children}
      <Spinner />
    </Link>
  );
}
