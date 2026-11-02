# OpenSpec Routing

Inspect `.openspec.yaml`, `openspec/config.yaml` or `openspec/` from the repository
root. When absent, use a single tracked plan root from repository conventions or
`docs/plans/<feature>/`; do not introduce OpenSpec solely for this planner.

When present, discover and read the installed `openspec-lifecycle-guard` SKILL.md.
The controller applies its repository/schema discovery and artifact-validity rules
before changing or freezing a change, its evidence-backed checkbox rules on each
task transition, and its readiness/main-spec rules before and after archive.
Record the resolved skill path, content SHA-256 and reviewed gates in mutable
execution-state/ledger, with evidence references; a named dependency is not proof
it ran. A resumed controller reloads it if the recorded content digest changed.
If unavailable, record LIFECYCLE_GUARD_UNAVAILABLE; prepare other planning work but
do not claim a fully ready OpenSpec execution handoff or closeout. Never invent a
shell command named after the skill. The helper script executes mechanical checks
and CLI operations; it does not replace loading/applying this governance skill.

When present, choose the user's explicit change ID first, otherwise inspect
`openspec list --json` and the candidates' scope. Use only a unique matching change.
An `.active` pointer is a hint, not proof of selection. Ask when competing candidates
cannot be resolved from the request. Never combine artifacts from different changes.

Read the selected proposal, specs, design and tasks, resolving actual artifact paths
from the local schema/CLI. Use locally supported `openspec status --change <id> --json`
and `openspec validate <id> --strict`. Missing/invalid load-bearing artifacts block
an executable handoff; do not emit a second orphan plan outside the change.

If no matching change exists, propose a concrete name and scope. Create/reconcile
artifacts when the user already authorized that work; otherwise ask about only the
missing authorization. Creating a scaffold is not completion: finish available
planning work and identify the exact missing architecture/acceptance inputs.

Keep the canonical plan in `<changeRoot>/tasks.md`, planner bundle in the same root,
and baseline/final reports under `<changeRoot>/evidence/`. Keep original Whitebox
ledger/raw artifacts under `.whitebox/<run>/` as described in the closeout reference,
so archive does not invalidate their paths. Freeze only after the artifacts and plan are consistent and valid.

Before handing off to another Git worktree, include the plan root in a planning
commit within authorized repository workflow. Create the implementation worktree
from that commit. Record its identity; avoid a hard-coded agent-specific branch
prefix. If committing is not available/authorized, deliver the files and explicitly
mark the cross-worktree execution prerequisite, without claiming a committed handoff.

After implementation acceptance use [openspec-closeout.md](openspec-closeout.md)
for source/scenario consistency, installed-CLI merge preview, archive and post-audit.
Do not equate strict validation, checkbox completion or an archive exit code with
Whitebox business acceptance. CLI/schema capabilities must be discovered locally.
