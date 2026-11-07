/**
 * Entwurf und Wiederherstellung der Formulareingabe (ohne React, nur DOM und `sessionStorage`): Momentaufnahme der Felder, schrittweises Zurückschreiben und
 * die Ablage der Entwürfe – gebunden an die Person (Umfang `scope`), damit auf einem geteilten Gerät nichts von einer anderen Person auftaucht.
 *
 * **Zurückschreiben** (`restorePass`): React setzt Formulare nach jeder Aktion zurück, und ein Entwurf muss beim Öffnen in die Felder. Ungesteuerte Felder nehmen den Wert sofort
 * an. Von React **gesteuerte** Felder (Zustand statt `defaultValue`, auch abhängige wie Netto → Brutto, Kundenauswahl, nachrückende Felder wie das Reserverad) übernehmen ihn erst,
 * wenn der Zustand gerendert ist: Ein Durchlauf schreibt deshalb nur bis zum ersten Feld, das nicht „hält“, und meldet, dass ein weiterer Durchlauf nach dem nächsten Rendern nötig
 * ist (`Form` ruft ihn dann wieder auf, bis nichts mehr zu tun ist). So liest jeder Rückruf den aktuellen Zustand – kein Feld überschreibt ein anderes mit einem veralteten Stand.
 */

export const DRAFT_PREFIX = "so_draft:";

export type Entry = { name: string; kind: "value" | "check" | "multi" | "state"; value: string | string[]; checked?: boolean; sensitive?: boolean };

const SKIPPED_TYPES = new Set(["password", "file", "hidden", "submit", "button", "image", "reset"]);

/** Ereignis, mit dem ein Baustein mit eigenem Zustand (Kundenauswahl) die Wiederherstellung seines Zustands annimmt (`detail`: der gemerkte Text) */
export const DRAFT_STATE_EVENT = "so-draft-state";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Zustandsfelder: unsichtbare Felder ohne Namen (werden nicht abgesendet), die den Zustand eines Bausteins als Text tragen (`data-draft-state="<Name>"`). */
const stateName = (element: Element) => (element instanceof HTMLInputElement ? element.getAttribute("data-draft-state") : null);

/** Name, unter dem ein Element im Entwurf steht – `null`: gehört nicht dazu. */
function entryName(element: Element): string | null {
  const state = stateName(element);
  if (state) return state;
  if (element instanceof HTMLInputElement) return !element.name || element.disabled || SKIPPED_TYPES.has(element.type) ? null : element.name;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return !element.name || element.disabled ? null : element.name;
  return null;
}

/** Werte des Formulars (ohne Passwort-, Datei- und versteckte Felder), in Dokumentreihenfolge. */
export function takeSnapshot(form: HTMLFormElement | null): Entry[] {
  if (!form) return [];
  const out: Entry[] = [];
  for (const element of Array.from(form.elements)) {
    const name = entryName(element);
    if (!name) continue;
    const sensitive = element.hasAttribute("data-no-draft");
    if (element instanceof HTMLInputElement) {
      if (stateName(element)) out.push({ name, kind: "state", value: element.value, sensitive });
      else if (element.type === "checkbox" || element.type === "radio") out.push({ name, kind: "check", value: element.value, checked: element.checked, sensitive });
      else out.push({ name, kind: "value", value: element.value, sensitive });
    } else if (element instanceof HTMLTextAreaElement) {
      out.push({ name, kind: "value", value: element.value, sensitive });
    } else if (element instanceof HTMLSelectElement) {
      if (element.multiple) out.push({ name, kind: "multi", value: Array.from(element.selectedOptions).map((o) => o.value), sensitive });
      else out.push({ name, kind: "value", value: element.value, sensitive });
    }
  }
  return out;
}

