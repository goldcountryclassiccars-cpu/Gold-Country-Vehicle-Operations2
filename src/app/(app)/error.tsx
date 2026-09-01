"use client";

/**
 * App-section error boundary. Authorization errors (thrown server-side by
 * requirePermission) land here — the message is intentionally generic; the
 * real control is server-side.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-brand-700">GCCC Ops</p>
      <h1 className="mt-2 text-xl font-semibold text-stone-900">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-stone-500">
        If you believe you should, ask an owner to review your role in Administration. Otherwise, head back to your
        dashboard.
      </p>
      <div className="mt-6 flex gap-3">
        <a href="/dashboard" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
          Dashboard
        </a>
        <button onClick={reset} className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">
          Try again
        </button>
      </div>
    </div>
  );
}
