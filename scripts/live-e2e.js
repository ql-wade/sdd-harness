#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXCLUDED_NAMES = new Set([
  '.claude',
  '.codex',
  '.git',
  '.opencode',
  '.sdd',
  '.understand-anything',
  'coverage',
  'dist',
  'llmwiki',
  'node_modules',
  'openspec',
]);

const REQUIRED_CAPABILITIES = [
  'spec-engine',
  'agent-host',
  'knowledge-base',
  'code-graph',
  'project-tests',
  'architecture-review',
  'line-review',
  'browser',
  'deploy',
];

const STAGE_TRANSITIONS = [
  ['grill', 'product'],
  ['product', 'dev'],
  ['dev', 'test'],
  ['test', 'code'],
  ['code', 'review'],
  ['review', 'verify'],
  ['verify', 'release'],
  ['release', 'archive'],
];

function parseArgs(argv) {
  const separator = argv.indexOf('--');
  const optionTokens = separator === -1 ? argv : argv.slice(0, separator);
  const args = {
    prepareOnly: false,
    record: false,
    recordStatus: false,
    finalize: false,
    command: separator === -1 ? [] : argv.slice(separator + 1),
  };
  const valueOptions = new Set([
    '--fixture',
    '--output',
    '--workspace',
    '--ledger',
    '--id',
    '--prepare-report',
    '--change',
    '--timeout-ms',
    '--status',
    '--reason',
  ]);
  for (let index = 0; index < optionTokens.length; index += 1) {
    const token = optionTokens[index];
    if (token === '--prepare-only') {
      args.prepareOnly = true;
    } else if (token === '--record') {
      args.record = true;
    } else if (token === '--record-status') {
      args.recordStatus = true;
    } else if (token === '--finalize') {
      args.finalize = true;
    } else if (valueOptions.has(token)) {
      const value = optionTokens[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${token} requires a value`);
      }
      const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }

  const modeCount = [args.prepareOnly, args.record, args.recordStatus, args.finalize].filter(Boolean).length;
  if (modeCount !== 1) throw new Error('Choose exactly one mode: --prepare-only, --record, --record-status, or --finalize');
  if (args.prepareOnly && !args.fixture) throw new Error('--fixture is required');
  if (args.prepareOnly && !args.output) throw new Error('--output is required');
  if (args.record && !args.workspace) throw new Error('--workspace is required');
  if (args.record && !args.ledger) throw new Error('--ledger is required');
  if (args.record && !args.id) throw new Error('--id is required');
  if (args.record && args.command.length === 0) throw new Error('--record requires a command after --');
  if (args.record && args.timeoutMs !== undefined && (!Number.isInteger(Number(args.timeoutMs)) || Number(args.timeoutMs) <= 0)) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  if (args.recordStatus && !args.workspace) throw new Error('--workspace is required');
  if (args.recordStatus && !args.ledger) throw new Error('--ledger is required');
  if (args.recordStatus && !args.id) throw new Error('--id is required');
  if (args.recordStatus && !['not-applicable', 'missing'].includes(args.status)) {
    throw new Error('--record-status requires --status not-applicable|missing');
  }
  if (args.recordStatus && (!args.reason || !args.reason.trim())) {
    throw new Error('--record-status requires a non-empty --reason');
  }
  if (args.finalize && !args.prepareReport) throw new Error('--prepare-report is required');
  if (args.finalize && !args.workspace) throw new Error('--workspace is required');
  if (args.finalize && !args.change) throw new Error('--change is required');
  if (args.finalize && !args.ledger) throw new Error('--ledger is required');
  if (args.finalize && !args.output) throw new Error('--output is required');
  return args;
}

function shouldExclude(name) {
  return EXCLUDED_NAMES.has(name);
}

function walkFiles(root, relative = '') {
  const absolute = path.join(root, relative);
  return fs.readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => !shouldExclude(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) return walkFiles(root, entryRelative);
      return [entryRelative];
    });
}

function hashFixture(root) {
  const hash = crypto.createHash('sha256');
  for (const relative of walkFiles(root)) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    hash.update(relative.split(path.sep).join('/'));
    hash.update('\0');
    if (stat.isSymbolicLink()) {
      hash.update(`link:${fs.readlinkSync(absolute)}`);
    } else {
      hash.update(fs.readFileSync(absolute));
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

function copyFixture(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (shouldExclude(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyFixture(from, to);
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(from), to);
    } else {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode);
    }
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
}

function sha256Bytes(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function canonicalPath(candidate) {
  const suffix = [];
  let cursor = path.resolve(candidate);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const existing = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.join(existing, ...suffix);
}

function ensureInside(root, candidate, label) {
  const resolvedRoot = canonicalPath(root);
  const resolved = canonicalPath(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} must be inside workspace: ${resolved}`);
  }
  return resolved;
}

function readLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return { schemaVersion: 1, receipts: [] };
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.receipts)) {
    throw new Error('Invalid live E2E ledger');
  }
  return ledger;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function recordCommand(args) {
  const workspace = canonicalPath(args.workspace);
  const ledgerPath = ensureInside(workspace, args.ledger, 'ledger');
  const [command, ...commandArgs] = args.command;
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, commandArgs, {
    cwd: workspace,
    encoding: 'utf8',
    env: process.env,
    timeout: Number(args.timeoutMs || 600000),
    killSignal: 'SIGTERM',
  });
  const endedAt = new Date().toISOString();
  const output = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');
  const logsDir = path.join(workspace, '.sdd', 'live-e2e', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const safeId = args.id.replace(/[^a-zA-Z0-9._-]/g, '-');
  const outputPath = path.join(logsDir, `${safeId}-${Date.now()}.log`);
  fs.writeFileSync(outputPath, output);
  const receipt = {
    schemaVersion: 1,
    id: args.id,
    status: result.status === 0 ? 'passed' : 'failed',
    source: 'runner',
    command: [command, ...commandArgs],
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    error: result.error?.message || null,
    startedAt,
    endedAt,
    outputPath,
    outputSha256: sha256File(outputPath),
  };
  const ledger = readLedger(ledgerPath);
  ledger.receipts.push(receipt);
  writeJson(ledgerPath, ledger);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (result.status !== 0) process.exitCode = 2;
}

