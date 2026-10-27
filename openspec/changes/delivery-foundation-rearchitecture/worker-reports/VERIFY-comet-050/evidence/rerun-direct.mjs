#!/usr/bin/env node
// Re-run Phase D (direct registered commands) with correct executables.
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';

const repo = '/Users/mac/Code/sdd-harness';
const change = path.join(repo, 'openspec/changes/delivery-foundation-rearchitecture');
const ev = path.join(change, 'worker-reports/VERIFY-comet-050/evidence');
const nodeBin = `${process.env.HOME}/.nvm/versions/node/v24.15.0/bin`;
const env = { ...process.env, PATH: `${nodeBin}:${process.env.PATH}` };
const contract = JSON.parse(fs.readFileSync(path.join(change, 'execution-contract.json'), 'utf8'));
const batch = JSON.parse(fs.readFileSync(path.join(ev, 'batch-results.json'), 'utf8'));

const results = [];
for (const c of contract.checks) {
  if (c.command.startsWith('node tools/verify/delivery-journey.mjs')) continue;
  const argv = c.command.split(/\s+/);
  if (argv[0] === 'node') argv[0] = `${nodeBin}/node`;
  const started = Date.now();
  const res = spawnSync(argv[0], argv.slice(1), { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 1_800_000, env });
  const row = {
    id: c.id, kind: 'direct', exitCode: res.status, verdict: null, reason: null,
    durationHint: Date.now() - started,
    tapSummary: (() => {
      const text = `${res.stdout ?? ''}${res.stderr ?? ''}`;
      const grab = (n) => { const m = [...text.matchAll(new RegExp(`[#ℹ] ${n} (\\d+)`, 'g'))].at(-1); return m ? Number(m[1]) : null; };
      const tests = grab('tests'); return tests === null ? null : { tests, pass: grab('pass'), fail: grab('fail') };
    })(),
    stdoutTail: res.stdout ? String(res.stdout).slice(-300) : null,
    stderrTail: res.stderr ? String(res.stderr).slice(-400) : null,
    command: c.command,
  };
  results.push(row);
  console.log(`[D2] ${c.id} exit=${res.status} tests=${row.tapSummary ? row.tapSummary.tests : '-'}`);
}
batch.phases.D_direct = results;
fs.writeFileSync(path.join(ev, 'batch-results.json'), `${JSON.stringify(batch, null, 2)}\n`);
fs.writeFileSync(path.join(ev, 'direct-rerun.log'), results.map((r) => `${r.id} exit=${r.exitCode}`).join('\n') + '\n');
console.log('D rerun done:', results.filter((r) => r.exitCode === 0).length, '/', results.length, 'exit 0');
