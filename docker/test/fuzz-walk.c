/*
 * libFuzzer-Ziel: Verzeichnislauf (sos_tree_walk) mit einem Orakel. Die Eingabe beschreibt einen kleinen Baum (Ordner, Dateien, Symlinks mit Inhalt, Ausführbit) und eine Mutation.
 * Der Harness legt den Baum wirklich an, erzeugt die Dateiliste mit echten Hashes, liest sie mit dem Parser des Prüfers, wendet die Mutation an und ruft den Lauf auf:
 *   ohne Mutation (oder nur mit zusätzlichem Ausführbit)  →  der Lauf muss 0 liefern
 *   mit Mutation (Fremdeintrag, Löschen, Inhalt, Länge, Ausführbit, Setuid, FIFO, Linkziel)  →  14, 15 oder 16 – nie 0, nie ein anderer Code
 * Dazu die Speichersicherheit über AddressSanitizer. Dateien liegen in /dev/shm (oder $TMPDIR).
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "monocypher-ed25519.h"
#include "verify.h"

#define MAX_NODES 14

typedef struct {
  char type; /* d f l */
  char path[96];
  int parent;
  int exec;
  uint8_t content[48];
  size_t content_len;
  char target[40];
} node_t;

typedef struct {
  const uint8_t *p;
  size_t n, i;
} reader_t;

static unsigned rd(reader_t *r) { return r->i < r->n ? r->p[r->i++] : 0u; }

static int cmp_nodes(const void *a, const void *b) {
  const node_t *x = a, *y = b;
  size_t lx = strlen(x->path), ly = strlen(y->path), m = lx < ly ? lx : ly;
  int c = memcmp(x->path, y->path, m);
  return c ? c : (lx > ly) - (lx < ly);
}

static int rm_rf_cb(const char *path) {
  struct stat st;
  if (lstat(path, &st) != 0) return 0;
  if (S_ISDIR(st.st_mode)) {
    chmod(path, 0755);
    DIR *d = opendir(path);
    struct dirent *e;
    while (d && (e = readdir(d))) {
      if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
      char child[512];
      snprintf(child, sizeof child, "%s/%s", path, e->d_name);
      rm_rf_cb(child);
    }
    if (d) closedir(d);
    rmdir(path);
  } else {
    unlink(path);
  }
  return 0;
}

