"use client";

import type { ReactNode } from "react";
import { DraftScopeContext } from "./form-context";

/** Bindet die Entwürfe der Formulare darunter an eine Person (siehe `DraftScopeContext`): `userId` kommt vom Anwendungsrahmen. */
export function DraftScope({ userId, children }: { userId: string; children: ReactNode }) {
  return <DraftScopeContext.Provider value={userId}>{children}</DraftScopeContext.Provider>;
}
