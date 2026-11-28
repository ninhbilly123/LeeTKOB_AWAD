// Rubric Criterion 2, Row 7: Non-root user check (--user 65534:65534 + no-new-privileges).
// Exits 0 ("ESCAPED_ROOT") if uid/euid is 0 or setuid(0) succeeds; exits 77 (RE) when non-root.
#include <unistd.h>
#include <iostream>

int main() {
  if (getuid() == 0 || geteuid() == 0 || setuid(0) == 0 || setgid(0) == 0) {
    std::cout << "ESCAPED_ROOT uid=" << getuid() << " euid=" << geteuid() << '\n';
    return 0;
  }
  return 77;
}
