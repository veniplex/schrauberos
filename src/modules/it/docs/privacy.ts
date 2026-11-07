import "server-only";
import { docsPrivacyProvider } from "@/capabilities/docs/privacy";
import type { PrivacyProviderDef } from "@/modules/types";

export const privacyProviders: PrivacyProviderDef[] = [docsPrivacyProvider({ id: "itdocs", feature: "it.docs", area: "it", order: 81 })];
