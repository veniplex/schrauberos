import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { applyPendingRestore, cancelPending, confirmRestore, listPreviousSecretKeys, pendingDbFile, type PendingRestore, pendingFilesDir, pendingSecretKeyFile, readApplied, readPending, readRestoreResult, restoreDir, rollbackRestore, writePending, writePendingSecretKey } from "./restore";

const data = mkdtempSync(path.join(tmpdir(), "so-restore-"));
const dbFile = path.join(data, "schrauberos.db");
const live = path.join(data, "files");
after(() => rmSync(data, { recursive: true, force: true }));

const info = { from: "schrauberos-20260101T020000Z-auto", at: "2026-01-02T10:00:00.000Z", files: false };
const withFiles = { ...info, files: true };
const put = (file: string, content: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const stage = (content: string, pending: PendingRestore = info) => {
  mkdirSync(restoreDir(data), { recursive: true });
  writeFileSync(pendingDbFile(data), content);
  if (pending.files) put(path.join(pendingFilesDir(data), "rechnungen", "neu.pdf"), "NEUE DATEI");
  writePending(pending, data);
};

beforeEach(() => {
  rmSync(restoreDir(data), { recursive: true, force: true });
  rmSync(live, { recursive: true, force: true });
  writeFileSync(dbFile, "ALT");
  writeFileSync(`${dbFile}-wal`, "wal");
  writeFileSync(`${dbFile}-shm`, "shm");
  put(path.join(live, "rechnungen", "alt.pdf"), "ALTE DATEI");
});

describe("Wiederherstellung", () => {
  it("ohne Vormerkung passiert nichts", () => {
    assert.equal(applyPendingRestore(dbFile, data), null);
    assert.equal(readFileSync(dbFile, "utf8"), "ALT");
  });

  it("tauscht die Datenbank aus; das alte WAL wandert mit der alten Datei und hängt nicht an der neuen", () => {
    stage("NEU");
    assert.deepEqual(readPending(data), info);
    assert.deepEqual(applyPendingRestore(dbFile, data), info);
    assert.equal(readFileSync(dbFile, "utf8"), "NEU");
    assert.equal(existsSync(`${dbFile}-wal`), false);
    assert.equal(existsSync(`${dbFile}-shm`), false);
    const replaced = path.join(restoreDir(data), "replaced.db");
    assert.equal(readFileSync(replaced, "utf8"), "ALT");
    assert.equal(readFileSync(`${replaced}-wal`, "utf8"), "wal");
    assert.equal(readPending(data), null);
    assert.deepEqual(readApplied(data), info);
  });

  it("lässt die Dateien unberührt, wenn die Sicherung keine enthält", () => {
    stage("NEU");
    applyPendingRestore(dbFile, data);
    assert.equal(readFileSync(path.join(live, "rechnungen", "alt.pdf"), "utf8"), "ALTE DATEI");
  });

  it("tauscht auch die Dateien aus, wenn die Sicherung welche enthält", () => {
    stage("NEU", withFiles);
    applyPendingRestore(dbFile, data);
    assert.equal(existsSync(path.join(live, "rechnungen", "alt.pdf")), false);
    assert.equal(readFileSync(path.join(live, "rechnungen", "neu.pdf"), "utf8"), "NEUE DATEI");
    assert.equal(readFileSync(path.join(restoreDir(data), "replaced-files", "rechnungen", "alt.pdf"), "utf8"), "ALTE DATEI");
  });

  it("Bestätigung räumt die ersetzten Daten weg und merkt das Ergebnis", () => {
    stage("NEU", withFiles);
    const applied = applyPendingRestore(dbFile, data)!;
    confirmRestore(applied, "t", data);
    assert.equal(existsSync(path.join(restoreDir(data), "replaced.db")), false);
    assert.equal(existsSync(path.join(restoreDir(data), "replaced.db-wal")), false);
    assert.equal(existsSync(path.join(restoreDir(data), "replaced-files")), false);
    assert.equal(readApplied(data), null);
    assert.deepEqual(readRestoreResult(data), { at: "t", from: info.from, status: "ok" });
  });

  it("Rückfall bringt Datenbank (samt WAL) und Dateien der vorherigen Daten zurück", () => {
    stage("DEFEKT", withFiles);
    const applied = applyPendingRestore(dbFile, data)!;
    rollbackRestore(dbFile, applied, "startet nicht", "t", data);
    assert.equal(readFileSync(dbFile, "utf8"), "ALT");
    assert.equal(readFileSync(`${dbFile}-wal`, "utf8"), "wal");
    assert.equal(readFileSync(`${dbFile}-shm`, "utf8"), "shm");
    assert.equal(readFileSync(path.join(live, "rechnungen", "alt.pdf"), "utf8"), "ALTE DATEI");
    assert.equal(existsSync(path.join(live, "rechnungen", "neu.pdf")), false);
    assert.deepEqual(readRestoreResult(data), { at: "t", from: info.from, status: "rolled-back", reason: "startet nicht" });
    assert.equal(readApplied(data), null);
  });

  it("Rückfall ohne Dateien in der Sicherung lässt die Dateien ebenfalls unberührt", () => {
    stage("DEFEKT");
    const applied = applyPendingRestore(dbFile, data)!;
    rollbackRestore(dbFile, applied, "x", "t", data);
    assert.equal(readFileSync(path.join(live, "rechnungen", "alt.pdf"), "utf8"), "ALTE DATEI");
  });

  it("Abbrechen verwirft die Vormerkung samt bereitgestellter Dateien", () => {
    stage("NEU", withFiles);
    cancelPending(data);
    assert.equal(readPending(data), null);
    assert.equal(existsSync(pendingFilesDir(data)), false);
    assert.equal(applyPendingRestore(dbFile, data), null);
    assert.equal(readFileSync(dbFile, "utf8"), "ALT");
  });

  it("ignoriert eine Vormerkung ohne Datenbank oder mit kaputter Info", () => {
    mkdirSync(restoreDir(data), { recursive: true });
    writeFileSync(path.join(restoreDir(data), "pending.json"), JSON.stringify(info));
    assert.equal(readPending(data), null);
    writeFileSync(pendingDbFile(data), "X");
    writeFileSync(path.join(restoreDir(data), "pending.json"), "kaputt");
    assert.equal(readPending(data), null);
  });

  describe("mit Geheimnisschlüssel (Wiederherstellung mit Wiederherstellungsschlüssel)", () => {
    const secretFile = path.join(data, "secret.key");
    const withKey = { ...info, secretKey: true };
    const stageKey = () => {
      stage("NEU", withKey);
      writePendingSecretKey("n".repeat(64), data);
    };

    it("setzt secret.key im selben Schritt ein; der bisherige wandert zur Seite und wird mit der Bestätigung gelöscht", () => {
      writeFileSync(secretFile, "a".repeat(64));
      stageKey();
      assert.deepEqual(readPending(data), withKey);
      applyPendingRestore(dbFile, data);
      assert.equal(readFileSync(secretFile, "utf8"), "n".repeat(64));
      assert.equal(readFileSync(path.join(restoreDir(data), "replaced-secret.key"), "utf8"), "a".repeat(64));
      assert.equal(existsSync(pendingSecretKeyFile(data)), false);
      confirmRestore(readApplied(data)!, "t", data);
      assert.equal(existsSync(path.join(restoreDir(data), "replaced-secret.key")), false);
      assert.equal(readFileSync(secretFile, "utf8"), "n".repeat(64));
    });

    it("Rückfall bringt den bisherigen Schlüssel zurück", () => {
      writeFileSync(secretFile, "a".repeat(64));
      stageKey();
      const applied = applyPendingRestore(dbFile, data)!;
      rollbackRestore(dbFile, applied, "x", "t", data);
      assert.equal(readFileSync(secretFile, "utf8"), "a".repeat(64));
      assert.equal(readFileSync(dbFile, "utf8"), "ALT");
    });

    it("Rückfall ohne bisherigen Schlüssel (frisches Volume) entfernt den eingesetzten", () => {
      rmSync(secretFile, { force: true });
      stageKey();
      const applied = applyPendingRestore(dbFile, data)!;
      assert.equal(existsSync(secretFile), true);
      rollbackRestore(dbFile, applied, "x", "t", data);
      assert.equal(existsSync(secretFile), false);
    });

    it("ohne Vermerk bleibt secret.key unberührt; Abbrechen verwirft den bereitgelegten Schlüssel", () => {
      writeFileSync(secretFile, "a".repeat(64));
      stage("NEU");
      applyPendingRestore(dbFile, data);
      assert.equal(readFileSync(secretFile, "utf8"), "a".repeat(64));
      stageKey();
      cancelPending(data);
      assert.equal(existsSync(pendingSecretKeyFile(data)), false);
    });

    it("legt den bereitgelegten Schlüssel nur für den Besitzer lesbar ab", () => {
      stageKey();
      if (process.platform !== "win32") assert.equal(statSync(pendingSecretKeyFile(data)).mode & 0o777, 0o600);
    });
  });
});

/**
 * Abbruch an jeder Stelle (ZP5-8): Der Prozess wird nach jedem einzelnen Schritt des Tauschs (und des Rückfalls) „abgebrochen“ (Wurf aus dem Testhaken); der nächste Start
 * muss den Zustand vollenden bzw. sauber zurückrollen – nie neue Datenbank mit altem Schlüssel, nie ein verwaister Rest.
 */
describe("Abbruch an jeder Stelle", () => {
  const secretFile = path.join(data, "secret.key");
  const restoreFile = (name: string) => path.join(restoreDir(data), name);
  class Crash extends Error {}

  type Setup = { previous: boolean };
  /** Ausgangslage: Datenbank, Dateien, Schlüssel (`previous`) – oder ein frisches Volume ohne alles – und eine vorgemerkte Wiederherstellung mit Dateien und Schlüssel */
  const prepare = ({ previous }: Setup) => {
    rmSync(restoreDir(data), { recursive: true, force: true });
    rmSync(live, { recursive: true, force: true });
    rmSync(secretFile, { force: true });
    rmSync(dbFile, { force: true });
    rmSync(`${dbFile}-wal`, { force: true });
    rmSync(`${dbFile}-shm`, { force: true });
    if (previous) {
      writeFileSync(dbFile, "ALT");
      writeFileSync(`${dbFile}-wal`, "wal");
      put(path.join(live, "rechnungen", "alt.pdf"), "ALTE DATEI");
      writeFileSync(secretFile, "a".repeat(64));
    }
    stage("NEU", { ...info, files: true, secretKey: true });
    writePendingSecretKey("b".repeat(64), data);
  };

  /** Alle Schritte eines ungestörten Tauschs (in der Reihenfolge, in der der Haken sie meldet) */
  const stepsOf = (setup: Setup, run: (hooks: { after: (step: string) => void }) => void): string[] => {
    prepare(setup);
    const steps: string[] = [];
    run({ after: (step) => void steps.push(step) });
    return steps;
  };

  const expectApplied = (setup: Setup, where: string) => {
    assert.equal(readFileSync(dbFile, "utf8"), "NEU", `${where}: Datenbank`);
    assert.equal(existsSync(`${dbFile}-wal`), false, `${where}: kein altes WAL an der neuen Datenbank`);
    assert.equal(readFileSync(path.join(live, "rechnungen", "neu.pdf"), "utf8"), "NEUE DATEI", `${where}: Dateien`);
    assert.equal(readFileSync(secretFile, "utf8"), "b".repeat(64), `${where}: Schlüssel passt zur neuen Datenbank`);
    if (setup.previous) {
      assert.equal(readFileSync(restoreFile("replaced.db"), "utf8"), "ALT", `${where}: bisherige Datenbank aufgehoben`);
      assert.equal(readFileSync(path.join(restoreFile("replaced-files"), "rechnungen", "alt.pdf"), "utf8"), "ALTE DATEI", `${where}: bisherige Dateien aufgehoben`);
      assert.equal(readFileSync(restoreFile("replaced-secret.key"), "utf8"), "a".repeat(64), `${where}: bisheriger Schlüssel aufgehoben`);
    }
    for (const leftover of ["pending.db", "pending.json", "pending-files", "pending-secret.key"]) assert.equal(existsSync(restoreFile(leftover)), false, `${where}: ${leftover} ist weg`);
    assert.deepEqual(readApplied(data), { ...info, files: true, secretKey: true }, `${where}: Journal fertig`);
    assert.equal(JSON.parse(readFileSync(restoreFile("applied.json"), "utf8")).applying, undefined, `${where}: nicht mehr „im Gang“`);
  };

  const expectOriginal = (setup: Setup, where: string) => {
    if (setup.previous) {
      assert.equal(readFileSync(dbFile, "utf8"), "ALT", `${where}: Datenbank`);
      assert.equal(readFileSync(`${dbFile}-wal`, "utf8"), "wal", `${where}: WAL kommt mit zurück`);
      assert.equal(readFileSync(path.join(live, "rechnungen", "alt.pdf"), "utf8"), "ALTE DATEI", `${where}: Dateien`);
      assert.equal(readFileSync(secretFile, "utf8"), "a".repeat(64), `${where}: Schlüssel`);
    } else {
      assert.equal(existsSync(dbFile), false, `${where}: es gab keine Datenbank`);
      assert.equal(existsSync(live), false, `${where}: es gab keine Dateien`);
      assert.equal(existsSync(secretFile), false, `${where}: es gab keinen Schlüssel`);
    }
    assert.equal(existsSync(restoreFile("applied.json")), false, `${where}: Journal beendet`);
    assert.equal(readRestoreResult(data)?.status, "rolled-back", `${where}: Ergebnis`);
    for (const leftover of ["replaced.db", "replaced-files", "replaced-secret.key"]) assert.equal(existsSync(restoreFile(leftover)), false, `${where}: ${leftover} ist weg`);
  };

  for (const setup of [{ previous: true }, { previous: false }]) {
    const label = setup.previous ? "mit bisherigen Daten" : "frisches Volume";

    it(`Tausch (${label}): nach jedem Schritt abgebrochen, vollendet der nächste Start ihn genau gleich`, () => {
      const steps = stepsOf(setup, (hooks) => applyPendingRestore(dbFile, data, hooks));
      assert.ok(steps.length >= 5, steps.join(","));
      for (let k = 1; k <= steps.length; k++) {
        prepare(setup);
        let count = 0;
        assert.throws(
          () =>
            applyPendingRestore(dbFile, data, {
              after: () => {
                if (++count === k) throw new Crash(`Abbruch nach Schritt ${k}`);
              },
            }),
          Crash,
        );
        // nächster Start: ohne Haken, wie der Launcher
        const resumed = applyPendingRestore(dbFile, data);
        assert.deepEqual(resumed, { ...info, files: true, secretKey: true }, `Abbruch nach Schritt ${k} (${steps[k - 1]})`);
        expectApplied(setup, `Abbruch nach Schritt ${k} (${steps[k - 1]})`);
        // ein weiterer Start tut nichts mehr
        assert.equal(applyPendingRestore(dbFile, data), null);
        expectApplied(setup, `nochmal nach ${k}`);
      }
    });

    it(`Rückfall (${label}): nach jedem Schritt abgebrochen, führt der nächste Start ihn zu Ende (alles zurück, nichts verwaist)`, () => {
      const steps = (() => {
        prepare(setup);
        const applied = applyPendingRestore(dbFile, data)!;
        const recorded: string[] = [];
        rollbackRestore(dbFile, applied, "antwortet nicht gesund", "2026-01-02T11:00:00.000Z", data, { after: (step) => void recorded.push(step) });
        return recorded;
      })();
      assert.ok(steps.length >= 4, steps.join(","));
      for (let k = 1; k <= steps.length; k++) {
        prepare(setup);
        const applied = applyPendingRestore(dbFile, data)!;
        let count = 0;
        assert.throws(
          () =>
            rollbackRestore(dbFile, applied, "antwortet nicht gesund", "2026-01-02T11:00:00.000Z", data, {
              after: () => {
                if (++count === k) throw new Crash();
              },
            }),
          Crash,
        );
        // nächster Start: der Launcher ruft zuerst applyPendingRestore auf – es führt den Rückfall zu Ende und gibt nichts zurück
        assert.equal(applyPendingRestore(dbFile, data), null, `Abbruch nach Schritt ${k} (${steps[k - 1]})`);
        assert.equal(readApplied(data), null);
        expectOriginal(setup, `Rückfall, Abbruch nach Schritt ${k} (${steps[k - 1]})`);
        assert.equal(readRestoreResult(data)?.reason, "antwortet nicht gesund");
      }
    });
  }

  it("ein Abbruch mitten im Tausch lässt nie neue Datenbank mit altem Schlüssel zurück: nach dem Wiederaufnehmen passen Datenbank und Schlüssel zusammen", () => {
    prepare({ previous: true });
    assert.throws(
      () =>
        applyPendingRestore(dbFile, data, {
          after: (step) => {
            if (step === "db") throw new Crash(); // Datenbank getauscht, Schlüssel noch nicht
          },
        }),
      Crash,
    );
    assert.equal(readFileSync(dbFile, "utf8"), "NEU");
    assert.equal(readFileSync(secretFile, "utf8"), "a".repeat(64), "zwischenzeitlich noch der alte Schlüssel …");
    assert.equal(existsSync(pendingSecretKeyFile(data)), true, "… der neue wartet im Vormerk-Ordner");
    assert.ok(readApplied(data), "das Journal merkt den laufenden Tausch");
    applyPendingRestore(dbFile, data);
    assert.equal(readFileSync(secretFile, "utf8"), "b".repeat(64));
  });

  it("die Bestätigung hebt den bisherigen Schlüssel auf (Stand „Vor Wiederherstellung“ bleibt lesbar), räumt sonst auf und ist wiederholbar", () => {
    prepare({ previous: true });
    const applied = applyPendingRestore(dbFile, data)!;
    confirmRestore(applied, "2026-01-02T11:00:00.000Z", data);
    confirmRestore(applied, "2026-01-02T11:00:00.000Z", data); // zweimal: kein Fehler
    assert.deepEqual(listPreviousSecretKeys(data), ["a".repeat(64)]);
    assert.equal(existsSync(restoreFile("replaced-secret.key")), false);
    assert.equal(existsSync(restoreFile("replaced.db")), false);
    assert.equal(existsSync(restoreFile("applied.json")), false);
    assert.equal(readFileSync(secretFile, "utf8"), "b".repeat(64));
    assert.equal(readRestoreResult(data)?.status, "ok");
    // jede bestätigte Wiederherstellung hebt ihren Schlüssel auf; es bleiben höchstens zehn
    for (let i = 0; i < 12; i++) {
      writeFileSync(secretFile, "c".repeat(64));
      stage("NEU", { ...info, secretKey: true });
      writePendingSecretKey(String(i % 10).repeat(64), data);
      confirmRestore(applyPendingRestore(dbFile, data)!, `2026-01-02T11:${String(i).padStart(2, "0")}:00.000Z`, data);
    }
    assert.equal(listPreviousSecretKeys(data).length, 10);
    if (process.platform !== "win32") assert.equal(statSync(path.join(restoreDir(data), readdirSync(restoreDir(data)).find((n) => n.startsWith("previous-secret-"))!)).mode & 0o777, 0o600);
  });
});
