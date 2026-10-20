import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareCometSource, verifyPreparedSource } from './source.js';
const execute = promisify(execFile);
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

const RUNTIME_SMOKE_FILES = [
  'test/domains/comet-classic/comet-scripts.test.ts',
  'test/repository/native-runtime-assets.test.ts',
  'test/repository/comet-entry-runtime-assets.test.ts',
  'test/app/cli-smoke.test.ts',
];

async function validatedPatches({ root, lock }) {
  if (!Array.isArray(lock.patches)) fail('LOCK_INVALID', 'An explicit ordered patch list is required');
  const patches = [];
  for (const patch of lock.patches) {
    if (typeof patch.path !== 'string' || path.isAbsolute(patch.path) || patch.path.split(/[\\/]/).includes('..') || !/^[a-f0-9]{64}$/.test(patch.sha256 ?? '')) fail('LOCK_INVALID', 'Patch paths and SHA256 must be fixed');
    const file = await fs.realpath(path.join(root, patch.path));
    if (!file.startsWith(root + path.sep) || digest(await fs.readFile(file)) !== patch.sha256) fail('PATCH_INTEGRITY_MISMATCH', 'A patch differs from the fixed source lock');
    patches.push({ file, path: patch.path, sha256: patch.sha256 });
  }
  return patches;
}

const fingerprintOf = (lock, patches) => digest(JSON.stringify({ archive: lock.source.sha256, patches: patches.map(({path, sha256}) => ({path, sha256})), toolchain: lock.toolchain }));

// Ephemeral tool caches that running the checks themselves may rewrite; they
// are excluded from the manifest on both build and verification so the
// manifest keeps attesting only real distribution content.
const VOLATILE_CACHE_PREFIXES = ['node_modules/.vite', 'node_modules/.vite-temp'];
const isVolatileCache = (name) => VOLATILE_CACHE_PREFIXES.some((volatilePrefix) => name === volatilePrefix || name.startsWith(`${volatilePrefix}/`));

async function tree(directory, prefix = '') {
  const result = Object.create(null);
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isVolatileCache(name)) continue;
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (entry.isSymbolicLink()) {
      result[name] = { kind: 'link', target: await fs.readlink(absolute) };
    } else if (entry.isDirectory()) {
      result[name] = { kind: 'directory', executeBits: stat.mode & 0o111 };
      Object.assign(result, await tree(absolute, name));
    } else if (entry.isFile()) {
      result[name] = { kind: 'file', sha256: digest(await fs.readFile(absolute)), executeBits: stat.mode & 0o111 };
    } else fail('BUILD_PATH_UNSAFE', 'Build output contains a special filesystem entry');
  }
  return result;
}

async function realDirectory(directory) {
  try {
    const value = await fs.lstat(directory);
    if (!value.isDirectory() || value.isSymbolicLink()) fail('BUILD_PATH_UNSAFE', 'Build parents must be real directories');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(directory);
  }
}

