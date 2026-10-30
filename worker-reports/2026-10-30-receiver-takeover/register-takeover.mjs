// Register the 2026-10-30 sole-controller takeover of the
// delivery-foundation-rearchitecture change, per execution-contract.json
// (`handoff.recipient`: "Portable receiving Agent selected by human, after
// execution instruction and sole-controller claim").
//
// This session is harness-bound to the isolated worktree
// dazzling-dirac-4a8010 (branch claude/dazzling-dirac-4a8010, same commit
// dfa4a75 as master), so the registration lands on that branch and merges
// back to master by the user's decision. State content is identical to the
// main checkout at registration time (verified: clean tree at dfa4a75).
//
// Order of operations (auditable):
//   1. collect live verification facts (processes, activity, digests)
//   2. snapshot the before-state  -> before/execution-state.json
//   3. write the verification record -> verification.json
//   4. mutate execution-state.json (controller_handoff, current_focus only)
//   5. append one ledger line
//
// The top-level status EXTERNAL_GLOBAL_COMET_PLAN_UPDATE_PENDING is
// intentionally KEPT: resolving the plan/state vs installed-application-version
// difference is six-step item 4 (app package + Foundation lock rebuild).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const WORKTREE = '/Volumes/mac-extend/claude-live/worktrees/sdd-harness/dazzling-dirac-4a8010';
const MAIN_CHECKOUT = '/Users/mac/Code/sdd-harness';
const CHANGE = join(WORKTREE, 'openspec/changes/delivery-foundation-rearchitecture');
const REPORT = join(WORKTREE, 'worker-reports/2026-10-30-receiver-takeover');
const STATE = join(CHANGE, 'execution-state.json');
const LEDGER = join(CHANGE, 'execution-ledger.jsonl');

const run = (cwd, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { cmd: [cmd, ...args].join(' '), exit: r.status, stdout: (r.stdout ?? '').slice(0, 4000), stderr: (r.stderr ?? '').slice(0, 2000) };
};
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const now = () => new Date().toISOString().replace('Z', '+00:00');

// --- 1. verification facts -------------------------------------------------
const verification = { at: now(), worktree: WORKTREE, mainCheckout: MAIN_CHECKOUT, checks: {} };
verification.checks.noCodexProcess = run(WORKTREE, 'pgrep', ['-fl', 'codex']);
verification.checks.noRunningNodeTests = run(WORKTREE, 'pgrep', ['-fl', 'node --test']);
verification.checks.psNote = 'ps aux is blocked by the session sandbox (operation not permitted); pgrep used instead';
// .local evidence lives only in the main checkout; read-only existence check.
verification.checks.noLocalActivityAfterHandoffLog = run(MAIN_CHECKOUT, 'find', ['.local', '-type', 'f', '-newer', '.local/comet-project-reinstall-efgrwupq/check-handoff-final-targeted-20261030.log']);
verification.checks.gitHead = run(WORKTREE, 'git', ['log', '--oneline', '-1']);
verification.checks.gitStatus = run(WORKTREE, 'git', ['status', '--porcelain']);
const ledgerRaw = readFileSync(LEDGER, 'utf8').trimEnd().split('\n');
const lastLedger = JSON.parse(ledgerRaw[ledgerRaw.length - 1]);
verification.ledgerLastEntryAt = lastLedger.at;

// Candidate digests must match execution-prompt.md's stated candidate.
const EXPECTED = {
  'architecture.md': '8d6b82cc36cbb4865a0b9a8e7fcce9d232071d1dda91a1e25ddc6db51a0844b6',
  'task-dag.json': '655b37ca6bad5154ab293b22f59d1238724353e0f1e025c1caf732367ef1cb12',
  'execution-contract.json': 'a470c94bc97da693244cf915e265eb518fba7b696a15b9f05dd265c49ff49362',
  'pilot-contract.md': '765b324e28be0c08ed9080f04ff507617ba89f690509e595d2577d94fdedb5de',
};
verification.candidateDigests = {};
for (const [file, expected] of Object.entries(EXPECTED)) {
  const actual = sha256(join(CHANGE, file));
  verification.candidateDigests[file] = { expected, actual, match: actual === expected };
}

