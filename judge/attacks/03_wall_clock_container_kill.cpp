// Rubric Criterion 2, Row 3: Wall-clock attack that forks a sleeping child holding stdout open,
// while the parent exits immediately. The runner must kill the ENTIRE container (not just PID 1)
// at wallTimeSec so the submission yields TLE without hanging or leaking containers.
#include <sys/types.h>
#include <unistd.h>

int main() {
  pid_t child = fork();
  if (child == 0) {
    // Child holds stdout/stderr open and sleeps far beyond the wall-clock limit (uses ~0 CPU).
    sleep(60);
    _exit(0);
  }
  // Parent exits immediately to catch naive runners that only wait on or kill the parent process.
  _exit(0);
}
