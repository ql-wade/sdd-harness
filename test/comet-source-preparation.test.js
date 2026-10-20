import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareCometSource } from '../tools/comet/source.js';

// Fixed upstream identity from integrations/comet/upstream.lock.json.
const lock = {
  schemaVersion: 1,
  package: {
    name: '@rpamis/comet',
    version: '0.4.5',
    integrity: 'sha512-zUs13Rq6Lk1mDgKGk/K3kbdiRLqv1j0DSw9oswwljIrVPiJ+NvfTYlKp2eLpIaIAzMA34RDx6KpenFC39qbR3A==',
  },
  source: {
    url: 'https://codeload.github.com/rpamis/comet/tar.gz/c90af44a4474662d7853aae76ce785404974fb0a',
    commit: 'c90af44a4474662d7853aae76ce785404974fb0a',
    sha256: '28a7e2faefa7817244bdc1e54fdca3443fb9e16d947f89df9d51391e45faaa1f',
    bytes: 40474019,
    directory: 'comet-c90af44a4474662d7853aae76ce785404974fb0a',
  },
  toolchain: { node: '24.15.0', pnpm: '10.18.3', pythonMinimum: '3.12' },
  patches: [],
};

test('rejects a source archive with the wrong SHA before creating the vendor target', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-integrity-'));
  try {
    const archivePath = path.join(projectRoot, 'wrong-source.tar.gz');
    // Match the declared byte count so this isolates integrity, not size validation.
    await fs.writeFile(archivePath, Buffer.alloc(lock.source.bytes));
    await assert.rejects(
      prepareCometSource({ projectRoot, lock, archivePath }),
      { code: 'ARCHIVE_INTEGRITY_MISMATCH' },
    );
    const target = path.join(projectRoot, '.sdd', 'vendor', 'comet', lock.source.commit);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

async function createSyntheticArchive(projectRoot, { traversal = false, executable = false } = {}) {
  const archivePath = path.join(projectRoot, 'synthetic-source.tar.gz');
  const packageIdentity = { name: '@rpamis/comet', version: '0.4.5' };
  const marker = 'upstream baseline';
  const created = spawnSync('python3', ['-c', String.raw`
import io, json, sys, tarfile
archive, root, package, marker, traversal, executable = sys.argv[1:]
with tarfile.open(archive, 'w:gz') as output:
    files = [('package.json', package), ('marker.txt', marker)]
    if traversal == 'true':
        files.append(('../../escaped.txt', 'escaped archive member'))
    if executable == 'true':
        files.append(('run.sh', '#!/bin/sh\nexit 0\n'))
    for name, content in files:
        data = content.encode('utf-8')
        entry = tarfile.TarInfo(root + '/' + name)
        entry.size = len(data)
        entry.mode = 0o755 if name == 'run.sh' else 0o644
        output.addfile(entry, io.BytesIO(data))
`, archivePath, lock.source.directory, JSON.stringify(packageIdentity), marker, String(traversal), String(executable)], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.error?.message ?? created.stderr);
  const archive = await fs.readFile(archivePath);
  const syntheticLock = {
    ...lock,
    source: {
      ...lock.source,
      sha256: crypto.createHash('sha256').update(archive).digest('hex'),
      bytes: archive.length,
    },
  };
  return { archivePath, syntheticLock, packageIdentity, marker };
}

test('prepares a verified synthetic upstream archive into the pristine source directory', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-pristine-'));
  try {
    const { archivePath, syntheticLock, packageIdentity, marker } = await createSyntheticArchive(projectRoot);
    const result = await prepareCometSource({ projectRoot, lock: syntheticLock, archivePath });
    const expectedRoot = await fs.realpath(projectRoot);
    const expectedSourceDir = path.join(expectedRoot, '.sdd', 'vendor', 'comet', lock.source.commit, 'pristine');
    assert.equal(path.resolve(result.sourceDir), expectedSourceDir);
    assert.equal(await fs.readFile(path.join(result.sourceDir, 'marker.txt'), 'utf8'), marker);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sourceDir, 'package.json'), 'utf8')), packageIdentity);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('reuses an identical verified archive without rewriting the pristine source', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-reuse-'));
  try {
    const { archivePath, syntheticLock, packageIdentity, marker } = await createSyntheticArchive(projectRoot);
    const first = await prepareCometSource({ projectRoot, lock: syntheticLock, archivePath });
    const markerPath = path.join(first.sourceDir, 'marker.txt');
    const packagePath = path.join(first.sourceDir, 'package.json');
    const before = await Promise.all([fs.stat(markerPath), fs.stat(packagePath)]);
    const second = await prepareCometSource({ projectRoot, lock: syntheticLock, archivePath });
    assert.equal(second.sourceDir, first.sourceDir);
    assert.equal(second.reused, true);
    assert.equal(await fs.readFile(markerPath, 'utf8'), marker);
    assert.deepEqual(JSON.parse(await fs.readFile(packagePath, 'utf8')), packageIdentity);
    const after = await Promise.all([fs.stat(markerPath), fs.stat(packagePath)]);
    for (let index = 0; index < before.length; index++) {
      assert.equal(after[index].ino, before[index].ino);
      assert.equal(after[index].mtimeMs, before[index].mtimeMs);
    }
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('rejects pristine source drift without overwriting the changed baseline', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-drift-'));
  try {
    const { archivePath, syntheticLock } = await createSyntheticArchive(projectRoot);
    const first = await prepareCometSource({ projectRoot, lock: syntheticLock, archivePath });
    const markerPath = path.join(first.sourceDir, 'marker.txt');
    await fs.writeFile(markerPath, 'tampered baseline');
    await assert.rejects(
      prepareCometSource({ projectRoot, lock: syntheticLock, archivePath }),
      { code: 'SOURCE_BASELINE_DRIFT' },
    );
    assert.equal(await fs.readFile(markerPath, 'utf8'), 'tampered baseline');
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('rejects an integrity-matching traversal archive without committing or escaping files', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-traversal-'));
  try {
    const { archivePath, syntheticLock } = await createSyntheticArchive(projectRoot, { traversal: true });
    await assert.rejects(
      prepareCometSource({ projectRoot, lock: syntheticLock, archivePath }),
      { code: 'UNSAFE_ARCHIVE' },
    );
    const target = path.join(projectRoot, '.sdd', 'vendor', 'comet', lock.source.commit);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
    const projectFiles = await fs.readdir(projectRoot, { recursive: true });
    assert.equal(projectFiles.some((entry) => path.basename(entry) === 'escaped.txt'), false);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('rejects an injected pristine file named __proto__ without deleting it', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-proto-drift-'));
  try {
    const { archivePath, syntheticLock } = await createSyntheticArchive(projectRoot);
    const first = await prepareCometSource({ projectRoot, lock: syntheticLock, archivePath });
    const injectedPath = path.join(first.sourceDir, '__proto__');
    await fs.writeFile(injectedPath, 'injected');
    await assert.rejects(
      prepareCometSource({ projectRoot, lock: syntheticLock, archivePath }),
      { code: 'SOURCE_BASELINE_DRIFT' },
    );
    assert.equal(await fs.readFile(injectedPath, 'utf8'), 'injected');
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('rejects executable-bit drift without changing the pristine script mode or bytes', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-mode-drift-'));
  try {
    const { archivePath, syntheticLock } = await createSyntheticArchive(projectRoot, { executable: true });
    const first = await prepareCometSource({ projectRoot, lock: syntheticLock, archivePath });
    const scriptPath = path.join(first.sourceDir, 'run.sh');
    const originalBytes = await fs.readFile(scriptPath);
    assert.equal((await fs.stat(scriptPath)).mode & 0o777, 0o755);
    await fs.chmod(scriptPath, 0o644);
    await assert.rejects(
      prepareCometSource({ projectRoot, lock: syntheticLock, archivePath }),
      { code: 'SOURCE_BASELINE_DRIFT' },
    );
    assert.equal((await fs.stat(scriptPath)).mode & 0o777, 0o644);
    assert.deepEqual(await fs.readFile(scriptPath), originalBytes);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('rejects an injected empty pristine directory without deleting it', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-directory-drift-'));
  try {
    const { archivePath, syntheticLock } = await createSyntheticArchive(projectRoot);
    const first = await prepareCometSource({ projectRoot, lock: syntheticLock, archivePath });
    const injectedPath = path.join(first.sourceDir, 'injected-empty');
    await fs.mkdir(injectedPath);
    await assert.rejects(
      prepareCometSource({ projectRoot, lock: syntheticLock, archivePath }),
      { code: 'SOURCE_BASELINE_DRIFT' },
    );
    assert.equal((await fs.stat(injectedPath)).isDirectory(), true);
    assert.deepEqual(await fs.readdir(injectedPath), []);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
