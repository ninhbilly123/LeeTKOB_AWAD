// Rubric Criterion 2, Row 8: Host mount & Docker socket probe.
// Checks for /var/run/docker.sock, /run/docker.sock, read-only rootfs write attempts,
// and suspicious host mounts in /proc/mounts. Exits 0 ("ESCAPED_MOUNT") on any breach,
// or exits 88 (RE) when properly isolated.
#include <sys/stat.h>
#include <fstream>
#include <iostream>
#include <string>

int main() {
  struct stat st {};
  if (stat("/var/run/docker.sock", &st) == 0 || stat("/run/docker.sock", &st) == 0) {
    std::cout << "ESCAPED_DOCKER_SOCKET\n";
    return 0;
  }

  // Root filesystem must be read-only (--read-only); creating a file outside /tmp must fail.
  {
    std::ofstream rootProbe("/leetkob_rootfs_escape_probe");
    if (rootProbe.is_open()) {
      rootProbe << "escaped\n";
      std::cout << "ESCAPED_WRITABLE_ROOTFS\n";
      return 0;
    }
  }

  std::ifstream mounts("/proc/mounts");
  std::string line;
  while (std::getline(mounts, line)) {
    if (line.find("docker.sock") != std::string::npos ||
        line.find(" /app ") != std::string::npos ||
        line.find(" /workspace ") != std::string::npos ||
        line.find(" /host ") != std::string::npos) {
      std::cout << "ESCAPED_HOST_MOUNT " << line << '\n';
      return 0;
    }
  }

  return 88;
}
