"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/lib/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
      {state.error ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-stone-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm shadow-sm"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-stone-700">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm shadow-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
