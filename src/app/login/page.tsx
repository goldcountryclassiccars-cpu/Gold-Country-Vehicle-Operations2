import type { Metadata } from "next";
import { Car } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 via-stone-50 to-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-950 text-gold-400 shadow-md">
            <Car className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">
            Gold Country Classic Cars
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">Vehicle Operations</h1>
        </div>
        {params.expired ? (
          <div
            role="status"
            className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            Your session expired. Sign in again to continue.
          </div>
        ) : null}
        <LoginForm next={params.next} />
        <p className="mt-6 text-center text-xs text-stone-500">
          Forgot your password? Ask an owner to reset it from Administration.
        </p>
      </div>
    </main>
  );
}
