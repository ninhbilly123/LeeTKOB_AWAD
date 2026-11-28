// Rubric Criterion 2, Row 5: Process/thread fork-bomb attack (--pids-limit 16 must cap spawning).
// Attempts to spawn 64 concurrent child processes. Exits 0 ("ESCAPED_PIDS") if all 64 succeed;
// kills spawned children and exits 55 (RE) as soon as fork() is rejected by cgroup pids.max.
#include <signal.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <iostream>
#include <vector>

int main() {
  std::vector<pid_t> children;
  children.reserve(64);
  bool blocked = false;

  for (int i = 0; i < 64; ++i) {
    pid_t pid = fork();
    if (pid < 0) {
      blocked = true;
      break;
    }
    if (pid == 0) {
      pause();
      _exit(0);
    }
    children.push_back(pid);
  }

  for (pid_t pid : children) {
    kill(pid, SIGKILL);
    waitpid(pid, nullptr, 0);
  }

  if (blocked) {
    return 55;
  }
  std::cout << "ESCAPED_PIDS " << children.size() << '\n';
  return 0;
}
