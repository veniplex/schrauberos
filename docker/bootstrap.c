/*
 * SchrauberOS – Starter (PID 1 im Container). Das Einzige im Image, das nicht per Web-Update erneuert wird – und der Vertrauensanker:
 * Eine installierte Version (unter <DATA_DIR>/app/versions/, für die App beschreibbar und deshalb NICHT vertraut) wird nur gestartet, wenn sie genau dem entspricht,
 * was der Release-Schlüssel signiert hat (Siegel + Dateiliste, Mengengleichheit). Die eingebaute Version unter /app ist root-eigen und die Vertrauensbasis.
 * Spezifikation: README „Starter-Vertrauensanker“; der Prüfer steht in verify.c (derselbe Code läuft als `--verify`), die Schlüssel in trust-keys.h (generiert).
 *
 * Bewusst klein und statisch gelinkt, ohne Netzwerk (außer dem lokalen Healthcheck) und ohne Umgebungsauswertung außer DATA_DIR und PORT:
 *   1. Wählt das App-Verzeichnis: den strengen Zeiger <DATA_DIR>/app/active (eine installierte Version) oder die eingebaute Version /app.
 *   2. Prüft eine installierte Version in einem Kindprozess (ein Speicherfehler im Prüfer darf den Start der eingebauten Version nie verhindern), nachdem alle Nachfahren
 *      des vorigen Laufs beendet sind (Ruhezustand: geprüft wird nur, wenn keine fremde Prozessgruppe der App mehr läuft).
 *   3. Startet den Launcher des gewählten Verzeichnisses mit der mitgelieferten Laufzeit, im Arbeitsverzeichnis <dir> und mit relativen Pfaden:
 *        ./runtime/<loader> --library-path ./runtime/lib ./runtime/node ./launcher.mjs
 *      Bei einer installierten Version wechselt der Starter per fchdir in genau den Ordner, den der Prüfer durchlaufen hat (Deskriptor aus der Prüfung), nicht in den Pfad.
 *   4. Exit-Code des Launchers: 0 = sauber beendet, 42 = neu prüfen und auswählen (jeder Neustart der App geht über den Starter), sonst Absturz. Stürzt der Launcher einer
 *      installierten Version zweimal kurz nach dem Start ab, nimmt der Starter die eingebaute Version und hinterlässt <DATA_DIR>/app/launcher-crash.
 *
 * Prüfergebnisse: ok · negativ (Integritätsbefund 10–16, 18: Marker verify-failed) · veraltet (19: nur ein Logeintrag) · unklar (Signal, Zeitüberschreitung, Ein-/Ausgabe, Ruhezustand
 * nicht herstellbar: Marker inconclusive, kein Befund über den Inhalt; nur Signal und Ein-/Ausgabe zählen im Launcher als Fehlversuch). In allen Fällen außer ok läuft für diesen Durchlauf die eingebaute Version; der Starter selbst ist zustandslos (der Zeiger
 * bleibt, die Vorversion-Logik liegt im Launcher der eingebauten Version).
 *
 * Kommandozeile:
 *   /bootstrap --healthcheck                 fragt http://127.0.0.1:$PORT/api/health ab (Exit 0 = gesund) – für Docker HEALTHCHECK
 *   /bootstrap --print-keys                  "root <16 Hex>" / "release <16 Hex>" / "tag-build 0|1": Fingerabdrücke der einkompilierten Schlüssel, ob es ein Tag-Build ist (Echtprobe)
 *   /bootstrap --verify DIR [--expect-version V] [--no-floor] [--check-expiry JJJJ-MM-TT]
 *                                            prüft ein Versionsverzeichnis wie der Starter (Installer, Echtprobe); eine JSON-Zeile auf stdout, Exit-Code = Befund
 *
 * Übersetzen (Produktion, Dockerfile): gcc -O2 -static-pie -fPIE -fstack-protector-strong -D_FORTIFY_SOURCE=2 -Wl,-z,relro,-z,now -Wall -Wextra -Wformat=2 -Wconversion -Wshadow -Werror
 *                                      -DSOS_PRODUCTION=1 -Ivendor/monocypher -o bootstrap bootstrap.c verify.c vendor/monocypher/monocypher.c vendor/monocypher/monocypher-ed25519.c
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/uio.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "trust-keys.h"
#include "verify.h"

#define RESTART_CODE 42
#define POINTER_MAX 4096
#define PATH_CAP (POINTER_MAX + 64) /* Pfade aus dem Zeiger (höchstens POINTER_MAX) plus feste Anhänge */

/* snprintf mit geprüftem Ergebnis: 1 = passt, 0 = wäre abgeschnitten worden (dann ist nichts Brauchbares geschrieben) */
static int fmt(char *out, size_t cap, const char *format, ...) __attribute__((format(printf, 3, 4)));
static int fmt(char *out, size_t cap, const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  int n = vsnprintf(out, cap, format, ap);
  va_end(ap);
  if (n < 0 || (size_t)n >= cap) {
    if (cap) out[0] = 0;
    return 0;
  }
  return 1;
}

