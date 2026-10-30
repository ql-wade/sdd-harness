// Project-local case projection; this module never executes tests or grants gates.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseContract } from './contracts-delivery-index.mjs';
import { envelopeDigest } from './lib-delivery-evidence.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`DOMAIN_CASES_INVALID: ${message}`); };
const nonempty = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be non-empty`);
  return value.trim();
};
const onlyKeys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`invalid ${label} fields`);
};

function readContained(root, relative) {
  nonempty(relative, 'path');
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || relative.includes('\0')) fail('path must stay in project');
  const actual = fs.realpathSync(path.resolve(root, relative));
  if (actual === root || path.relative(root, actual).startsWith(`..${path.sep}`) || path.isAbsolute(path.relative(root, actual))) fail('path escapes project');
  const stat = fs.statSync(actual);
  if (!stat.isFile() || stat.size > 1024 * 1024) fail('path must be a regular file under 1 MiB');
  return fs.readFileSync(actual);
}

const listFields = new Set(['Precondition', 'Step', 'Evidence', 'Cleanup', 'Check ID', 'Inherit']);
const singleFields = new Set(['Requirement IDs', 'Acceptance', 'Dimensions', 'Level', 'Priority', 'Input', 'Expected', 'Oracle basis', 'Oracle authority']);
const optionalFields = new Set(['Automation path', 'Automation test ID', 'Automation command']);

function addField(fields, line, label) {
  const field = /^-\s+\*\*([^*]+)\*\*:\s*(\S.*)$/.exec(line);
  if (!field || (!listFields.has(field[1]) && !singleFields.has(field[1]) && !optionalFields.has(field[1]))) fail(`unrecognized content for ${label}`);
  const [key, value] = [field[1], field[2].trim()];
  if (listFields.has(key)) (fields[key] ??= []).push(value);
  else if (fields[key] !== undefined) fail(`duplicate ${key} in ${label}`);
  else fields[key] = value;
}

function expandFields(root, fields, shared, visits, stack = []) {
  if (stack.length > 8) fail('shared section nesting exceeds 8');
  const result = {};
  for (const ref of fields.Inherit ?? []) {
    if (++visits.count > 256) fail('shared reference limit exceeded');
    const match = /^([^#]+)#([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(ref);
    if (!match) fail('shared reference must be a relative file and explicit heading');
    const [, file, anchor] = match;
    const bytes = readContained(root, file);
    const key = `${fs.realpathSync(path.resolve(root, file))}#${anchor}`;
    if (stack.includes(key)) fail('cyclic shared section reference');
    shared.set(file, digest(bytes));
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/);
    const starts = lines.flatMap((line, index) => line.trim() === `## ${anchor}` ? [index] : []);
    if (starts.length !== 1) fail(`shared heading ${anchor} must occur once`);
    const nested = {};
    for (const line of lines.slice(starts[0] + 1)) {
      if (/^#{1,2}\s/.test(line)) break;
      if (line.trim()) addField(nested, line, ref);
    }
    const expanded = expandFields(root, nested, shared, visits, [...stack, key]);
    for (const [name, value] of Object.entries(expanded)) {
      if (listFields.has(name)) (result[name] ??= []).push(...value);
      else if (result[name] !== undefined) fail(`duplicate inherited ${name}`);
      else result[name] = value;
    }
  }
  for (const [name, value] of Object.entries(fields)) {
    if (name === 'Inherit') continue;
    if (listFields.has(name)) (result[name] ??= []).push(...value);
    else if (result[name] !== undefined) fail(`duplicate inherited ${name}`);
    else result[name] = value;
  }
  return result;
}

