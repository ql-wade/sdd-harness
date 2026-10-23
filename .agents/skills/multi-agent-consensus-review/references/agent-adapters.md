# Agent adapters and Ralph execution

## Non-negotiable adapter contract

The dispatch wrapper must:

1. start one new process per required Agent per round;
2. run each process in read-only mode or an isolated read-only worktree;
3. pass the same review prompt and artifact digest to every Agent;
4. write exactly one `ballot-<agent-id>.json` file to `$REVIEW_ROUND_DIR`;
5. return non-zero if an Agent is unavailable, times out, emits invalid JSON, or fails to write its ballot;
6. preserve stdout/stderr in `$REVIEW_RUN_DIR/logs/`;
7. write `$REVIEW_ROUND_DIR/dispatch-meta.json` with the exact round, participant list, artifact digest, prompt SHA-256, `fresh_processes: true`, `read_only: true`, `artifact_edited: false`, and `status: "OK"`;
8. never downgrade quorum or turn a malformed response into an approval.

Keep the adapter as a small project-owned wrapper. Do not put credentials or
provider-specific secrets in the skill. Use environment variables or the
Agent’s existing login state.

## Current CLI patterns

Check commands before starting a run:

```bash
export CAR_ZCODE_COMMAND='node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'
python3 "$SKILL_ROOT/scripts/probe_agents.py" \
  --participants claude-code,zcode,codex-agent
```

On macOS, ZCode may be installed as `ZCode.app` without a `zcode` PATH
alias. The embedded CLI is the stable headless entry point for this adapter;
the GUI's Electron helper is reserved for the `app-server --stdio` protocol.
The bundled `scripts/dispatch_round.py` detects this app-bundle path when no
override is supplied and runs ZCode with `--prompt`, `--mode plan`, `--cwd`,
and the Ralph controller's finite per-round timeout. ZCode 0.16.3 advertises
`--max-turns` in help but rejects it in its parser, so the adapter deliberately
does not pass that version-sensitive option. The consensus adapter pins both
the ZCode `main` and `lite` slots to `bigmodel/GLM-5.3`; lower-tier model
overrides are rejected before the provider process starts. Before launching
any Agent, `scripts/model_policy.py` reads the provider-specific catalogs:
ZCode uses `~/.zcode/v2/config.json`, Claude uses `~/.claude/settings.json`,
and Codex uses `$CODEX_HOME/models_cache.json`. Each source can be overridden
with `CAR_ZCODE_MODEL_CATALOG`, `CAR_CLAUDE_MODEL_CATALOG`, or
`CAR_CODEX_MODEL_CATALOG` for a refreshed catalog snapshot. Claude is invoked
with `glm-5.3` and `max` effort, while Codex is invoked with `gpt-5.6-sol` and
`model_reasoning_effort="max"`; the corresponding `CAR_*` overrides are
validated and cannot downgrade a reviewer.

The resolved selection, catalog paths, catalog digests, and capability checks
are stored in `model-selection.json` without credentials. Subsequent Ralph
rounds must resolve to the exact same selection; a catalog change blocks the
run instead of switching models mid-review. There is no cross-provider
standard for a universal "highest model" endpoint, so discovery and capability
checks remain provider-specific and the high-tier policy remains explicit.

Claude Code supports non-interactive print mode. Use a plan/read-only posture
for a review and a fresh session:

```bash
claude -p \
  --permission-mode plan \
  --no-session-persistence \
  --output-format text \
  "$(cat "$PROMPT_FILE")"
```

Codex supports non-interactive `exec`; use an ephemeral, read-only run:

```bash
codex exec \
  --ephemeral \
  --skip-git-repo-check \
  -s read-only \
  -a never \
  -C "$REVIEW_ROOT" \
  -o "$RAW_OUTPUT" \
  - < "$PROMPT_FILE"
```

The adapter contract is implemented by
`$SKILL_ROOT/scripts/dispatch_round.py`. It launches all three participants in
parallel, stores raw stdout/stderr under `logs/`, extracts exactly one ballot
JSON object, validates it with `review_gate.py`, checks that the artifact digest
did not change, and writes `dispatch-meta.json`. A provider command override
must contain only the executable and its fixed arguments; the adapter appends
the provider-specific prompt/read-only arguments.

## Ralph state discipline

Use files as the cross-iteration memory:

```text
review-runs/<review-id>/
├── manifest.json
├── ralph-state.json
├── round-00/
│   ├── ballot-claude-code.json
│   ├── ballot-zcode.json
│   ├── ballot-codex-agent.json
│   ├── dispatch-meta.json
│   └── tally.json
├── round-01/
├── debate/round-01.md
└── logs/ralph-round-00.log
```

Start each iteration from the immutable manifest and current artifact. Read the
previous tally and debate log, then re-discover the relevant code or document;
do not trust a prior Agent’s paraphrase as evidence. Keep prompts bounded by
including unresolved findings rather than concatenating every prior transcript.

Set a finite max-rounds value. Create `$REVIEW_STOP_FILE` to stop before the
next round. Treat a missing ballot, a non-zero adapter exit, and repeated
unchanged dissent as a blocked state. Do not run an unattended loop with an
unbounded budget.

## Completion predicate

The only completion predicate is:

```text
review_gate.py tally.status == PASSED
```

An Agent’s phrase such as “looks good”, a majority, a high average, or an XML
promise without a passing tally is not completion. The bundled
`ralph_loop.py` prints `<promise>CONSENSUS_REVIEW_PASSED</promise>` only after
the predicate is true.

## Provenance

This adapter design follows the public Ralph patterns of fresh sessions,
file-backed state, explicit completion checks, finite iteration limits, stop
signals, and logs. It combines those controls with this skill’s stricter
unanimous ballot gate.

## Known breakage: ZCode.app >= 2026-10-23 auto-update (3.16.2 layout)

The embedded `glm/zcode.cjs` resolves its builtin provider config from
app-relative candidates (`Resources/glm/provider/`, then a `../../../../../config/provider/`
walk that lands at filesystem root). After the 2026-10-23 auto-update both
candidates fail ("无法定位 CLI ZCode Built-in Provider Config") even when the
file is materialized at the first candidate — the lookup anchors elsewhere in
the new build. `~/.zcode/v2/runtime/provider/darwin-aarch64/<version>/` still
holds known-good provisions per version.

Handling:
1. Attempt one dispatch with the embedded cjs after materializing
   `Resources/config/provider/zcode-builtin.json` at `Resources/glm/provider/`
   (additive, reversible). If it still fails, do NOT keep spelunking.
2. With explicit user authorization, re-init the run with a degraded quorum
   (drop the zcode participant), record the authorization + the upstream
   breakage in the run ledger and final report — an explicit, recorded
   downgrade; never a silent one.
3. Re-check after each ZCode.app update: the breakage may disappear in a
   later build.