/* Konstanten; die Tests (docker/test) überschreiben sie mit -D, ein Produktions-Build (-DSOS_PRODUCTION) nie */
#if defined(SOS_PRODUCTION) && (defined(SOS_BUILTIN_DIR) || defined(SOS_VERIFY_TIMEOUT_SECONDS) || defined(SOS_QUIESCE_MILLIS) || defined(SOS_CRASH_WINDOW_SECONDS) || defined(SOS_BACKOFF_STEP_MILLIS) || \
    defined(SOS_TEST_NO_QUIESCE))
#error "Testkonstanten in einem Produktions-Build"
#endif
#ifndef SOS_BUILTIN_DIR
#define SOS_BUILTIN_DIR "/app"
#endif
#ifndef SOS_VERIFY_TIMEOUT_SECONDS
#define SOS_VERIFY_TIMEOUT_SECONDS 900u /* harte Grenze für eine Prüfung (alarm); ein Überschreiten ist „unklar“ und zählt nicht (README, Klassen) */
#endif
#ifndef SOS_QUIESCE_MILLIS
#define SOS_QUIESCE_MILLIS 10000u /* so lange wartet der Starter darauf, dass alle Nachfahren weg sind */
#endif
#ifndef SOS_CRASH_WINDOW_SECONDS
#define SOS_CRASH_WINDOW_SECONDS 30 /* ein Launcher, der kürzer lebt, zählt als „sofort abgestürzt“ */
#endif
#ifndef SOS_BACKOFF_STEP_MILLIS
#define SOS_BACKOFF_STEP_MILLIS 1000u /* Wartezeit nach dem 4. schnellen Neustartwunsch (42) in Folge; verdoppelt sich, höchstens 60 s */
#endif
#define BACKOFF_STEP_MILLIS SOS_BACKOFF_STEP_MILLIS
#define BACKOFF_FREE_ROUNDS 4 /* so viele schnelle Neustartwünsche in Folge sind ohne Wartezeit erlaubt (Rückfall-Ketten: Vorversion, eingebaute Version) */
#define BACKOFF_MAX_MILLIS 60000u
#define BUILTIN_DIR SOS_BUILTIN_DIR
#define VERIFY_TIMEOUT_SECONDS SOS_VERIFY_TIMEOUT_SECONDS
#define QUIESCE_MILLIS SOS_QUIESCE_MILLIS
#define CRASH_WINDOW_SECONDS SOS_CRASH_WINDOW_SECONDS

static volatile pid_t child = 0;
static volatile sig_atomic_t terminating = 0;

static void forward_signal(int sig) {
  terminating = 1;
  pid_t c = child;
  if (c > 0) kill(c, sig);
}

static const int HANDLED_SIGNALS[] = {SIGTERM, SIGINT, SIGHUP, SIGQUIT};

static void block_signals(sigset_t *old) {
  sigset_t set;
  sigemptyset(&set);
  for (size_t i = 0; i < sizeof HANDLED_SIGNALS / sizeof HANDLED_SIGNALS[0]; i++) sigaddset(&set, HANDLED_SIGNALS[i]);
  sigprocmask(SIG_BLOCK, &set, old);
}

/* Im Kindprozess: Standardverhalten der Signale zurück und Signalmaske leeren (der Launcher und das Prüfkind erben sonst die Handler/die Sperre des Starters) */
static void child_reset_signals(void) {
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = SIG_DFL;
  sigemptyset(&sa.sa_mask);
  for (size_t i = 0; i < sizeof HANDLED_SIGNALS / sizeof HANDLED_SIGNALS[0]; i++) sigaction(HANDLED_SIGNALS[i], &sa, NULL);
  sigaction(SIGALRM, &sa, NULL);
  sigset_t empty;
  sigemptyset(&empty);
  sigprocmask(SIG_SETMASK, &empty, NULL);
}

static uint64_t monotonic_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

/* Datenverzeichnis ohne Schrägstrich am Ende (DATA_DIR oder /data) */
static const char *data_dir(void) {
  static char dir[POINTER_MAX - 256];
  if (dir[0]) return dir;
  const char *d = getenv("DATA_DIR");
  if (!d || !*d || strlen(d) >= sizeof dir) d = "/data";
  fmt(dir, sizeof dir, "%s", d);
  size_t n = strlen(dir);
  while (n > 1 && dir[n - 1] == '/') dir[--n] = 0;
  return dir;
}

static void anchor_init(sos_anchor *a) {
  memset(a, 0, sizeof *a);
  a->root_key = SOS_ROOT_KEY;
  a->release_key = SOS_RELEASE_KEY;
  a->base = SOS_BASE;
  a->arch = SOS_ARCH;
  a->has_floor = 1;
  a->floor_major = SOS_FLOOR_MAJOR;
  a->floor_minor = SOS_FLOOR_MINOR;
  a->floor_patch = SOS_FLOOR_PATCH;
  a->floor_prerelease = SOS_FLOOR_PRERELEASE;
}

