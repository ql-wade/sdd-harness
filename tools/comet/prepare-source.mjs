// CLI wrapper around prepareCometSource: verify a local integrity-locked
// Comet source archive against upstream.lock.json and install the pristine
// source plus its v2 provenance under .sdd/vendor/comet/<commit>.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { prepareCometSource } from './source.js';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      if (key === '--json') continue;
      if (!['--project', '--lock', '--archive'].includes(key) || !process.argv[i + 1]) {
        const error = new Error('Use --archive <file> [--project <directory>] [--lock <file>] [--json]');
        error.code = 'INPUT_INVALID';
        throw error;
      }
      options[key.slice(2)] = process.argv[++i];
    }
    if (!options.archive) {
      const error = new Error('A local integrity-locked --archive is required');
      error.code = 'INPUT_INVALID';
      throw error;
    }
    const projectRoot = path.resolve(options.project ?? '.');
    const lock = JSON.parse(await fs.readFile(path.resolve(projectRoot, options.lock ?? 'integrations/comet/upstream.lock.json'), 'utf8'));
    console.log(JSON.stringify(await prepareCometSource({ projectRoot, lock, archivePath: path.resolve(options.archive) })));
  } catch (error) {
    console.error(JSON.stringify({ code: error.code ?? 'PREPARE_FAILED', message: error.message }));
    process.exitCode = ['INPUT_INVALID', 'LOCK_INVALID', 'ENOENT'].includes(error.code) || error instanceof SyntaxError ? 1 : 2;
  }
}
