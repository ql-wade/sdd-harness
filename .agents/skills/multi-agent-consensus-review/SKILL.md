---
name: multi-agent-consensus-review
description: Run a read-only architecture, code, or general review across Claude Code, zcode, and Codex Agent with independent scoring, a hard unanimous-consensus gate, and evidence-based debate when any participant disagrees. Use when a review must not pass by majority vote, average score, or initiator override, and must end with a defensible conclusion plus an executable next-step plan.
---

# Multi-Agent Consensus Review

## Contract

Run a review as a three-party decision process:

1. The initiator declares the review type, scope, artifact, participants, and decision rules.
2. Every required Agent performs an independent, cold-start review and submits a structured ballot.
3. Pass only when every required participant votes `APPROVE`, meets the score thresholds, cites the same artifact revision, and has no blocking finding.
4. If any participant rejects, abstains, is missing, scores below threshold, or raises a blocker, mark `DEBATE_REQUIRED`; never pass by majority, average, or initiator override.
5. The initiator organizes bounded evidence-based debate rounds. Re-ballot after each round. Stop only at unanimous approval or an explicit blocked outcome.
6. Publish a conclusion and next-step plan only for a passed review. For an unresolved review, publish a blocked report and the exact evidence or decision still required.

The default quorum is `claude-code`, `zcode`, and `codex-agent`. A missing executable is a blocked review, not permission to reduce quorum or silently substitute another Agent.

## Use this skill for

- architecture reviews and design/SDD gates;
- code reviews, pull-request reviews, and change-readiness checks;
- cross-Agent decisions where the initiator must obtain unanimous agreement;
- adversarial refinement of a proposed design or implementation plan;
- reviews that must preserve independent scores, evidence, dissent, and decision history.

Do not use this skill to make edits while reviewing. Keep all Agents read-only; let the final plan describe changes for a separate implementation task unless the user explicitly requests implementation.

## Required inputs

Collect or infer these values before dispatching reviewers:

```text
Review type: architecture | code | general
Initiator: claude-code | zcode | codex-agent
Participants: claude-code,zcode,codex-agent
Artifact: file, directory, PR, diff, or design document
Scope: files, modules, interfaces, and exclusions
Decision: what “approved” authorizes
Max debate rounds: 3 (default; use 1–5)
Score thresholds: overall >= 8.0/10; every criterion >= 7.0/10
```

If the artifact, scope, decision, or initiator is unclear, ask for it before starting. Preserve the participant list exactly as supplied; do not remove a participant because its CLI is inconvenient.

## Workflow

### 0. Prepare an immutable review run

Create a unique run directory outside the artifact being reviewed. Record the artifact digest before dispatching any Agent:

```bash
SKILL_ROOT="/path/to/multi-agent-consensus-review"
RUN_DIR="review-runs/<review-id>"

python3 "$SKILL_ROOT/scripts/probe_agents.py"
python3 "$SKILL_ROOT/scripts/review_gate.py" init \
  --run-dir "$RUN_DIR" \
  --review-type architecture \
  --initiator codex-agent \
  --participants claude-code,zcode,codex-agent \
  --artifact /path/to/reviewed/artifact \
  --scope "public API and persistence boundary" \
  --max-rounds 3
```

The initializer stores the artifact digest, required criteria, quorum, thresholds, and review ID in `manifest.json`. Every ballot must reference that exact review ID, round, and digest. Read `references/agent-adapters.md` before launching external CLIs.

If `probe_agents.py` reports a missing required executable, stop with `BLOCKED` and list the installation or configuration needed. Do not start a two-Agent review while claiming a three-Agent quorum.

### 1. Dispatch independent first-pass reviews

Dispatch one fresh process per participant, preferably in parallel. Give every Agent the same task, artifact, scope, decision rule, rubric, review ID, round number, and ballot schema. Do not share another Agent’s ballot, score, or findings before all first-pass ballots are written.

Require each Agent to:

- inspect the artifact and cite concrete evidence (`path:line`, diff hunk, test, trace, or document section);
- identify blockers, major risks, minor issues, assumptions, and missing evidence;
- score every required criterion from 0 to 10 and provide an overall score;
- return exactly one JSON ballot matching `references/ballot.schema.json`;
- avoid editing the artifact or making claims without evidence.

