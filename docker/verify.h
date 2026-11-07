/*
 * SchrauberOS – Prüfer des Starters (Vertrauensanker, README „Starter-Vertrauensanker“): Siegel (SOS-SEAL), Dateiliste (SOS-TREE) und Mengengleichheit mit dem
 * Verzeichnis einer installierten Version. Derselbe Code läuft als `/bootstrap --verify` (Installer, Echtprobe) und im Prüfkind des Starters.
 *
 * Die Spezifikation steht in der README; der Referenzprüfer ist `verifyVersion` in src/lib/updates/seal.ts (TypeScript), der Goldkorpus
 * src/lib/updates/testdata/anchor/cases.json legt die Urteile fest. Alles Fremde wird erst nach der Signaturprüfung gelesen (authenticate-then-parse).
 */
#ifndef SOS_VERIFY_H
#define SOS_VERIFY_H

#include <stddef.h>
#include <stdint.h>

/* Exit-Codes des Prüfers (README, Tabelle) */
#define SOS_OK 0
#define SOS_E_USAGE 2
#define SOS_E_SEAL 10     /* Siegel fehlt, ist kein Siegel oder formal fehlerhaft */
#define SOS_E_SIG 11      /* Signatur, Kette oder Schlüssel ungültig */
#define SOS_E_VERSION 12  /* Version im Siegel != Ordnername / --expect-version */
#define SOS_E_TREE 13     /* SOS-TREE passt nicht zum Siegel */
#define SOS_E_MISSING 14  /* Eintrag der Liste fehlt im Baum */
#define SOS_E_EXTRA 15    /* zusätzlicher Eintrag im Baum */
#define SOS_E_DIFFERS 16  /* Eintrag weicht ab */
#define SOS_E_IO 17       /* Ein-/Ausgabefehler (unklar) */
#define SOS_E_OUTSIDE 18  /* node_modules in einem Vorfahrenordner */
#define SOS_E_OUTDATED 19 /* veraltet oder unverträglich (kein Alarm) */

/* Grenzen (README) */
#define SOS_SEAL_MAX 8192u
#define SOS_TREE_MAX (48u * 1024u * 1024u)
#define SOS_TREE_ENTRIES_MAX 200000u
#define SOS_PATH_LIMIT 1024u
#define SOS_DEPTH_LIMIT 48u
#define SOS_SIZE_LIMIT (1ull << 40)
#define SOS_REPORT_PATH 200u /* längste gemeldete Pfadlänge (JSON, Marker) */

/* Vertrauensanker des Images (aus docker/trust-keys.h) */
typedef struct {
  const uint8_t *root_key;    /* 32 Bytes */
  const uint8_t *release_key; /* 32 Bytes */
  unsigned base;
  const char *arch;
  int has_floor;
  uint32_t floor_major, floor_minor, floor_patch;
  int floor_prerelease;
} sos_anchor;

typedef struct {
  char version[32];
  uint32_t major, minor, patch;
  unsigned base;
  char arch[17];
  char tree_sha512[129]; /* Hex, NUL-terminiert */
  uint64_t tree_size, tree_entries, tree_bytes;
  uint8_t signing_key[32];
  int endorsed;
  char endorsed_until[11];
} sos_seal;

typedef struct {
  const char *path; /* in den Listenpuffer; NUL-terminiert */
  const char *field; /* Hash (hex) bei f, Linkziel bei l; NUL-terminiert */
  uint32_t path_len, name_off, field_len;
  uint64_t size;
  char type; /* d f l */
  uint8_t exec;
} sos_entry;

typedef struct {
  uint8_t *buf; /* Listendatei (wird beim Lesen in Felder zerlegt) */
  sos_entry *e;
  uint32_t *parent; /* Index des Elternordners, n = Wurzel */
  uint32_t *head;   /* je Ordner (n+1 Plätze): erstes Kind */
  uint32_t *next;   /* nächstes Geschwister */
  uint32_t n;
  uint64_t bytes; /* Summe der Dateigrößen */
} sos_tree;

typedef struct {
  int code; /* 0 = ok */
  char reason[28];
  char path[SOS_PATH_LIMIT + 1];
  char version[32];
  uint64_t files, bytes, ms;
  int floor; /* 0 none · 1 below · 2 equal · 3 above */
} sos_result;

typedef void (*sos_progress_fn)(void *ctx, uint64_t bytes_done, uint64_t bytes_total, uint32_t files_done, uint32_t files_total);

typedef struct {
  const char *expect_version; /* NULL: Ordnername */
  int enforce_floor;
  const char *check_expiry; /* JJJJ-MM-TT oder NULL */
  sos_progress_fn progress;
  void *progress_ctx;
} sos_options;

/* ───────── Bausteine (auch für Tests und Fuzz-Ziele) ───────── */

int sos_version_parse(const char *s, uint32_t out[3]); /* streng x.y.z: keine führenden Nullen, höchstens 9 Ziffern je Zahl */
int sos_calendar_date(const char *s); /* genau JJJJ-MM-TT, echtes Datum (gregorianisch, 0000–9999) */
size_t sos_utf8_seq(const uint8_t *p, size_t n); /* Länge der gültigen UTF-8-Sequenz an p (1–4) oder 0 */
int sos_utf8_valid(const uint8_t *p, size_t n);
/* Pfad/Text für Ausgaben bereinigen: Steuerzeichen, ungültiges UTF-8 und U+FFFD werden '?'; höchstens `cap-1` Bytes (an Zeichengrenzen) */
void sos_clean(const char *in, size_t n, char *out, size_t cap);

/* Ed25519-Prüfung wie im Prüfer: Monocypher plus Abweisung nicht-kanonischer Punktkodierungen von R und A. 1 = gültig. */
int sos_ed25519_check(const uint8_t sig[64], const uint8_t key[32], const uint8_t *msg, size_t n);

/* Siegel: 0 oder 10/11; `reason` zeigt auf einen Literal. Liest den Rumpf erst nach der Signaturprüfung. */
int sos_seal_parse(const uint8_t *buf, size_t len, const sos_anchor *anchor, const char *check_expiry, sos_seal *out, const char **reason);

/* Liste: zerlegt `buf` (Besitz geht auf `t` über, `sos_tree_free` gibt ihn frei); 0 oder 13. `errpath` nimmt den Pfad des Fehlers auf (gekürzt). */
int sos_tree_parse(uint8_t *buf, size_t len, sos_tree *t, const char **reason, char *errpath, size_t errpath_cap);
void sos_tree_free(sos_tree *t);

/* Baum gegen Liste (Mengengleichheit); `dirfd` ist das Versionsverzeichnis. 0 oder 14/15/16/17; füllt `r`. */
int sos_tree_walk(int dirfd, const sos_tree *t, sos_result *r, sos_progress_fn progress, void *ctx);

/* Alles zusammen für ein Verzeichnis. `data_dir`: Datenverzeichnis für die Vorfahrenregel (liegt `dir` darunter). Rückgabe = Exit-Code. */
int sos_verify_path(const char *dir, const char *data_dir, const sos_anchor *anchor, const sos_options *opt, sos_result *r);

/* Eine JSON-Zeile (ohne Zeilenende) für `--verify`. */
void sos_result_json(const sos_result *r, char *out, size_t cap);

#endif
