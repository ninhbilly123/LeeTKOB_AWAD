/*
 * Minimal zero-mount C++17 sandbox entrypoint compiled into leetkob-cpp-sandbox:pa3.
 *
 * Modes:
 *   sandbox-exec compile
 *     Reads C++17 source from stdin -> writes /tmp/solution.cpp -> runs
 *     `g++ -std=c++17 -O2 /tmp/solution.cpp -o /tmp/solution` -> streams ELF binary to stdout.
 *
 *   sandbox-exec run <cpu_time_sec> <output_limit_bytes>
 *     Reads framed stdin: "<binary_len>\n<binary_bytes><program_stdin>"
 *     Writes /tmp/solution (0700) and /tmp/input.txt, sets RLIMIT_CPU / RLIMIT_FSIZE / RLIMIT_CORE,
 *     forks the student binary, and waits for ALL descendants so orphan sleeping children keep the
 *     container alive until the runner's wall-clock `docker rm -f` kills the entire container.
 */
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define MAX_SOURCE_BYTES (128 * 1024)
#define MAX_BINARY_BYTES (32 * 1024 * 1024)
#define MAX_INPUT_BYTES (16 * 1024 * 1024)
#define IO_BUF_SIZE 8192

static int write_all(int fd, const unsigned char* buf, size_t len) {
  size_t written = 0;
  while (written < len) {
    ssize_t n = write(fd, buf + written, len - written);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    written += (size_t)n;
  }
  return 0;
}

static int copy_fd_bounded(int in_fd, int out_fd, size_t max_bytes) {
  unsigned char buf[IO_BUF_SIZE];
  size_t total = 0;
  for (;;) {
    ssize_t n = read(in_fd, buf, sizeof(buf));
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    if (n == 0) {
      return 0;
    }
    total += (size_t)n;
    if (total > max_bytes) {
      return -2;
    }
    if (write_all(out_fd, buf, (size_t)n) != 0) {
      return -1;
    }
  }
}

static int copy_exact_bytes(int in_fd, int out_fd, size_t exact_bytes) {
  unsigned char buf[IO_BUF_SIZE];
  size_t remaining = exact_bytes;
  while (remaining > 0) {
    size_t want = remaining < sizeof(buf) ? remaining : sizeof(buf);
    ssize_t n = read(in_fd, buf, want);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    if (n == 0) {
      return -2;  /* unexpected EOF */
    }
    if (write_all(out_fd, buf, (size_t)n) != 0) {
      return -1;
    }
    remaining -= (size_t)n;
  }
  return 0;
}

static int read_header_size(int in_fd, size_t* out_size) {
  char line[64];
  size_t idx = 0;
  while (idx < sizeof(line) - 1) {
    char ch = 0;
    ssize_t n = read(in_fd, &ch, 1);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    if (n == 0) {
      return -1;
    }
    if (ch == '\n') {
      break;
    }
    line[idx++] = ch;
  }
  line[idx] = '\0';
  if (idx == 0) {
    return -1;
  }
  char* endptr = NULL;
  unsigned long long val = strtoull(line, &endptr, 10);
  if (endptr == line || *endptr != '\0' || val == 0 || val > MAX_BINARY_BYTES) {
    return -1;
  }
  *out_size = (size_t)val;
  return 0;
}

static int mode_compile(void) {
  setenv("TMPDIR", "/tmp", 1);
  int src_fd = open("/tmp/solution.cpp", O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (src_fd < 0) {
    perror("open /tmp/solution.cpp");
    return 2;
  }
  int rc = copy_fd_bounded(STDIN_FILENO, src_fd, MAX_SOURCE_BYTES);
  close(src_fd);
  if (rc != 0) {
    fprintf(stderr, "Failed to read source code into sandbox.\n");
    return 2;
  }

  pid_t pid = fork();
  if (pid < 0) {
    perror("fork g++");
    return 2;
  }
  if (pid == 0) {
    /* Redirect compiler stdout to stderr so stdout carries ONLY the compiled binary bytes. */
    dup2(STDERR_FILENO, STDOUT_FILENO);
    char* const args[] = {
        "g++", "-std=c++17", "-O2", "/tmp/solution.cpp", "-o", "/tmp/solution", NULL,
    };
    execvp("g++", args);
    perror("execvp g++");
    _exit(127);
  }

  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) {
      return 2;
    }
  }
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    if (WIFEXITED(status)) {
      return WEXITSTATUS(status);
    }
    if (WIFSIGNALED(status)) {
      return 128 + WTERMSIG(status);
    }
    return 1;
  }

  int bin_fd = open("/tmp/solution", O_RDONLY);
  if (bin_fd < 0) {
    perror("open /tmp/solution");
    return 2;
  }
  rc = copy_fd_bounded(bin_fd, STDOUT_FILENO, MAX_BINARY_BYTES);
  close(bin_fd);
  return rc == 0 ? 0 : 2;
}

