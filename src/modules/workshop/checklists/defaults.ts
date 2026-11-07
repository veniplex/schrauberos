import type { SignatureMode, StandardKey } from "./constants";
import type { ItemDef } from "./domain";

/**
 * Die mitgelieferten Vorlagen: Annahmeprotokoll (der einzige Eigentümer des Annahmeprotokolls in der Anwendung), Ölwechsel, Reifenwechsel (mit Anzugsdrehmoment der Radschrauben) und HU-Vorbereitung.
 * Es sind **Ausgangspunkte**: Texte, Grenzen und Sollwerte (Drehmoment, Profiltiefe, Reifendruck) sind übliche Werte und gelten nicht für jedes Fahrzeug – die Leitung passt sie an
 * (jede Änderung erzeugt eine neue Version, laufende und abgeschlossene Checklisten behalten ihre). Deutsche Texte: Vorlagen sind Daten der Werkstatt, keine Oberflächentexte.
 */
export type DefaultTemplate = { key: StandardKey; name: string; description: string; signatureMode: SignatureMode; items: ItemDef[] };

const item = (label: string, type: ItemDef["type"], extra: Partial<ItemDef> = {}): ItemDef => ({ label, type, unit: null, minValue: null, maxValue: null, targetValue: null, options: null, required: true, hint: null, ...extra });
const tire = (position: string): ItemDef => item(`Profiltiefe ${position}`, "measure", { unit: "mm", minValue: 1.6, targetValue: 4, hint: "Gesetzliches Minimum 1,6 mm; empfohlen für Winterreifen mindestens 4 mm." });

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "intake",
    name: "Annahmeprotokoll",
    description: "Zustand des Fahrzeugs bei der Annahme, vom Kunden bestätigt.",
    signatureMode: "optional",
    items: [
      item("Kilometerstand abgelesen", "measure", { unit: "km", minValue: 0 }),
      item("Tankfüllung", "choice", { options: "leer\n1/4\n1/2\n3/4\nvoll" }),
      item("Warnleuchten im Kombiinstrument", "choice", { options: "keine\nMotor\nABS/ESP\nAirbag\nBatterie/Öldruck\nsonstige" }),
      item("Äußere Schäden dokumentiert (Fotos unter Dokumente & Fotos)", "photo", { hint: "Alle vier Seiten und vorhandene Schäden fotografieren." }),
      item("Vorhandene Schäden und Auffälligkeiten", "text", { required: false }),
      item("Wertgegenstände im Fahrzeug: Hinweis an den Kunden gegeben", "check"),
      item("Zweitschlüssel, Radiocode, Wegfahrsperre besprochen", "text", { required: false }),
      item("Kundenwunsch besprochen und im Auftrag erfasst", "check"),
      item("Kostenrahmen und Rückruf bei Mehrarbeit besprochen", "check"),
    ],
  },
  {
    key: "oil",
    name: "Ölwechsel",
    description: "Motoröl und Ölfilter wechseln.",
    signatureMode: "none",
    items: [
      item("Motoröl abgelassen", "check"),
      item("Ölfilter gewechselt", "check"),
      item("Dichtring der Ölablassschraube erneuert", "check"),
      item("Anzugsdrehmoment Ölablassschraube", "torque", { unit: "Nm", hint: "Herstellerangabe für dieses Fahrzeug beachten." }),
      item("Öl: Sorte und Menge", "text"),
      item("Ölstand nach Probelauf", "choice", { options: "Minimum\nzwischen Minimum und Maximum\nMaximum" }),
      item("Dichtheit geprüft (Ölablassschraube und Ölfilter)", "check"),
      item("Serviceanzeige zurückgesetzt", "check", { required: false }),
      item("Nächster Ölwechsel in", "measure", { unit: "km", minValue: 0, required: false }),
    ],
  },
  {
    key: "tires",
    name: "Reifenwechsel",
    description: "Räder wechseln mit Anzugsdrehmoment, Profiltiefe und Reifendruck.",
    signatureMode: "none",
    items: [
      item("Reifenart", "choice", { options: "Sommer\nWinter\nGanzjahr" }),
      tire("vorn links"),
      tire("vorn rechts"),
      tire("hinten links"),
      tire("hinten rechts"),
      item("Reifendruck vorn", "measure", { unit: "bar", minValue: 1.5, maxValue: 4, targetValue: 2.4 }),
      item("Reifendruck hinten", "measure", { unit: "bar", minValue: 1.5, maxValue: 4, targetValue: 2.4 }),
      item("Anzugsdrehmoment Radschrauben/-muttern", "torque", { unit: "Nm", minValue: 100, maxValue: 160, targetValue: 120, hint: "Herstellerangabe beachten; über Kreuz anziehen." }),
      item("Räder gewuchtet", "check"),
      item("Reifendruckkontrollsystem angelernt/zurückgesetzt", "check", { required: false }),
      item("Hinweis zum Nachziehen der Radschrauben nach 50–100 km gegeben", "check"),
      item("Abgenommene Räder eingelagert oder mitgegeben", "check", { required: false }),
    ],
  },
  {
    key: "hu",
    name: "HU-Vorbereitung",
    description: "Sichtprüfung und Messungen vor der Hauptuntersuchung.",
    signatureMode: "none",
    items: [
      item("Beleuchtung und Signalanlage (Abblend-, Fern-, Brems-, Schluss-, Blinklicht)", "check"),
      item("Scheinwerfereinstellung geprüft", "check"),
      item("Bremsbelagdicke vorn", "measure", { unit: "mm", minValue: 2, targetValue: 6 }),
      item("Bremsbelagdicke hinten", "measure", { unit: "mm", minValue: 2, targetValue: 6 }),
      item("Bremsscheiben und Bremsleitungen (Sicht)", "check"),
      item("Handbremse/Feststellbremse funktioniert", "check"),
      tire("Achse vorn (kleinster Wert)"),
      tire("Achse hinten (kleinster Wert)"),
      item("Lenkung, Spurstangen, Manschetten (Spiel und Sicht)", "check"),
      item("Stoßdämpfer und Fahrwerk (Sicht)", "check"),
      item("Abgasanlage und Dichtheit", "check"),
      item("Scheibenwischer, Waschanlage, Hupe", "check"),
      item("Sicherheitsgurte und Verbandkasten (Ablaufdatum)", "check"),
      item("Flüssigkeitsstände (Bremsflüssigkeit, Kühlmittel, Öl)", "check"),
      item("Auffälligkeiten", "text", { required: false }),
    ],
  },
];
