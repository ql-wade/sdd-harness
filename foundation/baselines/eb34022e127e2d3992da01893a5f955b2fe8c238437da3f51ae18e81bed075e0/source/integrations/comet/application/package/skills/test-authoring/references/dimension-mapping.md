# Planned coverage → independent acceptance dimensions

TestPack uses fixed Journey-A…J keys to avoid Debug/Journey letter collision. Whitebox owns acceptance contract; read its current main contract before exporting strict schema-3 obligations. This table describes planned tests, never dimension PASS.

| Journey key | Meaning | Typical author output | Debug mapping when applicable |
|---|---|---|---|
| A | Business/rules | Boundary, decision/state, terminal business assertions | A |
| B | Browser behavior | Actual actions/DOM/navigation/reload, required console/network observations | B |
| C | Accessibility/UX | Keyboard/focus, semantics, loading/error/empty, viewport cases | C |
| D | Persistence/data | Write/readback, transactions, cache, migration data checks | F plus D integration |
| E | Permission/privacy | Allow/deny identities, tenant boundary, prohibited side effects | E |
| F | Cross-boundary contracts | Consumer/provider, message, mandatory Journey edges | D |
| G | Concurrency/delivery | Duplicate, ordering, race, idempotency/backpressure cases | H |
| H | Recovery/compensation | Timeout/retry exhaustion/cancel/restart/recovery terminal cases | Domain-specific D/F/H |
| I | Compatibility/config/deploy | Version/schema/flags/rollout/rollback tests | Domain-specific |
| J | CI/regression/runner | Relevant regression, isolation, lint/typechecks, flake controls | No direct letter equivalence |

Performance has its own semantic tag/SLO (Debug-G). Do not rename Journey-G to arbitrary general performance; map applicable numeric capacity/concurrency/recovery bounds into the exact frozen contract. Observability probes are not themselves business terminal authority.

Assess A/E/J every time, but assessed does not mean every one required. For a pure numeric function, B/C may be N/A based on source showing no UI. For state/persistence writes D is required; cross-service F, asynchronous recovery H, compatibility changes I and concurrency G follow inspected scope. “Not requested/no time” is not evidence for N/A. A required design row blocked by an unresolved requirement remains required with that requirement basis link, not fake N/A.

Per dimension list why, source basis IDs and case IDs. Cases point back to dimensions; validator checks exact bidirectional membership. Technique coverage (e.g. boundaries) and architectural dimensions answer different questions: both are recorded, neither proves executed acceptance.