function recordStatus(args) {
  const workspace = canonicalPath(args.workspace);
  const ledgerPath = ensureInside(workspace, args.ledger, 'ledger');
  const receipt = {
    schemaVersion: 1,
    id: args.id,
    status: args.status,
    source: 'attestation',
    reason: args.reason.trim(),
    recordedAt: new Date().toISOString(),
  };
  const ledger = readLedger(ledgerPath);
  ledger.receipts.push(receipt);
  writeJson(ledgerPath, ledger);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (receipt.status === 'missing') process.exitCode = 2;
}

function yamlValue(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch {}
  }
  return trimmed;
}

function inspectWorkflow(workflowPath) {
  if (!fs.existsSync(workflowPath)) {
    return { current: null, runStatus: null, transitions: [] };
  }
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const transitions = [...workflow.matchAll(
    /^\s*-\s+from:\s*(.+?)\s*$\n\s+to:\s*(.+?)\s*$/gm,
  )].map((match) => [yamlValue(match[1]), yamlValue(match[2])]);
  return {
    current: workflow.match(/^\s*current:\s*(.+?)\s*$/m)?.[1]?.trim() || null,
    runStatus: workflow.match(/^run_status:\s*(.+?)\s*$/m)?.[1]?.trim() || null,
    transitions,
  };
}

function containsStageTrace(actual) {
  let expectedIndex = 0;
  for (const transition of actual) {
    const expected = STAGE_TRANSITIONS[expectedIndex];
    if (expected && transition[0] === expected[0] && transition[1] === expected[1]) {
      expectedIndex += 1;
    }
  }
  return expectedIndex === STAGE_TRANSITIONS.length;
}

