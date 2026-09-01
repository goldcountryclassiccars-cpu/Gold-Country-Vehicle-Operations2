import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-brand-700">
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
