"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { markAllNotificationsRead, markNotificationRead } from "./service";

const idSchema = z.object({ notificationId: z.string().uuid() });

export async function markReadAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) return;
  const parsed = idSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await markNotificationRead(user.id, parsed.data.notificationId);
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}

export async function markAllReadAction() {
  const user = await getSessionUser();
  if (!user) return;
  await markAllNotificationsRead(user.id);
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}
