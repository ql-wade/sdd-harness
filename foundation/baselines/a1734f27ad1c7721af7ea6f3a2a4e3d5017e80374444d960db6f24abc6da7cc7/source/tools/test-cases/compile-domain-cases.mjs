#!/usr/bin/env node
// Internal projection helper: it neither executes commands nor advances Comet.
import fs from 'node:fs';
import path from 'node:path';
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
  if (projection && values.view === 'contract' && !projection.testContract) throw new Error('unresolved design has no runnable TestContract');
  const output = projection && values.view === 'testpack' ? projection.testPack : projection && values.view === 'contract' ? projection.testContract : result;
  process.stdout.write(`${JSON.stringify(ordered(output), null, 2)}\n`);
  if (values.verify && !result.ok) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: 'DOMAIN_CASES_INVALID', message: error.message })}\n`);
  process.exitCode = 1;
}
