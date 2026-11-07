/*
 * Attrappe für Launcher und Node in den Starter-Tests (docker/test/stage-starter.mjs): Der Starter ruft `<dir>/runtime/node <dir>/launcher.mjs` auf; dieses Programm
 * liest die Datei (argv[1]) als Skript, eine Anweisung je Zeile, und schreibt in die Datei $SOS_TEST_LOG ("<Beschriftung> …"). Kein Node, keine Shell nötig.
 *
 *   log TEXT                  schreibt "TEXT" in das Protokoll
 *   exit N                    beendet mit Code N
 *   exit-once FLAG N          beim ersten Mal (FLAG existiert nicht) FLAG anlegen und mit N beenden; sonst weiter
 *   crash-times N FLAG        Zähler in FLAG erhöhen; solange er <= N ist, mit Code 3 beenden; sonst weiter
 *   sleep MS                  wartet
 *   daemon PIDFILE            (nur wenn PIDFILE noch nicht existiert) startet einen entkoppelten Prozess (Doppel-Fork, setsid), der lange schläft; seine PID kommt nach PIDFILE (ein „kompromittierter Überlebender“)
 *   wait-file FILE            wartet (höchstens 30 s), bis FILE existiert
 *   check-dead PIDFILE        protokolliert "dead" oder "alive" je nachdem, ob der Prozess aus PIDFILE noch lebt
 *   status                    protokolliert SigBlk/SigIgn/SigCgt aus /proc/self/status (geerbte Signalmaske und -behandlung)
 *   wait-term CODE            wartet auf SIGTERM und beendet dann mit CODE (protokolliert "term"); bei SIGINT/SIGHUP/SIGQUIT ebenso
 *   hold                      schläft für immer (nur ein Signal beendet es)
 *   include VAR               liest weitere Anweisungen aus der Datei, deren Name in der Umgebungsvariable VAR steht
 *   cwd                       protokolliert das Arbeitsverzeichnis
 *   append FILE TEXT          hängt TEXT an FILE an (die „kompromittierte App“ verändert ihr eigenes Paket)
 *   pidfile PATH              schreibt die eigene PID nach PATH
 *   ppid                      protokolliert die PID des Elternprozesses ("ppid N")
 *   uid                       protokolliert die Benutzerkennung ("uid N")
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static FILE *logf_;
static volatile sig_atomic_t got_term;
static int term_code;

static void say(const char *text) {
  if (!logf_) return;
  fprintf(logf_, "%s\n", text);
  fflush(logf_);
}

static void on_term(int sig) {
  (void)sig;
  got_term = 1;
}

static void sleep_ms(long ms) {
  struct timespec ts = {ms / 1000, (ms % 1000) * 1000000L};
  while (nanosleep(&ts, &ts) != 0 && errno == EINTR && !got_term) {
  }
}

static int run_script(const char *path);

static int run_line(char *line) {
  char *arg = strchr(line, ' ');
  if (arg) *arg++ = 0;
  if (strcmp(line, "log") == 0) say(arg ? arg : "");
  else if (strcmp(line, "exit") == 0) exit(atoi(arg ? arg : "0"));
  else if (strcmp(line, "exit-once") == 0 && arg) {
    char *n = strchr(arg, ' ');
    if (n) *n++ = 0;
    if (access(arg, F_OK) != 0) {
      int fd = open(arg, O_WRONLY | O_CREAT, 0644);
      if (fd >= 0) close(fd);
      exit(atoi(n ? n : "0"));
    }
  } else if (strcmp(line, "crash-times") == 0 && arg) {
    char *flag = strchr(arg, ' ');
    if (flag) *flag++ = 0;
    int limit = atoi(arg), count = 0;
    FILE *f = fopen(flag, "r");
    if (f) {
      if (fscanf(f, "%d", &count) != 1) count = 0;
      fclose(f);
    }
    count++;
    f = fopen(flag, "w");
    if (f) {
      fprintf(f, "%d\n", count);
      fclose(f);
    }
    if (count <= limit) exit(3);
  } else if (strcmp(line, "sleep") == 0) sleep_ms(atol(arg ? arg : "0"));
  else if (strcmp(line, "daemon") == 0 && arg) {
    if (access(arg, F_OK) == 0) return 0; /* nur beim ersten Mal */
    pid_t p = fork();
    if (p == 0) {
      setsid();
      pid_t q = fork();
      if (q == 0) {
        FILE *f = fopen(arg, "w");
        if (f) {
          fprintf(f, "%d\n", (int)getpid());
          fclose(f);
        }
        sleep(1000);
        _exit(0);
      }
      _exit(0);
    }
    if (p > 0) waitpid(p, NULL, 0);
    sleep_ms(200); /* dem Daemon Zeit geben, die PID zu schreiben */
  } else if (strcmp(line, "wait-file") == 0 && arg) {
    for (int i = 0; i < 3000 && access(arg, F_OK) != 0; i++) sleep_ms(10);
  } else if (strcmp(line, "check-dead") == 0 && arg) {
    FILE *f = fopen(arg, "r");
    int pid = 0;
    if (f) {
      if (fscanf(f, "%d", &pid) != 1) pid = 0;
      fclose(f);
    }
    if (pid > 0 && kill(pid, 0) == 0) {
      /* ein Zombie zählt als tot: /proc/<pid>/stat prüfen */
      char p[64], buf[256] = "";
      snprintf(p, sizeof p, "/proc/%d/stat", pid);
      f = fopen(p, "r");
      if (f && fgets(buf, sizeof buf, f)) {
        char *paren = strrchr(buf, ')');
        say(paren && paren[2] == 'Z' ? "dead" : "alive");
      } else {
        say("dead");
      }
      if (f) fclose(f);
    } else {
      say("dead");
    }
  } else if (strcmp(line, "status") == 0) {
    FILE *f = fopen("/proc/self/status", "r");
    char buf[256];
    while (f && fgets(buf, sizeof buf, f)) {
      if (strncmp(buf, "SigBlk:", 7) == 0 || strncmp(buf, "SigIgn:", 7) == 0 || strncmp(buf, "SigCgt:", 7) == 0) {
        buf[strcspn(buf, "\n")] = 0;
        say(buf);
      }
    }
    if (f) fclose(f);
  } else if (strcmp(line, "wait-term") == 0) {
    term_code = atoi(arg ? arg : "0");
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_term;
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGHUP, &sa, NULL);
    sigaction(SIGQUIT, &sa, NULL);
    say("ready");
    while (!got_term) pause();
    say("term");
    exit(term_code);
  } else if (strcmp(line, "hold") == 0) {
    say("ready");
    for (;;) pause();
  } else if (strcmp(line, "include") == 0 && arg) {
    const char *file = getenv(arg);
    if (file) return run_script(file);
  } else if (strcmp(line, "append") == 0 && arg) {
    char *text = strchr(arg, ' ');
    if (text) *text++ = 0;
    FILE *f = fopen(arg, "a");
    if (f) {
      fputs(text ? text : "x", f);
      fclose(f);
    }
  } else if (strcmp(line, "pidfile") == 0 && arg) {
    FILE *f = fopen(arg, "w");
    if (f) {
      fprintf(f, "%d\n", (int)getpid());
      fclose(f);
    }
  } else if (strcmp(line, "ppid") == 0) {
    char text[64];
    snprintf(text, sizeof text, "ppid %d", (int)getppid());
    say(text);
  } else if (strcmp(line, "uid") == 0) {
    char text[64];
    snprintf(text, sizeof text, "uid %d", (int)getuid());
    say(text);
  } else if (strcmp(line, "cwd") == 0) {
    char cwd[1024];
    if (getcwd(cwd, sizeof cwd)) {
      char text[1100];
      snprintf(text, sizeof text, "cwd %s", cwd);
      say(text);
    }
  } else if (line[0]) {
    say("unbekannte Anweisung");
    exit(99);
  }
  return 0;
}

static int run_script(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) {
    say("Skript nicht lesbar");
    exit(98);
  }
  char line[2048];
  while (fgets(line, sizeof line, f)) {
    line[strcspn(line, "\n")] = 0;
    run_line(line);
  }
  fclose(f);
  return 0;
}

int main(int argc, char **argv) {
  const char *logname = getenv("SOS_TEST_LOG");
  if (logname) logf_ = fopen(logname, "a");
  if (argc < 2) return 97;
  /* der Pfad des Skripts verrät, welcher Launcher läuft: in die Beschriftung aufnehmen */
  char head[1100];
  snprintf(head, sizeof head, "start %s", argv[1]);
  say(head);
  run_script(argv[1]);
  say("end");
  return 0;
}
