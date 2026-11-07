/*
 * Krypto-Tests des Starters (L2): Ed25519 (so, wie verify.c es aufruft: sos_ed25519_check) und SHA-512 aus dem vendorten Monocypher gegen Fremdvektoren und gegen node:crypto.
 *   crypto-test --rfc FILE --sha-short FILE --sha-long FILE --wycheproof FILE --diff FILE
 * Die Vektordateien erzeugt/liest docker/test/run.mjs (Wycheproof und die Differenzdatei als Zeilenformat, siehe run.mjs).
 * Exit 0 = alles wie erwartet.
 */
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "monocypher-ed25519.h"
#include "monocypher.h"
#include "verify.h"

static int failures = 0, checks = 0;

#define EXPECT(cond, ...)             \
  do {                                \
    checks++;                         \
    if (!(cond)) {                    \
      failures++;                     \
      fprintf(stderr, "FEHLER: ");    \
      fprintf(stderr, __VA_ARGS__);   \
      fprintf(stderr, "\n");          \
    }                                 \
  } while (0)

static int hv(int c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

/* Hex → Bytes (Zielpuffer wird allokiert); "-" = leer. Rückgabe Länge, -1 bei Fehler */
static long unhex(const char *s, uint8_t **out) {
  if (strcmp(s, "-") == 0) s = "";
  size_t n = strlen(s);
  if (n % 2) return -1;
  uint8_t *b = malloc(n / 2 + 1);
  for (size_t i = 0; i < n / 2; i++) {
    int a = hv(s[2 * i]), c = hv(s[2 * i + 1]);
    if (a < 0 || c < 0) { free(b); return -1; }
    b[i] = (uint8_t)(a * 16 + c);
  }
  *out = b;
  return (long)(n / 2);
}

static char *read_all(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) { fprintf(stderr, "kann %s nicht lesen\n", path); exit(2); }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *b = malloc((size_t)n + 1);
  if (fread(b, 1, (size_t)n, f) != (size_t)n) exit(2);
  b[n] = 0;
  fclose(f);
  return b;
}

static int check_sig(const uint8_t *pk, long pkn, const uint8_t *msg, long mn, const uint8_t *sig, long sn) {
  if (pkn != 32 || sn != 64) return 0; /* falsche Längen: der Aufrufer (verify.c) stellt sie sicher; hier gilt „abgelehnt“ */
  return sos_ed25519_check(sig, pk, msg, (size_t)mn);
}

/* ───────── SHA-512 ───────── */

static void sha512_oneshot_vs_chunks(const uint8_t *msg, size_t n, const uint8_t want[64], const char *label) {
  uint8_t d[64];
  crypto_sha512(d, msg, n);
  EXPECT(memcmp(d, want, 64) == 0, "SHA-512 (einmalig) %s", label);
  /* in ungleichen Stücken, auch über Blockgrenzen (128) */
  static const size_t steps[] = {1, 3, 7, 63, 64, 65, 127, 128, 129, 1000};
  for (size_t s = 0; s < sizeof steps / sizeof steps[0]; s++) {
    crypto_sha512_ctx ctx;
    crypto_sha512_init(&ctx);
    for (size_t off = 0; off < n;) {
      size_t take = steps[(s + off) % (sizeof steps / sizeof steps[0])];
      if (take > n - off) take = n - off;
      crypto_sha512_update(&ctx, msg + off, take);
      off += take;
    }
    crypto_sha512_final(&ctx, d);
    EXPECT(memcmp(d, want, 64) == 0, "SHA-512 (Stücke, Muster %zu) %s", s, label);
  }
}

static void run_nist(const char *path) {
  char *text = read_all(path);
  int count = 0;
  long len_bits = -1;
  uint8_t *msg = NULL;
  long msg_n = 0;
  for (char *line = strtok(text, "\n"); line; line = strtok(NULL, "\n")) {
    size_t l = strlen(line);
    while (l && (line[l - 1] == '\r' || line[l - 1] == ' ')) line[--l] = 0;
    if (strncmp(line, "Len = ", 6) == 0) len_bits = atol(line + 6);
    else if (strncmp(line, "Msg = ", 6) == 0) {
      free(msg);
      msg = NULL;
      msg_n = unhex(line + 6, &msg);
      if (len_bits == 0) msg_n = 0; /* NIST schreibt für die leere Nachricht „00“ */
    } else if (strncmp(line, "MD = ", 5) == 0) {
      uint8_t *md = NULL;
      long mdn = unhex(line + 5, &md);
      EXPECT(mdn == 64 && msg_n * 8 == len_bits, "NIST-Zeile fehlerhaft (Len %ld)", len_bits);
      if (mdn == 64 && msg_n * 8 == len_bits) {
        char label[64];
        snprintf(label, sizeof label, "NIST Len=%ld", len_bits);
        sha512_oneshot_vs_chunks(msg, (size_t)msg_n, md, label);
        count++;
      }
      free(md);
    }
  }
  free(msg);
  free(text);
  printf("SHA-512 NIST (%s): %d Vektoren\n", path, count);
}

