/*
 * SchrauberOS – Prüfer des Starters. Spezifikation: README „Starter-Vertrauensanker“; Referenz: src/lib/updates/seal.ts, tree.ts, keychain.ts.
 *
 * Regeln dieser Datei:
 *  - Authenticate-then-parse: Vom Siegel wird zuerst der Schwanz fester Länge an festen Positionen gelesen und die Signatur geprüft; der Rumpf (die Zahlen und Texte, die
 *    Größen bestimmen) erst danach. Die Liste wird erst gelesen, wenn ihr SHA-512 dem signierten Wert entspricht; Puffergrößen kommen aus dem signierten Siegel und sind begrenzt.
 *  - Alle Dezimalzahlen werden mit Längenbegrenzung gelesen (kein Überlauf möglich), kein sscanf/strtoul.
 *  - Der Baum wird nur mit openat/fstatat relativ zu einem geöffneten Ordner durchlaufen (O_NOFOLLOW, O_NONBLOCK, O_CLOEXEC), nie als ganzer Pfad aufgelöst; Dateien werden über den
 *    geöffneten Deskriptor gelesen und gehasht. Je Ordner wird nichts gepuffert: Namen werden einzeln gegen die Liste geprüft (Binärsuche) und in einer Bitliste abgehakt.
 *  - Der Prüfer schreibt nie (außer auf stdout/stderr der Aufrufer) und kennt keine Umgebung außer den übergebenen Parametern.
 */
#define _GNU_SOURCE
#include "verify.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#include "monocypher-ed25519.h"
#include "monocypher.h"

#if defined(SOS_FUZZ_NO_SIGNATURE) && defined(SOS_PRODUCTION)
#error "SOS_FUZZ_NO_SIGNATURE darf nie in einem Produktions-Build stehen"
#endif

static const char SEAL_HEADER[] = "schrauberos-seal 1\n";
static const char SEAL_CONTEXT[] = "schrauberos-seal-v1\n";
static const char ENDORSEMENT_CONTEXT[] = "schrauberos-release-key-endorsement-v2\n";
static const char ENDORSEMENT_MAGIC[] = "schrauberos-endorsement 2\n";
static const char TREE_HEADER[] = "schrauberos-tree 1\nhash sha512\n";

#define SEAL_HEADER_LEN (sizeof SEAL_HEADER - 1)
#define SEAL_CONTEXT_LEN (sizeof SEAL_CONTEXT - 1)
#define ENDORSEMENT_CONTEXT_LEN (sizeof ENDORSEMENT_CONTEXT - 1)
#define TREE_HEADER_LEN (sizeof TREE_HEADER - 1)

#define STATEMENT_BYTES 118u
#define KEY_LINE 77u                              /* "signing-key " + 64 + "\n" */
#define ENDORSEMENT_LINE (12u + 2u * STATEMENT_BYTES + 1u) /* "endorsement " + 236 + "\n" */
#define ENDORSEMENT_SIG_LINE (16u + 128u + 1u)    /* "endorsement-sig " + 128 + "\n" */
#define SIGNATURE_LINE (10u + 128u + 1u)          /* "signature " + 128 + "\n" */
#define TAIL_A (KEY_LINE + SIGNATURE_LINE)        /* 216 */
#define TAIL_B (KEY_LINE + ENDORSEMENT_LINE + ENDORSEMENT_SIG_LINE + SIGNATURE_LINE) /* 610 */

/* ───────── kleine Bausteine ───────── */

static int hexval(unsigned c) {
  if (c >= '0' && c <= '9') return (int)(c - '0');
  if (c >= 'a' && c <= 'f') return (int)(c - 'a') + 10;
  return -1;
}

static int is_hex(const uint8_t *p, size_t n) {
  for (size_t i = 0; i < n; i++)
    if (hexval(p[i]) < 0) return 0;
  return 1;
}

/* n Hexziffern (gerade, bereits geprüft) → n/2 Bytes */
static void hex_decode(const uint8_t *p, size_t n, uint8_t *out) {
  for (size_t i = 0; i < n / 2; i++) out[i] = (uint8_t)((hexval(p[2 * i]) << 4) | hexval(p[2 * i + 1]));
}

static void hex_encode(const uint8_t *in, size_t n, char *out) {
  static const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) {
    out[2 * i] = digits[in[i] >> 4];
    out[2 * i + 1] = digits[in[i] & 15];
  }
  out[2 * n] = 0;
}

/* Dezimalzahl `^(0|[1-9][0-9]*)$` mit höchstens max_digits (<= 18) Ziffern: kein Überlauf möglich */
static int parse_dec(const uint8_t *p, size_t n, size_t max_digits, uint64_t *out) {
  if (n == 0 || n > max_digits || max_digits > 18) return 0;
  if (p[0] == '0' && n > 1) return 0;
  uint64_t v = 0;
  for (size_t i = 0; i < n; i++) {
    if (p[i] < '0' || p[i] > '9') return 0;
    v = v * 10 + (uint64_t)(p[i] - '0');
  }
  *out = v;
  return 1;
}