function parseCases(root, markdown, shared) {
  const cases = [];
  const visits = { count: 0 };
  let current;
  const lines = markdown.split(/\r?\n/);
  if (lines.shift() !== '<!-- domain-cases/v1 -->') fail('explicit supported format version required');
  for (const line of lines) {
    const heading = /^###\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s+(?:—|-)\s+\S.*$/.exec(line);
    if (heading) {
      if (cases.some(entry => entry.id === heading[1])) fail(`duplicate case ${heading[1]}`);
      if (cases.length >= 256) fail('case limit exceeded');
      current = { id: heading[1], fields: {} }; cases.push(current); continue;
    }
    if (!line.trim()) continue;
    if (!current) {
      if (!/^#{1,2}\s+\S/.test(line)) fail('unparsed content before first case');
      continue;
    }
    addField(current.fields, line, current.id);
  }
  return cases.map(({ id, fields }) => {
    const f = expandFields(root, fields, shared, visits);
    for (const name of [...singleFields, ...[...listFields].filter(name => name !== 'Inherit')]) if (!f[name] || (Array.isArray(f[name]) && !f[name].length)) fail(`${id} missing ${name}`);
    const refs = name => f[name].split(',').map(value => nonempty(value, `${id} ${name}`));
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f.Acceptance)) fail(`${id} acceptance must be a single ID`);
    return { id, requirement_ids: refs('Requirement IDs'), ac: nonempty(f.Acceptance, `${id} acceptance`),
      dimensions: refs('Dimensions'), level: f.Level, priority: f.Priority, preconditions: f.Precondition,
      inputs: { description: f.Input }, steps: f.Step, oracle: { basis_id: f['Oracle basis'], expected: f.Expected, authority: f['Oracle authority'] },
      cleanup: f.Cleanup, evidence_plan: f.Evidence, checkIds: f['Check ID'],
      automationFields: { path: f['Automation path'], testId: f['Automation test ID'], command: f['Automation command'] } };
  });
}