static void run_million_a(void) {
  /* FIPS 180-2: eine Million mal 'a' */
  static const char *want_hex = "e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b";
  uint8_t *want = NULL;
  unhex(want_hex, &want);
  crypto_sha512_ctx ctx;
  uint8_t block[1000], d[64];
  memset(block, 'a', sizeof block);
  crypto_sha512_init(&ctx);
  for (int i = 0; i < 1000; i++) crypto_sha512_update(&ctx, block, sizeof block);
  crypto_sha512_final(&ctx, d);
  EXPECT(memcmp(d, want, 64) == 0, "SHA-512 einer Million 'a'");
  free(want);
  printf("SHA-512: Million 'a' geprüft\n");
}

/* ───────── Ed25519 ───────── */

static void run_rfc(const char *path) {
  char *text = read_all(path);
  int count = 0;
  for (char *line = strtok(text, "\n"); line; line = strtok(NULL, "\n")) {
    if (line[0] == '#' || !line[0]) continue;
    char name[64], pk[80], msg[4096], sig[200];
    if (sscanf(line, "%63s %79s %4095s %199s", name, pk, msg, sig) != 4) { EXPECT(0, "RFC-Zeile: %s", line); continue; }
    uint8_t *p = NULL, *m = NULL, *s = NULL;
    long pn = unhex(pk, &p), mn = unhex(msg, &m), sn = unhex(sig, &s);
    EXPECT(pn == 32 && mn >= 0 && sn == 64, "RFC-Zeile ungültig: %s", name);
    if (pn == 32 && mn >= 0 && sn == 64) {
      EXPECT(check_sig(p, pn, m, mn, s, sn), "RFC 8032 %s wird nicht akzeptiert", name);
      /* jede Ein-Bit-Änderung einer Signatur wird abgelehnt */
      for (int i = 0; i < 64 * 8; i++) {
        uint8_t t[64];
        memcpy(t, s, 64);
        t[i / 8] ^= (uint8_t)(1u << (i % 8));
        EXPECT(!check_sig(p, pn, m, mn, t, 64), "RFC %s: Bit %d der Signatur geändert, trotzdem akzeptiert", name, i);
      }
      if (mn > 0) {
        m[0] ^= 1;
        EXPECT(!check_sig(p, pn, m, mn, s, sn), "RFC %s: geänderte Nachricht akzeptiert", name);
      }
      count++;
    }
    free(p); free(m); free(s);
  }
  free(text);
  printf("Ed25519 RFC 8032: %d Vektoren (jeweils samt aller Ein-Bit-Änderungen der Signatur)\n", count);
}

/* Zeilenformat (aus Wycheproof erzeugt): <tcId> <valid|invalid|acceptable> <flags> <pk> <msg|-> <sig|-> */
static void run_wycheproof(const char *path) {
  char *text = read_all(path);
  int valid = 0, invalid = 0, acceptable_accept = 0, acceptable_reject = 0;
  for (char *line = strtok(text, "\n"); line; line = strtok(NULL, "\n")) {
    if (line[0] == '#' || !line[0]) continue;
    char id[16], result[16], flags[96], pk[80], msg[8192], sig[400];
    if (sscanf(line, "%15s %15s %95s %79s %8191s %399s", id, result, flags, pk, msg, sig) != 6) { EXPECT(0, "Wycheproof-Zeile: %.60s", line); continue; }
    uint8_t *p = NULL, *m = NULL, *s = NULL;
    long pn = unhex(pk, &p), mn = unhex(msg, &m), sn = unhex(sig, &s);
    if (pn < 0 || mn < 0 || sn < 0) { EXPECT(0, "Wycheproof %s: Hex", id); free(p); free(m); free(s); continue; }
    int accepted = check_sig(p, pn, m, mn, s, sn);
    if (strcmp(result, "valid") == 0) {
      EXPECT(accepted, "Wycheproof #%s (%s): gültige Signatur abgelehnt", id, flags);
      valid++;
    } else if (strcmp(result, "invalid") == 0) {
      EXPECT(!accepted, "Wycheproof #%s (%s): ungültige Signatur akzeptiert", id, flags);
      invalid++;
    } else {
      /* „acceptable“: Punkte kleiner Ordnung / gemischter Ordnung als öffentlicher Schlüssel – beide Urteile sind nach Wycheproof zulässig; wir halten das Verhalten fest */
      if (accepted) { acceptable_accept++; printf("  acceptable #%s (%s): akzeptiert\n", id, flags); }
      else acceptable_reject++;
    }
    free(p); free(m); free(s);
  }
  free(text);
  printf("Ed25519 Wycheproof: %d gültig (alle akzeptiert), %d ungültig (alle abgelehnt), acceptable: %d akzeptiert / %d abgelehnt\n", valid, invalid, acceptable_accept, acceptable_reject);
}