Store ballots as `round-00/ballot-<agent-id>.json`, then run:

```bash
python3 "$SKILL_ROOT/scripts/review_gate.py" tally \
  --manifest "$RUN_DIR/manifest.json" \
  --round-dir "$RUN_DIR/round-00"
```

### 2. Apply the hard consensus gate

The `tally` command is authoritative. A review is `PASSED` only if all of the following are true:

- every required participant submitted exactly one valid ballot;
- every ballot references the same artifact digest and review ID;
- every verdict is `APPROVE`;
- every overall score is at least 8.0/10 by default;
- every required criterion score is at least 7.0/10 by default;
- no ballot contains a `blocking: true` finding;
- no ballot is invalid, missing, stale, or ambiguous.

Non-blocking notes may remain in a passed review, but they must appear in the next-step plan with an owner and verification method. A high average cannot compensate for one dissenting Agent or one failed criterion.

### 3. Organize debate on disagreement

When the tally is `DEBATE_REQUIRED`, the initiator opens `debate/round-<n>.md` and includes:

1. the exact disputed claims and evidence;
2. the affected criterion and score delta;
3. the impact classification: `BLOCKER`, `MAJOR`, or `MINOR`;
4. the question that would resolve the disagreement;
5. the proposed evidence, experiment, design change, or user decision needed.

Use the autoresearch refinement pattern without importing its bias:

- keep the first-pass ballots immutable;
- have each dissenting Agent state the strongest version of its objection;
- ask the initiator to produce a concrete resolution candidate, not a rhetorical compromise;
- ask every participant to independently attack that candidate and then re-score it;
- record whether each objection was `RESOLVED`, `INVALIDATED`, or `REMAINS_OPEN`, with evidence;
- never let the initiator mark its own objection resolved without another Agent’s agreement.

Do not debate style. Debate correctness, requirements, risks, security, operability, testability, and the exact evidence needed to change a score. Do not use “agree to disagree” as a pass state.

After each debate round, create a new ballot directory (`round-01`, `round-02`, …) and re-run `tally`. Keep the previous ballots and tally files unchanged. Stop when the run passes or reaches `max-rounds`; at the limit, mark it `BLOCKED` and surface unresolved dissent.

### 3a. Apply the Ralph Loop

Use the Ralph Loop as the outer controller for repeated review rounds, not as a license to repeat an unbounded prompt:

- start a fresh process for every Agent on every round;
- persist continuity in `manifest.json`, round ballots, `tally.json`, debate logs, and `ralph-state.json`, not in chat history;
- feed only the current artifact, unresolved findings, previous tally, and the round objective into the next prompt;
- let a mechanical verifier decide completion; never let an Agent self-declare consensus;
- set a finite `max-rounds` (default 3, hard maximum 5), a stop-file, and per-round logs;
- stop immediately on missing participants, malformed ballots, stale artifact digests, repeated unchanged findings, or an explicit stop signal;
- emit `<promise>CONSENSUS_REVIEW_PASSED</promise>` only after `review_gate.py` returns `PASSED`.

Run the controller with a dispatch wrapper that launches all configured Agents in fresh read-only sessions:

```bash
python3 "$SKILL_ROOT/scripts/ralph_loop.py" \
  --manifest "$RUN_DIR/manifest.json" \
  --dispatch-command "python3 $SKILL_ROOT/scripts/dispatch_round.py" \
  --max-rounds 3 \
  --dispatch-timeout 1800
```

The bundled adapter detects the macOS ZCode app-bundle CLI at
`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`; set
`CAR_ZCODE_COMMAND` when the installation is elsewhere. It keeps the required
three-party quorum exact and refuses to convert a missing, malformed, or
non-zero provider response into a ballot. Consensus ZCode dispatch is pinned
to the high-tier policy `bigmodel/GLM-5.3` for both the main and lite slots.
Before dispatch, `scripts/model_policy.py` verifies that ZCode exposes that
model with max reasoning in its local provider catalog, that Claude exposes
`glm-5.3` in its configured model mapping, and that Codex exposes
`gpt-5.6-sol` with max reasoning in its model cache. Missing or stale catalogs,
unsupported models, and lower-tier `CAR_*` overrides fail the round instead
of silently downgrading a reviewer. The resolved, non-secret selection is
written to `model-selection.json` and must remain unchanged across Ralph
rounds.