/* ───────── Marker (Daten für den Launcher der eingebauten Version; nie blockierend, nie einem Link folgend) ───────── */

/*
 * Der Marker ist ein Hinweis, nie Voraussetzung für den Start. Auch ein Hindernis unter dem Markernamen darf nichts aussperren: ein Link oder eine FIFO verschwindet per unlink,
 * ein leeres Verzeichnis per rmdir, ein nicht leeres wird beiseite verschoben (die App – uid 1000 – kann so etwas vor dem Neustart anlegen). Gelingt auch das nicht, steht eine Logzeile da.
 */
static void write_marker(const char *name, const char *content) {
  char path[PATH_CAP];
  if (!fmt(path, sizeof path, "%s/app/%s", data_dir(), name)) return;
  if (unlink(path) != 0 && errno != ENOENT && rmdir(path) != 0 && errno != ENOENT) {
    char aside[PATH_CAP + 40];
    int moved = fmt(aside, sizeof aside, "%s.blocked-%llu", path, (unsigned long long)monotonic_ms()) && rename(path, aside) == 0;
    if (!moved) {
      fprintf(stderr, "[bootstrap] Warnung: Der Marker %s lässt sich nicht schreiben (Hindernis im Weg: %s).\n", name, strerror(errno));
      return;
    }
    fprintf(stderr, "[bootstrap] Hinweis: Unter dem Namen des Markers %s lag etwas anderes als eine Datei; es wurde beiseite verschoben.\n", name);
  }
  int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, 0644);
  if (fd < 0) {
    fprintf(stderr, "[bootstrap] Warnung: Der Marker %s lässt sich nicht schreiben (%s).\n", name, strerror(errno));
    return;
  }
  size_t len = strlen(content), done = 0;
  while (done < len) {
    ssize_t n = write(fd, content + done, len - done);
    if (n < 0) {
      if (errno == EINTR) continue;
      break;
    }
    done += (size_t)n;
  }
  close(fd);
}

/* ───────── Zeiger ───────── */

/*
 * <DATA_DIR>/app/active: exakt "<DATA_DIR>/app/versions/<x.y.z>", eine Zeile (ein einzelnes Zeilenende am Ende ist erlaubt). Alles andere – auch eine leere Datei –
 * bedeutet „eingebaute Version“, ohne Marker (Ungültigkeit ist kein Angriffsziel). Öffnen ohne zu blockieren (kein mkfifo-Aussperren), ohne Link, nur reguläre Datei, kleine Datei.
 */
