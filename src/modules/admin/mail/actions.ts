"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { resendMail, saveSettings, sendTest, testConnection } from "./operations";

/** Einstellungen speichern. Passwörter nie kürzen; Häkchen kommen als „on“. */
export const saveMailSettings = defineAction(saveSettings, {
  form: (fd) => {
    const password = fd.get("password");
    return {
      ...formObject(fd),
      enabled: fd.get("enabled") === "on",
      allowPrivate: fd.get("allowPrivate") === "on",
      plainConfirmed: fd.get("plainConfirmed") === "on",
      clearPassword: fd.get("clearPassword") === "on",
      password: typeof password === "string" && password !== "" ? password : undefined,
    };
  },
  revalidate: ["/settings"],
  message: "mail.saved",
});

export const testMailConnectionAction = defineAction(testConnection, { message: "mail.connectionOk" });

/** Test-Mail an die eigene Adresse; die Meldung nennt die Adresse. */
export const sendTestMailAction = defineAction(sendTest, {
  state: (data, _input, { t }) => ({ message: t("mail.testSent", { address: data.to }) }),
  revalidate: ["/settings"],
});

export const resendMailAction = defineAction(resendMail, { revalidate: ["/settings"], message: "mail.log.resent" });
