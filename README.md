# AI Coding Scaffold

English | [中文](README.zh.md)

A scaffold for team AI delivery. It gives any repo a shared rulebook, review skills,
a hook control plane, an honest MCP manifest, and machine-checkable verification —
plus, if you opt in, a managed delivery workflow that drives every change through six
gates where people only decide at approval points.

Two names used below:

- **Scaffold** — the five facilities listed above. It does not dictate your workflow
  ([ADR-0015](docs/architecture/adr/0015-scaffold-repositioning.md)).
- **Managed delivery** — the optional six-gate workflow application. Agents do the
  work; each gate demands an independent evidence chain before a change moves on.

No badges yet: both CI workflows currently fail on the default branch, and they go up
when they go green. The repo has no LICENSE file yet.

## Why this architecture

AI agents write code faster than anyone can review it. The failure mode is familiar:
the agent says "done", the diff looks plausible, and two weeks later nobody can say
what was actually verified. This scaffold answers with structure, not trust.

**Independent review at every gate.** The author never signs their own work. Each gate
is a separate review step with its own receipts, evaluated by code rather than by the
authoring agent's confidence.

**Evidence over claims.** Every gate produces a receipt bundle: HMAC-signed, bound to
input digests, re-checked by hash comparison at record time. "The agent says it's done"
carries no weight here; the evidence chain either holds or the gate refuses.

**People decide, agents work.** You approve requirements, design, test criteria, the
plan, and the final verification. Driving the run, constructing evidence, recording
outcomes — all automated.

**Knowledge converges.** Project closeout (Kp) and team publishing (Kt) turn each
delivery's lessons into retrievable knowledge instead of tribal memory.

**Proven on real deliveries.** Two pilot rounds took changes through all six gates,
archive, and Kt. To be precise about scope: the pilots validated the RUNBOOK journey
and its evidence chain, not the convergence target architecture (that design is done,
implementation tracked separately). And this repo holds itself to its own standard —
the README you are reading went through a three-seat adversarial consensus review that
caught three factual errors in its first draft.

## The six gates

```text
R ───► A ───► T ───► P ───► Build ───► V ───► Kp ───► Archive ───► Kt
requirements  architecture  test design  planning  implementation  verification  closeout  archive  publish
```

| Gate | Settles the question | Verdicts |
|---|---|---|
| R requirements | Is the scope real and agreed? | pass / repair / revise-requirements |
| A architecture | Is the design sound and independently reviewed? | pass / repair / revise-requirements |
| T test design | What does "correct" mean, before any code? | pass / repair / revise-requirements |
| P planning | Is the task DAG buildable in this order? | pass / repair / revise-requirements |
| V verification | Did the real thing work, with machine evidence? | pass / repair |
| Kp closeout | What did this change teach the project? | confirmation |

Each gate is one review step, one evidence bundle, one recorded outcome. A refusal
loops the change back; nothing advances on a promise.

## Architecture

```text
convention    AGENTS.md                 the rulebook agents and humans read first
collaboration docs/agent/               skill trigger matrix, handoff templates
skills        .agents/skills/           versioned snapshots, vendored
control       hooks.yaml → adapter → native hooks    policy defined once, compiled per agent
tools         mcp-capabilities.yaml + .mcp.json      honest capability manifest
artifacts     openspec/ + docs/architecture/adr/     specs and irreversible decisions
verification  lib/ + scripts/check.sh                gate/audit regression suite
```

The control plane works one way: [hooks.yaml](hooks.yaml) defines policy (knowledge-base
write protection, dangerous-command blocklist, session context injection), adapters
compile it into each agent's native hooks, and generated artifacts are never hand-edited.
Adding a new agent means writing one `tools/adapters/<agent>.sh`.
The managed delivery application lives in
[integrations/comet/](integrations/comet/application/composition.json): gate validators,
a six-skill composition, and evidence ports. Full layering:
[scaffold-architecture.md](docs/architecture/scaffold-architecture.md).

## Quick start