static int read_pointer(char *version, size_t version_cap, char *dir, size_t dir_cap) {
  char path[PATH_CAP];
  if (!fmt(path, sizeof path, "%s/app/active", data_dir())) return 0;
  int fd = open(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return 0;
  struct stat st;
  char buf[POINTER_MAX + 1];
  ssize_t got = -1;
  if (fstat(fd, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0 && st.st_size <= POINTER_MAX) {
    size_t total = 0;
    for (;;) {
      ssize_t n = read(fd, buf + total, sizeof buf - 1 - total);
      if (n < 0 && errno == EINTR) continue;
      if (n <= 0) break;
      total += (size_t)n;
      if (total >= sizeof buf - 1) break;
    }
    got = (ssize_t)total;
  }
  close(fd);
  if (got <= 0 || got > POINTER_MAX) return 0;
  size_t len = (size_t)got;
  if (buf[len - 1] == '\n') len--;
  buf[len] = 0;
  if (strlen(buf) != len) return 0; /* NUL im Inhalt */
  for (size_t i = 0; i < len; i++)
    if ((unsigned char)buf[i] < 0x20 || buf[i] == 0x7f) return 0; /* nur eine Zeile, keine Steuerzeichen */
  char prefix[PATH_CAP];
  if (!fmt(prefix, sizeof prefix, "%s/app/versions/", data_dir())) return 0;
  size_t pl = strlen(prefix);
  if (len <= pl || strncmp(buf, prefix, pl) != 0) return 0;
  uint32_t parts[3];
  if (!sos_version_parse(buf + pl, parts)) return 0;
  return fmt(version, version_cap, "%s", buf + pl) && fmt(dir, dir_cap, "%s", buf);
}

/* ───────── Ruhezustand ───────── */

/*
 * Geprüft wird nur, wenn kein anderer Code der App läuft. Der Starter ist Subreaper (oder PID 1): Alles, was vom vorigen Lauf übrig ist, hängt als Kind an ihm. Er tötet diese
 * Prozesse (nur Nachfahren: gesucht wird über /proc nach ppid == getpid(), nie kill(-1) – das träfe `docker exec` und den Healthcheck) und sammelt sie ein.
 * 1 = ruhig · 0 = es blieb etwas übrig · -1 = nicht erzwingbar (kein /proc und nicht erkennbar, ob Kinder bleiben).
 */
static int children_of_us(int kill_them, int *unreadable) {
  DIR *proc = opendir("/proc");
  *unreadable = 0;
  if (!proc) {
    *unreadable = 1;
    return 0;
  }
  int found = 0;
  pid_t me = getpid();
  struct dirent *d;
  while ((d = readdir(proc)) != NULL) {
    char *end;
    if (d->d_name[0] < '1' || d->d_name[0] > '9') continue;
    long pid = strtol(d->d_name, &end, 10);
    if (*end || pid <= 0 || pid == me) continue;
    char path[64], buf[512];
    snprintf(path, sizeof path, "/proc/%ld/stat", pid);
    int fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) continue;
    ssize_t n = read(fd, buf, sizeof buf - 1);
    close(fd);
    if (n <= 0) continue;
    buf[n] = 0;
    char *paren = strrchr(buf, ')'); /* der Prozessname steht in Klammern und darf beliebige Zeichen enthalten */
    if (!paren) continue;
    char state;
    long ppid;
    if (sscanf(paren + 1, " %c %ld", &state, &ppid) != 2) continue;
    if (ppid == (long)me) {
      found++;
      if (kill_them) kill((pid_t)pid, SIGKILL);
    }
  }
  closedir(proc);
  return found;
}

static int quiesce(void) {
  uint64_t deadline = monotonic_ms() + QUIESCE_MILLIS;
  for (;;) {
    int reaped = 0, status;
    pid_t w;
    while ((w = waitpid(-1, &status, WNOHANG)) > 0) reaped++;
    int no_children = (w < 0 && errno == ECHILD);
    int unreadable;
    int found = children_of_us(1, &unreadable);
    if (no_children && (found == 0 || unreadable)) return 1;
    if (unreadable && !no_children) return -1;
    if (terminating) return 0;
    if (monotonic_ms() >= deadline) return 0;
    (void)reaped;
    struct timespec nap = {0, 10 * 1000 * 1000};
    nanosleep(&nap, NULL);
  }
}

/* ───────── Prüfung im Kindprozess ───────── */

typedef struct {
  int32_t code;
  int32_t floor;
  uint64_t files, bytes, ms;
  char reason[28];
  char path[SOS_REPORT_PATH + 1];
} report_t;

typedef struct {
  const char *version;
  uint64_t started;
} progress_ctx;

static void print_progress(void *ctx, uint64_t done, uint64_t total, uint32_t files_done, uint32_t files_total) {
  const progress_ctx *p = ctx;
  fprintf(stderr, "[bootstrap] Prüfe Version %s … %llu MiB / %llu MiB (%u / %u Dateien)\n", p->version, (unsigned long long)(done >> 20), (unsigned long long)(total >> 20), files_done,
          files_total);
}

typedef enum { VERIFY_OK, VERIFY_NEGATIVE, VERIFY_OUTDATED, VERIFY_INCONCLUSIVE } verify_class;

/* Bericht (und bei Erfolg der Deskriptor des geprüften Versionsordners) an den Elternprozess; ein Fehler dabei zeigt sich dort als fehlender Bericht → unklar */
static void send_report(int sock, const report_t *rep, int dirfd) {
  struct iovec iov = {(void *)(uintptr_t)rep, sizeof *rep};
  union {
    struct cmsghdr align;
    char buf[CMSG_SPACE(sizeof(int))];
  } ctl;
  struct msghdr msg;
  memset(&msg, 0, sizeof msg);
  memset(&ctl, 0, sizeof ctl);
  msg.msg_iov = &iov;
  msg.msg_iovlen = 1;
  if (dirfd >= 0) {
    msg.msg_control = ctl.buf;
    msg.msg_controllen = sizeof ctl.buf;
    struct cmsghdr *c = CMSG_FIRSTHDR(&msg);
    c->cmsg_level = SOL_SOCKET;
    c->cmsg_type = SCM_RIGHTS;
    c->cmsg_len = CMSG_LEN(sizeof(int));
    memcpy(CMSG_DATA(c), &dirfd, sizeof(int));
  }
  ssize_t ignored = sendmsg(sock, &msg, MSG_NOSIGNAL);
  (void)ignored;
}

/* Empfängt den Bericht samt Deskriptor (der Absender ist schon beendet; die Nachricht liegt im Puffer des Sockets). Liefert die Größe des Berichts; *dirfd = -1, wenn keiner mitkam. */
static ssize_t receive_report(int sock, report_t *rep, int *dirfd) {
  struct iovec iov = {rep, sizeof *rep};
  union {
    struct cmsghdr align;
    char buf[CMSG_SPACE(4 * sizeof(int))];
  } ctl;
  struct msghdr msg;
  memset(&msg, 0, sizeof msg);
  memset(&ctl, 0, sizeof ctl);
  msg.msg_iov = &iov;
  msg.msg_iovlen = 1;
  msg.msg_control = ctl.buf;
  msg.msg_controllen = sizeof ctl.buf;
  *dirfd = -1;
  ssize_t n;
  do n = recvmsg(sock, &msg, MSG_DONTWAIT | MSG_CMSG_CLOEXEC);
  while (n < 0 && errno == EINTR);
  for (struct cmsghdr *c = CMSG_FIRSTHDR(&msg); c; c = CMSG_NXTHDR(&msg, c)) {
    if (c->cmsg_level != SOL_SOCKET || c->cmsg_type != SCM_RIGHTS) continue;
    size_t count = (c->cmsg_len - CMSG_LEN(0)) / sizeof(int);
    for (size_t i = 0; i < count; i++) {
      int fd;
      memcpy(&fd, CMSG_DATA(c) + i * sizeof(int), sizeof fd);
      if (*dirfd < 0 && i == 0 && count == 1) *dirfd = fd;
      else close(fd); /* mehr als erwartet: nichts davon weiterverwenden */
    }
  }
  if (msg.msg_flags & MSG_CTRUNC) {
    if (*dirfd >= 0) close(*dirfd);
    *dirfd = -1;
  }
  return n;
}

/*
 * Ergebnis der Prüfung einer installierten Version: Klasse, Grund bei „unklar“, Bericht (nur Anzeige). Bei Erfolg liefert *verified den Deskriptor genau des Versionsordners, den der
 * Prüfer durchlaufen hat (der Prüfer öffnet ihn selbst per openat/O_NOFOLLOW): Der Launcher startet aus diesem Ordner (fchdir), nicht aus dem Pfad, der sich inzwischen geändert haben könnte.
 */
static verify_class verify_in_child(const char *version, const char *dir, report_t *rep, const char **why, int *verified) {
  memset(rep, 0, sizeof *rep);
  *why = "other";
  *verified = -1;
  int fds[2];
  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, fds) != 0) {
    *why = "io";
    return VERIFY_INCONCLUSIVE;
  }
  sigset_t old;
  block_signals(&old);
  pid_t parent = getpid();
  pid_t pid = fork();
  if (pid < 0) {
    sigprocmask(SIG_SETMASK, &old, NULL);
    close(fds[0]);
    close(fds[1]);
    *why = "fork";
    return VERIFY_INCONCLUSIVE;
  }
  if (pid == 0) {
    /* Prüfkind: zuerst Signale und Maske, dann alarm – ein Speicherfehler im Prüfer darf nichts außer diesem Kind treffen */
    child_reset_signals();
    alarm(VERIFY_TIMEOUT_SECONDS);
    prctl(PR_SET_PDEATHSIG, SIGKILL);
    if (getppid() != parent) _exit(1);
    prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
    struct rlimit nocore = {0, 0};
    setrlimit(RLIMIT_CORE, &nocore);
    close(fds[0]);
    sos_anchor anchor;
    anchor_init(&anchor);
    sos_options opt;
    memset(&opt, 0, sizeof opt);
    opt.enforce_floor = 1;
    opt.expect_version = version;
    progress_ctx pc = {version, monotonic_ms()};
    opt.progress = print_progress;
    opt.progress_ctx = &pc;
    int kept = -1;
    opt.keep_dirfd = &kept;
    sos_result r;
    int code = sos_verify_path(dir, data_dir(), &anchor, &opt, &r);
    report_t out;
    memset(&out, 0, sizeof out);
    out.code = code;
    out.floor = r.floor;
    out.files = r.files;
    out.bytes = r.bytes;
    out.ms = r.ms;
    snprintf(out.reason, sizeof out.reason, "%s", r.reason);
    sos_clean(r.path, strlen(r.path), out.path, sizeof out.path);
    send_report(fds[1], &out, code == 0 ? kept : -1);
    _exit(code & 0xff);
  }
  child = pid;
  sigprocmask(SIG_SETMASK, &old, NULL); /* ein inzwischen eingetroffenes Signal wird jetzt zugestellt und erreicht das Kind */
  close(fds[1]);
  int status = 0;
  for (;;) {
    pid_t w = waitpid(pid, &status, 0);
    if (w == pid) break;
    if (w < 0 && errno != EINTR) {
      status = -1;
      break;
    }
  }
  child = 0;
  report_t got;
  int received = -1;
  ssize_t n = receive_report(fds[0], &got, &received);
  close(fds[0]);
  if (status == -1) {
    if (received >= 0) close(received);
    *why = "other";
    return VERIFY_INCONCLUSIVE;
  }
  if (WIFSIGNALED(status)) {
    if (received >= 0) close(received);
    *why = WTERMSIG(status) == SIGALRM ? "timeout" : "signal";
    return VERIFY_INCONCLUSIVE;
  }
  int code = WEXITSTATUS(status);
  if (n == (ssize_t)sizeof got && got.code == code) {
    /* Der Bericht kommt aus dem Prüfkind (Speicherfehler dort wären denkbar): nur Anzeige, und vor jeder Verwendung erneut bereinigt – Grund auf [a-z0-9:-], Pfad ohne Steuerzeichen */
    *rep = got;
    rep->reason[sizeof rep->reason - 1] = 0;
    rep->path[sizeof rep->path - 1] = 0;
    for (char *p = rep->reason; *p; p++)
      if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == ':' || *p == '-')) *p = '?';
    char clean[SOS_REPORT_PATH + 1];
    sos_clean(rep->path, strlen(rep->path), clean, sizeof clean);
    memcpy(rep->path, clean, sizeof clean);
  } else {
    rep->code = code;
  }
  if (code == 0) {
    if (received < 0) { /* „ok“ ohne den geprüften Ordner kann nicht gestartet werden (fail closed) */
      *why = "io";
      return VERIFY_INCONCLUSIVE;
    }
    *verified = received;
    return VERIFY_OK;
  }
  if (received >= 0) close(received);
  if ((code >= SOS_E_SEAL && code <= SOS_E_DIFFERS) || code == SOS_E_OUTSIDE) return VERIFY_NEGATIVE;
  if (code == SOS_E_OUTDATED) return VERIFY_OUTDATED;
  *why = code == SOS_E_IO ? "io" : "other";
  return VERIFY_INCONCLUSIVE;
}