static int mode_run(unsigned long cpu_sec, unsigned long output_limit_bytes) {
  size_t bin_size = 0;
  if (read_header_size(STDIN_FILENO, &bin_size) != 0) {
    fprintf(stderr, "Invalid sandbox binary header.\n");
    return 2;
  }

  int bin_fd = open("/tmp/solution", O_WRONLY | O_CREAT | O_TRUNC, 0700);
  if (bin_fd < 0) {
    perror("open /tmp/solution");
    return 2;
  }
  if (copy_exact_bytes(STDIN_FILENO, bin_fd, bin_size) != 0) {
    close(bin_fd);
    fprintf(stderr, "Failed to stream binary into sandbox.\n");
    return 2;
  }
  if (fchmod(bin_fd, 0700) != 0) {
    close(bin_fd);
    perror("fchmod /tmp/solution");
    return 2;
  }
  close(bin_fd);

  int in_fd = open("/tmp/input.txt", O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (in_fd < 0) {
    perror("open /tmp/input.txt");
    return 2;
  }
  if (copy_fd_bounded(STDIN_FILENO, in_fd, MAX_INPUT_BYTES) != 0) {
    close(in_fd);
    fprintf(stderr, "Failed to stream test input into sandbox.\n");
    return 2;
  }
  close(in_fd);

  pid_t child = fork();
  if (child < 0) {
    perror("fork solution");
    return 2;
  }

  if (child == 0) {
    int rd_fd = open("/tmp/input.txt", O_RDONLY);
    if (rd_fd < 0) {
      _exit(126);
    }
    dup2(rd_fd, STDIN_FILENO);
    close(rd_fd);
    unlink("/tmp/input.txt");

    struct rlimit cpu_lim;
    cpu_lim.rlim_cur = (rlim_t)cpu_sec;
    cpu_lim.rlim_max = (rlim_t)(cpu_sec + 1);
    setrlimit(RLIMIT_CPU, &cpu_lim);

    struct rlimit core_lim;
    core_lim.rlim_cur = 0;
    core_lim.rlim_max = 0;
    setrlimit(RLIMIT_CORE, &core_lim);

    struct rlimit fsize_lim;
    fsize_lim.rlim_cur = (rlim_t)(output_limit_bytes + 4096);
    fsize_lim.rlim_max = (rlim_t)(output_limit_bytes + 4096);
    setrlimit(RLIMIT_FSIZE, &fsize_lim);

    char* const run_argv[] = {"/tmp/solution", NULL};
    char* const clean_env[] = {
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "HOME=/tmp",
        NULL,
    };
    execve("/tmp/solution", run_argv, clean_env);
    _exit(127);
  }

  /* Wait for the primary child AND any reparented descendants (proving wall-clock container kill). */
  int main_status = 0;
  int have_main = 0;
  for (;;) {
    int st = 0;
    pid_t done = waitpid(-1, &st, 0);
    if (done < 0) {
      if (errno == EINTR) {
        continue;
      }
      if (errno == ECHILD) {
        break;
      }
      break;
    }
    if (done == child) {
      main_status = st;
      have_main = 1;
    }
  }

  if (!have_main) {
    return 1;
  }
  if (WIFEXITED(main_status)) {
    return WEXITSTATUS(main_status);
  }
  if (WIFSIGNALED(main_status)) {
    return 128 + WTERMSIG(main_status);
  }
  return 1;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "Usage: sandbox-exec <compile|run <cpu_sec> <output_limit_bytes>>\n");
    return 2;
  }
  if (strcmp(argv[1], "compile") == 0) {
    return mode_compile();
  }
  if (strcmp(argv[1], "run") == 0 && argc >= 4) {
    unsigned long cpu_sec = strtoul(argv[2], NULL, 10);
    unsigned long output_limit = strtoul(argv[3], NULL, 10);
    if (cpu_sec == 0) {
      cpu_sec = 1;
    }
    if (output_limit < 1024) {
      output_limit = 1048576;
    }
    return mode_run(cpu_sec, output_limit);
  }
  fprintf(stderr, "Unknown sandbox-exec arguments.\n");
  return 2;
}
