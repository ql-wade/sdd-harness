// P2_4-r3 live gate builder: content-address-stable per-gate receipt bundle
// (composition.json gateArtifactContract writeProtocol). The bundle bytes are
// a pure function of the judged evidence — recursively key-sorted JSON,
// 2-space indent, trailing newline. `divergeNote` (B-③ negative leg) injects
// an epoch-derived field on purpose: the bytes then diverge for identical
// evidence, which the packaged validator must refuse at record time.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const PROJ = process.argv[2];
const GATE = process.argv[3];
const activationFile = process.argv[4];
const divergeNote = process.argv[5] && process.argv[5] !== '' ? process.argv[5] : null;
const { createLaunchAuthority, admitEvidence } = await import(path.join(PROJ, 'lib/delivery/evidence.js'));
const { evaluate } = await import(path.join(PROJ, 'lib/delivery/gate.js'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const canon = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
};
const sortedClone = (v) => {
  if (Array.isArray(v)) return v.map(sortedClone);
  if (v !== null && typeof v === 'object') {
    const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortedClone(v[k]); return o;
  }
  return v;
};
const source = JSON.parse(fs.readFileSync(activationFile, 'utf8')).source;
const sourceHash = sha256(canon(source));
const inputDigest = source.event.contentHash;
const CAP = { R: 'requirements-open-confirmed', A: 'architecture-consensus-unanimous', T: 'test-design-sufficient', P: 'build-plan-unique', V: 'verify-whitebox-pass' }[GATE];
const RUN = 'p24r3-live';
const execution = `exec-${GATE.toLowerCase()}-canonical`; // deterministic, epoch-independent
const policy = { ref: `p24r3-live/${GATE.toLowerCase()}-gate`, digest: sha256(`p24r3-live-${GATE}-policy`) };
const authority = createLaunchAuthority({ secret: sha256(`p24r3-live-${GATE}-authority-secret`) });
const dispatch = authority.issueDispatch({ runnerId: 'p24r3-live-host', run: RUN, gate: CAP, role: 'verifier', execution, inputDigest, policyDigest: policy.digest, attempt: 1, epoch: 1 });
const evidenceRefs = { R: ['openspec/changes/p24r3-live/proposal.md', 'openspec/changes/p24r3-live/design.md'], A: ['openspec/changes/p24r3-live/design.md'], T: ['openspec/changes/p24r3-live/design.md'], P: ['docs/superpowers/plans/p24r3-live.md'], V: ['lib/delivery/gate.js'] }[GATE];
const evidenceItems = evidenceRefs.map((rel) => ({ uri: rel, sha256: sha256(fs.readFileSync(path.join(PROJ, rel))) }));
const envelope = {
  schemaVersion: 1, candidateDigest: inputDigest, caseId: 'c1', check: CAP,
  origin: { kind: 'registered-runner', id: 'p24r3-live-host' }, execution: { id: execution },
  environment: 'p24r3-live /private/tmp one-shot world', toolchain: 'node v24.15.0',
  executions: { total: 1, valid: 1 }, result: 'pass', evidence: evidenceItems,
  expiry: '2199-01-01T00:00:00.000Z',
};
const admitted = admitEvidence({ envelope, dispatch, authority, current: { inputDigest, policyDigest: policy.digest, environment: envelope.environment }, issuedExecutions: [] });
if (!admitted.ok) { console.error(JSON.stringify({ ok: false, stage: 'admit', error: admitted.error, reason: admitted.reason })); process.exit(2); }
const LEVEL = { R: 'requirements', A: 'design', T: 'design', P: 'build', V: 'verify' }[GATE];
const testContract = {
  schemaVersion: 1, project: 'p24r3-live', change: RUN,
  cases: [{ id: 'c1', ac: { R: 'D01', A: 'D02', T: 'D03', P: 'D04', V: 'D05' }[GATE], oracle: `live ${GATE} gate oracle bound to the ${LEVEL} digest`, checkIds: ['g1'] }],
  requiredChecks: [{ id: 'g1', level: LEVEL, capability: CAP, caseIds: ['c1'] }],
  executionDenominator: { totalCases: 1 },
  cleanup: { environment: 'one-shot /private/tmp world', data: 'none persisted outside the world' },
  dependencyBaselines: [{ kind: 'comet-build', digest: 'de39629a80fb32f16f3fa12515523988d775f957a62e16941542438c3b61908a' }],
};
const inputs = { inputDigest, testContract, builderExecution: 'exec-builder-canonical' };
const receipts = [admitted.entry];
const localVerdict = evaluate(inputs, receipts, policy);
if (localVerdict.verdict !== 'pass') { console.error(JSON.stringify({ ok: false, stage: 'evaluate', verdict: localVerdict.verdict, blocked: localVerdict.receipt?.blocked })); process.exit(2); }
const artifactRef = `.sdd/delivery/gates/${GATE.toLowerCase()}/receipt-bundle.json`;
let bundle = {
  schema: 'sdd.delivery.gate.receipt-bundle.v1', kind: 'gate-receipt-bundle', gate: GATE,
  artifactRef, hashBinding: 'artifactHashes', writtenBy: 'extension-execution',
  inputs, receipts, policy,
  evaluatedBy: `sdd.delivery.gate.${GATE.toLowerCase()}@1 (packaged bindings -> lib/delivery/gate.js evaluate)`,
  verdict: localVerdict.verdict, receipt: localVerdict.receipt,
};
if (divergeNote) bundle.epochNote = divergeNote;
const bundleBytes = Buffer.from(`${JSON.stringify(sortedClone(bundle), null, 2)}\n`, 'utf8');
fs.mkdirSync(path.join(PROJ, path.dirname(artifactRef)), { recursive: true });
fs.writeFileSync(path.join(PROJ, artifactRef), bundleBytes);
const output = { verdict: 'pass', sourceHash, artifactHashes: { [artifactRef]: sha256(bundleBytes) }, gateEvidence: { gate: GATE, inputs, receipts, policy } };
console.log(JSON.stringify({ ok: true, gate: GATE, diverged: Boolean(divergeNote), output }, null, 1));
