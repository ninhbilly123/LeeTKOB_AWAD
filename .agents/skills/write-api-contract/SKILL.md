---
name: write-api-contract
description: Write, update, or review LeeTKOB API contracts and their contract tests. Use for HTTP endpoint contracts, internal service payloads in docs/contract, or tests that verify those contracts.
---

# Write a LeeTKOB API contract

## Establish the expected behavior

1. Read [AGENTS.md](../../../AGENTS.md), the API, security, and testing sections of the [engineering rules](../../../docs/engineering-rules.md), and the existing contract for the surface. Read the applicable checkpoint rubric, including criteria 5 and 6 for PA#2. For product behavior, use the class brief first, then the [product owner FAQ](../../../docs/proposal/FAQ.md), then the proposal. Cite the applicable FAQ entries in the contract.
2. Check the route, guards, DTOs, serializers, consumers, and corresponding tests to establish current behavior and compatibility. Report drift between the documented contract and the implementation. Preserve the published contract unless an intentional change is approved. If role, ownership, error precedence, or another caller-visible decision is unresolved and cannot be derived from the sources, ask the owner.
3. Follow the Tier 2 rules in AGENTS.md before changing a contract, database schema, dependency, or CI workflow. An explicit request can already authorize a change within its scope. Write the contract before implementation and record the reason for any intentional change.

## Write the HTTP endpoint contract

Place the contract in `docs/contract/<endpoint>.md`. Use the five sections of the CSC13114 IA#3 `CONTRACT.md` as the outline. Use LeeTKOB paths, identifiers, field units, and error types throughout.

| Section | What to specify |
| --- | --- |
| **1. Conventions** | Media types, ID/time/unit conventions and how unknown fields are handled. Define authentication, allowed roles, class or resource ownership, and visibility by role and resource state. |
| **2. Errors** | List every reachable error with its exact problem `type` URI, HTTP status, title, triggering condition, and response extensions when applicable. Provide a safe example using `application/problem+json` with `type`, `title`, `status`, `detail`, and `instance` as required by LeeTKOB. Specify how validation reports individual fields. Clients branch on `type`; internal errors expose a safe message. |
| **3. Resources** | Define public response objects with a JSON example and field rules for types, units, optionality, nullability, enums, and invariants. Describe omitted fields per role or state. Keep database columns and unpublished checker data out of student responses. |
| **4. Endpoints** | Give the exact method/path, path/query parameters, headers, request shape, field limits/defaults, and success status/headers/body. Describe validation order when it changes the result, empty and boundary behavior, and what the server persists or leaves unchanged on failure. Add pagination or idempotency as applicable below. |
| **5. Versions and the legacy API** | Explain compatible additions, what counts as breaking, and the version or migration path. When retiring a real legacy route, document preserved behavior, deprecation and sunset, and the successor link. |

- **Authorization.** Use the status pinned by the endpoint contract. Document the difference between unauthenticated, forbidden, and missing or concealed resources. For example, the [submission contract](../../../docs/contract/post-submissions.md) explicitly uses `403` for a student outside the lab's class.
- **Lists.** Specify an opaque cursor, stable unique sort order, default and maximum page size, cursor scope across filters, invalid cursor behavior, and `nextCursor` semantics. State the behavior when records change between pages.
- **Writes.** For applicable creates, mutations, or publish actions, specify the key format and scope, fingerprint, retention, replayed status/body/headers, mismatched and simultaneous requests, and whether failures are cached. Persist the key and successful write in one transaction with a uniqueness constraint. Match the endpoint's own contract. The IA#3 menu service's replay headers and conflict statuses are examples specific to that API.

For an internal message or schema, use the producer/consumer boundary instead of the HTTP outline. Specify field types and visibility, validation and fallback behavior, compatibility, and retry/duplicate semantics where applicable. Use [checker-output.md](../../../docs/contract/checker-output.md) as the LeeTKOB reference for checker verdicts, evidence, and `unsureReason`.

## Derive contract tests from the spec

1. Map each stated behavior or numbered acceptance criterion to an observable test. Land the test before or in the same commit as the implementation. Use [the submission suite](../../../gateway/test/submissions.contract.spec.ts) for the HTTP test pattern and [the boundary suite](../../../gateway/test/submission-boundaries.contract.spec.ts) for signed credentials, concurrency, and TTL examples.
2. For Gateway endpoints, use Jest and Supertest through the configured Nest app so routing, guards, validation, and error filters run. Use signed fixture credentials and deterministic data. For internal contracts, test representative producer payloads against the consumer, including invalid payloads and the documented fallback. Use a fake model for offline checker tests.
3. Assert the success status, relevant headers and body fields, and any documented omissions. For every error type, assert the HTTP status, problem media type, exact `type`, required members and documented extensions. Cover wrong role and cross-user or cross-class access. After a refused write, check the target state and other relevant records or jobs for side effects.
4. For a paginated list, exercise an empty page, the last page, invalid cursors and limits, and traversal across multiple pages with tied sort values. For idempotent writes, verify unchanged replay, changed-payload rejection, principal scoping, simultaneous retries, and expiry as applicable. Assert both the client response and the number of persisted writes. Use PostgreSQL for assertions that depend on its constraints or transactions and report separately what in-memory tests cover.
5. Run the focused suite, then the canonical [README](../../../README.md) commands and confirm the tests are included in CI through `npm run test`. Record actual results and gaps. When PA#2 evidence is requested, link a CI run where an isolated, deliberate contract violation made the existing test fail. Keep assertions and fixtures aligned with the approved spec.
