# Git history secret scan

- Date: 2026-11-11.
- Tool: [Gitleaks v8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), Windows x64.
- The downloaded archive's SHA-256 was verified against the release checksums.
- Scope: all reachable local and fetched remote refs (`--log-opts=--all`).
- Result: exit code 0, no findings. The redacted JSON report is [gitleaks-history.json](gitleaks-history.json).

Reproduce from the repository root with Gitleaks installed:

```bash
gitleaks git --redact --no-banner --log-opts=--all --report-format=json --report-path=docs/evidence/gitleaks-history.json .
```

A clean scan means the configured detectors found no recognized secrets. It is not proof that every possible credential is absent. No model API key or real signing secret is required by the test suites; their JWT secret is generated at runtime.
