# Final Verification and Evidence Grill

## Trigger and order

Final verification is an automatic, required continuation of this skill's plan.
Do not finish the execution response at "implementation complete" or ask whether to
run verification. All implementation/review results must be integrated and workers
reconciled before final verification. Record final HEAD (or content manifest), repository, branch,
worktree, stack/environment, base URL, model/provider where applicable, session/run
ID and timestamps. Keep the root goal active in VERIFYING until reports pass.

1. Revalidate locked inputs and acceptance coverage. Read actual implementation,
   test outputs and task records; checkboxes alone are insufficient. Reconcile the
   canonical progress source, including any tasks.md status summary, remaining waves,
   completion count, ledger and report baseline. STATUS_DIVERGENCE blocks a final
   PASS even if a report or commit message says all tasks are complete.
2. Discover and load `whitebox-verify` on the executing host. Use the frozen
   Slice/Journey mode, exact change ID and acceptance/check mapping. For UI paths
   read its browser-execution reference and use the user's requested/native harness.
   Debug is diagnosis only. Keep original Whitebox report, ledger and raw evidence.
3. Run Whitebox's validator AND inspect actual commands, RED/GREEN, terminal
   readback, source/build identity and required UI evidence. STRUCTURE_PASS is only
   structural closure. Missing capability, UNVERIFIED, EVIDENCE_UNSTABLE, required
   skipped/retried checks or missing evidence leave acceptance incomplete. There is
   no mandatory Trinity dependency; do not silently fall back to it. If Whitebox is
   unavailable report WHITEBOX_UNAVAILABLE and an unmet gate. Honor any additional
   user-required verification without replacing Whitebox.
4. Execute every planned required check on the final baseline; collect and inspect
   data, screenshots and logs. Run independent `architecture-grill` if available;
   otherwise apply the evidence review below and disclose self-review if applicable.
5. Publish `verification-report.md`, `grill-report.md` and
   `verification-results.json` under the plan root. Deliver links and unresolved
   items before completing the goal and stopping the schedule.

## The plan's evidence requirements control final acceptance

Keep build/static checks and endpoint reachability separate from business E2E. A 401/403/500 response, HTTP 200,
Mock result, screenshot, generated artifact or worker final message alone is not
business completion. Tests, CI, local browser, real provider and deployment are
separate rows. Do not claim deployment or production acceptance from local evidence.

Each check records `id`, acceptance IDs, task IDs, command/procedure, expected and
observed behavior, status, environment/baseline identity, start/end time, exit code,
evidence paths with hashes and reviewer finding. Status is exactly
`PASS | FAIL | NOT-EXERCISED | NOT-APPLICABLE`. A timeout or missing environment is
NOT-EXERCISED or FAIL as supported by observations, never PASS. A not-applicable
case requires a reason agreed in the plan, not a retroactive way to skip a gate.

Every required executable check retains its command log, including exit status
and observed output; inability to capture it leaves the check unverified.

For every required evidence kind:

- **Data:** inspect the real payload, persisted state, query or test assertion
  output. Record query/command, expected-versus-actual values and provenance.
- **Screenshots:** for UI paths capture relevant before/after/error states where
  applicable and visually inspect actual images. Record URL, action, viewport,
  timestamp and session identity. A screenshot file's existence is insufficient.
- **Logs:** inspect command/service/browser/trace logs, including relevant failures,
  correlated by run/session/request ID and time. Follow the call chain through
  state persistence and terminal outcome; absence of errors alone is insufficient.

Use one evidence bundle per baseline/run. Never join another worktree's screenshot
with current logs or treat old passing evidence as current. Preserve original raw
evidence locally with appropriate access; redact secrets and personal data from
reports/shared copies. Missing or contradictory data/screenshot/log evidence is an
explicit finding. For a CLI-only task screenshots may be NOT-APPLICABLE; tests and
logs still prove the required behavior. Do not manufacture screenshots or logs.

## Original acceptance, repair and final evidence

Keep separate immutable records for original acceptance, fix/retest, and final
verification. Link each record to its task/check IDs, findings, tested commit or
artifact digest, environment and run/session ID, timestamps, commands and raw
artifacts. Never overwrite an original failure with a later PASS.

For every original P0/P1, require an explicit closure chain:
`finding ID -> fix commit -> retest check/run -> observed result -> final baseline`.
For example, an original T10 run with "9/9" plus P0-1/P0-2/P0-3 remains historical
acceptance evidence with those findings. A later P0FIX "9/9" can close them only
when its actual checks and data/log/screenshot evidence demonstrate those fixes.
It is not automatically evidence for the final HEAD or deployed production path.

Compare the retest's implementation/configuration/artifact baseline with the final
one. Rerun affected checks when relevant code/config changes or the mapping cannot
be proved. If only report/progress files were committed after the tested SHA, retain
that tested SHA and record the inspected diff proving implementation equivalence;
do not relabel old logs as a run on the newer commit. Keep local/mock/real-provider/
deployed evidence separate; a local retest alone cannot close a production-only gate.

## Reports and completion gate

Verification report:

| Acceptance/check | Expected | Observed | Status | Baseline/run | Data | Screenshots | Logs |
| --- | --- | --- | --- | --- | --- | --- | --- |

Also include raw Whitebox verdict versus the plan-level verdict, commands/exit codes,
coverage counts, remaining checks, owner and next action. Structured JSON contains
`run_id`, `baseline`, `whitebox_status`, `checks`, `findings`, `overall_status` and
`unverified_items`. Explain not-applicable kinds inside each check.

Grill report maps claims → source call chain → data → screenshot → logs → conclusion.
Give findings P0–P3, exact locations, reproduction/impact and smallest fix. Distinguish
code proof, mock-only proof, observed runtime proof and unavailable evidence.
Do not change implementation during read-only Grill; route repairs through the
original implementer, re-integrate, then rerun affected checks and final gates on
that new revision. Three repeated failures of one cause trigger diagnosis/escalation,
not an indefinite repair loop or a weakened acceptance criterion.

Before the final COMPLETE claim, the controller must persist and read back the
final progress snapshot: all required tasks accepted, no remaining required waves,
no unresolved blockers/P0/P1, and counts/baseline consistent across tasks.md,
execution state and final reports. A divergence remains a release-blocking finding;
correct it from evidence before completion, never merely from report wording.

Only declare COMPLETE when this state-consistency check and the required Whitebox
gate are satisfied, all required checks PASS, required evidence is inspected
and consistent on the final baseline, workers are terminal, and no blocking finding
remains. FAIL / NOT-EXERCISED / unresolved P0/P1 keeps the objective incomplete.
Report finite blockers honestly, retaining host-specific goal status rules. For OpenSpec, ACCEPTED is followed by the controller closeout in
[openspec-closeout.md](openspec-closeout.md): consistency preflight, archive, post-audit.
Do not call an OpenSpec lifecycle objective COMPLETE while closeout is pending.
After report delivery and completion of the authorized closeout scope, close the
verified goal and clean up its monitor as described in the automation reference; record any cleanup failure as a remaining operation.
