// Rubric Criterion 2, Row 6: Output flood attack (must be stopped at 1 MiB output cap -> RE).
#include <cstdio>
#include <cstring>

int main() {
  char buf[4096];
  std::memset(buf, 'A', sizeof(buf));
  // Attempt to write 16 MiB (16x the 1 MiB FAQ-05 limit).
  for (int i = 0; i < 4096; ++i) {
    if (std::fwrite(buf, 1, sizeof(buf), stdout) != sizeof(buf)) {
      return 66;
    }
  }
  std::fflush(stdout);
  return 0;
}