int sos_calendar_date(const char *s) {
  if (!s || strlen(s) != 10 || s[4] != '-' || s[7] != '-') return 0;
  unsigned v[3] = {0, 0, 0};
  const size_t from[3] = {0, 5, 8}, len[3] = {4, 2, 2};
  for (int k = 0; k < 3; k++)
    for (size_t i = 0; i < len[k]; i++) {
      char c = s[from[k] + i];
      if (c < '0' || c > '9') return 0;
      v[k] = v[k] * 10 + (unsigned)(c - '0');
    }
  unsigned y = v[0], m = v[1], d = v[2];
  int leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
  static const unsigned days[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (m < 1 || m > 12 || d < 1) return 0;
  return d <= days[m - 1] + (m == 2 && leap ? 1u : 0u);
}

size_t sos_utf8_seq(const uint8_t *p, size_t n) {
  if (n == 0) return 0;
  uint8_t c = p[0];
  if (c < 0x80) return 1;
  size_t need;
  uint8_t lo = 0x80, hi = 0xbf;
  if (c >= 0xc2 && c <= 0xdf) need = 2;
  else if (c == 0xe0) { need = 3; lo = 0xa0; }
  else if (c == 0xed) { need = 3; hi = 0x9f; }
  else if (c >= 0xe1 && c <= 0xef) need = 3;
  else if (c == 0xf0) { need = 4; lo = 0x90; }
  else if (c == 0xf4) { need = 4; hi = 0x8f; }
  else if (c >= 0xf1 && c <= 0xf3) need = 4;
  else return 0;
  if (n < need) return 0;
  if (p[1] < lo || p[1] > hi) return 0;
  for (size_t i = 2; i < need; i++)
    if (p[i] < 0x80 || p[i] > 0xbf) return 0;
  return need;
}

int sos_utf8_valid(const uint8_t *p, size_t n) {
  size_t i = 0;
  while (i < n) {
    if (p[i] < 0x80) { i++; continue; }
    size_t k = sos_utf8_seq(p + i, n - i);
    if (k == 0) return 0;
    i += k;
  }
  return 1;
}

/* Zeichen, die in Logs, Markern und der Anzeige nichts zu suchen haben: C1 (U+0080–U+009F), Bidi (U+061C, U+200E/F, U+202A–E, U+2066–9), Zeilentrenner (U+2028/9), U+FFFD */
static int hostile_seq(const uint8_t *p, size_t k) {
  if (k == 2) return p[0] == 0xc2 && p[1] >= 0x80 && p[1] <= 0x9f ? 1 : (p[0] == 0xd8 && p[1] == 0x9c);
  if (k != 3) return 0;
  if (p[0] == 0xef) return p[1] == 0xbf && p[2] == 0xbd;
  if (p[0] == 0xe2 && p[1] == 0x80) return p[2] == 0x8e || p[2] == 0x8f || (p[2] >= 0xa8 && p[2] <= 0xae);
  if (p[0] == 0xe2 && p[1] == 0x81) return p[2] >= 0xa6 && p[2] <= 0xa9;
  return 0;
}

void sos_clean(const char *in, size_t n, char *out, size_t cap) {
  size_t o = 0, i = 0;
  if (cap == 0) return;
  while (i < n) {
    const uint8_t *p = (const uint8_t *)in + i;
    size_t k = sos_utf8_seq(p, n - i);
    char tmp[4];
    size_t take;
    if (k == 0 || (k == 1 && (p[0] < 0x20 || p[0] == 0x7f)) || hostile_seq(p, k)) {
      tmp[0] = '?';
      take = 1;
      k = k ? k : 1;
    } else {
      memcpy(tmp, p, k);
      take = k;
    }
    if (o + take > cap - 1 || o + take > SOS_REPORT_PATH) break;
    memcpy(out + o, tmp, take);
    o += take;
    i += k;
  }
  out[o] = 0;
}

/*
 * Kanonische Kodierung eines Punktes (RFC 8032, 5.1.3): y < p = 2^255 - 19, und bei x = 0 (y = 1 oder y = p - 1) darf das Vorzeichenbit nicht gesetzt sein.
 * Monocypher prüft die Gleichung auf Punkten und lässt nicht-kanonische Kodierungen von R und A bewusst zu (Wycheproof tcId 151); wir weisen sie vorher ab – eine Signatur
 * hat damit genau eine gültige Kodierung.
 */
static int canonical_point(const uint8_t e[32]) {
  int middle_ff = 1, middle_zero = 1;
  for (int i = 1; i < 31; i++) {
    middle_ff &= e[i] == 0xff;
    middle_zero &= e[i] == 0x00;
  }
  uint8_t top = e[31] & 0x7f;
  int sign = (e[31] & 0x80) != 0;
  if (top == 0x7f && middle_ff && e[0] >= 0xed) return 0; /* y >= p */
  if (sign && top == 0 && middle_zero && e[0] == 0x01) return 0; /* y = 1, x = 0, Vorzeichen gesetzt */
  if (sign && top == 0x7f && middle_ff && e[0] == 0xec) return 0; /* y = p - 1, x = 0, Vorzeichen gesetzt */
  return 1;
}

int sos_ed25519_check(const uint8_t sig[64], const uint8_t key[32], const uint8_t *msg, size_t n) {
  if (!canonical_point(sig) || !canonical_point(key)) return 0;
  return crypto_ed25519_check(sig, key, msg, n) == 0;
}

static int sig_valid(const uint8_t sig[64], const uint8_t key[32], const uint8_t *msg, size_t n) {
#ifdef SOS_FUZZ_NO_SIGNATURE
  (void)sig; (void)key; (void)msg; (void)n;
  return 1; /* nur im Fuzz-Bau: der Parser hinter der Signaturprüfung wird erreichbar */
#else
  return sos_ed25519_check(sig, key, msg, n);
#endif
}

/* ───────── Siegel ───────── */

/* Beglaubigungs-Aussage (118 Bytes): wird nicht „geparst“, sondern an festen Stellen gelesen und gegen den Nachbau geprüft */
static int statement_valid(const uint8_t *st, uint8_t key_out[32], char until_out[11]) {
  static const char head[] = "key ";
  static const char until_label[] = "valid-until ";
  size_t o = 0;
  if (memcmp(st, ENDORSEMENT_MAGIC, sizeof ENDORSEMENT_MAGIC - 1) != 0) return 0;
  o += sizeof ENDORSEMENT_MAGIC - 1; /* 26 */
  if (memcmp(st + o, head, 4) != 0) return 0;
  o += 4; /* 30 */
  if (!is_hex(st + o, 64)) return 0;
  hex_decode(st + o, 64, key_out);
  o += 64;
  if (st[o++] != '\n') return 0; /* 95 */
  if (memcmp(st + o, until_label, sizeof until_label - 1) != 0) return 0;
  o += sizeof until_label - 1; /* 107 */
  memcpy(until_out, st + o, 10);
  until_out[10] = 0;
  if (!sos_calendar_date(until_out)) return 0;
  o += 10;
  if (st[o++] != '\n') return 0;
  return o == STATEMENT_BYTES;
}

static int is_version(const uint8_t *p, size_t n, uint32_t v[3], char *out32) {
  /* ^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$ */
  size_t pos = 0;
  for (int k = 0; k < 3; k++) {
    size_t start = pos;
    while (pos < n && p[pos] >= '0' && p[pos] <= '9') pos++;
    uint64_t x;
    if (!parse_dec(p + start, pos - start, 9, &x)) return 0;
    v[k] = (uint32_t)x;
    if (k < 2) {
      if (pos >= n || p[pos] != '.') return 0;
      pos++;
    }
  }
  if (pos != n || n > 31) return 0;
  if (out32) {
    memcpy(out32, p, n);
    out32[n] = 0;
  }
  return 1;
}

int sos_version_parse(const char *s, uint32_t out[3]) { return is_version((const uint8_t *)s, strlen(s), out, NULL); }

int sos_seal_parse(const uint8_t *buf, size_t len, const sos_anchor *anchor, const char *check_expiry, sos_seal *out, const char **reason) {
#define BAD(code, why) do { *reason = (why); return (code); } while (0)
  if (len > SOS_SEAL_MAX) BAD(SOS_E_SEAL, "too-large");
  if (len < SEAL_HEADER_LEN + TAIL_A || buf[len - 1] != '\n') BAD(SOS_E_SEAL, "format");

  /* Form B zuerst: 610 Bytes vor dem Ende „signing-key “ und an der festen Stelle danach „endorsement “ */
  int form_b = len >= TAIL_B + SEAL_HEADER_LEN && memcmp(buf + len - TAIL_B, "signing-key ", 12) == 0 && memcmp(buf + len - (TAIL_B - KEY_LINE), "endorsement ", 12) == 0;
  size_t tail_len = form_b ? TAIL_B : TAIL_A;
  const uint8_t *tail = buf + len - tail_len;
  if (memcmp(tail, "signing-key ", 12) != 0 || tail[KEY_LINE - 1] != '\n') BAD(SOS_E_SEAL, "tail");
  const uint8_t *key_hex = tail + 12;
  const uint8_t *sig_line = buf + len - SIGNATURE_LINE;
  if (memcmp(sig_line, "signature ", 10) != 0 || !is_hex(sig_line + 10, 128) || sig_line[138] != '\n' || !is_hex(key_hex, 64)) BAD(SOS_E_SEAL, "tail");

  uint8_t signing_key[32];
  hex_decode(key_hex, 64, signing_key);
  int is_release = memcmp(signing_key, anchor->release_key, 32) == 0;
  int endorsed = 0;
  char until[11] = "";

  if (form_b) {
    const uint8_t *e_line = tail + KEY_LINE;
    const uint8_t *s_line = e_line + ENDORSEMENT_LINE;
    if (memcmp(e_line, "endorsement ", 12) != 0 || e_line[ENDORSEMENT_LINE - 1] != '\n' || !is_hex(e_line + 12, 2 * STATEMENT_BYTES)) BAD(SOS_E_SEAL, "tail");
    if (memcmp(s_line, "endorsement-sig ", 16) != 0 || s_line[ENDORSEMENT_SIG_LINE - 1] != '\n' || !is_hex(s_line + 16, 128)) BAD(SOS_E_SEAL, "tail");
    if (is_release) BAD(SOS_E_SIG, "endorsement-for-release-key");
    uint8_t statement[STATEMENT_BYTES], esig[64], ekey[32];
    hex_decode(e_line + 12, 2 * STATEMENT_BYTES, statement);
    hex_decode(s_line + 16, 128, esig);
    uint8_t msg[sizeof ENDORSEMENT_CONTEXT + STATEMENT_BYTES];
    memcpy(msg, ENDORSEMENT_CONTEXT, ENDORSEMENT_CONTEXT_LEN);
    memcpy(msg + ENDORSEMENT_CONTEXT_LEN, statement, STATEMENT_BYTES);
    if (!statement_valid(statement, ekey, until) || !sig_valid(esig, anchor->root_key, msg, ENDORSEMENT_CONTEXT_LEN + STATEMENT_BYTES)) BAD(SOS_E_SIG, "endorsement-invalid");
    if (check_expiry && strcmp(check_expiry, until) > 0) BAD(SOS_E_SIG, "endorsement-expired");
    if (memcmp(ekey, signing_key, 32) != 0) BAD(SOS_E_SIG, "endorsement-other-key");
    endorsed = 1;
  } else if (!is_release) {
    BAD(SOS_E_SIG, "unknown-key");
  }

  /* Hauptsignatur über Kontext + alles vor der signature-Zeile */
  size_t signed_len = len - SIGNATURE_LINE;
  uint8_t msg[SEAL_CONTEXT_LEN + SOS_SEAL_MAX];
  memcpy(msg, SEAL_CONTEXT, SEAL_CONTEXT_LEN);
  memcpy(msg + SEAL_CONTEXT_LEN, buf, signed_len);
  uint8_t sig[64];
  hex_decode(sig_line + 10, 128, sig);
  if (!sig_valid(sig, signing_key, msg, SEAL_CONTEXT_LEN + signed_len)) BAD(SOS_E_SIG, "bad-signature");

  /* Erst jetzt (die Bytes sind echt) wird der Rumpf gelesen: acht Zeilen, jede mit festem Namen */
  size_t body_end = len - tail_len;
  size_t newlines = 0;
  for (size_t i = 0; i < body_end; i++)
    if (buf[i] == '\n') newlines++;
  if (body_end == 0 || buf[body_end - 1] != '\n' || newlines != 8 || memcmp(buf, SEAL_HEADER, SEAL_HEADER_LEN) != 0) BAD(SOS_E_SEAL, "body");
  static const char *const names[7] = {"version", "base", "arch", "tree-sha512", "tree-size", "tree-entries", "tree-bytes"};
  const uint8_t *val[7];
  size_t vlen[7];
  size_t pos = SEAL_HEADER_LEN;
  for (int i = 0; i < 7; i++) {
    size_t nl = strlen(names[i]);
    if (pos + nl + 1 > body_end || memcmp(buf + pos, names[i], nl) != 0 || buf[pos + nl] != ' ') {
      static const char *const reasons[7] = {"body:version", "body:base", "body:arch", "body:tree-sha512", "body:tree-size", "body:tree-entries", "body:tree-bytes"};
      *reason = reasons[i];
      return SOS_E_SEAL;
    }
    const uint8_t *start = buf + pos + nl + 1;
    const uint8_t *end = memchr(start, '\n', body_end - (pos + nl + 1));
    if (!end) BAD(SOS_E_SEAL, "body");
    val[i] = start;
    vlen[i] = (size_t)(end - start);
    pos = (size_t)(end - buf) + 1;
  }
  sos_seal s;
  memset(&s, 0, sizeof s);
  uint32_t ver[3];
  uint64_t base, size, entries, bytes;
  if (!is_version(val[0], vlen[0], ver, s.version) || vlen[1] == 0 || val[1][0] == '0' || !parse_dec(val[1], vlen[1], 6, &base)) BAD(SOS_E_SEAL, "body:value");
  if (vlen[2] < 1 || vlen[2] > 16) BAD(SOS_E_SEAL, "body:value");
  for (size_t i = 0; i < vlen[2]; i++) {
    uint8_t c = val[2][i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) BAD(SOS_E_SEAL, "body:value");
  }
  if (vlen[3] != 128 || !is_hex(val[3], 128)) BAD(SOS_E_SEAL, "body:value");
  if (!parse_dec(val[4], vlen[4], 15, &size) || !parse_dec(val[5], vlen[5], 15, &entries) || !parse_dec(val[6], vlen[6], 15, &bytes)) BAD(SOS_E_SEAL, "body:value");
  if (size > SOS_TREE_MAX || entries > SOS_TREE_ENTRIES_MAX) BAD(SOS_E_SEAL, "body:limit");
  s.major = ver[0];
  s.minor = ver[1];
  s.patch = ver[2];
  s.base = (unsigned)base;
  memcpy(s.arch, val[2], vlen[2]);
  memcpy(s.tree_sha512, val[3], 128);
  s.tree_size = size;
  s.tree_entries = entries;
  s.tree_bytes = bytes;
  memcpy(s.signing_key, signing_key, 32);
  s.endorsed = endorsed;
  if (endorsed) memcpy(s.endorsed_until, until, 11);
  *out = s;
  return SOS_OK;
#undef BAD
}

/* ───────── Liste ───────── */

static int cmp_path(const sos_entry *e, const char *p, size_t n) {
  size_t m = e->path_len < n ? e->path_len : n;
  int c = memcmp(e->path, p, m);
  if (c) return c;
  return (e->path_len > n) - (e->path_len < n);
}

/* Binärsuche in e[0..hi) nach dem Pfad; -1, wenn es ihn nicht gibt */
static int64_t find_entry(const sos_entry *e, uint32_t hi, const char *p, size_t n) {
  uint32_t lo = 0;
  while (lo < hi) {
    uint32_t mid = lo + (hi - lo) / 2;
    int c = cmp_path(&e[mid], p, n);
    if (c == 0) return mid;
    if (c < 0) lo = mid + 1;
    else hi = mid;
  }
  return -1;
}

/* Pfad im Sinne des Formats zulässig? (pathProblem in tree.ts) */
static int path_ok(const uint8_t *p, size_t n) {
  if (n == 0 || n > SOS_PATH_LIMIT || p[0] == '/') return 0;
  size_t parts = 1, part_start = 0;
  for (size_t i = 0; i <= n; i++) {
    if (i < n) {
      uint8_t c = p[i];
      if (c < 0x20 || c == 0x7f || c == '\\') return 0;
      if (c == 0xef && i + 2 < n && p[i + 1] == 0xbf && p[i + 2] == 0xbd) return 0; /* U+FFFD */
    }
    if (i == n || p[i] == '/') {
      size_t l = i - part_start;
      if (l == 0 || (l == 1 && p[part_start] == '.') || (l == 2 && p[part_start] == '.' && p[part_start + 1] == '.')) return 0;
      if (i < n) {
        parts++;
        part_start = i + 1;
      }
    }
  }
  return parts <= SOS_DEPTH_LIMIT;
}

/* Ziel eines Symlinks: relativ, kanonisch (targetProblem in tree.ts) */
static int target_ok(const uint8_t *p, size_t n) {
  if (n == 0 || n > SOS_PATH_LIMIT || p[0] == '/') return 0;
  int seen_name = 0;
  size_t part_start = 0;
  for (size_t i = 0; i <= n; i++) {
    if (i < n) {
      uint8_t c = p[i];
      if (c < 0x20 || c == 0x7f || c == '\\') return 0;
      if (c == 0xef && i + 2 < n && p[i + 1] == 0xbf && p[i + 2] == 0xbd) return 0;
    }
    if (i == n || p[i] == '/') {
      size_t l = i - part_start;
      if (l == 0 || (l == 1 && p[part_start] == '.')) return 0;
      if (l == 2 && p[part_start] == '.' && p[part_start + 1] == '.') {
        if (seen_name) return 0;
      } else {
        seen_name = 1;
      }
      part_start = i + 1;
    }
  }
  return seen_name;
}

void sos_tree_free(sos_tree *t) {
  free(t->buf);
  free(t->e);
  free(t->parent);
  free(t->head);
  free(t->next);
  memset(t, 0, sizeof *t);
}

int sos_tree_parse(uint8_t *buf, size_t len, sos_tree *t, const char **reason, char *errpath, size_t errpath_cap) {
#define FAIL(why, path_ptr, path_n) do { *reason = (why); if (errpath && errpath_cap && (path_ptr)) sos_clean((const char *)(path_ptr), (path_n), errpath, errpath_cap); sos_tree_free(t); return SOS_E_TREE; } while (0)
  memset(t, 0, sizeof *t);
  t->buf = buf; /* Besitz übernommen (auch im Fehlerfall: sos_tree_free) */
  if (errpath && errpath_cap) errpath[0] = 0;
  if (len > SOS_TREE_MAX) FAIL("tree-format", NULL, 0);
  if (!sos_utf8_valid(buf, len)) FAIL("tree-format", NULL, 0);
  if (len < TREE_HEADER_LEN || memcmp(buf, TREE_HEADER, TREE_HEADER_LEN) != 0) FAIL("tree-format", NULL, 0);
  size_t cap = len / 10 + 1;
  if (cap > SOS_TREE_ENTRIES_MAX) cap = SOS_TREE_ENTRIES_MAX;
  t->e = malloc(cap * sizeof *t->e);
  t->parent = malloc((cap + 1) * sizeof *t->parent);
  t->head = malloc((cap + 1) * sizeof *t->head);
  t->next = malloc((cap + 1) * sizeof *t->next);
  if (!t->e || !t->parent || !t->head || !t->next) FAIL("tree-memory", NULL, 0);

  size_t pos = TREE_HEADER_LEN;
  uint32_t n = 0;
  if (pos < len && buf[len - 1] != '\n') FAIL("tree-format", NULL, 0);
  while (pos < len) {
    uint8_t *line = buf + pos;
    uint8_t *line_end = memchr(line, '\n', len - pos);
    if (!line_end) FAIL("tree-format", NULL, 0);
    size_t line_len = (size_t)(line_end - line);
    /* genau fünf Felder: vier TAB, danach der Pfad (ohne TAB) */
    uint8_t *tab[4];
    uint8_t *cursor = line;
    for (int k = 0; k < 4; k++) {
      tab[k] = memchr(cursor, '\t', line_len - (size_t)(cursor - line));
      if (!tab[k]) FAIL("tree-format", line, line_len < 80 ? line_len : 80); /* wie der Referenzprüfer: die ersten 80 Zeichen der Zeile */
      cursor = tab[k] + 1;
    }
    uint8_t *extra_tab = memchr(cursor, '\t', line_len - (size_t)(cursor - line));
    if (extra_tab) FAIL("tree-format", tab[3] + 1, (size_t)(extra_tab - (tab[3] + 1))); /* der fünfte Teil der Zeile */
    uint8_t *path = tab[3] + 1;
    size_t path_len = (size_t)(line_end - path);
    if (n >= cap) FAIL("tree-format", path, path_len); /* zu viele Einträge */
    if (tab[0] - line != 1 || tab[1] - tab[0] != 2) FAIL("tree-format", path, path_len);
    uint8_t type = line[0], exec = tab[0][1];
    if (type != 'd' && type != 'f' && type != 'l') FAIL("tree-format", path, path_len);
    if (exec != 'x' && exec != '-') FAIL("tree-format", path, path_len);
    uint64_t size;
    if (!parse_dec(tab[1] + 1, (size_t)(tab[2] - tab[1]) - 1, 13, &size)) FAIL("tree-format", path, path_len);
    uint8_t *field = tab[2] + 1;
    size_t field_len = (size_t)(tab[3] - tab[2]) - 1;
    if (type == 'd' && !(field_len == 1 && field[0] == '-')) FAIL("tree-format", path, path_len);

    /* Konsistenz (assertConsistent in tree.ts) */
    if (!path_ok(path, path_len)) FAIL("tree-format", path, path_len);
    sos_entry *e = &t->e[n];
    e->path = (const char *)path;
    e->path_len = (uint32_t)path_len;
    if (n > 0 && cmp_path(&t->e[n - 1], e->path, path_len) >= 0) FAIL("tree-format", path, path_len);
    size_t slash = path_len;
    while (slash > 0 && path[slash - 1] != '/') slash--;
    e->name_off = (uint32_t)slash;
    if (slash > 0) {
      int64_t p = find_entry(t->e, n, e->path, slash - 1);
      if (p < 0 || t->e[p].type != 'd') FAIL("tree-format", path, path_len);
      t->parent[n] = (uint32_t)p;
    } else {
      t->parent[n] = UINT32_MAX; /* Wurzel, unten auf n gesetzt */
    }
    if ((path_len == 8 && (memcmp(path, "SOS-TREE", 8) == 0 || memcmp(path, "SOS-SEAL", 8) == 0))) FAIL("tree-format", path, path_len);
    if (size > SOS_SIZE_LIMIT) FAIL("tree-format", path, path_len);
    e->type = (char)type;
    e->exec = exec == 'x';
    e->size = size;
    e->field = (const char *)field;
    e->field_len = (uint32_t)field_len;
    if (type == 'f') {
      if (field_len != 128 || !is_hex(field, 128)) FAIL("tree-format", path, path_len);
    } else {
      if (exec == 'x' || size != 0) FAIL("tree-format", path, path_len);
      if (type == 'l' && !target_ok(field, field_len)) FAIL("tree-format", path, path_len);
    }
    /* Felder NUL-terminieren (erst jetzt: die Suche nach TAB/LF oben ist beendet) */
    tab[2][0] = 0;
    tab[3][0] = 0;
    *line_end = 0;
    if (type == 'f') t->bytes += size;
    n++;
    pos = (size_t)(line_end - buf) + 1;
  }
  t->n = n;

  /* Symlink-Ziele: im Baum, und der aufgelöste Weg führt nicht über einen weiteren Symlink */
  for (uint32_t i = 0; i < n; i++) {
    const sos_entry *l = &t->e[i];
    if (l->type != 'l') continue;
    char res[2 * SOS_PATH_LIMIT + 8];
    size_t rl = l->name_off > 0 ? l->name_off - 1 : 0;
    memcpy(res, l->path, rl);
    const char *tp = l->field;
    size_t tl = l->field_len, ps = 0;
    for (size_t j = 0; j <= tl; j++) {
      if (j == tl || tp[j] == '/') {
        size_t pl = j - ps;
        if (pl == 2 && tp[ps] == '.' && tp[ps + 1] == '.') {
          if (rl == 0) FAIL("tree-format", l->path, l->path_len); /* verlässt den Baum */
          while (rl > 0 && res[rl - 1] != '/') rl--;
          if (rl > 0) rl--;
        } else {
          if (rl > 0) res[rl++] = '/';
          memcpy(res + rl, tp + ps, pl);
          rl += pl;
        }
        ps = j + 1;
      }
    }
    for (size_t k = 0; k < rl; k++) {
      if (res[k] != '/') continue;
      int64_t q = find_entry(t->e, n, res, k);
      if (q >= 0 && t->e[q].type == 'l') FAIL("tree-format", l->path, l->path_len);
    }
  }

  /* Kinderlisten (in Listenreihenfolge) */
  for (uint32_t i = 0; i <= n; i++) t->head[i] = UINT32_MAX;
  for (uint32_t i = n; i-- > 0;) {
    uint32_t p = t->parent[i] == UINT32_MAX ? n : t->parent[i];
    t->parent[i] = p;
    t->next[i] = t->head[p];
    t->head[p] = i;
  }
  return SOS_OK;
#undef FAIL
}

/* ───────── Baum gegen Liste ───────── */

typedef struct {
  const sos_tree *t;
  sos_result *r;
  uint8_t *seen;
  dev_t dev;
  uint64_t bytes_done;
  uint32_t files_done;
  struct timespec last_progress;
  sos_progress_fn progress;
  void *ctx;
  char pathbuf[SOS_PATH_LIMIT + NAME_MAX + 2];
} walk_t;

static uint8_t iobuf[256 * 1024];

static int fail_at(sos_result *r, int code, const char *reason, const char *path, size_t n) {
  r->code = code;
  snprintf(r->reason, sizeof r->reason, "%s", reason);
  size_t m = n < SOS_PATH_LIMIT ? n : SOS_PATH_LIMIT;
  memcpy(r->path, path, m);
  r->path[m] = 0;
  return code;
}

static int fail_entry(walk_t *w, int code, const char *reason, const sos_entry *e) { return fail_at(w->r, code, reason, e->path, e->path_len); }

static void maybe_progress(walk_t *w) {
  if (!w->progress) return;
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  if (now.tv_sec - w->last_progress.tv_sec >= 5) {
    w->last_progress = now;
    w->progress(w->ctx, w->bytes_done, w->t->bytes, w->files_done, w->t->n);
  }
}

static int walk_dir(walk_t *w, int dirfd, uint32_t dir_index, unsigned depth);

static int check_entry(walk_t *w, int dirfd, uint32_t idx, unsigned depth) {
  const sos_entry *e = &w->t->e[idx];
  const char *name = e->path + e->name_off;
  struct stat st;
  if (fstatat(dirfd, name, &st, AT_SYMLINK_NOFOLLOW) != 0) {
    if (errno == ENOENT) return fail_entry(w, SOS_E_MISSING, "missing", e);
    return fail_entry(w, SOS_E_IO, "io", e);
  }
  if (st.st_mode & 07000) return fail_entry(w, SOS_E_DIFFERS, "setid", e);
  char kind = S_ISDIR(st.st_mode) ? 'd' : S_ISREG(st.st_mode) ? 'f' : S_ISLNK(st.st_mode) ? 'l' : 'o';
  if (kind != e->type) return fail_entry(w, SOS_E_DIFFERS, "type", e);
  if (st.st_dev != w->dev) return fail_entry(w, SOS_E_DIFFERS, "device", e);

  if (e->type == 'd') {
    int fd = openat(dirfd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return fail_entry(w, errno == ELOOP || errno == ENOTDIR ? SOS_E_DIFFERS : SOS_E_IO, errno == ELOOP || errno == ENOTDIR ? "type" : "io", e);
    struct stat st2;
    int rc;
    if (fstat(fd, &st2) != 0) rc = fail_entry(w, SOS_E_IO, "io", e);
    else if (!S_ISDIR(st2.st_mode)) rc = fail_entry(w, SOS_E_DIFFERS, "type", e);
    else if (st2.st_dev != w->dev) rc = fail_entry(w, SOS_E_DIFFERS, "device", e);
    else rc = walk_dir(w, fd, idx, depth + 1);
    close(fd);
    return rc;
  }
  if (e->type == 'l') {
    char target[SOS_PATH_LIMIT + 2];
    ssize_t n = readlinkat(dirfd, name, target, sizeof target);
    if (n < 0) return fail_entry(w, SOS_E_IO, "io", e);
    if ((size_t)n != e->field_len || memcmp(target, e->field, (size_t)n) != 0) return fail_entry(w, SOS_E_DIFFERS, "target", e);
    return SOS_OK;
  }
  /* Datei: Größe, Ausführbit, Inhalt – alles über denselben geöffneten Deskriptor */
  int fd = openat(dirfd, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_NOCTTY | O_CLOEXEC);
  if (fd < 0) return fail_entry(w, errno == ELOOP || errno == ENXIO ? SOS_E_DIFFERS : SOS_E_IO, errno == ELOOP || errno == ENXIO ? "type" : "io", e);
  int rc = SOS_OK;
  struct stat fs;
  if (fstat(fd, &fs) != 0) {
    rc = fail_entry(w, SOS_E_IO, "io", e);
  } else if (!S_ISREG(fs.st_mode)) {
    rc = fail_entry(w, SOS_E_DIFFERS, "type", e);
  } else if (fs.st_mode & 07000) {
    rc = fail_entry(w, SOS_E_DIFFERS, "setid", e);
  } else if (fs.st_dev != w->dev) {
    rc = fail_entry(w, SOS_E_DIFFERS, "device", e);
  } else if ((uint64_t)fs.st_size != e->size) {
    rc = fail_entry(w, SOS_E_DIFFERS, "size", e);
  } else if (e->exec && (fs.st_mode & 0111) == 0) {
    rc = fail_entry(w, SOS_E_DIFFERS, "exec", e);
  } else {
#ifdef POSIX_FADV_SEQUENTIAL
    posix_fadvise(fd, 0, 0, POSIX_FADV_SEQUENTIAL);
#endif
    crypto_sha512_ctx ctx;
    crypto_sha512_init(&ctx);
    uint64_t total = 0;
    for (;;) {
      ssize_t n = read(fd, iobuf, sizeof iobuf);
      if (n < 0) {
        if (errno == EINTR) continue;
        rc = fail_entry(w, SOS_E_IO, "io", e);
        break;
      }
      if (n == 0) break;
      total += (uint64_t)n;
      if (total > e->size) {
        rc = fail_entry(w, SOS_E_DIFFERS, "size", e);
        break;
      }
      crypto_sha512_update(&ctx, iobuf, (size_t)n);
      w->bytes_done += (uint64_t)n;
      maybe_progress(w);
    }
    if (rc == SOS_OK) {
      uint8_t digest[64];
      char hex[129];
      crypto_sha512_final(&ctx, digest);
      hex_encode(digest, 64, hex);
      if (total != e->size) rc = fail_entry(w, SOS_E_DIFFERS, "size", e);
      else if (memcmp(hex, e->field, 128) != 0) rc = fail_entry(w, SOS_E_DIFFERS, "hash", e);
      else w->files_done++;
    }
  }
  close(fd);
  return rc;
}

static int walk_dir(walk_t *w, int dirfd, uint32_t dir_index, unsigned depth) {
  const sos_tree *t = w->t;
  if (depth > SOS_DEPTH_LIMIT + 1) return fail_at(w->r, SOS_E_DIFFERS, "depth", "", 0);
  /* pathbuf trägt den Pfad dieses Ordners (Wurzel: leer); die Namen werden dahinter zusammengesetzt */
  size_t dir_path_len = dir_index == t->n ? 0 : t->e[dir_index].path_len;
  if (dir_path_len > 0) memcpy(w->pathbuf, t->e[dir_index].path, dir_path_len);
  w->pathbuf[dir_path_len] = 0;
  uint32_t expected = 0;
  for (uint32_t c = t->head[dir_index]; c != UINT32_MAX; c = t->next[c]) expected++;

  /* 1) Namen im Ordner: jeder muss in der Liste stehen (sonst 15), und jeder Listeneintrag genau einmal */
  int dupfd = dup(dirfd);
  if (dupfd < 0) return fail_at(w->r, SOS_E_IO, "io", w->pathbuf, dir_path_len);
  DIR *dp = fdopendir(dupfd);
  if (!dp) {
    close(dupfd);
    return fail_at(w->r, SOS_E_IO, "io", w->pathbuf, dir_path_len);
  }
  uint32_t matched = 0;
  int rc = SOS_OK;
  for (;;) {
    errno = 0;
    struct dirent *d = readdir(dp);
    if (!d) {
      if (errno != 0) rc = fail_at(w->r, SOS_E_IO, "io", w->pathbuf, dir_path_len);
      break;
    }
    const char *name = d->d_name;
    if (name[0] == '.' && (name[1] == 0 || (name[1] == '.' && name[2] == 0))) continue;
    size_t nl = strlen(name);
    if (dir_index == t->n && (strcmp(name, "SOS-TREE") == 0 || strcmp(name, "SOS-SEAL") == 0)) continue;
    size_t base = dir_path_len > 0 ? dir_path_len + 1 : 0;
    int64_t found = -1;
    if (base + nl <= SOS_PATH_LIMIT) {
      if (dir_path_len > 0) w->pathbuf[dir_path_len] = '/';
      memcpy(w->pathbuf + base, name, nl);
      found = find_entry(t->e, t->n, w->pathbuf, base + nl);
    }
    if (found < 0 || t->parent[found] != dir_index) {
      size_t shown = base + nl < sizeof w->pathbuf ? base + nl : sizeof w->pathbuf - 1;
      if (base + nl > SOS_PATH_LIMIT) {
        /* zu lang für die Liste: den Namen ohne Prüfung des Zusammenhangs melden */
        if (dir_path_len > 0) w->pathbuf[dir_path_len] = '/';
        memcpy(w->pathbuf + base, name, nl);
      }
      rc = fail_at(w->r, SOS_E_EXTRA, "extra", w->pathbuf, shown);
      break;
    }
    if (!w->seen[found]) {
      w->seen[found] = 1;
      matched++;
    }
  }
  closedir(dp);
  if (rc != SOS_OK) return rc;
  if (matched < expected) {
    for (uint32_t c = t->head[dir_index]; c != UINT32_MAX; c = t->next[c])
      if (!w->seen[c]) return fail_entry(w, SOS_E_MISSING, "missing", &t->e[c]);
  }

  /* 2) Einträge der Liste in Listenreihenfolge prüfen (Ordner werden dabei durchlaufen) */
  for (uint32_t c = t->head[dir_index]; c != UINT32_MAX; c = t->next[c]) {
    rc = check_entry(w, dirfd, c, depth);
    if (rc != SOS_OK) return rc;
  }
  return SOS_OK;
}

int sos_tree_walk(int dirfd, const sos_tree *t, sos_result *r, sos_progress_fn progress, void *ctx) {
  walk_t *w = calloc(1, sizeof *w);
  uint8_t *seen = calloc(t->n + 1u, 1);
  if (!w || !seen) {
    free(w);
    free(seen);
    return fail_at(r, SOS_E_IO, "memory", "", 0);
  }
  struct stat st;
  if (fstat(dirfd, &st) != 0) {
    free(w);
    free(seen);
    return fail_at(r, SOS_E_IO, "io", "", 0);
  }
  w->t = t;
  w->r = r;
  w->seen = seen;
  w->dev = st.st_dev;
  w->progress = progress;
  w->ctx = ctx;
  clock_gettime(CLOCK_MONOTONIC, &w->last_progress);
  int rc = walk_dir(w, dirfd, t->n, 1);
  if (rc == SOS_OK) {
    r->files = t->n;
    r->bytes = t->bytes;
  }
  free(w);
  free(seen);
  return rc;
}

/* ───────── Alles zusammen ───────── */

static uint64_t now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

static int fail_r(sos_result *r, int code, const char *reason, const char *path) { return fail_at(r, code, reason, path, path ? strlen(path) : 0); }

/* Gibt es `node_modules` (jede Art) in diesem Ordner? 1 ja, 0 nein, -1 Fehler */
static int has_node_modules(int fd) {
  struct stat st;
  if (fstatat(fd, "node_modules", &st, AT_SYMLINK_NOFOLLOW) == 0) return 1;
  return errno == ENOENT || errno == ENOTDIR ? 0 : -1;
}

static int open_error(sos_result *r, const char *path) {
  if (errno == ENOENT) return fail_r(r, SOS_E_SEAL, "dir-missing", path);
  if (errno == ELOOP || errno == ENOTDIR) return fail_r(r, SOS_E_SEAL, "dir-not-directory", path);
  return fail_r(r, SOS_E_IO, "io", path);
}

static int read_regular(int dirfd, const char *name, uint64_t max, uint8_t **out, size_t *len, int *state, int *setid) {
  /* state: 0 ok · 1 fehlt/keine reguläre Datei · 2 zu groß · 3 E/A · 4 Größe wich ab */
  struct stat st;
  *out = NULL;
  if (fstatat(dirfd, name, &st, AT_SYMLINK_NOFOLLOW) != 0) return *state = errno == ENOENT || errno == ENOTDIR ? 1 : 3, -1;
  if (!S_ISREG(st.st_mode)) return *state = 1, -1;
  int fd = openat(dirfd, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_NOCTTY | O_CLOEXEC);
  if (fd < 0) return *state = errno == ELOOP || errno == ENXIO ? 1 : 3, -1;
  struct stat fs;
  if (fstat(fd, &fs) != 0) { close(fd); return *state = 3, -1; }
  if (!S_ISREG(fs.st_mode)) { close(fd); return *state = 1, -1; }
  *setid = (fs.st_mode & 07000) != 0;
  if ((uint64_t)fs.st_size > max) { close(fd); return *state = 2, -1; }
  size_t want = (size_t)fs.st_size;
  uint8_t *buf = malloc(want + 1);
  if (!buf) { close(fd); return *state = 3, -1; }
  size_t got = 0;
  for (;;) {
    ssize_t n = read(fd, buf + got, want + 1 - got);
    if (n < 0) {
      if (errno == EINTR) continue;
      free(buf);
      close(fd);
      return *state = 3, -1;
    }
    if (n == 0) break;
    got += (size_t)n;
    if (got > want) break;
  }
  close(fd);
  if (got != want) {
    free(buf);
    return *state = 4, -1;
  }
  *out = buf;
  *len = got;
  return *state = 0;
}

int sos_verify_path(const char *dir_in, const char *data_dir_in, const sos_anchor *a, const sos_options *o, sos_result *r) {
  uint64_t started = now_ms();
  memset(r, 0, sizeof *r);
  int rc;
  int dirfd = -1;
  uint8_t *seal_buf = NULL, *tree_buf = NULL;
  if (o->keep_dirfd) *o->keep_dirfd = -1;
  sos_tree tree;
  memset(&tree, 0, sizeof tree);
  int ancestor_fds[SOS_DEPTH_LIMIT + 4];
  size_t ancestors = 0;

  char dir[4096], data[4096];
  if (!dir_in || !*dir_in || strlen(dir_in) >= sizeof dir || (data_dir_in && strlen(data_dir_in) >= sizeof data)) { rc = fail_r(r, SOS_E_USAGE, "usage", ""); goto done; }
  snprintf(dir, sizeof dir, "%s", dir_in);
  snprintf(data, sizeof data, "%s", data_dir_in ? data_dir_in : "");
  size_t dl = strlen(dir), ql = strlen(data);
  while (dl > 1 && dir[dl - 1] == '/') dir[--dl] = 0;
  while (ql > 0 && data[ql - 1] == '/') data[--ql] = 0;
  const char *last_slash = strrchr(dir, '/');
  const char *folder = last_slash ? last_slash + 1 : dir;
  const char *expect = o->expect_version ? o->expect_version : folder;
  int under = ql > 0 && dl > ql + 1 && strncmp(dir, data, ql) == 0 && dir[ql] == '/';

  /* 1) Vorfahren: kein node_modules oberhalb der Version bis einschließlich des Datenverzeichnisses */
  char comps[SOS_DEPTH_LIMIT + 2][256];
  size_t ncomp = 0;
  if (under) {
    const char *p = dir + ql + 1;
    while (*p) {
      const char *slash = strchr(p, '/');
      size_t l = slash ? (size_t)(slash - p) : strlen(p);
      if (l == 0 || l >= sizeof comps[0] || (l == 1 && p[0] == '.') || (l == 2 && p[0] == '.' && p[1] == '.') || ncomp >= SOS_DEPTH_LIMIT) { rc = fail_r(r, SOS_E_USAGE, "usage", dir); goto done; }
      memcpy(comps[ncomp], p, l);
      comps[ncomp][l] = 0;
      ncomp++;
      p += l + (slash ? 1 : 0);
    }
    int fd = open(data, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0) { rc = open_error(r, data); goto done; }
    ancestor_fds[ancestors++] = fd;
    char shown[4096];
    size_t shown_len = ql;
    memcpy(shown, data, ql + 1);
    for (size_t i = 0;; i++) {
      int nm = has_node_modules(ancestor_fds[ancestors - 1]);
      if (nm != 0) {
        char found[4200];
        snprintf(found, sizeof found, "%s/node_modules", shown);
        rc = nm > 0 ? fail_r(r, SOS_E_OUTSIDE, "node_modules-in-ancestor", found) : fail_r(r, SOS_E_IO, "io", found);
        goto done;
      }
      if (i + 1 >= ncomp) break; /* die Version selbst ist kein Vorfahre */
      int next = openat(ancestor_fds[ancestors - 1], comps[i], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      shown_len += 1 + strlen(comps[i]);
      if (shown_len < sizeof shown) {
        strcat(shown, "/");
        strcat(shown, comps[i]);
      }
      if (next < 0) { rc = open_error(r, shown); goto done; }
      ancestor_fds[ancestors++] = next;
    }
  }

  /* 2) Ordnername / --expect-version und Untergrenze */
  uint32_t want[3];
  if (!is_version((const uint8_t *)expect, strlen(expect), want, NULL)) { rc = fail_r(r, SOS_E_VERSION, "folder-name", ""); goto done; }
  if (a->has_floor && o->enforce_floor) {
    int above = want[0] != a->floor_major ? want[0] > a->floor_major : want[1] != a->floor_minor ? want[1] > a->floor_minor : want[2] != a->floor_patch ? want[2] > a->floor_patch : a->floor_prerelease;
    if (!above) { rc = fail_r(r, SOS_E_OUTDATED, "floor", ""); goto done; }
  }

  /* 3) das Versionsverzeichnis öffnen */
  if (under) dirfd = openat(ancestor_fds[ancestors - 1], comps[ncomp - 1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  else dirfd = open(dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (dirfd < 0) { rc = open_error(r, dir); goto done; }

  /* 4) Siegel */
  int state = 0, setid = 0;
  size_t seal_len = 0;
  struct stat root_st;
  if (fstat(dirfd, &root_st) != 0) { rc = fail_r(r, SOS_E_IO, "io", ""); goto done; }
  if (root_st.st_mode & 07000) { rc = fail_r(r, SOS_E_DIFFERS, "setid", ""); goto done; }
  if (read_regular(dirfd, "SOS-SEAL", SOS_SEAL_MAX, &seal_buf, &seal_len, &state, &setid) != 0) {
    rc = state == 1 ? fail_r(r, SOS_E_SEAL, "seal-missing", "") : state == 2 ? fail_r(r, SOS_E_SEAL, "too-large", "") : fail_r(r, SOS_E_IO, "io", "SOS-SEAL");
    goto done;
  }
  if (setid) { rc = fail_r(r, SOS_E_DIFFERS, "setid", "SOS-SEAL"); goto done; }
  sos_seal seal;
  const char *why = "";
  rc = sos_seal_parse(seal_buf, seal_len, a, o->check_expiry, &seal, &why);
  if (rc != SOS_OK) { rc = fail_r(r, rc, why, ""); goto done; }
  snprintf(r->version, sizeof r->version, "%s", seal.version);
  if (strcmp(seal.version, expect) != 0) { rc = fail_r(r, SOS_E_VERSION, "seal-version", ""); goto done; }
  if (seal.base != a->base) { rc = fail_r(r, SOS_E_OUTDATED, "base", ""); goto done; }
  if (strcmp(seal.arch, a->arch) != 0) { rc = fail_r(r, SOS_E_OUTDATED, "arch", ""); goto done; }

  /* 5) Liste: Größe und SHA-512 gegen das Siegel, erst dann lesen */
  size_t tree_len = 0;
  struct stat tst;
  if (fstatat(dirfd, "SOS-TREE", &tst, AT_SYMLINK_NOFOLLOW) != 0 || !S_ISREG(tst.st_mode)) { rc = fail_r(r, SOS_E_TREE, "tree-missing", ""); goto done; }
  if (tst.st_mode & 07000) { rc = fail_r(r, SOS_E_DIFFERS, "setid", "SOS-TREE"); goto done; }
  if ((uint64_t)tst.st_size != seal.tree_size) { rc = fail_r(r, SOS_E_TREE, "tree-size", ""); goto done; }
  if (read_regular(dirfd, "SOS-TREE", seal.tree_size, &tree_buf, &tree_len, &state, &setid) != 0) {
    rc = state == 1 ? fail_r(r, SOS_E_TREE, "tree-missing", "") : state == 2 || state == 4 ? fail_r(r, SOS_E_TREE, state == 2 ? "tree-size" : "tree-hash", "") : fail_r(r, SOS_E_IO, "io", "SOS-TREE");
    goto done;
  }
  {
    uint8_t digest[64];
    char hex[129];
    crypto_sha512(digest, tree_buf, tree_len);
    hex_encode(digest, 64, hex);
    if (tree_len != seal.tree_size || memcmp(hex, seal.tree_sha512, 128) != 0) { rc = fail_r(r, SOS_E_TREE, "tree-hash", ""); goto done; }
  }
  char errpath[SOS_REPORT_PATH + 1];
  const char *treewhy = "";
  rc = sos_tree_parse(tree_buf, tree_len, &tree, &treewhy, errpath, sizeof errpath);
  tree_buf = NULL; /* Besitz liegt bei `tree` (auch im Fehlerfall, dort schon freigegeben) */
  if (rc != SOS_OK) { rc = fail_r(r, SOS_E_TREE, treewhy, errpath); goto done; }
  if (tree.n != seal.tree_entries || tree.bytes != seal.tree_bytes) { rc = fail_r(r, SOS_E_TREE, "tree-counts", ""); goto done; }

  /* 6) Baum */
  rc = sos_tree_walk(dirfd, &tree, r, o->progress, o->progress_ctx);
  if (rc != SOS_OK) goto done;

  r->code = 0;
  r->files = tree.n;
  r->bytes = tree.bytes;
  if (o->keep_dirfd) {
    *o->keep_dirfd = dirfd; /* der Aufrufer übernimmt den Deskriptor */
    dirfd = -1;
  }
  r->floor = !a->has_floor ? 0
             : (seal.major != a->floor_major ? seal.major > a->floor_major : seal.minor != a->floor_minor ? seal.minor > a->floor_minor : seal.patch != a->floor_patch ? seal.patch > a->floor_patch : a->floor_prerelease) ? 3
             : (seal.major == a->floor_major && seal.minor == a->floor_minor && seal.patch == a->floor_patch) ? 2
             : 1;
  rc = SOS_OK;

done:
  if (dirfd >= 0) close(dirfd);
  for (size_t i = 0; i < ancestors; i++) close(ancestor_fds[i]);
  free(seal_buf);
  free(tree_buf);
  sos_tree_free(&tree);
  r->ms = now_ms() - started;
  r->code = rc;
  return rc;
}

/* ───────── Ausgabe ───────── */

static size_t json_text(char *out, size_t cap, size_t o, const char *s) {
  for (; *s && o + 2 < cap; s++) {
    if (*s == '"' || *s == '\\') out[o++] = '\\';
    out[o++] = *s;
  }
  return o;
}

void sos_result_json(const sos_result *r, char *out, size_t cap) {
  if (r->code == 0) {
    static const char *const floors[4] = {"none", "below", "equal", "above"};
    snprintf(out, cap, "{\"ok\":true,\"version\":\"%s\",\"files\":%llu,\"bytes\":%llu,\"ms\":%llu,\"floor\":\"%s\"}", r->version, (unsigned long long)r->files, (unsigned long long)r->bytes,
             (unsigned long long)r->ms, floors[r->floor & 3]);
    return;
  }
  char clean[SOS_REPORT_PATH + 1];
  sos_clean(r->path, strlen(r->path), clean, sizeof clean);
  size_t o = (size_t)snprintf(out, cap, "{\"ok\":false,\"code\":%d,\"reason\":\"%s\",\"path\":\"", r->code, r->reason);
  if (o >= cap) return;
  o = json_text(out, cap, o, clean);
  snprintf(out + o, cap - o, "\",\"ms\":%llu}", (unsigned long long)r->ms);
}
