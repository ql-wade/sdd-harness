#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const liveRunner = path.join(scriptDir, 'live-e2e.js');
const reportGate = path.join(scriptDir, 'assert-live-report.js');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: process.env,
    timeout: options.timeout,
    killSignal: 'SIGTERM',
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || result.error?.message || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function parseLastJson(output, label) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  throw new Error(`${label} did not emit a JSON result`);
}

try {
  const fixture = path.resolve(requiredEnv('SDD_LIVE_FIXTURE'));
  const driver = path.resolve(requiredEnv('SDD_LIVE_DRIVER'));
  const output = path.resolve(process.env.SDD_LIVE_OUTPUT || path.join(repoRoot, 'reports', 'live-e2e'));
  const driverTimeout = Number(process.env.SDD_LIVE_DRIVER_TIMEOUT_MS || 3600000);
  if (!fs.existsSync(driver)) throw new Error(`SDD_LIVE_DRIVER does not exist: ${driver}`);

  const prepareOutput = run(process.execPath, [
    liveRunner,
    '--prepare-only',
    '--fixture', fixture,
    '--output', output,
  ]);
  const prepare = parseLastJson(prepareOutput, 'prepare');

  const driverOutput = run(driver, [
    '--prepare-report', prepare.reportPath,
    '--workspace', prepare.workspace,
    '--output', output,
    '--harness', repoRoot,
  ], { cwd: prepare.workspace, timeout: driverTimeout });
  const session = parseLastJson(driverOutput, 'live driver');
  if (!session.change || !session.ledger) {
    throw new Error('live driver result requires change and ledger');
  }

  const finalOutput = run(process.execPath, [
    liveRunner,
    '--finalize',
    '--prepare-report', prepare.reportPath,
    '--workspace', prepare.workspace,
    '--change', session.change,
    '--ledger', session.ledger,
    '--output', output,
  ]);
  const finalReport = parseLastJson(finalOutput, 'finalize');
  run(process.execPath, [reportGate, '--report', finalReport.reportPath]);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    pass: true,
    prepareReport: prepare.reportPath,
    finalReport: finalReport.reportPath,
    workspace: prepare.workspace,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
