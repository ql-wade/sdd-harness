// Replay harness: the exact exported requiredArtifactClosure from the
// published @rpamis/comet@0.4.5 npm artifact, evaluated in an isolated vm
// against the real local OpenSpec `status --json` output. Local relative
// imports resolve inside the extracted dist tree; bare and node: specifiers
// import the real host module and expose its namespace; 'yaml' resolves to
// YAML_ENTRY (scratch install from the same upstream semver range).
// Usage: node --experimental-vm-modules replay-requires.mjs <distRoot> <statusJson>
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [distRoot, statusPath] = process.argv.slice(2);
const yamlEntry = process.env.YAML_ENTRY;
const source = await fs.readFile(path.join(distRoot, 'domains/comet-classic/classic-artifact-requirements.js'), 'utf8');
const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));

const context = vm.createContext({
  console,
  process: { platform: process.platform, arch: process.arch, version: process.version, env: {}, cwd: () => process.cwd() },
  URL, TextEncoder, TextDecoder, queueMicrotask, structuredClone, performance,
});
const moduleCache = new Map();
const syntheticCache = new Map();

function moduleFor(identifier, sourceText) {
  const value = new vm.SourceTextModule(sourceText, { context, identifier });
  moduleCache.set(identifier, value);
  return value;
}

function syntheticFromNamespace(identifier, namespace) {
  const cached = syntheticCache.get(identifier);
  if (cached) return cached;
  const names = 'default' in namespace ? Object.keys(namespace) : ['default', ...Object.keys(namespace)];
  const value = new vm.SyntheticModule(names, function (module) {
    const self = module ?? this; // node 22 passes undefined; module is bound to this
    for (const name of names) self.setExport(name, namespace[name]);
  }, { context, identifier });
  syntheticCache.set(identifier, value);
  return value;
}

async function resolveModule(specifier, referrerIdentifier) {
  if (specifier === 'yaml') {
    return syntheticFromNamespace(specifier, await import(pathToFileURL(yamlEntry).href));
  }
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const referrerHref = referrerIdentifier.startsWith('file:') ? referrerIdentifier : pathToFileURL(referrerIdentifier).href;
    const resolved = new URL(specifier, referrerHref).href;
    if (moduleCache.has(resolved)) return moduleCache.get(resolved);
    const sourceText = await fs.readFile(fileURLToPath(resolved), 'utf8');
    return moduleFor(resolved, sourceText);
  }
  return syntheticFromNamespace(specifier, await import(specifier));
}

const entryHref = pathToFileURL(path.join(distRoot, 'domains/comet-classic/classic-artifact-requirements.js')).href;
moduleCache.set(entryHref, moduleFor(entryHref, source));
const entry = moduleCache.get(entryHref);
await entry.link((specifier, referrer) => resolveModule(specifier, referrer.identifier));
await entry.evaluate();
const requiredArtifactClosure = entry.namespace.requiredArtifactClosure;
if (typeof requiredArtifactClosure !== 'function') {
  console.log(JSON.stringify({ accepted: false, error: 'requiredArtifactClosure export not found' }));
  process.exit(2);
}
try {
  const result = requiredArtifactClosure(status);
  console.log(JSON.stringify({ accepted: true, artifacts: Array.isArray(result) ? result.length : typeof result }));
} catch (error) {
  console.log(JSON.stringify({ accepted: false, error: String(error.message) }));
  process.exitCode = 3;
}
