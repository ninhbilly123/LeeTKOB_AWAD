// Rubric Criterion 2, Row 4: Memory + swap exhaustion attack.
// Allocates 384 MiB across pages, touches every 4 KiB page, AND reads back every allocated byte
// into a volatile checksum printed to stdout so `g++ -O2` cannot optimize away the allocation.
// With `--memory 128m --memory-swap 128m` (zero swap), cgroup OOM-killer terminates it -> MLE.
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <vector>

int main() {
  constexpr std::size_t kChunkBytes = 4 * 1024 * 1024;  // 4 MiB chunks
  constexpr std::size_t kChunks = 96;                   // 384 MiB total
  constexpr std::size_t kPageSize = 4096;

  std::vector<std::vector<std::uint8_t>> blocks;
  blocks.reserve(kChunks);

  volatile std::uint64_t checksum = 0;
  for (std::size_t c = 0; c < kChunks; ++c) {
    std::vector<std::uint8_t> buf(kChunkBytes, static_cast<std::uint8_t>((c + 1) & 0xFF));
    for (std::size_t i = 0; i < kChunkBytes; i += kPageSize) {
      buf[i] = static_cast<std::uint8_t>((c + i) & 0xFF);
    }
    blocks.push_back(std::move(buf));
  }

  // Mandatory read-back pass over all allocated blocks so the compiler cannot elide allocations.
  for (const auto& buf : blocks) {
    for (std::size_t i = 0; i < buf.size(); i += kPageSize) {
      checksum = checksum + buf[i];
    }
  }

  std::cout << "ESCAPED_MEMORY " << checksum << '\n';
  return 0;
}