/** Kurzer Fingerabdruck der Ausgangswerte (Vorbelegung aus der Adresse, gewählter Kunde …): ein Entwurf passt nur zur selben Vorbelegung. */
export function snapshotBase(form: HTMLFormElement | null): string {
  const text = JSON.stringify(takeSnapshot(form).filter((entry) => !entry.sensitive).map((entry) => [entry.name, entry.value, entry.checked ?? null]));
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * Setzt den Wert wie eine Eingabe des Menschen: über den nativen Setter und ein `input`-Ereignis, damit auch von React gesteuerte Felder (Zustand statt `defaultValue`)
 * den Wert übernehmen – ein bloßes `element.value = …` würde beim nächsten Rendern wieder überschrieben.
 */
export function setControlValue(element: Control, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

/** Mehrfach-Auswahl: gewählt sind genau die Werte des Eintrags. */
const selectedValues = (select: HTMLSelectElement) => Array.from(select.selectedOptions).map((option) => option.value);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Wie oft ein einzelner Eintrag höchstens versucht wird (ein Feld, das den Wert nie annimmt – z. B. eine Option, die es nicht mehr gibt –, hält die Wiederherstellung nicht auf). */
const MAX_ATTEMPTS = 3;
/** Obergrenze der Durchläufe je Wiederherstellung (jeder gesteuerte Wert und jedes nachrückende Feld braucht höchstens einen) */
export const MAX_RESTORE_PASSES = 40;

export type RestoreJob = { entries: Entry[]; attempts: number[]; passes: number };

export const createRestoreJob = (entries: Entry[]): RestoreJob => ({ entries, attempts: entries.map(() => 0), passes: 0 });

/**
 * Ein Durchlauf: schreibt, was noch nicht stimmt. Gibt `true` zurück, wenn etwas geschrieben wurde und **nach dem nächsten Rendern erneut** geprüft werden muss
 * (gesteuerte Felder, abgeleitete Werte, Felder, die erst durch einen Wert entstehen). `false`: nichts mehr zu tun.
 */
export function restorePass(form: HTMLFormElement | null, job: RestoreJob): boolean {
  if (!form || job.passes >= MAX_RESTORE_PASSES) return false;
  job.passes++;
  const used = new Set<number>();
  let changed = false;
  for (const element of Array.from(form.elements)) {
    const name = entryName(element);
    if (!name) continue;
    const index = job.entries.findIndex((entry, i) => !used.has(i) && entry.name === name);
    if (index < 0) continue;
    used.add(index);
    const entry = job.entries[index];
    if (job.attempts[index] >= MAX_ATTEMPTS) continue;

    if (element instanceof HTMLInputElement && stateName(element)) {
      if (element.value === entry.value) continue;
      job.attempts[index]++;
      changed = true;
      element.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { bubbles: true, detail: entry.value }));
      if (element.value !== entry.value) return true; // der Baustein hat den Zustand noch nicht gerendert
    } else if (entry.kind === "check" && element instanceof HTMLInputElement) {
      if (element.checked === Boolean(entry.checked)) continue;
      job.attempts[index]++;
      changed = true;
      element.click(); // ein Klick löst auch bei gesteuerten Kontrollkästchen die Änderung aus
      if (element.checked !== Boolean(entry.checked)) return true;
    } else if (entry.kind === "multi" && element instanceof HTMLSelectElement) {
      const wanted = entry.value as string[];
      if (sameList(selectedValues(element), wanted)) continue;
      job.attempts[index]++;
      changed = true;
      for (const option of Array.from(element.options)) option.selected = wanted.includes(option.value);
    } else if (entry.kind === "value" && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      if (element.value === entry.value) continue;
      job.attempts[index]++;
      changed = true;
      setControlValue(element, entry.value as string);
      if (element.value !== entry.value) return true; // gesteuertes Feld: der Wert gilt erst nach dem nächsten Rendern
    }
  }
  // Einträge ohne Feld (noch nicht gezeichnet) findet der nächste Durchlauf, der durch eine Änderung ausgelöst wurde (`changed`)
  return changed;
}

/* ---------------------------------------------------------------- Ablage */

export type Draft = { version: string; base?: string; entries: Entry[] };

/** Ablageschlüssel: Entwürfe gehören einer Person (`scope`, z. B. die Benutzer-ID) – ein anderer Benutzer am selben Browser sieht sie nicht. */
export const draftStorageKey = (scope: string, key: string) => `${DRAFT_PREFIX}${scope || "anon"}:${key}`;

export const versionOf = (form: HTMLFormElement | null) => (form?.elements.namedItem("version") as HTMLInputElement | null)?.value ?? "";

export function readDraft(scope: string, key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftStorageKey(scope, key));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function writeDraft(scope: string, key: string, form: HTMLFormElement | null, base: string) {
  if (!form) return;
  try {
    const draft: Draft = { version: versionOf(form), base, entries: takeSnapshot(form).filter((e) => !e.sensitive) };
    sessionStorage.setItem(draftStorageKey(scope, key), JSON.stringify(draft));
  } catch {
    /* Speicher voll oder gesperrt: kein Entwurf */
  }
}

export function removeDraft(scope: string, key: string) {
  try {
    sessionStorage.removeItem(draftStorageKey(scope, key));
  } catch {
    /* ignorieren */
  }
}

/** Alle Entwürfe löschen (beim Abmelden und auf der Anmeldeseite: auf einem geteilten Gerät soll nichts von der Eingabe zurückbleiben). */
export function clearFormDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* ignorieren */
  }
}

/** Entwürfe anderer Personen verwerfen (z. B. nach einem Sitzungsablauf und Anmeldung eines anderen Benutzers im selben Tab). */
export function purgeForeignDrafts(scope: string): void {
  const own = `${DRAFT_PREFIX}${scope || "anon"}:`;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX) && !key.startsWith(own)) sessionStorage.removeItem(key);
    }
  } catch {
    /* ignorieren */
  }
}
