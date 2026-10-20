import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCometDistribution } from '../tools/comet/build.mjs';

test('rejects an exact Node pin mismatch before reading source or writing project state', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-build-node-'));
  try {
    // Fixed upstream identity from integrations/comet/upstream.lock.json.
    const alternateNode = process.versions.node === '24.13.0' ? '24.15.0' : '24.13.0';
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
      toolchain: { node: alternateNode, pnpm: '10.18.3', pythonMinimum: '3.12' },
      patches: [],
    };
    const archivePath = path.join(projectRoot, 'nonexistent-source.tar.gz');
    await assert.rejects(
      buildCometDistribution({ projectRoot, lock, archivePath }),
      { code: 'TOOLCHAIN_MISMATCH' },
    );
    assert.deepEqual(await fs.readdir(projectRoot), []);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
