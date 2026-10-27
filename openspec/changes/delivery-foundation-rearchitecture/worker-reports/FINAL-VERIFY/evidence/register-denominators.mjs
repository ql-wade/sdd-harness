#!/usr/bin/env node
// G-T1-02 denominator registration (FINAL-VERIFY worker).
//
// Registers, for each of the 103 current-domain required scenarios in
// verification-case-plan.json:
//   - required_proof_level: "component" when the registered (post-rebind)
//     case_module's real pinned-node TAP carries an executed ok test point
//     matching the scenario id (word-boundary, the validator's own rule);
//     "host" otherwise — the honest declaration that this scenario's proof
//     layer is above the component plane.
//   - required_assertions: [<scenario id>] — the frozen assertion denominator.
//     For component scenarios the id maps to real test points in the module
//     (verified below); for host scenarios it is the target a future frozen
//     host recipe must satisfy.
//   - required_readbacks: registered ONLY for host scenarios. Rationale (from
//     tools/verify/delivery-journey.mjs mechanics): any registered readback is
//     deep-validated against the case definition's id-anchored jsonFields/
//     equals actions (L859-881); the synthesized component definition carries
//     no such actions, so registering readbacks on component scenarios would
//     refuse every component run and destroy real evidence. Managed mode
//     short-circuits 'component' scenarios at the proof-level check (L785)
//     before readbacks, so a readback on a component scenario is unreachable
//     dead weight on every plane. On host scenarios it advances the managed
//     refusal from "proof-registration-missing" to the true root blocker
//     ("protected-source-unavailable: no qualified Comet launcher observation
//     interface is installed").
//
// Also lands the two registration reconciliations the prior VERIFY round
// demanded alongside the denominator (verification-report.md §5 G-T1-02):
//   - 9 module rebinds to modules that really carry the scenario's test point
//     (E06/L11 additionally reconcile the plan with the frozen journey
//     recipes that were already bound to 3_2/3_3);
//   - journey_definitions case_definition_sha256 freeze for the 3 recipes.
//
// Evidence basis: /tmp/tapscan/*.tap — real `node --test --test-reporter=tap`
// output of every case module, pinned node v24.15.0, captured this round
// before registration. The batch runner re-derives the authoritative verdicts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repo = '/Users/mac/Code/sdd-harness';
const change = path.join(repo, 'openspec/changes/delivery-foundation-rearchitecture');
const planPath = path.join(change, 'verification-case-plan.json');
const tapDir = '/tmp/tapscan';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const moduleForTap = (base) => (base.endsWith('.test')
  ? `test/${base}.js`
  : `test/delivery-cases/${base}.mjs`);

