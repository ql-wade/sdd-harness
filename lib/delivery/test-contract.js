// Valid-RED classification and execution-denominator checks (tasks 2.1.c,
// A03/A04). Zero tests, all-skip runs and environment crashes are invalid
// executions: they can neither pass acceptance nor be recorded as behavior
// RED. Classification is deliberately conservative — when a run shows a known
// environment-failure signature or no TAP summary at all, it is treated as an
// environment failure (fail-closed), so a doubtful run must be re-executed in
// a clean environment instead of being trusted.
// Observed denominators always come from the TAP summary of the real run
// output, never from declared numbers.
import { parseContract } from '../../contracts/delivery/index.js';

const ENV_FAILURE_SIGNATURES = [
  [/ERR_MODULE_NOT_FOUND|Cannot find module|MODULE_NOT_FOUND/, 'module resolution failure'],
  [/\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|\bENOTFOUND\b|\bEAI_AGAIN\b/, 'network dependency unreachable'],
  [/\bEADDRINUSE\b|\bEACCES\b|\bENOENT\b/, 'local resource unavailable'],
  [/spawn (?:ENOENT|EACCES|ETIMEDOUT)/, 'process spawn failure'],
  [/command not found/i, 'command not found'],
  [/connection refused/i, 'connection refused'],
];

export function parseTapSummary(output) {
  const text = String(output ?? '');
  const grab = (name) => {
    const pattern = new RegExp(`^# ${name} (\\d+)`, 'gm');
    let last = null;
    for (const match of text.matchAll(pattern)) last = Number(match[1]);
    return last;
  };
  const tests = grab('tests');
  if (tests === null) return null;
  return {
    tests,
    suites: grab('suites') ?? 0,
    pass: grab('pass') ?? 0,
    fail: grab('fail') ?? 0,
    cancelled: grab('cancelled') ?? 0,
    skipped: grab('skipped') ?? 0,
    todo: grab('todo') ?? 0,
  };
}

export function classifyRunOutcome({ exitCode, output, spawnError } = {}) {
  if (spawnError) {
    return {
      kind: 'environment-failure',
      signatures: [spawnError.code ?? spawnError.message],
      summary: null,
    };
  }
  const text = String(output ?? '');
  const signatures = [];
  for (const [pattern, label] of ENV_FAILURE_SIGNATURES) {
    if (pattern.test(text)) signatures.push(label);
  }
  const summary = parseTapSummary(text);
  if (signatures.length > 0) {
    return { kind: 'environment-failure', signatures, summary };
  }
  if (!summary) {
    return {
      kind: 'environment-failure',
      signatures: ['no TAP summary: the command produced no test execution record'],
      summary: null,
    };
  }
  if (summary.tests !== summary.pass + summary.fail + summary.cancelled + summary.skipped + summary.todo || summary.cancelled > 0) {
    return { kind: 'environment-failure', signatures: ['incomplete or contradictory TAP execution counts'], summary };
  }
  if (summary.tests === 0) return { kind: 'empty', signatures: [], summary };
  if (summary.fail > 0) {
    if (!Number.isInteger(exitCode) || exitCode <= 0) {
      return { kind: 'environment-failure', signatures: ['failed TAP assertions require an observed nonzero exit code'], summary };
    }
    return { kind: 'behavior-red', signatures: [], summary };
  }
  if (summary.pass > 0) {
    if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
      return {
        kind: 'environment-failure',
        signatures: [`exit code ${exitCode} contradicts the passing TAP summary`],
        summary,
      };
    }
    return { kind: 'pass', signatures: [], summary };
  }
  return { kind: 'empty', signatures: [], summary };
}

export function evaluateExecutionDenominator({ summary }) {
  const reasons = [];
  let validExecutions = 0;
  if (!summary || summary.tests === 0) {
    reasons.push('zero tests executed');
  } else {
    validExecutions = summary.pass + summary.fail;
    if (validExecutions === 0) {
      reasons.push(`zero effective executions: ${summary.skipped} skipped, ${summary.cancelled} cancelled`);
    }
  }
  return { valid: reasons.length === 0, reasons, validExecutions };
}

export function requireValidRed(run) {
  const outcome = classifyRunOutcome(run);
  if (outcome.kind === 'behavior-red') {
    return { ok: true, outcome, reason: null };
  }
  const reason = outcome.kind === 'environment-failure'
    ? `environment failure is not a valid behavior RED (${outcome.signatures.join('; ')})`
    : outcome.kind === 'empty'
      ? 'zero valid executions is not a valid behavior RED'
      : 'run passed; there is no RED to record';
  return { ok: false, outcome, reason };
}

// Acceptance-side evaluation against a frozen TestContract: the run must be a
// real passing execution and must meet the declared execution denominator.
// Caller policy belongs in the separate options argument, never in worker
// payloads. Even strict results remain component observations: admission and
// independent Journey authority must be proved by their actual owners.
export function evaluateExecution({ testContract, run }, { requireCommands = false } = {}) {
  const scope = requireCommands === true ? 'component/required-command-links'
    : testContract?.commandBindingsRequired === true ? 'component/declared-command-links' : 'component/ac-only';
  const boundary = { scope, managedClosureEligible: false };
  if (typeof requireCommands !== 'boolean' || (requireCommands && testContract?.commandBindingsRequired !== true)) {
    return { ...boundary, verdict: 'reject', reasons: ['protected caller requires a command-bound TestContract; payload cannot downgrade this requirement'], outcome: null, summary: null, observedValidExecutions: 0 };
  }
  const parsed = parseContract('SDD.Delivery.TestContract', testContract);
  if (!parsed.ok) {
    return {
      ...boundary,
      verdict: 'reject',
      reasons: parsed.errors.map((error) => `invalid TestContract: ${error}`),
      outcome: null,
      summary: null,
      observedValidExecutions: 0,
    };
  }
  const outcome = classifyRunOutcome(run);
  const summary = outcome.summary;
  const reasons = [];
  if (outcome.kind === 'environment-failure') {
    reasons.push(`environment failure is not valid acceptance evidence (${outcome.signatures.join('; ')})`);
  } else if (outcome.kind === 'behavior-red') {
    reasons.push(`run reports ${summary.fail} behavior failure(s); acceptance requires a passing run`);
  }
  const denominator = evaluateExecutionDenominator({ summary });
  reasons.push(...denominator.reasons);
  // Observation links are data checks, NOT origin authentication. A trusted
  // recorder/admission layer must bind these results to real execution later.
  if (parsed.value.commandBindingsRequired === true) {
    const observed = Array.isArray(run?.caseResults) ? run.caseResults : [];
    for (const entry of parsed.value.cases.filter((c) => c.required !== false)) {
      for (const checkId of entry.checkIds) {
        const check = parsed.value.requiredChecks.find((c) => c.id === checkId);
        const records = observed.filter((item) => item?.caseId === entry.id && item.checkId === checkId);
        if (records.length !== 1 || records[0].status !== 'pass' || records[0].command !== check.command) {
          reasons.push(`required execution link missing or inconsistent: case ${entry.id}, check ${checkId}`);
        }
      }
    }
  }
  const declared = parsed.value.executionDenominator.totalCases;
  if (denominator.validExecutions < declared) {
    reasons.push(`execution denominator unmet: declared ${declared}, observed ${denominator.validExecutions}`);
  }
  return {
    ...boundary,
    verdict: reasons.length > 0 ? 'reject' : 'accept',
    reasons,
    outcome,
    summary,
    declared,
    observedValidExecutions: denominator.validExecutions,
  };
}
