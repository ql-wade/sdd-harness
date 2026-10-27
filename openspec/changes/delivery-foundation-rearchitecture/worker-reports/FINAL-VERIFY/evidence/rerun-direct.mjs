#!/usr/bin/env node
// Re-run Phase D (direct registered commands) with correct executables — the
// batch runner's Phase D spawn had the same executable-resolution bug the
// prior VERIFY round hit (nodeBin prefixed onto argv), voided and re-run here.
// V_RW_COMPLETION_REQUIRED is re-run separately against the FINAL index
// (see finalize sequence in the worker report): this pass records it against
// the pre-projection index for transparency, and direct-rerun-final.json
// carries the post-projection verdict that the shipped artifacts pair with.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = '/Users/mac/Code/sdd-harness';
const change = path.join(repo, 'openspec/changes/delivery-foundation-rearchitecture');
const ev = path.join(change, 'worker-reports/FINAL-VERIFY/evidence');
const nodeDir = `${process.env.HOME}/.nvm/versions/node/v24.15.0/bin`;
const env = { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` };
const contract = JSON.parse(fs.readFileSync(path.join(change, 'execution-contract.json'), 'utf8'));

const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
const results = [];
for (const c of contract.checks) {
  if (c.command.startsWith('node tools/verify/delivery-journey.mjs')) continue;
  const argv = c.command.split(/\s+/);
  if (argv[0] === 'node') argv[0] = `${nodeDir}/node`;
  const started = Date.now();
  const res = spawnSync(argv[0], argv.slice(1), { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 1_800_000, env });
  const row = {
    id: c.id, kind: 'direct', exitCode: res.status, verdict: null, reason: null,
    durationMs: Date.now() - started,
    stdoutTail: res.stdout ? String(res.stdout).slice(-400) : null,
    stderrTail: res.stderr ? String(res.stderr).slice(-400) : null,
    command: c.command,
  };
  results.push(row);
  console.log(`[D2] ${c.id} exit=${res.status} (${row.durationMs}ms)`);
}
fs.writeFileSync(path.join(ev, 'direct-rerun.json'), `${JSON.stringify({ head, ranAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log('D rerun done:', results.filter((r) => r.exitCode === 0).length, '/', results.length, 'exit 0');
