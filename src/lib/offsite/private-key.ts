/**
 * Privater SSH-Schlüssel (PEM / OpenSSH) aus einem Eingabefeld in eine saubere Form bringen – reine Textfunktion. Ein einzeiliges Feld oder eine Zwischenablage kann die Zeilenumbrüche
 * verlieren („-----BEGIN … ----- AAAA … -----END …-----“) oder Windows-Zeilenenden liefern; der Schlüssel wird dann neu umbrochen (OpenSSH: 70 Zeichen, PEM: 64). Gibt `null`
 * zurück, wenn der Text nicht wie ein privater Schlüssel aufgebaut ist. Ob er sich lesen lässt (und ob die Passphrase stimmt), prüft der Server mit `ssh2` (`server/backup/offsite/private-key.ts`).
 */
export function normalizePrivateKey(input: string): string | null {
  const text = input.replace(/\r\n?/g, "\n").trim();
  const match = /^(-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----)([\s\S]*?)(-----END \2-----)$/.exec(text);
  if (!match) return null;
  const [, begin, label, rawBody, end] = match;
  const body = rawBody.trim();
  let lines: string[];
  if (body.includes("\n")) {
    lines = body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } else {
    const compact = body.replace(/\s+/g, "");
    if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) return null;
    const width = label.startsWith("OPENSSH") ? 70 : 64;
    lines = compact.match(new RegExp(`.{1,${width}}`, "g")) ?? [];
  }
  return `${[begin, ...lines, end].join("\n")}\n`;
}