function validateReceipt(workspace, capability, receipt) {
  if (!receipt) {
    return { code: 'CAPABILITY_RECEIPT_MISSING', capability };
  }
  if (receipt.status === 'not-applicable') {
    if (typeof receipt.reason === 'string' && receipt.reason.trim()) return null;
    return { code: 'NOT_APPLICABLE_REASON_MISSING', capability };
  }
  if (receipt.status !== 'passed') {
    return { code: 'CAPABILITY_NOT_PASSED', capability, status: receipt.status || 'unknown' };
  }
  if (receipt.source !== 'runner' || !Array.isArray(receipt.command) || receipt.exitCode !== 0) {
    return { code: 'CAPABILITY_RECEIPT_UNVERIFIABLE', capability };
  }
  try {
    const outputPath = ensureInside(workspace, receipt.outputPath, 'receipt output');
    if (!fs.existsSync(outputPath) || sha256File(outputPath) !== receipt.outputSha256) {
      return { code: 'CAPABILITY_RECEIPT_OUTPUT_MISMATCH', capability };
    }
  } catch {
    return { code: 'CAPABILITY_RECEIPT_OUTPUT_MISMATCH', capability };
  }
  return null;
}

function finalize(args) {
  const prepare = JSON.parse(fs.readFileSync(path.resolve(args.prepareReport), 'utf8'));
  const workspace = canonicalPath(args.workspace);
  const output = path.resolve(args.output);
  const issues = [];
  if (canonicalPath(prepare.workspace) !== workspace || prepare.mode !== 'prepare-only' || prepare.pass !== true) {
    issues.push({ code: 'PREPARE_REPORT_MISMATCH' });
  }

  const fixtureHashAfter = hashFixture(path.resolve(prepare.fixture));
  if (fixtureHashAfter !== prepare.fixtureHashBefore) {
    issues.push({ code: 'SOURCE_FIXTURE_CHANGED' });
  }

  const workflowPath = path.join(workspace, '.sdd', 'runs', args.change, 'workflow-frame.yaml');
  const workflow = inspectWorkflow(workflowPath);
  if (workflow.current !== 'archive' || workflow.runStatus !== 'completed') {
    issues.push({
      code: 'WORKFLOW_NOT_COMPLETED',
      current: workflow.current,
      runStatus: workflow.runStatus,
    });
  }
  if (!containsStageTrace(workflow.transitions)) {
    issues.push({ code: 'WORKFLOW_TRACE_INCOMPLETE', transitions: workflow.transitions });
  }

  const ledgerPath = ensureInside(workspace, args.ledger, 'ledger');
  const ledger = readLedger(ledgerPath);
  const receiptResults = [];
  for (const capability of REQUIRED_CAPABILITIES) {
    const receipt = ledger.receipts.filter((item) => item.id === capability).at(-1);
    const issue = validateReceipt(workspace, capability, receipt);
    if (issue) issues.push(issue);
    receiptResults.push({ capability, receipt: receipt || null, pass: !issue });
  }

  fs.mkdirSync(output, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const reportPath = path.join(output, `live-e2e-final-${timestamp}.json`);
  const report = {
    schemaVersion: 1,
    mode: 'finalize',
    pass: issues.length === 0,
    fixture: prepare.fixture,
    fixtureHashBefore: prepare.fixtureHashBefore,
    fixtureHashAfter,
    workspace,
    change: args.change,
    workflowPath,
    workflow,
    ledgerPath,
    capabilities: receiptResults,
    issues,
    reportPath,
  };
  writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.pass) process.exitCode = 2;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.record) {
    recordCommand(args);
    return;
  }
  if (args.recordStatus) {
    recordStatus(args);
    return;
  }
  if (args.finalize) {
    finalize(args);
    return;
  }
  const fixture = path.resolve(args.fixture);
  const output = path.resolve(args.output);
  if (!fs.statSync(fixture).isDirectory()) {
    throw new Error(`Fixture is not a directory: ${fixture}`);
  }

  fs.mkdirSync(output, { recursive: true });
  const fixtureHashBefore = hashFixture(fixture);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-live-e2e-'));
  copyFixture(fixture, workspace);
  run('git', ['init', '--quiet'], workspace);
  const fixtureHashAfter = hashFixture(fixture);
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const reportPath = path.join(output, `live-e2e-${timestamp}.json`);
  const report = {
    schemaVersion: 1,
    mode: 'prepare-only',
    pass: fixtureHashBefore === fixtureHashAfter,
    fixture,
    fixtureHashBefore,
    fixtureHashAfter,
    workspace,
    excluded: [...EXCLUDED_NAMES].sort(),
    reportPath,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.pass) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