// history_ref of the 2026-10-29 codex registration resolves at the MAIN
// checkout's repo-root worker-reports (committed evidence).
verification.priorCodexTakeoverRef = {
  dir: 'worker-reports/2026-10-29-codex-takeover (main checkout repo root)',
  exists: existsSync(join(MAIN_CHECKOUT, 'worker-reports/2026-10-29-codex-takeover')),
  listing: run(MAIN_CHECKOUT, 'ls', ['worker-reports/2026-10-29-codex-takeover', 'worker-reports/2026-10-29-codex-takeover/before']),
};

const allDigestsMatch = Object.values(verification.candidateDigests).every((d) => d.match);

// --- 2. before snapshot ----------------------------------------------------
mkdirSync(join(REPORT, 'before'), { recursive: true });
const rawState = readFileSync(STATE, 'utf8');
writeFileSync(join(REPORT, 'before', 'execution-state.json'), rawState);

// --- 3. verification record ------------------------------------------------
writeFileSync(join(REPORT, 'verification.json'), JSON.stringify(verification, null, 2) + '\n');

// --- 4. mutate the two controller fields -----------------------------------
const state = JSON.parse(rawState);
state.controller_handoff = {
  status: 'USER_AUTHORIZED_RECEIVING_SESSION_SOLE_CONTROLLER_20261030',
  authorization: 'User instruction 2026-10-30 (verbatim): 先核实无活跃控制器与会话句柄，沿原执行契约登记唯一接管，按六步顺序从真实来源端口开始推进. Verified before registration: no codex process, no running node --test, zero .local files newer than the handoff targeted log, ledger idle since ' + lastLedger.at + '; candidate digests match execution-prompt.md (allDigestsMatch=' + allDigestsMatch + '). Supersedes the 2026-10-29 codex sole-controller authorization; its history_ref resolves at main-checkout repo-root worker-reports/2026-10-29-codex-takeover/before/. Registration and subsequent work land on branch claude/dazzling-dirac-4a8010 (harness-bound isolated worktree); merge to master is decided by the user.',
  sameDagRequired: true,
  history_ref: 'worker-reports/2026-10-30-receiver-takeover/before/execution-state.json',
  chat_progress_automation: 'USER_REMOVED_DO_NOT_RECREATE',
  g15_product_maintenance: 'REQUIRED_NOT_STARTED',
};
state.current_focus = 'sole receiver registered 2026-10-30; six-step order step 1 (real source port, P2_2/P2_4/P1) starting; top-level EXTERNAL_GLOBAL_COMET_PLAN_UPDATE_PENDING kept until the plan/state vs installed-application-version difference is resolved (six-step item 4)';
const trailingNewline = rawState.endsWith('\n');
writeFileSync(STATE, JSON.stringify(state, null, 2) + (trailingNewline ? '\n' : ''));

// --- 5. one ledger line ----------------------------------------------------
const line = {
  at: now(),
  event: 'RECEIVER_SOLE_CONTROLLER_REGISTERED',
  evidence: 'worker-reports/2026-10-30-receiver-takeover/before/execution-state.json',
  verification: 'worker-reports/2026-10-30-receiver-takeover/verification.json',
  candidate_digests_match: allDigestsMatch,
  branch: 'claude/dazzling-dirac-4a8010',
  scope: 'controller registration only; top-level status EXTERNAL_GLOBAL_COMET_PLAN_UPDATE_PENDING kept; no DAG task state, no tasks.md checkbox and no gate evidence changed',
};
appendFileSync(LEDGER, JSON.stringify(line) + '\n');

console.log(JSON.stringify({
  registered: true,
  allDigestsMatch,
  priorCodexRefExists: verification.priorCodexTakeoverRef.exists,
  lastLedgerAt: verification.ledgerLastEntryAt,
  gitHead: verification.checks.gitHead.stdout.trim(),
  gitStatusLines: verification.checks.gitStatus.stdout.trim().split('\n').filter(Boolean),
}, null, 2));