/* ───────── Launcher ───────── */

/*
 * Startet den Launcher des Verzeichnisses `dir`. `dirfd` >= 0 ist der vom Prüfer durchlaufene Versionsordner: das Kind wechselt per fchdir hinein und ruft alles mit relativen Pfaden auf
 * (ein inzwischen ausgetauschter Ordner unter demselben Pfad bleibt unbeachtet). Ohne dirfd (die eingebaute Version, root-eigen) wechselt es per chdir.
 */
static pid_t spawn_launcher(const char *dir, int dirfd) {
  sigset_t old;
  block_signals(&old);
  pid_t pid = fork();
  if (pid < 0) {
    sigprocmask(SIG_SETMASK, &old, NULL);
    return pid;
  }
  if (pid != 0) {
    child = pid;
    sigprocmask(SIG_SETMASK, &old, NULL);
    return pid;
  }
  child_reset_signals();

  char loader_rel[256], loader[sizeof loader_rel + 16];
  if (dirfd >= 0 ? fchdir(dirfd) != 0 : chdir(dir) != 0) _exit(126);
  static char libs[] = "./runtime/lib", node[] = "./runtime/node", launcher[] = "./launcher.mjs";
  FILE *f = fopen("runtime/loader", "r");
  int have_loader = 0;
  if (f) {
    if (fgets(loader_rel, (int)sizeof loader_rel, f)) {
      loader_rel[strcspn(loader_rel, "\r\n")] = 0;
      have_loader = loader_rel[0] != 0;
    }
    fclose(f);
  }
  if (have_loader) {
    if (!fmt(loader, sizeof loader, "./runtime/%s", loader_rel)) _exit(126);
    char *args[] = {loader, "--library-path", libs, node, launcher, NULL};
    execv(loader, args);
  } else {
    char *args[] = {node, launcher, NULL};
    execv(node, args);
  }
  perror("[bootstrap] exec");
  _exit(127);
}

