# SDD Harness E2E release gates

SDD Harness uses three different gates. A lower tier never substitutes for a
higher tier.

| Gate | Command | Required cadence | Pass evidence |
|---|---|---|---|
| Core E2E | `npm run test:e2e:core` | every PR | real CLI completes all nine stages in an isolated fixture |
| Claude Reference Adapter E2E | `npm run test:e2e:claude` | main-branch merge | freshly installed commands, skills and hooks preserve CLI-owned state |
| Live Integration E2E | prepare/record/finalize commands below | nightly and before release | final report passes `npm run test:e2e:live:report -- --report <path>` |

Codex/OpenCode remain preview. Their non-blocking parity smoke test is
`npm run test:adapter:preview` and must not be presented as reference-adapter
parity.

## Live Integration phases

Prepare a read-only fixture copy:

```bash
npm run test:e2e:live -- \
  --prepare-only \
  --fixture /absolute/path/to/approved/project \
  --output reports/live-e2e
```

Run every real external command through the recorder. It writes the exact
command, exit code, timeout/signal state, output file and SHA-256 to the ledger:

```bash
npm run test:e2e:live -- \
  --record \
  --workspace /tmp/sdd-live-e2e-XXXXXX \
  --ledger /tmp/sdd-live-e2e-XXXXXX/.sdd-live-ledger.json \
  --id project-tests \
  --timeout-ms 120000 \
  -- npm test
```

Required capability receipt ids are `spec-engine`, `agent-host`,
`knowledge-base`, `code-graph`, `project-tests`, `architecture-review`,
`line-review`, `browser`, and `deploy`. A failed, timed-out, missing, or unverifiable receipt fails the final
gate. `not-applicable` is accepted only with a concrete reason recorded by the
approved live driver.

```bash
npm run test:e2e:live -- \
  --record-status \
  --workspace /tmp/sdd-live-e2e-XXXXXX \
  --ledger /tmp/sdd-live-e2e-XXXXXX/.sdd-live-ledger.json \
  --id deploy \
  --status not-applicable \
  --reason "isolated validation has no production deploy target"
```

`--record-status` cannot create a `passed` receipt; only the command recorder
can do that.

The recorder treats exit code zero as command success; it does not infer a
tool-specific semantic verdict from prose. A driver MUST therefore wrap review,
audit, or policy tools so that `NEEDS-FIX`, rejected, or otherwise failing
verdicts exit non-zero. The finalizer only accepts the wrapper's runner-backed
receipt and output hash; a textual `READY` claim on its own is not evidence.

Finalize after the CLI workflow has reached `archive` with
`run_status: completed`:

```bash
npm run test:e2e:live -- \
  --finalize \
  --prepare-report reports/live-e2e/live-e2e-<timestamp>.json \
  --workspace /tmp/sdd-live-e2e-XXXXXX \
  --change <change-id> \
  --ledger /tmp/sdd-live-e2e-XXXXXX/.sdd-live-ledger.json \
  --output reports/live-e2e

npm run test:e2e:live:report -- \
  --report reports/live-e2e/live-e2e-final-<timestamp>.json
```

The release command exits non-zero unless the complete nine-stage trace,
capability receipts and unchanged source-fixture hash are all proven. External
tool absence or an agent-written Markdown claim cannot turn the gate green.
Runner paths are canonicalized through the nearest existing ancestor before
containment checks, so platform aliases such as macOS `/var` and
`/private/var` identify the same isolated workspace without weakening the
workspace-boundary check.

## Nightly driver contract

`.github/workflows/live-integration.yml` runs only on a self-hosted runner with
the `sdd-live` label. It requires two runner variables:

- `SDD_LIVE_FIXTURE`: approved read-only project path.
- `SDD_LIVE_DRIVER`: executable environment-specific adapter driver.

The nightly orchestrator invokes the driver with `--prepare-report`,
`--workspace`, `--output`, and `--harness`. The driver must execute real tools
through `live-e2e.js --record`, then print a final JSON line containing absolute
`change` and `ledger` values. The repository-owned orchestrator performs
finalization and the release assertion itself, so a driver cannot turn a failed
receipt into a green report by merely printing `pass: true`.

Missing variables, a missing driver, driver timeout, a red final report, or a
missing artifact all fail the nightly workflow. A release workflow can reuse
the same gate through `workflow_call`.