/* Zeilenformat (von node:crypto erzeugt): <pk> <msg|-> <sig> <1|0> <label> */
static void run_diff(const char *path) {
  char *text = read_all(path);
  int count = 0, accepted_n = 0;
  for (char *line = strtok(text, "\n"); line; line = strtok(NULL, "\n")) {
    if (line[0] == '#' || !line[0]) continue;
    char pk[80], msg[4096], sig[200], label[64];
    int expect;
    if (sscanf(line, "%79s %4095s %199s %d %63s", pk, msg, sig, &expect, label) != 5) { EXPECT(0, "Differenzzeile: %.60s", line); continue; }
    uint8_t *p = NULL, *m = NULL, *s = NULL;
    long pn = unhex(pk, &p), mn = unhex(msg, &m), sn = unhex(sig, &s);
    if (pn < 0 || mn < 0 || sn < 0) { EXPECT(0, "Differenz: Hex"); free(p); free(m); free(s); continue; }
    int got = check_sig(p, pn, m, mn, s, sn);
    EXPECT(got == expect, "Differenzfall %s: node:crypto sagt %d, Monocypher %d", label, expect, got);
    count++;
    accepted_n += got;
    free(p); free(m); free(s);
  }
  free(text);
  printf("Ed25519 gegen node:crypto: %d Fälle (davon %d gültig), alle gleich beurteilt\n", count, accepted_n);
}

/* --bench MiB: SHA-512-Durchsatz des vendorten Monocypher über einen Puffer (in 256-KiB-Blöcken, wie der Prüfer liest) */
static void run_bench(long mib) {
  size_t block = 256 * 1024, total = (size_t)mib << 20;
  uint8_t *buf = malloc(block);
  for (size_t i = 0; i < block; i++) buf[i] = (uint8_t)(i * 2654435761u >> 24);
  crypto_sha512_ctx ctx;
  uint8_t d[64];
  struct timespec a, b;
  crypto_sha512_init(&ctx);
  clock_gettime(CLOCK_MONOTONIC, &a);
  for (size_t done = 0; done < total; done += block) crypto_sha512_update(&ctx, buf, block);
  crypto_sha512_final(&ctx, d);
  clock_gettime(CLOCK_MONOTONIC, &b);
  double s = (double)(b.tv_sec - a.tv_sec) + (double)(b.tv_nsec - a.tv_nsec) / 1e9;
  printf("SHA-512 (Monocypher): %ld MiB in %.3f s = %.0f MB/s\n", mib, s, (double)total / 1e6 / s);
  free(buf);
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--bench") == 0) {
    run_bench(atol(argv[2]));
    return 0;
  }
  for (int i = 1; i + 1 < argc; i += 2) {
    if (strcmp(argv[i], "--rfc") == 0) run_rfc(argv[i + 1]);
    else if (strcmp(argv[i], "--sha-short") == 0 || strcmp(argv[i], "--sha-long") == 0) run_nist(argv[i + 1]);
    else if (strcmp(argv[i], "--wycheproof") == 0) run_wycheproof(argv[i + 1]);
    else if (strcmp(argv[i], "--diff") == 0) run_diff(argv[i + 1]);
    else { fprintf(stderr, "Argument %s?\n", argv[i]); return 2; }
  }
  run_million_a();
  printf("%d Prüfungen, %d Fehler\n", checks, failures);
  return failures ? 1 : 0;
}
