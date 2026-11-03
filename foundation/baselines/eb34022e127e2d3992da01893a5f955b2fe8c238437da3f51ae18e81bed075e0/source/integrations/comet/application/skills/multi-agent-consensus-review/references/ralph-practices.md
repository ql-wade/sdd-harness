# Ralph Loop practices adopted here

The review loop uses the useful parts of Ralph without treating repetition as
proof. The controller must still require independent ballots and an external
completion predicate.

| Practice | Adopted behavior in this skill |
|---|---|
| Fresh context per iteration | Start a new Claude Code, zcode, or Codex process for each Agent and round. |
| File-backed continuity | Store manifest, artifact digest, ballots, tally, debate log, state, and logs on disk. |
| Mechanical completion | Stop only when `review_gate.py tally` returns `PASSED`; never trust a model phrase. |
| Bounded execution | Default to three debate rounds and cap at five; expose a stop file. |
| Feedback injection | Feed unresolved findings and the previous tally into the next round. |
| Observable progress | Write one log per round and preserve all prior ballots immutably. |
| Context control | Do not concatenate every transcript; re-read the artifact and pass only unresolved state. |
| Safety boundary | Keep reviewers read-only and make the supervisor/initiator unable to override the gate. |
| Stuck detection | Stop on missing/invalid ballots, repeated unchanged dissent, stale digests, or max rounds. |
| Acceptance criteria | Define exact score thresholds and evidence requirements before the loop starts. |

## Source notes

- Anthropic’s Claude Code Ralph plugin stores loop state, supports a maximum
  iteration count, and treats a completion promise as valid only when the
  statement is true: <https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/scripts/setup-ralph-loop.sh>
- Vercel’s `ralph-loop-agent` separates an outer loop from the inner tool loop,
  injects failed-verification feedback, and provides iteration, token, and cost
  stop conditions: <https://github.com/vercel-labs/ralph-loop-agent>
- Santander AI’s implementation launches a brand-new session per iteration,
  keeps continuity in files, captures logs, reloads configuration, and supports
  a stop file: <https://github.com/SantanderAI/ralph>
- The OpenCode Ralph/RLM project emphasizes fresh worker context, file-first
  state, a supervisor that does not edit code, and a strong verification
  command: <https://github.com/doeixd/opencode-ralph-rlm>
- The spec-driven Ralph implementation requires testable acceptance criteria,
  records attempts, and flags work that remains stuck after repeated tries:
  <https://github.com/fstandhartinger/ralph-wiggum>

These are design references, not runtime dependencies. The consensus gate is
stricter than a normal Ralph coding loop: repetition can improve a proposal but
cannot convert dissent into approval.
