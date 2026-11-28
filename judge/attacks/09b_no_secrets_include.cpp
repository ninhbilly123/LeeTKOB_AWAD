// Rubric Criterion 2, Row 9b: Compile-time #include secret probe.
// Compiling happens inside the isolated sandbox image, which contains no .env or host secrets.
// Must fail compilation (CE) with zero secret contents leaked in compile diagnostics.
#include "/app/.env"

int main() {
  return 0;
}
