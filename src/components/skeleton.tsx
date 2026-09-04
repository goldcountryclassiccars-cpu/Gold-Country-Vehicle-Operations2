/**
 * Loading placeholders.
 *
 * Every page in this app is server-rendered against a database in another
 * region, so a click has a real, visible cost. Without a `loading.tsx`
 * boundary Next.js paints nothing until the whole page is ready, and a slow
 * page is indistinguishable from a frozen one — the single most common
 * complaint about the app. These skeletons give the click somewhere to land
 * immediately.
 *
 * No client JavaScript: the shimmer is pure CSS.
 */

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-stone-200 ${className}`} aria-hidden="true" />;
}

/** Generic page skeleton: a header, a few tiles, and a table-ish body. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="mb-6">
        <SkeletonBar className="h-7 w-56" />
        <SkeletonBar className="mt-2 h-4 w-80 max-w-full" />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <SkeletonBar className="h-4 w-24" />
            <SkeletonBar className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-3">
          <SkeletonBar className="h-3 w-40" />
        </div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-stone-100 px-4 py-4 last:border-b-0">
            <SkeletonBar className="h-4 flex-1" />
            <SkeletonBar className="hidden h-4 w-32 sm:block" />
            <SkeletonBar className="hidden h-4 w-24 md:block" />
            <SkeletonBar className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
