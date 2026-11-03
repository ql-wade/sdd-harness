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
8. never downgrade quorum or turn a malformed response into an approval;
9. execute all CLIs and their children silently, with no terminal windows, Dock
   entries, or focus changes; use closed/piped stdin and file-backed logs;
10. clean up only owned process groups on completion, failure, cancellation,
    timeout, and stop-file requests; retain logs and report failures in chat.

The ZCode adapter correlates its unique input ID to the root turn and user
message. Only a successful completion of that turn permits extracting the final
assistant text with the matching session and parent message; reasoning and
subagent status are not final output. Raw final text is saved before cleanup.
Cleanup receipts distinguish `complete`, `failed`, and `unverified`; the latter
two block approval while retaining any valid ballot. Ballot files use exclusive
creation and are never overwritten.

Keep the adapter as a small project-owned wrapper. Do not put credentials or
provider-specific secrets in the skill. Use environment variables or the
Agent’s existing login state.

## Current CLI patterns

Check commands before starting a run with `probe_agents.py`; on a default
macOS app-bundle install no override is needed.

On macOS, ZCode may be installed as `ZCode.app` without a `zcode` PATH
alias. For ZCode 0.16.x and 0.17.x, the bundled `scripts/dispatch_round.py`
uses the read-only ZCode Protocol `app-server` path, creates an ephemeral
personal BigModel provider registry, answers runtime-header requests with the
existing authenticated process credential, and never writes the user's ZCode
state database or a credential into the review run. ZCode 0.17.x app-bundle
CLIs are built for Electron's node, so the default command runs the bundle
through the hidden helper (`/Applications/ZCode.app/Contents/Frameworks/ZCode Helper.app/Contents/MacOS/ZCode Helper`)
with `ELECTRON_RUN_AS_NODE=1`, which the adapter injects into the child
environment automatically; under a standalone `node` the CLI fails during
sqlite migration ("Migration transaction ownership mismatch"), even on a fresh
database, so an override must use the hidden Electron form. `ELECTRON_RUN_AS_NODE`
alone does not suppress Dock registration: the main app binary and inherited
plugin processes can still become foreground applications. The adapter requires
the helper's `LSUIElement` marker and blocks if it is unavailable:

```bash
export CAR_ZCODE_COMMAND='"/Applications/ZCode.app/Contents/Frameworks/ZCode Helper.app/Contents/MacOS/ZCode Helper" /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'
python3 "$SKILL_ROOT/scripts/probe_agents.py" \
  --participants claude-code,zcode,codex-agent
```

Set `CAR_ZCODE_PROTOCOL=0` only for an older CLI that still supports the
legacy `--prompt` adapter. Zcode 0.16.3 advertises `--max-turns` in help but
rejects it in its parser, so the adapter deliberately does not pass that
version-sensitive option. The
consensus adapter sets both the ZCode `main` and `lite` slots to the
auto-selected flagship. Before launching any Agent, `scripts/model_policy.py`
reads the provider-specific catalogs: ZCode uses `~/.zcode/v2/config.json`,
Claude uses `~/.claude/settings.json`, and Codex uses
`$CODEX_HOME/models_cache.json`. Each source can be overridden with
`CAR_ZCODE_MODEL_CATALOG`, `CAR_CLAUDE_MODEL_CATALOG`, or
`CAR_CODEX_MODEL_CATALOG` for a refreshed catalog snapshot. Selection keeps
the highest-version non-light model that advertises max reasoning (Claude
follows its Opus-tier mapping); every reviewer is invoked with `max` effort.
A `CAR_*_MODEL` pin is honored only when the named model passes the same
high-tier checks, so overrides cannot downgrade a reviewer, and a
same-version codename tie fails closed until one candidate is pinned.

The resolved selection, catalog paths, catalog digests, and capability checks
are stored in `model-selection.json` without credentials. Subsequent Ralph
rounds must resolve to the exact same selection; a catalog change blocks the
run instead of switching models mid-review. There is no cross-provider
standard for a universal "highest model" endpoint, so discovery, ranking, and
capability checks remain provider-specific with an explicit fail-closed policy.

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

Set a finite max-rounds value. Create `$REVIEW_STOP_FILE` to cancel the active
dispatch and stop further rounds. SIGINT/SIGTERM also stop the controller and
clean up its owned reviewer trees. Keep a unique run directory and retain logs;
never delete an active run to retry it. Treat a missing ballot, a non-zero adapter exit, and repeated
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
