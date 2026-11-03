# Review protocol

## First-pass prompt

Send the same task frame to each Agent in a fresh process. Do not send any other Agent’s ballot before all first-pass ballots are stored.

```text
You are one independent reviewer in a unanimous multi-Agent review.

Review ID: {review_id}
Round: {round}
Review type: {review_type}
Initiator: {initiator}
Required participants: {participants}
Artifact: {artifact}
Artifact SHA-256: {artifact_sha256}
Scope: {scope}
Decision being gated: {decision}
Required criteria: {criteria}

Read the artifact in read-only mode. Do not edit files, run destructive commands,
or assume another reviewer will cover a risk. Cite concrete evidence for every
material finding. Score each criterion from 0 to 10 and give an overall score.

Return exactly one JSON object matching ballot.schema.json. Use APPROVE only if
you would authorize the gated decision now. Use REJECT for a material problem,
ABSTAIN for missing evidence or an authority boundary. A blocker must set
blocking=true. Do not wrap the JSON in Markdown and do not add prose before or
after it.
```

## Criterion anchors

Use the anchors below to reduce score drift. A score is not a vote substitute;
the verdict and the evidence must agree.

### Architecture

- `requirements_fit`: traces each important requirement to a design behavior and names exclusions;
- `boundaries`: defines ownership, interfaces, data contracts, failure boundaries, and dependency direction;
- `reliability`: covers retries, idempotency, ordering, recovery, observability, and degraded modes;
- `security_operations`: covers trust boundaries, authorization, secrets, abuse cases, deployment, and operations;
- `evolution_testability`: provides migration/versioning strategy, test seams, rollout/rollback, and measurable acceptance.

### Code

- `correctness`: behavior matches requirements and handles failure/edge cases;
- `security`: authorization, input/data handling, secrets, injection, and abuse resistance;
- `maintainability`: cohesion, coupling, naming, complexity, duplication, and change locality;
- `tests`: tests exercise critical paths, failure paths, and regression risk with useful assertions;
- `operability`: logs, metrics, traces, configuration, rollback, compatibility, and runbook evidence.

### General

- `correctness`: claims and proposed behavior are technically valid;
- `completeness`: important requirements, alternatives, risks, and boundaries are covered;
- `risk`: severity, likelihood, blast radius, and mitigations are explicit;
- `evidence`: conclusions are traceable to artifact evidence or explicitly marked planned evidence;
- `actionability`: the result can be executed and verified by a named owner.

## Ballot rules

Use stable finding IDs within a review run. A finding must contain:

```text
id              F-001, F-002, ...
severity        BLOCKER | MAJOR | MINOR | NOTE
claim           the exact problem or disputed claim
evidence        path:line, diff hunk, test output, trace, or document section
recommendation  the smallest concrete resolution or requested evidence
blocking        true only when approval must stop
```

Keep `assumptions` separate from evidence. An assumption is not proof. Set
`confidence` from 0.0 to 1.0 and lower it when the artifact lacks authority or
runtime evidence.

## Debate round template

Create one immutable Markdown file per round. The initiator may coordinate the
round but may not resolve its own objection unilaterally.

```markdown
# Debate round {n}

## Objective
Resolve the findings that prevented unanimous approval in round {n-1}.

## Prior tally
- Status:
- Dissenters:
- Artifact SHA-256:

## Disputed findings
### F-001 — {severity}
- Agent:
- Claim:
- Evidence:
- Criterion and prior score:
- Resolution question:

## Agent positions
### claude-code
- strongest objection:
- evidence:
- requested resolution:

### zcode
- strongest objection:
- evidence:
- requested resolution:

### codex-agent
- strongest objection:
- evidence:
- requested resolution:

## Initiator resolution candidate
- proposed change/evidence:
- expected effect on each criterion:
- verification:

## Resolution ledger
| Finding | Status | Evidence | Accepted by |
|---|---|---|---|
| F-001 | RESOLVED / INVALIDATED / REMAINS_OPEN | ... | ... |
```

After the log is written, dispatch every participant again in a fresh process.
Give them the artifact, this round’s resolution candidate, the previous tally,
and only the unresolved findings that need a decision. Require a complete new
ballot; do not let an Agent carry forward `APPROVE` without re-scoring.

## Final report requirements

The conclusion must answer:

1. What was reviewed and at which immutable revision?
2. Did every required Agent approve, and what did each score?
3. Which findings were resolved, by what evidence?
4. What is authorized next?
5. What remains non-blocking, who owns it, and how will it be verified?

Each next-step item should have this shape:

```text
Action: <one concrete action>
Owner: <agent or human role>
Verification: <command, test, trace, or artifact>
Done when: <observable condition>
```