static int healthcheck(void) {
  const char *p = getenv("PORT");
  int port = (p && atoi(p) > 0 && atoi(p) < 65536) ? atoi(p) : 3000;
  alarm(4);
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return 1;
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof addr);
  addr.sin_family = AF_INET;
  addr.sin_port = htons((unsigned short)port);
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
  if (connect(fd, (struct sockaddr *)&addr, sizeof addr) != 0) return 1;
  const char *req = "GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n";
  if (write(fd, req, strlen(req)) < 0) return 1;
  char buf[64] = {0};
  ssize_t n = read(fd, buf, sizeof buf - 1);
  close(fd);
  return (n > 12 && strncmp(buf, "HTTP/1.", 7) == 0 && strncmp(buf + 8, " 200", 4) == 0) ? 0 : 1;
}

/* ───────── Kommandozeilen-Modi ───────── */

static int print_keys(void) {
  printf("root %s\nrelease %s\ntag-build %d\n", SOS_ROOT_FINGERPRINT, SOS_RELEASE_FINGERPRINT, SOS_TAG_BUILD);
  return 0;
}

static int usage_error(const char *what) {
  fprintf(stderr, "[bootstrap] Aufruf: --verify DIR [--expect-version V] [--no-floor] [--check-expiry JJJJ-MM-TT] (%s)\n", what);
  printf("{\"ok\":false,\"code\":2,\"reason\":\"usage\",\"path\":\"\",\"ms\":0}\n");
  return SOS_E_USAGE;
}

