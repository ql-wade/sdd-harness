// Entry-closure evidence (T5 pieces 1–2): the PACKAGED R validator, reached
// through the same bindings.mjs chain the managed entry installs, refuses an
// unsubstantiated requirements pass and accepts a genuinely covered one.
// Construction mirrors test/comet-execution-binding.test.js (the P2_2
// evidence path) — nothing here invents a new admission route.
//
// Run: node openspec/changes/delivery-foundation-rearchitecture/pilot-journey/entry-closure-evidence.mjs
// Writes verdicts to pilot-journey/evidence/entry-closure/.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cometLaunchAuthority } from '../../../../lib/adapters/comet.js';
import { admitEvidence } from '../../../../lib/delivery/evidence.js';

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUN_ID = 'entry-closure-evidence';
const INPUT = sha('entry-closure-input-r1');
const POLICY = { ref: 'policy/entry-closure', digest: sha('policy/entry-closure') };

const { createBindings } = await import(path.join(repository, 'integrations/comet/application/bindings.mjs'));
const bindings = await createBindings();
const rValidator = bindings.validators.find((validator) => validator.id === 'sdd.delivery.gate.r');
if (!rValidator) throw new Error('packaged R validator is not registered');

const launcher = cometLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), runId: RUN_ID });

function admittedReceipt(execution) {
  const dispatch = launcher.issueDispatch({
    runnerId: 'comet-classic', run: RUN_ID, gate: 'R',
    inputDigest: INPUT, policyDigest: POLICY.digest,
    attempt: 1, epoch: 1, role: 'verifier', execution,
  });
  const admitted = admitEvidence({
    envelope: {
      schemaVersion: 1, candidateDigest: INPUT, caseId: 'c1', check: 'unit:node:test',
      origin: { kind: 'registered-runner', id: 'comet-classic' }, execution: { id: execution },
      environment: 'entry-closure-env', toolchain: 'node v24.15.0', executions: { total: 3, valid: 3 },
      result: 'pass', evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: sha('tap-output') }],
      expiry: '2099-01-01T00:00:00.000Z',
    },
    dispatch, authority: launcher,
    current: { inputDigest: INPUT, policyDigest: POLICY.digest, environment: 'entry-closure-env' },
    now: '2026-10-26T12:00:00.000Z',
  });
  if (!admitted.ok) throw new Error(`fixture admission failed: ${admitted.reason ?? ''}`);
  return admitted.entry;
}

function outcome({ requiredChecks, receipts, builderExecution = 'exec-builder-entry-1' }) {
  return {
    verdict: 'pass',
    sourceHash: sha('entry-closure-source'),
    artifactHashes: { '.sdd/delivery/gates/r/receipt-bundle.json': sha('r-bundle-bytes') },
    output: {
      gateEvidence: {
        gate: 'R',
        inputs: {
          inputDigest: INPUT,
          builderExecution,
          testContract: {
            schemaVersion: 1, project: 'sdd-harness', change: 'entry-closure',
            cases: [{ id: 'c1', ac: 'F05', oracle: 'required capabilities are observed before pass' }],
            requiredChecks, executionDenominator: { totalCases: 1 },
            cleanup: { environment: 'temp dir removed', data: 'none persisted' },
            dependencyBaselines: [{ kind: 'product', digest: sha('product-entry-r1') }],
          },
        },
        receipts,
        policy: POLICY,
      },
    },
  };
}

const stamp = new Date().toISOString();
const run = { runId: RUN_ID };
const action = { gate: 'R' };

// Piece 1 — REJECT: a requirements pass that claims a capability no receipt
// observes (the "junk requirements deliverable": asserted, never evidenced).
const rejectVerdict = rValidator.validate({
  run, action,
  outcome: outcome({
    requiredChecks: [
      { level: 'unit', capability: 'unit:node:test' },
      { level: 'ui', capability: 'console' },
    ],
    receipts: [admittedReceipt('exec-r-entry-reject')],
  }),
});

// Piece 2 — PASS: same shape, every required check covered by an admitted
// receipt through the real admission path.
const passVerdict = rValidator.validate({
  run, action,
  outcome: outcome({
    requiredChecks: [{ level: 'unit', capability: 'unit:node:test' }],
    receipts: [admittedReceipt('exec-r-entry-pass')],
  }),
});

const outDir = path.join(repository, 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/evidence/entry-closure');
fs.mkdirSync(outDir, { recursive: true });

const record = {
  stamp,
  runner: 'node openspec/changes/delivery-foundation-rearchitecture/pilot-journey/entry-closure-evidence.mjs',
  validator: 'sdd.delivery.gate.r@1 via integrations/comet/application/bindings.mjs (packaged chain the managed entry installs)',
  reject: { accepted: rejectVerdict.accepted, reason: rejectVerdict.reason ?? null },
  pass: { accepted: passVerdict.accepted, reason: passVerdict.reason ?? null },
  honest: {
    rejectRefused: rejectVerdict.accepted === false,
    passAccepted: passVerdict.accepted === true,
  },
};
fs.writeFileSync(path.join(outDir, 'r-gate-verdicts.json'), JSON.stringify(record, null, 2) + '\n');

console.log(JSON.stringify(record, null, 2));
if (!record.honest.rejectRefused || !record.honest.passAccepted) {
  console.error('EVIDENCE FAILED: the packaged R validator did not behave as required');
  process.exit(1);
}
console.log('OK: both verdicts recorded and honest.');
