#!/usr/bin/env node
// Internal projection helper: it neither executes commands nor advances Comet.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { compileDomainCases, verifyDomainCaseProjection } from '../../lib/delivery/domain-cases.js';

function readLocal(root, name) {
  if (!name || path.isAbsolute(name) || name.split(/[\\/]/).includes('..') || name.includes('\0')) throw new Error('relative project path required');
  const file = fs.realpathSync(path.resolve(root, name)), relative = path.relative(root, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('path escapes project');
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('file must be regular and under 1 MiB');
  return fs.readFileSync(file, 'utf8');
}

function uniqueJson(text) {
  const value = JSON.parse(text), stack = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      while (++i < text.length) { if (text[i] === '\\') i++; else if (text[i] === '"') break; }
      const top = stack.at(-1);
      if (top?.keys && top.expectKey) {
        const key = JSON.parse(text.slice(start, i + 1));
        if (top.keys.has(key)) throw new Error('duplicate JSON key');
        top.keys.add(key); top.expectKey = false;
      }
    } else if (char === '{' || char === '[') stack.push(char === '{' ? { keys: new Set(), expectKey: true } : {});
    else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.keys) stack.at(-1).expectKey = true;
  }
  return value;
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    project: { type: 'string' }, cases: { type: 'string' }, config: { type: 'string' }, verify: { type: 'string' }, view: { type: 'string' },
    'bind-specs': { type: 'boolean' }, 'promote': { type: 'string' },
  } });
  if (positionals.length || !values.project || !values.cases || !values.config) throw new Error('project, cases and config are required');
  if (values.view && !['projection', 'testpack', 'contract'].includes(values.view)) throw new Error('unknown projection view');
  const root = fs.realpathSync(values.project);
  if (!fs.statSync(root).isDirectory()) throw new Error('project must be a directory');
  const config = uniqueJson(readLocal(root, values.config));
  if (!config || typeof config !== 'object' || !Array.isArray(config.basis)) throw new Error('config basis required');
  const input = { projectRoot: root, caseFile: values.cases,
    config: { ...config, basis: [...config.basis, { id: 'DOMAIN-CONFIG', kind: 'source', path: values.config }] } };
  const frozen = values.verify ? uniqueJson(readLocal(root, values.verify)) : null;
  const result = values.verify ? verifyDomainCaseProjection({ ...input, projection: frozen }) : compileDomainCases(input);
  const projection = values.verify ? (result.ok ? frozen : null) : result;
  if (projection && values.promote) {
    if (values.verify || !projection.testPack) throw new Error('--promote runs on a fresh compile');
    // Archive promotion (three-choice ruling): cases keep their F-ID refs;
    // the F-ID → spec mapping is written into the features.md spec-binding
    // column, carrying the actual merged-spec content digest.
    const mapping = uniqueJson(readLocal(root, values.promote));
    if (!mapping || typeof mapping !== 'object' || typeof mapping.capability !== 'string' || !mapping.capability.trim()
      || !mapping.bindings || typeof mapping.bindings === 'object' && Array.isArray(mapping.bindings)
      || !mapping.bindings || !Object.keys(mapping.bindings).length
      || Object.values(mapping.bindings).some(title => typeof title !== 'string' || !title.trim())) {
      throw new Error('promote mapping requires capability and bindings of non-empty titles');
    }
    const specRelative = path.join('openspec', 'specs', mapping.capability, 'spec.md');
    let specText;
    try { specText = readLocal(root, specRelative); } catch {
      throw new Error(`spec delta not merged: missing ${specRelative}`);
    }
    const digestHex = crypto.createHash('sha256').update(Buffer.from(specText, 'utf8')).digest('hex');
    const lines = specText.split(/\r?\n/);
    for (const title of Object.values(mapping.bindings)) {
      if (!lines.some(line => line.trim() === `### Requirement: ${title}`)) {
        throw new Error(`spec requirement ${mapping.capability}#${title} not resolvable: heading absent from ${specRelative}`);
      }
    }
    const registered = new Set(projection.testPack.basis.filter(item => item.kind === 'requirement').map(item => item.id));
    const registries = new Set();
    for (const featureId of Object.keys(mapping.bindings)) {
      if (!registered.has(featureId)) throw new Error(`promote binding ${featureId} is not a registered requirement basis id`);
      const entry = projection.testPack.basis.find(item => item.kind === 'requirement' && item.id === featureId);
      registries.add(entry.path);
    }
    for (const registry of registries) {
      const content = readLocal(root, registry).split(/\r?\n/);
      for (const [featureId, title] of Object.entries(mapping.bindings)) {
        if (!projection.testPack.basis.some(item => item.kind === 'requirement' && item.id === featureId && item.path === registry)) continue;
        const escaped = featureId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const index = content.findIndex(line => new RegExp(`^\\s*\\|\\s*${escaped}\\s*\\|`).test(line));
        if (index < 0) throw new Error(`promote binding ${featureId} has no registry row in ${registry}`);
        const cells = content[index].split('|');
        if (cells.length < 3) throw new Error(`registry row for ${featureId} is not a pipe-table row`);
        const binding = ` ${mapping.capability}#${title} digest:${digestHex} `;
        const cell = cells.length - 2;
        if (cells[cell].trim() && cells[cell].trim() !== binding.trim()) {
          throw new Error(`promote binding ${featureId} conflicts with existing spec binding`);
        }
        cells[cell] = binding;
        content[index] = cells.join('|');
      }
      fs.writeFileSync(fs.realpathSync(path.resolve(root, registry)), `${content.join('\n')}\n`);
    }
  }
  if (projection && values['bind-specs']) {
    // Promoted-library resolvability: every spec-key Requirement ID
    // (`<capability>#<title>`) must name an existing requirement heading in
    // openspec/specs/<capability>/spec.md. Change-phase F-ID refs (no '#')
    // are registered basis entries and stay compiler-enforced instead.
    for (const entry of projection.testPack.cases) {
      for (const id of entry.requirement_ids) {
        const match = /^([^#\s]+)#(.+)$/.exec(id);
        if (!match) continue;
        const specRelative = path.join('openspec', 'specs', match[1], 'spec.md');
        let text;
        try { text = readLocal(root, specRelative); } catch {
          throw new Error(`spec requirement ${id} not resolvable: missing ${specRelative}`);
        }
        if (!text.split(/\r?\n/).some(line => line.trim() === `### Requirement: ${match[2]}`)) {
          throw new Error(`spec requirement ${id} not resolvable: heading '### Requirement: ${match[2]}' absent from ${specRelative}`);
        }
      }
    }
  }
  if (projection && values.view === 'contract' && !projection.testContract) throw new Error('unresolved design has no runnable TestContract');
  const output = projection && values.view === 'testpack' ? projection.testPack : projection && values.view === 'contract' ? projection.testContract : result;
  process.stdout.write(`${JSON.stringify(ordered(output), null, 2)}\n`);
  if (values.verify && !result.ok) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: 'DOMAIN_CASES_INVALID', message: error.message })}\n`);
  process.exitCode = 1;
}