static void write_file(const char *path, const uint8_t *data, size_t n, mode_t mode) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) abort();
  if (n && write(fd, data, n) != (ssize_t)n) abort();
  close(fd);
  chmod(path, mode);
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  static const char *const names[] = {"a", "b", "c", "a.b", "dd", "e f", "\xc3\xa9", "n", "node_modules", "SOS-SEAL", "x1", "x2"};
  static const char *const targets[] = {"a", "../a", "b/c", "x1", "a.b", "dd/x", "../../a", "e f"};
  reader_t r = {data, size, 0};
  node_t nodes[MAX_NODES];
  int count = 0, dirs[MAX_NODES], ndirs = 0;
  unsigned want = 1 + rd(&r) % MAX_NODES;
  for (unsigned i = 0; i < want; i++) {
    int parent = (int)(rd(&r) % (unsigned)(ndirs + 1)) - 1; /* -1 = Wurzel */
    const char *name = names[rd(&r) % (sizeof names / sizeof names[0])];
    node_t n;
    memset(&n, 0, sizeof n);
    n.parent = parent < 0 ? -1 : dirs[parent];
    if (n.parent >= 0) snprintf(n.path, sizeof n.path, "%s/%s", nodes[n.parent].path, name);
    else snprintf(n.path, sizeof n.path, "%s", name);
    int dup = 0;
    for (int k = 0; k < count; k++)
      if (strcmp(nodes[k].path, n.path) == 0) dup = 1;
    unsigned kind = rd(&r) % 5;
    n.type = kind < 2 ? 'd' : kind < 4 ? 'f' : 'l';
    n.exec = (int)(rd(&r) & 1);
    n.content_len = rd(&r) % (sizeof n.content);
    for (size_t k = 0; k < n.content_len; k++) n.content[k] = (uint8_t)rd(&r);
    snprintf(n.target, sizeof n.target, "%s", targets[rd(&r) % (sizeof targets / sizeof targets[0])]);
    if (dup || count >= MAX_NODES) continue;
    if (n.type != 'f') n.exec = 0;
    if (n.type == 'd') dirs[ndirs++] = count;
    nodes[count++] = n;
  }
  unsigned mutation = rd(&r) % 10;
  unsigned pick = rd(&r);

  /* die Wurzel anlegen */
  const char *tmp = access("/dev/shm", W_OK) == 0 ? "/dev/shm" : (getenv("TMPDIR") ? getenv("TMPDIR") : "/tmp");
  char root[256];
  snprintf(root, sizeof root, "%s/sos-fuzz-walk-XXXXXX", tmp);
  if (!mkdtemp(root)) abort();

  /* Reihenfolge der Liste: nach Pfad-Bytes */
  node_t sorted[MAX_NODES];
  memcpy(sorted, nodes, (size_t)count * sizeof nodes[0]);
  qsort(sorted, (size_t)count, sizeof sorted[0], cmp_nodes);

  /* anlegen: Ordner zuerst (in Listenreihenfolge liegen Eltern vor Kindern) */
  char full[512];
  for (int i = 0; i < count; i++) {
    snprintf(full, sizeof full, "%s/%s", root, sorted[i].path);
    if (sorted[i].type == 'd') mkdir(full, 0755);
  }
  /* Dateien und Links, soweit der Elternordner existiert (Ordner liegen unter Dateien/Links nie: Elternpfade sind immer Ordner, weil nur Ordner in `dirs` stehen) */
  for (int i = 0; i < count; i++) {
    snprintf(full, sizeof full, "%s/%s", root, sorted[i].path);
    if (sorted[i].type == 'f') write_file(full, sorted[i].content, sorted[i].content_len, sorted[i].exec ? 0755 : 0644);
    else if (sorted[i].type == 'l' && symlink(sorted[i].target, full) != 0) abort();
  }
  write_file((snprintf(full, sizeof full, "%s/SOS-TREE", root), full), (const uint8_t *)"", 0, 0644);
  write_file((snprintf(full, sizeof full, "%s/SOS-SEAL", root), full), (const uint8_t *)"", 0, 0644);

  /* Liste serialisieren */
  char *text = malloc(64 * 1024);
  size_t tl = (size_t)snprintf(text, 64 * 1024, "schrauberos-tree 1\nhash sha512\n");
  uint64_t bytes = 0;
  for (int i = 0; i < count; i++) {
    const node_t *n = &sorted[i];
    char field[160];
    if (n->type == 'f') {
      uint8_t digest[64];
      crypto_sha512(digest, n->content, n->content_len);
      static const char digits[] = "0123456789abcdef";
      for (int k = 0; k < 64; k++) {
        field[2 * k] = digits[digest[k] >> 4];
        field[2 * k + 1] = digits[digest[k] & 15];
      }
      field[128] = 0;
      bytes += n->content_len;
    } else if (n->type == 'l') {
      snprintf(field, sizeof field, "%s", n->target);
    } else {
      snprintf(field, sizeof field, "-");
    }
    tl += (size_t)snprintf(text + tl, 64 * 1024 - tl, "%c\t%c\t%zu\t%s\t%s\n", n->type, n->exec ? 'x' : '-', n->type == 'f' ? n->content_len : 0, field, n->path);
  }
  (void)bytes;

  sos_tree t;
  const char *reason;
  char errpath[201];
  uint8_t *buf = malloc(tl + 1);
  memcpy(buf, text, tl);
  free(text);
  int rc = sos_tree_parse(buf, tl, &t, &reason, errpath, sizeof errpath);
  if (rc != 0) { /* z. B. ein Linkziel, das der Parser ablehnt: kein Fall für den Lauf */
    rm_rf_cb(root);
    return 0;
  }

  /* Mutation + erwartetes Urteil: -1 = muss 0 sein, sonst der erwartete Code */
  int expect = 0;
  if (count > 0) {
    int k = (int)(pick % (unsigned)count);
    const node_t *n = &sorted[k];
    snprintf(full, sizeof full, "%s/%s", root, n->path);
    char extra[600];
    switch (mutation) {
      case 1: { /* Fremdeintrag im Ordner des gewählten Eintrags (oder in der Wurzel) */
        const char *dir_path = n->type == 'd' ? n->path : NULL;
        snprintf(extra, sizeof extra, "%s%s%s/fremd", root, dir_path ? "/" : "", dir_path ? dir_path : "");
        write_file(extra, (const uint8_t *)"x", 1, 0644);
        expect = 15;
        break;
      }
      case 2: /* Eintrag löschen (Ordner samt Inhalt) */
        rm_rf_cb(full);
        expect = 14;
        break;
      case 3:
        if (n->type == 'f' && n->content_len > 0) {
          uint8_t c[48];
          memcpy(c, n->content, n->content_len);
          c[pick % n->content_len] ^= 1;
          write_file(full, c, n->content_len, n->exec ? 0755 : 0644);
          expect = 16;
        }
        break;
      case 4:
        if (n->type == 'f') {
          uint8_t c[49];
          memcpy(c, n->content, n->content_len);
          c[n->content_len] = 'x';
          write_file(full, c, n->content_len + 1, n->exec ? 0755 : 0644);
          expect = 16;
        }
        break;
      case 5:
        if (n->type == 'f' && n->exec) {
          chmod(full, 0644);
          expect = 16;
        } else if (n->type == 'f') {
          chmod(full, 0755); /* zusätzliches Ausführbit ist gleichgültig */
        }
        break;
      case 6:
        if (n->type != 'd') {
          unlink(full);
          if (mkfifo(full, 0644) != 0) abort();
          expect = 16;
        }
        break;
      case 7:
        if (n->type == 'l') {
          unlink(full);
          if (symlink("anderes-ziel", full) != 0) abort();
          expect = 16;
        }
        break;
      case 8:
        if (n->type == 'f' || n->type == 'd') {
          chmod(full, (n->type == 'd' ? 0755 : n->exec ? 0755 : 0644) | (pick & 1 ? 04000 : 01000));
          expect = 16;
        }
        break;
      default:
        break;
    }
  }

  int dirfd = open(root, O_RDONLY | O_DIRECTORY);
  sos_result res;
  memset(&res, 0, sizeof res);
  int walk = sos_tree_walk(dirfd, &t, &res, NULL, NULL);
  close(dirfd);
  if (walk != expect) {
    fprintf(stderr, "Orakel verletzt: Lauf %d (%s: %s), erwartet %d, Mutation %u\n", walk, res.reason, res.path, expect, mutation);
    abort();
  }
  sos_tree_free(&t);
  rm_rf_cb(root);
  return 0;
}
