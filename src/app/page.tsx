import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";

export default async function RootPage() {
  const user = await getSessionUser();
  redirect(user ? (user.defaultLandingPage ?? "/dashboard") : "/login");
}