export async function buildCometDistribution({ projectRoot, lock, archivePath }) {
  if (typeof lock?.toolchain?.node !== 'string' || typeof lock?.toolchain?.pnpm !== 'string') fail('LOCK_INVALID', 'Pinned Node and pnpm versions are required');
  if (process.versions.node !== lock.toolchain.node) fail('TOOLCHAIN_MISMATCH', `Build requires Node ${lock.toolchain.node}; observed ${process.versions.node}`);
  const root = await fs.realpath(projectRoot);
  const prepared = await prepareCometSource({ projectRoot: root, lock, archivePath });
  const patches = await validatedPatches({ root, lock });
  const fingerprint = fingerprintOf(lock, patches);
  const builds = path.join(root, '.sdd/vendor/comet', lock.source.commit, 'builds');
  await realDirectory(builds);
  const buildRoot = path.join(builds, fingerprint);
  const work = path.join(buildRoot, 'work');
  const manifestFile = path.join(buildRoot, 'distribution.json');
  try {
    const previous = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    const actual = await tree(work);
    if (previous.fingerprint !== fingerprint || JSON.stringify(actual) !== JSON.stringify(previous.files)) fail('BUILD_BASELINE_DRIFT', 'Existing build output has changed; preserve it for inspection');
    return { buildRoot, entrypoint: path.join(work, 'bin/comet.js'), sourceCommit: lock.source.commit, fingerprint, reused: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await fs.lstat(buildRoot); fail('BUILD_INCOMPLETE', 'An incomplete build exists; reconcile it before retry'); } catch (probe) { if (probe.code !== 'ENOENT') throw probe; }
  }
  await fs.mkdir(buildRoot);
  await fs.cp(prepared.sourceDir, work, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  const childEnvironment = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CI: 'true', COREPACK_HOME: path.join(root, '.sdd/cache/corepack'), COREPACK_ENABLE_AUTO_PIN: '0', npm_config_cache: path.join(root, '.sdd/cache/npm'), GIT_CEILING_DIRECTORIES: buildRoot };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete childEnvironment[key];
  const run = async (command, args) => {
    try {
      const value = await execute(command, args, { cwd: work, env: childEnvironment, timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
      if (value.stdout) process.stderr.write(value.stdout);
      if (value.stderr) process.stderr.write(value.stderr);
      return value.stdout.trim();
    } catch (error) {
      if (error.stdout) process.stderr.write(error.stdout);
      if (error.stderr) process.stderr.write(error.stderr);
      fail('BUILD_STEP_FAILED', `Comet build step failed: ${command} ${args.join(' ')}`);
    }
  };
  for (const patch of patches) { await run('git', ['apply', '--check', '--', patch.file]); await run('git', ['apply', '--', patch.file]); }
  if (await run('pnpm', ['--version']) !== lock.toolchain.pnpm) fail('TOOLCHAIN_MISMATCH', 'pnpm does not match the fixed source lock');
  await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', path.join(root, '.sdd/cache/pnpm-store')]);
  await run(process.execPath, ['build.js']);
  for (const family of ['classic', 'native', 'entry']) await run(process.execPath, [`scripts/build/build-${family}-runtime.mjs`, '--check']);
  const version = await run(process.execPath, ['bin/comet.js', '--version']);
  if (version !== lock.package.version) fail('BUILD_IDENTITY_MISMATCH', 'Built CLI version differs from locked package');
  const files = await tree(work);
  await fs.writeFile(manifestFile, JSON.stringify({ schemaVersion: 1, fingerprint, sourceCommit: lock.source.commit, node: process.versions.node, pnpm: lock.toolchain.pnpm, files }, null, 2) + '\n', { flag: 'wx' });
  return { buildRoot, entrypoint: path.join(work, 'bin/comet.js'), sourceCommit: lock.source.commit, fingerprint, reused: false };
}

// Contract check mode (V_COMET_NATIVE): verify the already-prepared pristine
// source and the completed distribution for the current fingerprint, then run
// the upstream generated-consistency and runtime-smoke assertions in place.
export async function verifyCometDistribution({ projectRoot, lock, checkGenerated = false, runtimeSmoke = false }) {
  if (typeof lock?.toolchain?.node !== 'string') fail('LOCK_INVALID', 'Pinned Node version is required');
  if (process.versions.node !== lock.toolchain.node) fail('TOOLCHAIN_MISMATCH', `Verification requires Node ${lock.toolchain.node}; observed ${process.versions.node}`);
  const root = await fs.realpath(projectRoot);
  const prepared = await verifyPreparedSource({ projectRoot: root, lock });
  const patches = await validatedPatches({ root, lock });
  const fingerprint = fingerprintOf(lock, patches);
  const buildDir = path.join(root, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
  const manifestFile = path.join(buildDir, 'distribution.json');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') fail('BUILD_NOT_PRESENT', 'No completed Comet build for the current fingerprint; run the build with a local integrity-locked --archive first');
    throw error;
  }
  if (manifest.fingerprint !== fingerprint || manifest.sourceCommit !== lock.source.commit) fail('BUILD_BASELINE_DRIFT', 'Build manifest does not match the fixed source lock');
  const work = path.join(buildDir, 'work');
  const actual = await tree(work);
  const manifestFiles = Object.fromEntries(Object.entries(manifest.files).filter(([name]) => !isVolatileCache(name)));
  if (JSON.stringify(actual) !== JSON.stringify(manifestFiles)) fail('BUILD_BASELINE_DRIFT', 'Build output has changed since its manifest was written');
  const childEnvironment = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CI: 'true', COREPACK_HOME: path.join(root, '.sdd/cache/corepack'), COREPACK_ENABLE_AUTO_PIN: '0', npm_config_cache: path.join(root, '.sdd/cache/npm'), GIT_CEILING_DIRECTORIES: buildDir };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete childEnvironment[key];
  const steps = [];
  const runStep = async (name, command, args) => {
    try {
      const value = await execute(command, args, { cwd: work, env: childEnvironment, timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
      if (value.stdout) process.stderr.write(value.stdout);
      if (value.stderr) process.stderr.write(value.stderr);
      steps.push({ name, command: `${command} ${args.join(' ')}`, exitCode: 0, status: 'PASS' });
      return true;
    } catch (error) {
      if (error.stdout) process.stderr.write(error.stdout);
      if (error.stderr) process.stderr.write(error.stderr);
      steps.push({ name, command: `${command} ${args.join(' ')}`, exitCode: typeof error.code === 'number' ? error.code : 1, status: 'FAIL' });
      return false;
    }
  };
  let pass = true;
  if (checkGenerated) {
    for (const family of ['classic', 'native', 'entry']) {
      pass = await runStep(`check-generated:${family}`, process.execPath, ['scripts/build/build-' + family + '-runtime.mjs', '--check']) && pass;
    }
  }
  if (runtimeSmoke) {
    pass = await runStep('runtime-smoke', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...RUNTIME_SMOKE_FILES]) && pass;
  }
  return {
    schemaVersion: 1,
    status: pass ? 'PASS' : 'FAIL',
    version: lock.package?.version ?? null,
    sourceCommit: lock.source.commit,
    fingerprint,
    verifiedPreparedSource: prepared.sourceDir,
    steps,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      if (key === '--json') continue;
      if (key === '--check-generated' || key === '--runtime-smoke') { options[key.slice(2)] = true; continue; }
      if (!['--project', '--lock', '--archive'].includes(key) || !process.argv[i + 1]) fail('INPUT_INVALID', 'Use --archive <file> [--project <directory>] [--lock <file>] [--check-generated] [--runtime-smoke] [--json]');
      options[key.slice(2)] = process.argv[++i];
    }
    const projectRoot = path.resolve(options.project ?? '.');
    const lock = JSON.parse(await fs.readFile(path.resolve(projectRoot, options.lock ?? 'integrations/comet/upstream.lock.json'), 'utf8'));
    if (options['check-generated'] || options['runtime-smoke']) {
      if (options.archive) fail('INPUT_INVALID', 'Verification mode runs against the integrated build; --archive belongs to build mode');
      console.log(JSON.stringify(await verifyCometDistribution({
        projectRoot,
        lock,
        checkGenerated: options['check-generated'] === true,
        runtimeSmoke: options['runtime-smoke'] === true,
      })));
    } else {
      if (!options.archive) fail('INPUT_INVALID', 'A local integrity-locked --archive is required');
      console.log(JSON.stringify(await buildCometDistribution({ projectRoot, lock, archivePath: path.resolve(options.archive) })));
    }
  } catch (error) {
    console.error(JSON.stringify({ code: error.code ?? 'BUILD_FAILED', message: error.message }));
    process.exitCode = ['INPUT_INVALID', 'LOCK_INVALID', 'ENOENT', 'SOURCE_NOT_PREPARED', 'BUILD_NOT_PRESENT'].includes(error.code) || error instanceof SyntaxError ? 1 : 2;
  }
}
