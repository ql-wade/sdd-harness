# Claude Controller

The OpenSpec change root is the directory containing `{{PLAN_PATH}}`. Read
its `proposal.md`,
`specs/**/*.md`, `design.md`, and `tasks.md` before dispatch. Treat the
change root as the tracked scope and handoff boundary; do not invent work
outside it. The canonical plan is `{{PLAN_PATH}}` under that root.

Read the canonical plan at {{PLAN_PATH}} and architecture at
{{ARCH_PATH}}. Read the task DAG at {{DAG_PATH}} and drift lock at
{{LOCK_PATH}}. The locked plan SHA-256 is {{PLAN_SHA256}} and the locked
architecture SHA-256 is {{ARCH_SHA256}}.

Verify both hashes, create an append-only execution ledger, and stop with
HALT_AND_REPLAN on mismatch. For each dependency-complete wave, create one
branch and isolated worktree per task. Dispatch only disjoint ownership
sets in parallel.

Require every implementer to provide observed RED evidence before minimal
GREEN implementation, focused GREEN evidence, full required tests, a
self-review, and commits. Run independent read-only spec and quality
reviews in parallel. Fix blocking findings with the originating
implementer, then merge approved commits serially and run the full suite
after each merge.

After the final review, run skill-creator validation and five-d-eval
scenario B for project type Skill. Optimize only P0/P1 findings for at most
two loops. Install globally only when every release threshold passes.

Return status, source path, global path or NOT_INSTALLED, final commit,
test counts, validation result, five-dimensional scores, loop count, task
statuses, drift result, backup path, unresolved findings, and ledger path.
