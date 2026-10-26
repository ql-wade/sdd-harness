// Diagnostic only. Load on the exact Runner build-plan child, never via global NODE_OPTIONS.
import cp from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { syncBuiltinESMExports } from 'node:module';
const output = new URL('./python-events.capture.jsonl', import.meta.url);
const original = cp.spawnSync;
cp.spawnSync = function(command, args, options) {
  if (command !== 'python3' || args?.[0] !== '-I' || args?.[1] !== '-c'
    || !args?.[2]?.startsWith('import io,json,sys,tarfile')) return original.apply(this, arguments);
  const startedAt = new Date().toISOString(), started = performance.now();
  const result = original.apply(this, arguments);
  let metadataClass = 'EMPTY';
  if (typeof result.stdout === 'string' && result.stdout.trim()) {
    try {
      const metadata = JSON.parse(result.stdout);
      metadataClass = metadata?.name === '@fission-ai/openspec' && metadata?.version === '1.11.0'
        && metadata?.entry === 'bin/openspec.js' ? 'EXPECTED_OPENSPEC_1_11_0' : 'UNEXPECTED_METADATA';
    } catch { metadataClass = 'NON_JSON'; }
  }
  fs.appendFileSync(output, JSON.stringify({ startedAt, durationMs: performance.now() - started,
    timeoutMs: options.timeout, errorCode: result.error?.code ?? null,
    signal: result.signal, status: result.status, metadataClass,
    inputBytes: options.input.length,
    inputSha256: crypto.createHash('sha256').update(options.input).digest('hex') }) + '\n');
  return result;
};
syncBuiltinESMExports();