static int verify_command(int argc, char **argv) {
  const char *dir = NULL;
  sos_options opt;
  memset(&opt, 0, sizeof opt);
  opt.enforce_floor = 1;
  for (int i = 2; i < argc; i++) {
    if (strcmp(argv[i], "--expect-version") == 0 && i + 1 < argc && !opt.expect_version) {
      opt.expect_version = argv[++i];
    } else if (strcmp(argv[i], "--check-expiry") == 0 && i + 1 < argc && !opt.check_expiry) {
      opt.check_expiry = argv[++i];
      if (!sos_calendar_date(opt.check_expiry)) return usage_error("Datum");
    } else if (strcmp(argv[i], "--no-floor") == 0 && opt.enforce_floor) {
      opt.enforce_floor = 0;
    } else if (!dir && argv[i][0] != '-') {
      dir = argv[i];
    } else {
      return usage_error("Argument");
    }
  }
  if (!dir) return usage_error("Verzeichnis fehlt");
  struct rlimit nocore = {0, 0};
  setrlimit(RLIMIT_CORE, &nocore);
  sos_anchor anchor;
  anchor_init(&anchor);
  sos_result r;
  int code = sos_verify_path(dir, data_dir(), &anchor, &opt, &r);
  char json[2048];
  sos_result_json(&r, json, sizeof json);
  printf("%s\n", json);
  fflush(stdout);
  if (code == 0) {
    fprintf(stderr, "[bootstrap] Version %s geprüft: %llu Einträge, %llu Bytes, %llu ms.\n", r.version, (unsigned long long)r.files, (unsigned long long)r.bytes, (unsigned long long)r.ms);
  } else {
    char clean[SOS_REPORT_PATH + 1];
    sos_clean(r.path, strlen(r.path), clean, sizeof clean);
    fprintf(stderr, "[bootstrap] Prüfung fehlgeschlagen (Code %d, %s%s%s).\n", code, r.reason, clean[0] ? ", " : "", clean);
  }
  return code;
}

/* ───────── Hauptschleife ───────── */

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "--healthcheck") == 0) return healthcheck();
  if (argc > 1 && strcmp(argv[1], "--print-keys") == 0) return print_keys();
  if (argc > 1 && strcmp(argv[1], "--verify") == 0) return verify_command(argc, argv);
  if (argc > 1) {
    fprintf(stderr, "[bootstrap] Unbekanntes Argument.\n");
    return SOS_E_USAGE;
  }

  /* PID 1 darf nicht über /proc/1/mem oder ptrace von der App (gleiche uid) verändert werden; keine Speicherabzüge mit Geheimnissen */
  prctl(PR_SET_DUMPABLE, 0, 0, 0, 0);
  struct rlimit nocore = {0, 0};
  setrlimit(RLIMIT_CORE, &nocore);
  int subreaper = prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) == 0;
  int can_quiesce = subreaper || getpid() == 1;
#ifdef SOS_TEST_NO_QUIESCE
  can_quiesce = 0; /* nur Tests: die Zusicherung ist nicht erzwingbar */
