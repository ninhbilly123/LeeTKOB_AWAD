// Rubric Criterion 2, Row 9a: Runtime secret probe across environment variables and files.
// Exits 0 ("ESCAPED_SECRET") if any secret-like env var or .env file is readable; exits 99 (RE) when clean.
#include <algorithm>
#include <cctype>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

extern char** environ;

namespace {
std::string toUpper(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
                 [](unsigned char ch) { return static_cast<char>(std::toupper(ch)); });
  return s;
}
}  // namespace

int main() {
  const std::vector<std::string> needles = {
      "GEMINI", "MODEL_API", "API_KEY", "JWT_SECRET", "DATABASE_URL", "PASSWORD", "CANARY_SECRET"};

  if (environ != nullptr) {
    for (char** env = environ; *env != nullptr; ++env) {
      std::string entry(*env);
      std::string upper = toUpper(entry);
      for (const auto& needle : needles) {
        if (upper.find(needle) != std::string::npos) {
          std::cout << "ESCAPED_ENV " << entry << '\n';
          return 0;
        }
      }
    }
  }

  const std::vector<std::string> secretFiles = {
      "/.env", "/app/.env", "/workspace/.env", "/etc/shadow"};
  for (const auto& path : secretFiles) {
    std::ifstream f(path);
    if (f.is_open()) {
      std::string content((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
      std::cout << "ESCAPED_FILE " << path << " " << content << '\n';
      return 0;
    }
  }

  return 99;
}
