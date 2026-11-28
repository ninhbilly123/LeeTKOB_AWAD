// Sanity check: valid C++17 program must compile and pass (AC) inside the hardened sandbox.
#include <iostream>

int main() {
  long long a = 0;
  long long b = 0;
  if (std::cin >> a >> b) {
    std::cout << (a + b) << '\n';
  }
  return 0;
}