The wrapper receives `REVIEW_RUN_DIR`, `REVIEW_ROUND`, `REVIEW_ROUND_DIR`, `REVIEW_MANIFEST`, and `REVIEW_STOP_FILE` in its environment. It must create exactly one ballot per required Agent plus `dispatch-meta.json` in `REVIEW_ROUND_DIR`, return non-zero on dispatch failure, and never edit the reviewed artifact. The controller rejects missing or inconsistent metadata. See `references/agent-adapters.md` for safe command patterns.

The loop is a convergence controller, not a majority vote. A round with two approvals and one rejection remains `DEBATE_REQUIRED`; a round with one missing ballot is `INCOMPLETE`; either state prevents the completion promise.

### 4. Publish the result

For `PASSED`, write `final-report.md` with:

- review ID, artifact digest, scope, participants, initiator, and round count;
- a vote and score table for every Agent;
- the unanimous decision and any non-blocking findings;
- the evidence that closed each debated issue;
- a concrete next-step plan: action, owner, verification command/evidence, and due condition.

Use the gate to prevent accidental claims of consensus:

```bash
python3 "$SKILL_ROOT/scripts/review_gate.py" finalize \
  --manifest "$RUN_DIR/manifest.json" \
  --tally "$RUN_DIR/round-01/tally.json" \
  --conclusion-file "$RUN_DIR/conclusion.md" \
  --next-plan-file "$RUN_DIR/next-plan.md" \
  --debate-log "$RUN_DIR/debate/round-01.md" \
  --output "$RUN_DIR/final-report.md"
```

For `BLOCKED`, write `blocked-report.md` instead. State that no approval was granted, name every dissenting participant, preserve the unresolved findings verbatim, and list the next evidence or user decision required. Never label a blocked report “consensus”.

## Review criteria

Score each criterion 0–10. Use the lowest material score to explain the gate; do not hide a weak dimension behind an average.

| Review type | Required criteria |
|---|---|
| `architecture` | `requirements_fit`, `boundaries`, `reliability`, `security_operations`, `evolution_testability` |
| `code` | `correctness`, `security`, `maintainability`, `tests`, `operability` |
| `general` | `correctness`, `completeness`, `risk`, `evidence`, `actionability` |

Use this severity scale:

- `BLOCKER`: invalidates the decision or creates unacceptable correctness, security, data-loss, or operability risk;
- `MAJOR`: material risk or missing evidence that must be resolved before approval;
- `MINOR`: non-blocking defect that belongs in the next-step plan;
- `NOTE`: observation with no required action.

## Agent output contract

Read `references/review-protocol.md` and `references/ballot.schema.json`. Require strict JSON, not prose wrapped around JSON. Reject a ballot that omits evidence, criteria, confidence, artifact digest, or a clear verdict. If an Agent emits prose, ask it to normalize its own response into the schema; do not infer an approval from prose.

## Safety and integrity rules

- Keep reviewers read-only and use fresh processes; do not resume a prior conversational context for the first pass.
- Pin the artifact digest and reject stale ballots after the artifact changes.
- Keep ballot files immutable after tallying; append new rounds instead of overwriting.
- Treat missing, malformed, or unavailable Agents as `BLOCKED`, never as approval.
- Do not expose one Agent’s score to another before independent first-pass ballots are complete.
- Do not manufacture test results, line numbers, traces, or tool activity. Mark planned evidence as `PLANNED`.
- Let empirical tests override debate consensus when the review is chained into implementation or verification.

## Bundled tools and references

- `scripts/review_gate.py`: initialize runs, validate ballots, tally the hard gate, and render a final report.
- `scripts/probe_agents.py`: detect the configured Claude Code, zcode, and Codex Agent executables without invoking them.
- `scripts/model_policy.py`: discover provider-local model catalogs, verify the high-tier policy, and fail closed on unavailable or downgraded models.
- `references/review-protocol.md`: prompt templates, criterion anchors, debate log, and report requirements.
- `references/agent-adapters.md`: safe non-interactive command patterns and zcode configuration contract.
- `references/ballot.schema.json`: machine-readable ballot shape for external Agent CLIs.
- `references/ralph-practices.md`: GitHub-derived loop controls and their adaptation to unanimous review.
