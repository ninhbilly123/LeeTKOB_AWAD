// Rubric Criterion 2, Row 2: CPU time exhaustion attack.
// Pure CPU burn loop; must be terminated by RLIMIT_CPU / CPU limit with verdict TLE.
#include <cstdint>
#include <iostream>

int main() {
  volatile std::uint64_t sink = 0;
  while (true) {
    sink = sink + 1;
  }
  std::cout << sink << '\n';
  return 0;
}
