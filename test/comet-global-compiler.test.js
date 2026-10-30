import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { taskDefinitionDigest } from '../lib/delivery/baseline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativeDriver = 'integrations/comet/application/internal/build-application.mjs';
const nodeBin = path.dirname(process.execPath);

test('the project application compiles using installed Comet 0.5.1 without a repository vendor tree', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-global-compiler-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const source = path.join(scratch, 'source');
  for (const rel of ['lib/delivery', 'lib/adapters/plan-source.js', 'lib/adapters/comet-host-ports.js', 'lib/adapters/codex-host-source.js', 'lib/adapters/codex-test-observation.js', 'contracts/delivery', 'tools/comet', 'integrations/comet/application']) {
    const target = path.join(source, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, rel), target, { recursive: true, filter: (item) => !['package', '__pycache__'].includes(path.basename(item)) });
  }
  const lock = path.join(source, 'integrations/comet/upstream.lock.json');
  fs.copyFileSync(path.join(root, 'integrations/comet/upstream.lock.json'), lock);
  fs.copyFileSync(path.join(root, 'package.json'), path.join(source, 'package.json'));
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(source, 'package-lock.json'));
  const commonmark = path.join(source, 'node_modules/commonmark');
  fs.mkdirSync(path.join(commonmark, 'dist'), {recursive:true});
  for (const rel of ['LICENSE', 'dist/commonmark.min.js']) fs.copyFileSync(path.join(root,'node_modules/commonmark',rel),path.join(commonmark,rel));
  for (const name of ['entities','mdurl','minimist']) {
    fs.mkdirSync(path.join(source,'node_modules',name),{recursive:true});
    fs.copyFileSync(path.join(root,'node_modules',name,'LICENSE'),path.join(source,'node_modules',name,'LICENSE'));
  }
  assert.equal(fs.existsSync(path.join(source, '.sdd')), false);
  const env = { ...process.env, PATH: `${nodeBin}${path.delimiter}${process.env.PATH ?? ''}` };
  delete env.NODE_OPTIONS; delete env.NODE_PATH; delete env.NODE_TEST_CONTEXT;
  const output = path.join(scratch, 'candidate');
  const result = spawnSync(process.execPath, [path.join(source, relativeDriver), '--out', output], { cwd: source, env, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const appBytes = fs.readFileSync(path.join(output, 'package/application.json'), 'utf8');
  const app = JSON.parse(appBytes);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'compile-manifest.json'), 'utf8'));
  const currentManifest = JSON.parse(fs.readFileSync(path.join(root, 'integrations/comet/application/internal/compile-manifest.json'), 'utf8'));
  assert.equal(app.runtimeVersion, '0.5.1');
  assert.equal(app.version, '9', 'changed gate code must not reuse the installed application version');
  assert.equal(manifest.build.version, '0.5.1');
  assert.equal(manifest.build.supplierQualification, 'not-verified');
  assert.equal(manifest.contentHash, currentManifest.contentHash, 'the current candidate must be reproducible from current sources');
  const files = (directory, prefix = '') => fs.readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(prefix, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `package symlink refused: ${rel}`);
    return entry.isDirectory() ? files(directory, rel) : [rel];
  }).sort();
  const builtRoot = path.join(output, 'package');
  const currentRoot = path.join(root, 'integrations/comet/application/package');
  const builtFiles = files(builtRoot);
  assert.deepEqual(builtFiles, files(currentRoot), 'the complete package file set must match');
  for (const rel of builtFiles) assert.deepEqual(fs.readFileSync(path.join(builtRoot, rel)), fs.readFileSync(path.join(currentRoot, rel)), `package bytes differ: ${rel}`);
  assert.ok(fs.statSync(path.join(output, 'package/sdd/lib-delivery-gate.mjs')).isFile());
  const packagedBaseline = await import(pathToFileURL(path.join(builtRoot,'sdd/lib-delivery-baseline.mjs')).href);
  for (const text of ['- [x] done\n', '```\n- [x] code\n```\n', '- [ ] parent\n  - [X] nested\n', '# heading\r\n- [x] progress\r\n']) {
    assert.equal(packagedBaseline.taskDefinitionDigest(text),taskDefinitionDigest(text),'packaged parser must preserve the project digest semantics');
  }
  const parserFile=path.join(commonmark,'dist/commonmark.min.js');
  fs.appendFileSync(parserFile,'\n// modified\n');
  const corruptOutput=path.join(scratch,'corrupt-parser');
  const corrupt=spawnSync(process.execPath,[path.join(source,relativeDriver),'--out',corruptOutput],{cwd:source,env,encoding:'utf8',timeout:60000});
  assert.notEqual(corrupt.status,0,'modified parser bytes must be refused');
  assert.match(corrupt.stderr,/commonmark package does not match/);
  assert.equal(fs.existsSync(corruptOutput),false);
  assert.equal(fs.existsSync(path.join(source, '.sdd')), false, 'building must not download or generate an upstream vendor tree');
  const repeat = spawnSync(process.execPath, [path.join(source, relativeDriver), '--out', output], { cwd: source, env, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(repeat.status, 0, 'an existing candidate is not overwritten');
  assert.equal(fs.readFileSync(path.join(output, 'package/application.json'), 'utf8'), appBytes);
});

