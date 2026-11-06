-- Der Hinweis „Notzugang wurde verwendet“ überlebt das Löschen des Kontos: userId wird nullable (SetNull), der Name bleibt in userName.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecoveryNotice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RecoveryNotice" ("createdAt", "id", "userId", "userName") SELECT "createdAt", "id", "userId", COALESCE((SELECT "name" FROM "User" WHERE "User"."id" = "RecoveryNotice"."userId"), '') FROM "RecoveryNotice";
DROP TABLE "RecoveryNotice";
ALTER TABLE "new_RecoveryNotice" RENAME TO "RecoveryNotice";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
