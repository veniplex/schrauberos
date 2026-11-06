/*
 * SchrauberOS – Starter (PID 1 im Container). Das Einzige im Image, das nicht per Web-Update erneuert wird.
 *
 * Bewusst winzig, statisch gelinkt, ohne Netzwerk und ohne Parser für fremde Eingaben:
 *   1. Wählt das App-Verzeichnis: den Eintrag in <DATA_DIR>/app/active (eine installierte Version) oder die im Image
 *      eingebaute Version /app.
 *   2. Startet dessen Launcher mit der mitgelieferten Laufzeit (Lader + Bibliotheken + Node liegen im Paket):
 *        <dir>/runtime/<loader> --library-path <dir>/runtime/lib <dir>/runtime/node <dir>/launcher.mjs
 *   3. Exit-Code des Launchers: 0 = sauber beendet, 42 = neu auswählen (Update/Rückfall), sonst Absturz. Stürzt der Launcher
 *      einer installierten Version zweimal kurz hintereinander ab, nimmt der Starter für diesen Lauf die eingebaute Version und
 *      hinterlässt <DATA_DIR>/app/launcher-crash (die eingebaute Version markiert die fehlerhafte dann als unbrauchbar).
 *
 * Kommandozeile: `/bootstrap --healthcheck` fragt http://127.0.0.1:$PORT/api/health ab (Exit 0 = gesund) – für Docker HEALTHCHECK,
 * weil das Image weder Shell noch Node auf dem Suchpfad hat.
 *
 * Übersetzen: gcc -static -Os -s -Wall -o bootstrap bootstrap.c
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <limits.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define RESTART_CODE 42
#define BUILTIN_DIR "/app"

static volatile pid_t child = 0;
static volatile sig_atomic_t terminating = 0;

static void forward_signal(int sig) {
  terminating = 1;
  if (child > 0) kill(child, sig);
}

/* Erste Zeile einer kleinen Textdatei ohne Zeilenende; 0, wenn nicht lesbar oder leer. */
static int read_line(const char *path, char *buf, size_t size) {
  FILE *f = fopen(path, "r");
  if (!f) return 0;
  if (!fgets(buf, (int)size, f)) {
    fclose(f);
    return 0;
  }
  fclose(f);
  buf[strcspn(buf, "\r\n")] = 0;
  return buf[0] != 0;
}

static const char *data_dir(void) {
  const char *d = getenv("DATA_DIR");
  return (d && *d) ? d : "/data";
}

/* Nur Verzeichnisse unterhalb von <DATA_DIR>/app/versions/ mit vorhandenem Launcher sind gültig. */
static int valid_version_dir(const char *dir) {
  char prefix[PATH_MAX], probe[PATH_MAX];
  snprintf(prefix, sizeof prefix, "%s/app/versions/", data_dir());
  if (strncmp(dir, prefix, strlen(prefix)) != 0 || strstr(dir, "..") != NULL) return 0;
  snprintf(probe, sizeof probe, "%s/launcher.mjs", dir);
  return access(probe, R_OK) == 0;
}

static void pick_dir(char *out, size_t size, int force_builtin) {
  char active_file[PATH_MAX], dir[PATH_MAX];
  snprintf(active_file, sizeof active_file, "%s/app/active", data_dir());
  if (!force_builtin && read_line(active_file, dir, sizeof dir) && valid_version_dir(dir)) {
    snprintf(out, size, "%s", dir);
    return;
  }
  snprintf(out, size, "%s", BUILTIN_DIR);
}

static pid_t spawn_launcher(const char *dir) {
  pid_t pid = fork();
  if (pid != 0) return pid;

  char loader_file[PATH_MAX], loader_rel[256], loader[PATH_MAX], libs[PATH_MAX], node[PATH_MAX], launcher[PATH_MAX];
  snprintf(loader_file, sizeof loader_file, "%s/runtime/loader", dir);
  snprintf(libs, sizeof libs, "%s/runtime/lib", dir);
  snprintf(node, sizeof node, "%s/runtime/node", dir);
  snprintf(launcher, sizeof launcher, "%s/launcher.mjs", dir);
  if (chdir(dir) != 0) _exit(126);
  if (read_line(loader_file, loader_rel, sizeof loader_rel)) {
    snprintf(loader, sizeof loader, "%s/runtime/%s", dir, loader_rel);
    char *args[] = {loader, "--library-path", libs, node, launcher, NULL};
    execv(loader, args);
  } else {
    char *args[] = {node, launcher, NULL};
    execv(node, args);
  }
  perror("[bootstrap] exec");
  _exit(127);
}

static void record_launcher_crash(const char *dir) {
  char path[PATH_MAX];
  snprintf(path, sizeof path, "%s/app/launcher-crash", data_dir());
  FILE *f = fopen(path, "w");
  if (f) {
    fputs(dir, f);
    fclose(f);
  }
}

static int healthcheck(void) {
  const char *p = getenv("PORT");
  int port = (p && atoi(p) > 0) ? atoi(p) : 3000;
  alarm(4);
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return 1;
  struct sockaddr_in addr = {0};
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

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "--healthcheck") == 0) return healthcheck();

  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = forward_signal;
  sigaction(SIGTERM, &sa, NULL);
  sigaction(SIGINT, &sa, NULL);
  sigaction(SIGHUP, &sa, NULL);
  sigaction(SIGQUIT, &sa, NULL);

  int force_builtin = 0, crashes = 0;
  char last_dir[PATH_MAX] = "";
  time_t last_crash = 0;

  for (;;) {
    char dir[PATH_MAX];
    pick_dir(dir, sizeof dir, force_builtin);
    fprintf(stderr, "[bootstrap] Starte Launcher aus %s\n", dir);
    pid_t pid = spawn_launcher(dir);
    if (pid < 0) {
      perror("[bootstrap] fork");
      return 1;
    }
    child = pid;

    int status = 0;
    for (;;) { /* auch verwaiste Prozesse einsammeln, bis der Launcher selbst endet */
      pid_t w = waitpid(-1, &status, 0);
      if (w == pid) break;
      if (w < 0 && errno != EINTR) return 1;
    }
    child = 0;
    int code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);

    if (terminating || code == 0) return code;
    if (code == RESTART_CODE) {
      crashes = 0;
      continue;
    }

    if (strcmp(dir, BUILTIN_DIR) != 0) {
      time_t now = time(NULL);
      crashes = (strcmp(dir, last_dir) == 0 && now - last_crash < 30) ? crashes + 1 : 1;
      snprintf(last_dir, sizeof last_dir, "%s", dir);
      last_crash = now;
      if (crashes >= 2) {
        fprintf(stderr, "[bootstrap] Launcher aus %s stürzt wiederholt ab (Code %d) – nehme die eingebaute Version.\n", dir, code);
        record_launcher_crash(dir);
        force_builtin = 1;
        crashes = 0;
      }
      continue;
    }
    fprintf(stderr, "[bootstrap] Der eingebaute Launcher ist mit Code %d beendet.\n", code);
    return code;
  }
}