test('global compiler preflight rejects wrong versions, escaping exports and existing output', (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-global-preflight-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const source = path.join(scratch, 'source');
  const driver = path.join(source, relativeDriver);
  fs.mkdirSync(path.dirname(driver), { recursive: true });
  fs.copyFileSync(path.join(root, relativeDriver), driver);
  fs.copyFileSync(path.join(root, 'integrations/comet/upstream.lock.json'), path.join(source, 'integrations/comet/upstream.lock.json'));
  const binDir = path.join(scratch, 'bin');
  const fakeRoot = path.join(scratch, 'global/comet');
  const fakeCli = path.join(fakeRoot, 'bin/comet.js');
  const invoked = path.join(scratch, 'invoked');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
  fs.writeFileSync(fakeCli, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(invoked)}, 'invoked');\nconsole.log('0.5.1')\n`, { mode: 0o755 });
  fs.symlinkSync(fakeCli, path.join(binDir, 'comet'));
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${nodeBin}${path.delimiter}/usr/bin:/bin` };
  delete env.NODE_OPTIONS; delete env.NODE_PATH; delete env.NODE_TEST_CONTEXT;
  const run = (target) => spawnSync(process.execPath, [driver, '--out', target], { cwd: source, env, encoding: 'utf8', timeout: 10000 });
  const packageFile = path.join(fakeRoot, 'package.json');
  const pkg = { name: '@rpamis/comet', version: '0.5.0', bin: { comet: 'bin/comet.js' }, exports: {} };
  fs.writeFileSync(packageFile, JSON.stringify(pkg));
  const wrongVersion = run(path.join(scratch, 'wrong-version'));
  assert.notEqual(wrongVersion.status, 0);
  assert.match(wrongVersion.stderr, /global @rpamis\/comet 0\.5\.1 is required/);
  assert.equal(fs.existsSync(path.join(scratch, 'wrong-version')), false);
  assert.equal(fs.existsSync(invoked), false, 'the wrong global version must not execute');

  const lockFile = path.join(source, 'integrations/comet/upstream.lock.json');
  const originalLock = fs.readFileSync(lockFile, 'utf8');
  const badLock = JSON.parse(originalLock);
  badLock.package.version = '0.5.0';
  fs.writeFileSync(lockFile, JSON.stringify(badLock));
  const wrongLock = run(path.join(scratch, 'wrong-lock'));
  assert.notEqual(wrongLock.status, 0);
  assert.match(wrongLock.stderr, /version lock required/);
  assert.equal(fs.existsSync(invoked), false, 'a mismatched version lock must be refused before execution');
  fs.writeFileSync(lockFile, originalLock);

  const marker = path.join(scratch, 'imported');
  fs.writeFileSync(path.join(scratch, 'escape.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected');`);
  pkg.version = '0.5.1';
  pkg.exports = { './applications/compiler': { import: './../../escape.mjs' } };
  fs.writeFileSync(packageFile, JSON.stringify(pkg));
  const escape = run(path.join(scratch, 'escaped-output'));
  assert.notEqual(escape.status, 0);
  assert.match(escape.stderr, /official ESM export escapes/);
  assert.equal(fs.existsSync(marker), false, 'an out-of-package module must not be imported');

  const existing = path.join(scratch, 'existing');
  fs.mkdirSync(existing);
  fs.writeFileSync(path.join(existing, 'keep.txt'), 'keep');
  const refuseExisting = run(existing);
  assert.notEqual(refuseExisting.status, 0);
  assert.equal(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8'), 'keep');
  const insideSource = run(path.join(source, 'no-output'));
  assert.notEqual(insideSource.status, 0);
  assert.equal(fs.existsSync(path.join(source, 'no-output')), false);
});
