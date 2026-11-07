import { resetUnreadableSettingSecrets, type SecretConsumerDef } from "@/server/secret-consumers";
import { UPDATE_TOKEN_KEY } from "./config";

/** Das Update-Token liegt verschlüsselt in den Einstellungen; ist es nach einem Restore ohne passenden Schlüssel unlesbar, wird es entfernt (neu eintragen unter Einstellungen → Updates). */
export const secretConsumers: SecretConsumerDef[] = [
  { id: "updates.token", feature: "admin.updates", resetUnreadable: () => resetUnreadableSettingSecrets([UPDATE_TOKEN_KEY]) },
];
