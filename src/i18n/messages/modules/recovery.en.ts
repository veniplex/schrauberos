import type { recoveryDe } from "./recovery.de";

export const recoveryEn: typeof recoveryDe = {
  setupDoneReload: "Setup is complete. The recovery code is shown only once; you can create a new one at any time under “My account”.",
  title: "Emergency access",
  heading: "Recovery code",
  keepLikePassword:
    "Keep this code like a password – it bypasses the password and two-factor sign-in. Whoever has it can take over an administrator account.",
  shownOnce:
    "The code is shown only now and cannot be retrieved later. Print it or write it down and keep it somewhere safe, for example in a safe. If all administrator passwords are lost, it gets you back into the system.",
  yourCode: "Your recovery code",
  print: "Print",
  saved: "I have saved the code.",
  continue: "Continue",
  confirmFailed: "The confirmation could not be saved. Please try again.",
  printTitle: "Recovery code",
  printFor: "Account: {name} ({username})",
  printWorkshop: "Workshop: {workshop}",
  printIssued: "Issued on {date}",
  printWarning:
    "Keep it like a password – the code bypasses the password and two-factor sign-in. It is valid for this account only and becomes invalid as soon as it is used or a new one is created. After restoring an older backup this printout may be out of date.",
  link: "Lost access? Use a recovery code",
  recover: {
    title: "Recover access",
    intro: "Enter the recovery code of an administrator account and a new password. Then sign in with the new password.",
    code: "Recovery code",
    codeHint: "8 groups of 5 characters. Case and hyphens do not matter.",
    codePlaceholder: "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX",
    checksumOk: "The check characters are correct.",
    badGroup: "The check character in group {group} does not match – probably a typo.",
    badChars: "The code contains a character that cannot occur.",
    newPassword: "New password",
    submit: "Recover access",
    back: "Back to sign-in",
    doneTitle: "Password changed",
    doneIntro:
      "The new password is active and all existing sign-ins of this account have been ended. The code you used is no longer valid – here is your new code. You are not signed in automatically.",
    toLogin: "To sign-in",
    secondFactorReset: "Two-factor sign-in for this account has been reset: the emergency access bypasses it. After signing in, set it up again under “My account”.",
    errors: {
      invalid: "The code is invalid or no longer valid.",
      throttled: "Too many attempts from this address. Please try again in about {seconds} seconds.",
    },
  },
  account: {
    intro:
      "The recovery code is your emergency access: if all administrator passwords are lost, “Lost access?” on the sign-in page gets you back into the system. Each administrator account has exactly one valid code.",
    created: "Current code created on {date}.",
    confirmed: "Confirmed as saved.",
    notConfirmed: "Not yet confirmed as saved.",
    none: "This account has no code yet.",
    regenerate: "Create new code",
    generate: "Create code",
    regenerateHint: "The previous code becomes invalid. For safety, your current password is required.",
    password: "Current password",
    restoreHint: "After restoring an older backup, a printed code may be out of date – create a new one here.",
    errors: { adminOnly: "Emergency access exists for administrator accounts only.", external: "This account is managed externally." },
  },
  banner: {
    used: "Emergency access was used ({date}): the password of the account “{name}” was reset with a recovery code.",
    usedOwn: "Your emergency access was used ({date}): your password was reset with your recovery code. If this was not you, change your password and create a new code.",
    ack: "Seen",
    unconfirmed: "You have not yet confirmed that your recovery code is saved.",
    confirm: "I have saved it",
    toAccount: "Create new code",
  },
};
