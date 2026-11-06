import type { ReactNode } from "react";
import { AppShell } from "@/app/app-shell";
import { requireSession } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Die Erzwingung der Passwortänderung passiert in den Seiten (requireSession/requirePermission).
  const session = await requireSession({ allowPasswordChange: true });
  return <AppShell session={session}>{children}</AppShell>;
}