#endif
  if (!can_quiesce) fprintf(stderr, "[bootstrap] Warnung: Ruhezustand nicht erzwingbar (weder PID 1 noch Subreaper) – installierte Versionen werden nicht gestartet.\n");

  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = forward_signal;
  sigemptyset(&sa.sa_mask);
  for (size_t i = 0; i < sizeof HANDLED_SIGNALS / sizeof HANDLED_SIGNALS[0]; i++) sigaction(HANDLED_SIGNALS[i], &sa, NULL);

  int force_builtin = 0, crashes = 0, quick_restarts = 0;
  char last_dir[POINTER_MAX + 1] = "";

  for (;;) {
    if (terminating) return 0;

    char dir[POINTER_MAX + 1] = BUILTIN_DIR, version[32] = "";
    int installed = 0, verified_fd = -1;
    if (!force_builtin) {
      char target[POINTER_MAX + 1];
      struct stat st;
      if (read_pointer(version, sizeof version, target, sizeof target) && lstat(target, &st) == 0) {
        installed = 1;
        fmt(dir, sizeof dir, "%s", target);
      }
    }

    if (installed) {
      int quiet = can_quiesce ? quiesce() : -1;
      if (terminating) return 0;
      if (quiet <= 0) {
        /* Eigenschaft der Umgebung bzw. ein Überlebender, kein Befund über die Version: nie ein Fehlversuch (Grund quiesce zählt nicht), die Update-Seite meldet „installiert, aber nicht gestartet“ */
        if (quiet < 0) fprintf(stderr, "[bootstrap] Warnung: Ruhezustand nicht erzwingbar – Version %s wird nicht geprüft, es läuft die eingebaute Version.\n", version);
        else fprintf(stderr, "[bootstrap] Nach dem Beenden der App laufen noch Prozesse – Version %s wird nicht geprüft, es läuft die eingebaute Version.\n", version);
        char marker[64];
        snprintf(marker, sizeof marker, "%s\nquiesce\n", version);
        write_marker("inconclusive", marker);
        installed = 0;
      } else {
        fprintf(stderr, "[bootstrap] Prüfe Version %s …\n", version);
        report_t rep;
        const char *why;
        verify_class cls = verify_in_child(version, dir, &rep, &why, &verified_fd);
        if (terminating) {
          if (verified_fd >= 0) close(verified_fd);
          return 0; /* nach einem Stoppsignal gibt es keinen Befund und keinen Marker */
        }
        if (cls == VERIFY_OK) {
          unsigned long long secs = rep.ms / 1000u, tenths = (rep.ms % 1000u) / 100u;
          fprintf(stderr, "[bootstrap] Version %s geprüft (%llu Einträge, %llu MiB, %llu,%llu s).\n", version, (unsigned long long)rep.files, (unsigned long long)(rep.bytes >> 20), secs, tenths);
          char marker[160];
          snprintf(marker, sizeof marker, "%s\n%llu\n%llu\n%llu\n%lld\n", version, (unsigned long long)rep.files, (unsigned long long)rep.bytes, (unsigned long long)rep.ms, (long long)time(NULL));
          write_marker("verify-ok", marker);
        } else {
          installed = 0;
          if (cls == VERIFY_NEGATIVE) {
            fprintf(stderr, "[bootstrap] Version %s abgelehnt (Code %d, %s%s%s) – es läuft die eingebaute Version.\n", version, rep.code, rep.reason, rep.path[0] ? ": " : "", rep.path);
            char marker[SOS_REPORT_PATH + 96];
            snprintf(marker, sizeof marker, "%s\n%d\n%s\n", version, rep.code, rep.path);
            write_marker("verify-failed", marker);
          } else if (cls == VERIFY_OUTDATED) {
            fprintf(stderr, "[bootstrap] Version %s ist veraltet oder passt nicht zu diesem Image (%s) – es läuft die eingebaute Version.\n", version, rep.reason);
          } else {
            fprintf(stderr, "[bootstrap] Die Prüfung der Version %s blieb unklar (%s) – es läuft die eingebaute Version, der nächste Start prüft erneut.\n", version, why);
            char marker[64];
            snprintf(marker, sizeof marker, "%s\n%s\n", version, why);
            write_marker("inconclusive", marker);
          }
        }
      }
      if (!installed) fmt(dir, sizeof dir, "%s", BUILTIN_DIR);
    }

    fprintf(stderr, "[bootstrap] Starte Launcher aus %s\n", dir);
    uint64_t spawned = monotonic_ms();
    pid_t pid = spawn_launcher(dir, verified_fd);
    if (verified_fd >= 0) close(verified_fd);
    if (pid < 0) {
      perror("[bootstrap] fork");
      return 1;
    }

    int status = 0;
    for (;;) { /* auch verwaiste Prozesse einsammeln, bis der Launcher selbst endet */
      pid_t w = waitpid(-1, &status, 0);
      if (w == pid) break;
      if (w < 0 && errno != EINTR) return 1;
    }
    child = 0;
    int code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);

    if (terminating || code == 0) return code;
    /* Absturzfenster an der Laufzeit des Launchers, nicht an der Prüfzeit */
    int quick = monotonic_ms() - spawned < CRASH_WINDOW_SECONDS * 1000u;
    if (code == RESTART_CODE) {
      crashes = 0;
      if (strcmp(dir, BUILTIN_DIR) == 0) force_builtin = 0; /* die eingebaute Version hat den Zustand abgeglichen: der Zeiger entscheidet wieder */
      /* Meldet ein Launcher wiederholt sofort 42, wäre jede Runde eine volle Prüfung ohne Pause: ab der 5. in Folge wartet der Starter (1 s, 2 s, 4 s … höchstens 60 s; ein Signal bricht die Pause ab) */
      quick_restarts = quick ? quick_restarts + 1 : 0;
      if (quick_restarts > BACKOFF_FREE_ROUNDS) {
        uint64_t wait_ms = (uint64_t)BACKOFF_STEP_MILLIS << (quick_restarts - BACKOFF_FREE_ROUNDS - 1 < 6 ? quick_restarts - BACKOFF_FREE_ROUNDS - 1 : 6);
        if (wait_ms > BACKOFF_MAX_MILLIS) wait_ms = BACKOFF_MAX_MILLIS;
        fprintf(stderr, "[bootstrap] Der Launcher verlangt wiederholt sofort einen Neustart – Pause von %llu ms.\n", (unsigned long long)wait_ms);
        struct timespec nap = {(time_t)(wait_ms / 1000u), (long)(wait_ms % 1000u) * 1000000L};
        nanosleep(&nap, NULL);
      }
      continue;
    }
    quick_restarts = 0;

    if (strcmp(dir, BUILTIN_DIR) != 0) {
      /* ein langsamer Absturz zählt nicht (und beendet eine begonnene Reihe schneller Abstürze): nur Abstürze unter 30 s in Folge derselben Version */
      crashes = !quick ? 0 : (strcmp(dir, last_dir) == 0 ? crashes + 1 : 1);
      fmt(last_dir, sizeof last_dir, "%s", dir);
      if (crashes >= 2) {
        fprintf(stderr, "[bootstrap] Launcher aus %s stürzt wiederholt ab (Code %d) – nehme die eingebaute Version.\n", dir, code);
        write_marker("launcher-crash", dir);
        force_builtin = 1;
        crashes = 0;
      }
      continue;
    }
    fprintf(stderr, "[bootstrap] Der eingebaute Launcher ist mit Code %d beendet.\n", code);
    return code;
  }
}