function parseTapPoints(text) {
  const points = [];
  for (const m of String(text ?? '').matchAll(/^[ \t]*(ok|not ok)\s+\d+\s+-\s+(.+)$/gm)) {
    const name = m[2];
    const todo = /#\s*TODO\b/i.test(name);
    const skipped = /#\s*SKIP\b/i.test(name) || todo;
    points.push({ ok: m[1] === 'ok', skipped, name: name.replace(/\s*#\s*(?:SKIP|TODO)\b.*$/i, '') });
  }
  return points;
}

// Faithful copy of the validator's assertionIdMatches (word-boundary match;
// composite ids keep ':' inside the token).
function assertionIdMatches(pointName, id) {
  if (/\s/.test(id)) return pointName === id;
  const inner = id.includes(':') ? 'A-Za-z0-9_:' : 'A-Za-z0-9';
  const boundary = new RegExp(`(^|[^${inner}])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^${inner}]|$)`);
  return boundary.test(pointName);
}

const tap = {};
for (const f of fs.readdirSync(tapDir)) {
  if (!f.endsWith('.tap')) continue;
  tap[moduleForTap(f.slice(0, -4))] = parseTapPoints(fs.readFileSync(path.join(tapDir, f), 'utf8'));
}

// Rebinds: scenario -> module that really carries an ok point for the id.
// Every entry was verified against the real TAP (see FINAL-VERIFY evidence).
const REBINDS = {
  B01: 'test/delivery-cases/3_2.mjs',
  C04: 'test/classic-integration.test.js',
  C06: 'test/classic-integration.test.js',
  C07: 'test/delivery-cases/1_5.mjs',
  D02: 'test/delivery-cases/2_5.mjs',
  E06: 'test/delivery-cases/3_2.mjs',
  H02: 'test/delivery-cases/4_5.mjs',
  N07: 'test/delivery-cases/3_4.mjs',
  L11: 'test/delivery-cases/3_3.mjs',
};

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const original = `${JSON.stringify(plan, null, 2)}\n`;

const out = { component: [], host: [], rebinds: [], hostReadbackIds: {} };
for (const [scenario, entry] of Object.entries(plan.cases)) {
  if (entry.required_in_current_completion === false) continue; // F10 scope-excluded
  if (REBINDS[scenario]) {
    out.rebinds.push({ scenario, from: entry.case_module, to: REBINDS[scenario] });
    entry.rebind_note = `FINAL-VERIFY binding reconciliation (G-T1-02): rebound from ${entry.case_module} (carries no test point for ${scenario}) to ${REBINDS[scenario]} which really executes an ok point matching the id; verified against pinned-node TAP this round`;
    entry.case_module = REBINDS[scenario];
  }
  const points = tap[entry.case_module] ?? [];
  const okPoint = points.find((p) => p.ok && !p.skipped && assertionIdMatches(p.name, scenario));
  entry.required_assertions = [scenario];
  if (okPoint) {
    entry.required_proof_level = 'component';
    out.component.push(scenario);
  } else {
    entry.required_proof_level = 'host';
    // Typed managed-recipe readback slot: the future frozen host recipe must
    // read back the managed Run state (native comet.classic vocabulary).
    entry.required_readbacks = [{
      id: `${scenario}:managed-run-state`,
      type: 'readState',
      expect: 'jsonFields',
      fields: ['runId', 'currentPhase'],
    }];
    out.host.push(scenario);
    out.hostReadbackIds[scenario] = `${scenario}:managed-run-state`;
  }
}

// Journey recipe freeze: sha256 of the three registered recipe files.
const journeyFreeze = {};
for (const [name, reg] of Object.entries(plan.journey_definitions)) {
  const bytes = fs.readFileSync(path.join(repo, reg.path));
  reg.case_definition_sha256 = sha256(bytes);
  journeyFreeze[name] = reg.case_definition_sha256;
}

plan.proof_registration = {
  registered_at: new Date().toISOString(),
  registered_by: 'FINAL-VERIFY worker (G-T1-02), controller-authorized denominator registration',
  basis: 'real pinned-node (v24.15.0) TAP of every case module captured this round; component level requires an executed ok point matching the scenario id under the validator word-boundary rule',
  component_scenarios: out.component.length,
  host_scenarios: out.host.length,
  host_readback_note: 'required_readbacks are registered only on host-level scenarios: the validator deep-checks readbacks against id-anchored jsonFields/equals actions of a frozen recipe, which no component scenario has yet; on host scenarios the slot advances the managed refusal to the true blocker (protected-source-unavailable)',
  journey_recipe_freeze: journeyFreeze,
};

const next = `${JSON.stringify(plan, null, 2)}\n`;
if (next === original) { console.error('plan unchanged — refusing to claim registration'); process.exit(2); }
fs.writeFileSync(planPath, next);
fs.writeFileSync(path.join(change, 'worker-reports/FINAL-VERIFY/evidence/registration-summary.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`registered: component=${out.component.length} host=${out.host.length} rebinds=${out.rebinds.length} journeys=${Object.keys(journeyFreeze).length}`);
console.log('component:', out.component.join(' '));
console.log('host:', out.host.join(' '));
