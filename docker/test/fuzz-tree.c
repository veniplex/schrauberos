/*
 * libFuzzer-Ziel: Parser der Dateiliste (sos_tree_parse). Die Eingabe wird als SOS-TREE gelesen; ein angenommener Baum muss die Invarianten erfüllen, auf die der Rest des
 * Prüfers sich verlässt (Sortierung, Elternordner, Kinderlisten, Symlink-Ziele).
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "verify.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  if (size > 1024 * 1024) return 0;
  uint8_t *copy = malloc(size ? size : 1);
  if (!copy) return 0;
  memcpy(copy, data, size);
  sos_tree t;
  const char *reason = NULL;
  char errpath[201];
  int rc = sos_tree_parse(copy, size, &t, &reason, errpath, sizeof errpath); /* übernimmt `copy` */
  if (rc != 0) {
    if (rc != 13 || !reason) abort();
    return 0;
  }
  uint64_t bytes = 0;
  for (uint32_t i = 0; i < t.n; i++) {
    const sos_entry *e = &t.e[i];
    if (i > 0) {
      const sos_entry *p = &t.e[i - 1];
      size_t m = p->path_len < e->path_len ? p->path_len : e->path_len;
      int c = memcmp(p->path, e->path, m);
      if (c > 0 || (c == 0 && p->path_len >= e->path_len)) abort(); /* streng aufsteigend */
    }
    if (e->path_len == 0 || e->path_len > SOS_PATH_LIMIT || strlen(e->path) != e->path_len) abort();
    if (e->name_off > e->path_len || (e->name_off > 0 && e->path[e->name_off - 1] != '/')) abort();
    if (memchr(e->path + e->name_off, '/', e->path_len - e->name_off)) abort();
    if (e->type != 'd' && e->type != 'f' && e->type != 'l') abort();
    if (e->type == 'f' && e->field_len != 128) abort();
    if (e->type == 'f') bytes += e->size;
    if (e->type != 'f' && (e->size != 0 || e->exec)) abort();
    if (strlen(e->field) != e->field_len) abort();
    if (t.parent[i] > t.n) abort();
    if (t.parent[i] != t.n && (t.parent[i] >= i || t.e[t.parent[i]].type != 'd')) abort();
  }
  if (bytes != t.bytes) abort();
  uint32_t seen = 0;
  for (uint32_t d = 0; d <= t.n; d++)
    for (uint32_t c = t.head[d]; c != UINT32_MAX; c = t.next[c]) {
      if (t.parent[c] != d) abort();
      seen++;
    }
  if (seen != t.n) abort();
  sos_tree_free(&t);
  return 0;
}