export function compileDomainCases({ projectRoot, caseFile, config } = {}) {
  const root = fs.realpathSync(nonempty(projectRoot, 'projectRoot'));
  if (!fs.statSync(root).isDirectory() || !config || typeof config !== 'object' || !['design', 'automate'].includes(config.mode)) fail('valid mode and existing project required');
  onlyKeys(config, ['project', 'change', 'mode', 'basis', 'design_basis_id', 'dimensions', 'checks', 'cleanup', 'self_checks', 'unresolved'], 'config');
  onlyKeys(config.cleanup, ['environment', 'data'], 'cleanup');
  const source = readContained(root, caseFile);
  const shared = new Map();
  const parsed = parseCases(root, new TextDecoder('utf-8', { fatal: true }).decode(source), shared);
  if (!Array.isArray(config.basis) || !config.basis.length) fail('basis required');
  const basis = config.basis.map(item => {
    onlyKeys(item, ['id', 'kind', 'path'], 'basis');
    return { id: nonempty(item.id, 'basis id'), kind: item.kind, path: item.path, sha256: digest(readContained(root, item.path)) };
  });
  if (basis.some(item => !['source', 'requirement'].includes(item.kind)) || new Set(basis.map(item => item.id)).size !== basis.length || basis.some(item => ['DOMAIN-CASES', 'domain-cases/v1:testpack'].includes(item.id))) fail('invalid basis identities');
  const design = basis.find(item => item.id === config.design_basis_id && item.kind === 'source');
  if (!design) fail('a design source basis is required');
  const designStat = fs.statSync(fs.realpathSync(path.resolve(root, design.path)));
  const aliasesDesign = file => {
    const stat = fs.statSync(fs.realpathSync(path.resolve(root, file)));
    return stat.dev === designStat.dev && stat.ino === designStat.ino;
  };
  if (aliasesDesign(caseFile) || basis.some(item => item.kind === 'requirement' && aliasesDesign(item.path))) fail('design source must differ from cases and requirements');
  basis.push({ id: 'DOMAIN-CASES', kind: 'source', path: caseFile, sha256: digest(source) });
  for (const [file, sha256] of [...shared].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const id = `SHARED-${digest(Buffer.from(file))}`;
    if (basis.some(item => item.id === id)) fail('shared basis identity collision');
    basis.push({ id, kind: 'source', path: file, sha256 });
  }
  const requirements = basis.filter(item => item.kind === 'requirement').map(item => item.id);
  const unresolved = config.unresolved ?? [];
  if (!Array.isArray(unresolved) || (config.mode === 'automate' && unresolved.length)) fail('invalid unresolved requirements');
  const pending = new Set();
  for (const row of unresolved) {
    onlyKeys(row, ['requirement_ids', 'question'], 'unresolved');
    if (!row || !Array.isArray(row.requirement_ids) || !row.requirement_ids.length
      || new Set(row.requirement_ids).size !== row.requirement_ids.length
      || row.requirement_ids.some(id => !requirements.includes(id))) fail('invalid unresolved requirement references');
    nonempty(row.question, 'unresolved question');
    row.requirement_ids.forEach(id => pending.add(id));
  }
  const dimensionNames = 'ABCDEFGHIJ'.split('').map(c => `Journey-${c}`);
  for (const entry of parsed) {
    if (!entry.requirement_ids.length || new Set(entry.requirement_ids).size !== entry.requirement_ids.length
      || entry.requirement_ids.some(id => !requirements.includes(id)) || !entry.requirement_ids.includes(entry.oracle.basis_id)
      || !entry.dimensions.length || new Set(entry.dimensions).size !== entry.dimensions.length
      || entry.dimensions.some(id => !dimensionNames.includes(id))) fail(`${entry.id} has unknown or duplicate requirement/dimension references`);
    if (!['unit', 'integration', 'api', 'contract', 'property', 'e2e'].includes(entry.level)
      || !['P0', 'P1', 'P2'].includes(entry.priority)) fail(`${entry.id} has invalid level or priority`);
  }
  if (!requirements.length || requirements.some(id => !pending.has(id) && !parsed.some(entry => entry.requirement_ids.includes(id)))) fail('every requirement needs a case or unresolved entry');
  if (!config.dimensions || Object.keys(config.dimensions).sort().join() !== [...dimensionNames].sort().join()) fail('exact Journey dimensions required');
  const dimensions = Object.fromEntries(dimensionNames.map(name => {
    const value = config.dimensions[name];
    onlyKeys(value, ['required', 'reason', 'basis_ids'], name);
    if (!value || typeof value.required !== 'boolean' || !Array.isArray(value.basis_ids) || !value.basis_ids.length
      || new Set(value.basis_ids).size !== value.basis_ids.length || value.basis_ids.some(id => !basis.some(item => item.id === id))) fail(`invalid ${name}`);
    const caseIds = parsed.filter(entry => entry.dimensions.includes(name)).map(entry => entry.id);
    if ((!value.required && caseIds.length) || (value.required && !caseIds.length && !value.basis_ids.some(id => pending.has(id)))) fail(`${name} applicability disagrees with cases`);
    return [name, { required: value.required, reason: nonempty(value.reason, `${name} reason`), basis_ids: value.basis_ids,
      case_ids: caseIds }];
  }));
  if (!Array.isArray(config.checks) || (!unresolved.length && !config.checks.length)) fail('checks required');
  const checks = config.checks.map(check => {
    onlyKeys(check, ['id', 'level', 'capability', 'command', 'mode'], 'check');
    if (check.mode !== undefined && !['manual', 'automated'].includes(check.mode)) fail('invalid check mode');
    return { id: nonempty(check.id, 'check id'), level: nonempty(check.level, 'check level'),
      capability: nonempty(check.capability, 'check capability'), command: nonempty(check.command, 'check command'),
      ...(check.mode === undefined ? {} : { mode: check.mode }),
      caseIds: parsed.filter(entry => entry.checkIds.includes(check.id)).map(entry => entry.id) };
  });
  const automationEntries=[];
  const shellWord=value=>/^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
  const cases = parsed.map(({ ac, checkIds, automationFields, ...entry }) => {
    const supplied = Object.values(automationFields).some(value => value !== undefined);
    if (supplied) {
      const {path:target,testId,command}=automationFields;
      if (!target || !testId || !command) fail(`${entry.id} automation mapping must be complete`);
      let argv;try { argv=JSON.parse(command); } catch { fail(`${entry.id} automation command must be a JSON argv array`); }
      if (!Array.isArray(argv) || !argv.length || argv.some(item=>typeof item!=='string' || !item || item.includes('\0') || /[\r\n]/.test(item))) fail(`${entry.id} automation command must contain nonempty argv strings`);
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]) || !argv.includes(target)) fail(`${entry.id} automation argv must invoke the declared test file without an assignment prefix`);
      if (automationEntries.some(item=>item.testId===testId)) fail(`${entry.id} automation test ID must be unique`);
      const expected=argv.map(shellWord).join(' ');
      if (!checkIds.length || checkIds.some(id=>!checks.some(check=>check.id===id && check.mode!=='manual' && check.command===expected)))
        fail(`${entry.id} automation command must match each automated check`);
      let bytes;try { bytes=readContained(root,target); } catch { fail(`${entry.id} automation path must be a project file`); }
      automationEntries.push({caseId:entry.id,path:target,sha256:digest(bytes),testId,command:argv,checkIds});
    }
    return { ...entry, automation: null };
  });
  // Author self-check CLAIMS: pure projection only. This module never
  // corroborates an execution — the protected host ports must qualify every
  // claim against real source records before any gate may promote it
  // (compileDomainCases stays projection-only; design mode cannot claim
  // self-checks at all).
  const rawChecks = config.self_checks ?? [];
  if (!Array.isArray(rawChecks)) fail('self_checks must be an array');
  if (config.mode === 'design' && rawChecks.length) fail('design mode cannot claim author self-checks');
  const selfChecks = config.mode === 'automate' ? rawChecks.map((claim, index) => {
    onlyKeys(claim, ['caseId', 'testId', 'execution', 'principal', 'outcome', 'executions', 'evidenceRefs'], `self_checks[${index}]`);
    const entry = automationEntries.find(item => item.caseId === claim.caseId && item.testId === claim.testId);
    if (!entry) fail(`self_checks[${index}] must name an automation candidate caseId and testId`);
    if (automationEntries.some(item => item !== entry && item.caseId === claim.caseId)) fail(`self_checks[${index}] leaves case ${claim.caseId} claimed twice`);
    if (automationEntries.some(item => item !== entry && item.testId === claim.testId)) fail(`self_checks[${index}] leaves test ID ${claim.testId} claimed twice`);
    if (typeof claim.execution !== 'string' || !claim.execution.trim()
      || typeof claim.principal !== 'string' || !claim.principal.trim()) fail(`self_checks[${index}] must bind non-empty execution and principal`);
    if (claim.outcome !== 'pass') fail(`self_checks[${index}] outcome must be pass`);
    onlyKeys(claim.executions, ['total', 'valid'], `self_checks[${index}].executions`);
    if (!Number.isInteger(claim.executions.total) || claim.executions.total < 1
      || claim.executions.valid !== claim.executions.total) fail(`self_checks[${index}] must record a fully valid, non-skipped execution`);
    if (!Array.isArray(claim.evidenceRefs) || !claim.evidenceRefs.length
      || claim.evidenceRefs.some(ref => !ref || typeof ref !== 'object' || typeof ref.ref !== 'string' || !ref.ref.trim() || !/^[0-9a-f]{64}$/.test(ref.digest ?? ''))) {
      fail(`self_checks[${index}] must carry real evidence refs with sha256 digests`);
    }
    return structuredClone(claim);
  }) : [];
  if (config.mode === 'automate') {
    if (!automationEntries.length) fail('automate mode requires Markdown automation mappings');
    const claimed = new Set(selfChecks.map(claim => claim.caseId));
    for (const entry of automationEntries) if (!claimed.has(entry.caseId)) fail(`automate mode requires a self-check claim for case ${entry.caseId}`);
    const authors = new Set(selfChecks.map(claim => claim.execution));
    if (authors.size !== 1) fail('every self-check claim must come from the same author execution');
  }
  const testPack = { schema_version: 'test-authoring/v1', mode: config.mode, status: 'design_only', project_root: root, basis,
    requirements, dimensions, cases, unresolved, self_checks: selfChecks };
  const testContract = unresolved.length ? null : { schemaVersion: 1, commandBindingsRequired: true, sourceReadiness: 'design_only', project: nonempty(config.project, 'project'), change: nonempty(config.change, 'change'),
    cases: parsed.map(entry => ({ id: entry.id, ac: entry.ac, oracle: String(entry.oracle.expected), required: true, checkIds: entry.checkIds })),
    requiredChecks: checks, executionDenominator: { totalCases: parsed.length }, cleanup: config.cleanup,
    dependencyBaselines: [...basis.map(item => ({ kind: item.id, digest: item.sha256 })), { kind: 'domain-cases/v1:testpack', digest: envelopeDigest(testPack) }] };
  if (testContract) {
    const contract = parseContract('SDD.Delivery.TestContract', testContract);
    if (!contract.ok) fail(contract.errors.join('; '));
  }
  return structuredClone({ testPack, testContract, source: { path: caseFile, sha256: digest(source) },
    ...(automationEntries.length ? { automationCandidate:{scope:'unqualified-automation-map',entries:automationEntries} } : {}),
    scope: 'projection-only', managedClosureEligible: false });
}

export function verifyDomainCaseProjection({ projection, ...input } = {}) {
  try {
    const current = compileDomainCases(input);
    return { ok: isDeepStrictEqual(projection, current), scope: 'projection-only', managedClosureEligible: false };
  } catch {
    return { ok: false, code: 'DOMAIN_CASES_SOURCE_INVALID', scope: 'projection-only', managedClosureEligible: false };
  }
}
