import "server-only";
import { docsPrivacyProvider } from "@/capabilities/docs/privacy";
import type { PrivacyProviderDef } from "@/modules/types";

export const privacyProviders: PrivacyProviderDef[] = [docsPrivacyProvider({ id: "handbook", feature: "handbook.manual", area: "handbook", order: 80 })];
