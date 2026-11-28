// Rubric Criterion 2, Row 1: Network egress attack (--network none must block all outbound sockets).
// Reads optional "<ip> <port>" canary target from stdin and also probes 1.1.1.1:53.
// Exits 0 ("ESCAPED_NETWORK") if any TCP connect succeeds; exits 11 (RE) when blocked as required.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>
#include <cstring>
#include <iostream>
#include <string>

namespace {
bool tryConnect(const std::string& ip, int port) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    return false;
  }
  timeval tv{};
  tv.tv_sec = 2;
  tv.tv_usec = 0;
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(static_cast<uint16_t>(port));
  if (inet_pton(AF_INET, ip.c_str(), &addr.sin_addr) != 1) {
    close(fd);
    return false;
  }
  int rc = connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
  close(fd);
  return rc == 0;
}
}  // namespace

int main() {
  std::string targetIp;
  int targetPort = 0;
  if (std::cin >> targetIp >> targetPort) {
    if (tryConnect(targetIp, targetPort)) {
      std::cout << "ESCAPED_NETWORK_CANARY\n";
      return 0;
    }
  }
  if (tryConnect("1.1.1.1", 53)) {
    std::cout << "ESCAPED_NETWORK_PUBLIC\n";
    return 0;
  }
  return 11;
}
