/* Wirft die Seiten aller Dateien unter dem Verzeichnis aus dem Seiten-Cache (posix_fadvise DONTNEED, ohne Root): macht die nächste Prüfung „kalt“ (nur Messung). */
#define _GNU_SOURCE
#include <fcntl.h>
#include <ftw.h>
#include <stdio.h>
#include <unistd.h>

static int visit(const char *path, const struct stat *st, int type, struct FTW *ftw) {
  (void)st; (void)ftw;
  if (type != FTW_F) return 0;
  int fd = open(path, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) return 0;
  fdatasync(fd);
  posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED);
  close(fd);
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  return nftw(argv[1], visit, 64, FTW_PHYS) == 0 ? 0 : 1;
}
