/*
 * libFuzzer-Ziel: Siegel-Parser (sos_seal_parse). Gebaut mit -DSOS_FUZZ_NO_SIGNATURE (nur dort): Die Signaturprüfung ist dann ausgeschaltet, damit der Parser *hinter* ihr erreichbar
 * wird – im echten Prüfer liest er den Rumpf erst nach der Signatur. Erstes Eingabebyte: Bit 0 wählt, ob der Release-Schlüssel dem signing-key am Ende der Eingabe entspricht
 * (Form A) oder ein anderer ist (Form B / unbekannter Schlüssel). Prüft nur Speichersicherheit und Invarianten des Ergebnisses.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "verify.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  if (size < 1) return 0;
  int same = data[0] & 1;
  const uint8_t *seal = data + 1;
  size_t len = size - 1;
  /* die Eingabe in einen exakt bemessenen Puffer kopieren: Lesen über das Ende wird von AddressSanitizer erkannt */
  uint8_t *copy = malloc(len ? len : 1);
  if (!copy) return 0;
  memcpy(copy, seal, len);

  uint8_t release[32] = {0}, root[32] = {1};
  if (same && len >= 216) {
    /* der signing-key der Form A steht 216 - 12 Bytes vor dem Ende als Hex; hier nur grob dekodieren, ein falscher Wert ergibt eben „unbekannter Schlüssel“ */
    const uint8_t *hex = copy + len - 216 + 12;
    for (int i = 0; i < 32; i++) {
      int a = hex[2 * i], b = hex[2 * i + 1];
      a = a >= '0' && a <= '9' ? a - '0' : a >= 'a' && a <= 'f' ? a - 'a' + 10 : 0;
      b = b >= '0' && b <= '9' ? b - '0' : b >= 'a' && b <= 'f' ? b - 'a' + 10 : 0;
      release[i] = (uint8_t)(a * 16 + b);
    }
  }
  sos_anchor anchor;
  memset(&anchor, 0, sizeof anchor);
  anchor.root_key = root;
  anchor.release_key = release;
  anchor.base = 4;
  anchor.arch = "x64";
  sos_seal out;
  const char *reason = NULL;
  int rc = sos_seal_parse(copy, len, &anchor, (size & 2) ? "2026-11-07" : NULL, &out, &reason);
  if (rc != 0 && rc != 10 && rc != 11) abort();
  if (rc != 0 && !reason) abort();
  if (rc == 0) {
    /* Invarianten eines angenommenen Siegels */
    if (out.tree_size > SOS_TREE_MAX || out.tree_entries > SOS_TREE_ENTRIES_MAX) abort();
    if (strlen(out.tree_sha512) != 128 || strlen(out.arch) == 0 || strlen(out.arch) > 16 || out.base == 0 || out.base > 999999) abort();
    if (out.major > 999999999u || out.minor > 999999999u || out.patch > 999999999u) abort();
  }
  free(copy);
  return 0;
}