Prerequisites: Node ≥ 18 for the toolchain below. The managed delivery journey needs
Node ≥ 22.16 (24 works best) and Comet 0.5.1 on PATH. Failure modes are catalogued in
the RUNBOOK preflight table.

```bash
git clone <this-repo> my-project && cd my-project   # terminal
bash tools/bootstrap.sh                             # hooks, skills, MCP registration
# bash tools/bootstrap.sh --with-llmwiki            # optional: also install the LLMWiki MCP (python venv)
# fill the TODO(team) blocks in AGENTS.md and openspec/project.md
bash scripts/check.sh                               # skeleton check
# restart your Claude Code session — hooks load only at session start
comet application install <scaffold>/integrations/comet/application/package/application.json \
  --project "$PWD" --preview --json                 # project root — note the confirmationHash
comet application install <scaffold>/integrations/comet/application/package/application.json \
  --confirmation-hash <hash> --project "$PWD"       # project root — actual install
mkdir -p openspec/changes/my-change                 # no `comet state init`: see RUNBOOK traps
export SDD_SESSION_ID="$(uuidgen)"                  # the driver requires it
bash tools/drive-journey.sh my-change               # the Run starts and calls you at gates
# approve in the driver's own terminal: approved / 同意 / y / yes
```

Per-gate deliverables, evidence construction, and trap recovery: the
[RUNBOOK](docs/user/RUNBOOK.md).

## Skills and tools

| Skill | Job |
|---|---|
| grill-me + grilling | interrogate facts before design, one question at a time |
| whitebox-verify | three verification modes: debug, journey acceptance, slice TDD |
| claude-parallel-tdd-planner | parallel planning protocol: DAG, RED-GREEN ledger |
| multi-agent-consensus-review | three-seat unanimous review with evidence-based debate |

Trigger matrix: [skill-architecture.md](docs/agent/skill-architecture.md). Verification
CLI essentials: `node bin/cli.js doctor`, `test-gate`, and `scripts/check.sh`. Exit
codes: 0 pass, 1 bad input, 2 verification failed. The full command list:
[docs/reference.md](docs/reference.md).

MCP integrations are declared once in [mcp-capabilities.yaml](mcp-capabilities.yaml) —
ready, degraded, or planned, and the manifest is the only place that status lives.

## Documentation

| Read | When |
|---|---|
| [RUNBOOK](docs/user/RUNBOOK.md) | you are driving a delivery — cookbook plus trap table |
| [scaffold-architecture.md](docs/architecture/scaffold-architecture.md) | you want the full layered architecture |
| [convergence](docs/architecture/comet-ai-devops-convergence.md) | the target architecture — design revision done, implementation tracked in the change tasks/DAG |
| [adr/](docs/architecture/adr/) | irreversible decisions, with reasons |
| [skill-architecture.md](docs/agent/skill-architecture.md) | how and when skills trigger |
| [mcp-capabilities.yaml](mcp-capabilities.yaml) | which integrations actually work today |
| [FRAMEWORK.md](FRAMEWORK.md) | the delivery framework layout and purity rules |
| [delivery-foundation-rearchitecture](openspec/changes/delivery-foundation-rearchitecture/tasks.md) | current implementation status (tasks, DAG, HANDOFF) |
| [foundation/](foundation/) | sealed baselines for audit replay |
| [managed-delivery-quickstart.md](docs/delivery/managed-delivery-quickstart.md) | historical walkthrough from the 2026-10 era — the RUNBOOK is current |

## Need help

Delivery traps and recovery live in the [RUNBOOK trap table](docs/user/RUNBOOK.md)
(state-init misbinding, failed-terminal runs, authority merge). Questions go to the
team channel; reproducible problems to the issue tracker.

## Developing this repo

```bash
npm install
npm test               # gate/audit regression suite
bash scripts/check.sh  # rules + skills + regression + YAML/JSON
node integrations/comet/application/internal/build-application.mjs --out <new-external-dir>
```

A successful build is not runtime qualification. The compiled application still needs
a host install and gate-by-gate verification.
