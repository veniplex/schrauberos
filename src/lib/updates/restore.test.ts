import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { applyPendingRestore, cancelPending, confirmRestore, pendingDbFile, pendingFilesDir, pendingSecretKeyFile, readApplied, readPending, readRestoreResult, restoreDir, rollbackRestore, writePending, writePendingSecretKey } from "./restore";

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
const stage = (content: string, pending = info) => {
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
