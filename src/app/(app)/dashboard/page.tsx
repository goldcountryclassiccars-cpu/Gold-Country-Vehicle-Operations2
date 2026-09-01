import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { navForUser } from "@/lib/navigation";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");

  const nav = navForUser(user);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-stone-900">
        Welcome, {user.name.split(" ")[0]}
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        {user.previewRoleKey
          ? "You are previewing another role's view of the application."
          : "Your dashboard shows the work relevant to your role."}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {nav
          .filter((n) => n.href !== "/dashboard")
          .map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-brand-600"
            >
              <p className="text-sm font-medium text-stone-900">{item.label}</p>
              <p className="mt-1 text-xs text-stone-500">Open {item.label.toLowerCase()}</p>
            </a>
          ))}
      </div>
    </div>
  );
}
