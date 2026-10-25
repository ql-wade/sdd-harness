import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const { exportRelease, verifyLock } = await import(pathToFileURL(path.join(root, 'tools/foundation-export.mjs')));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'p12-standards-repro-'));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
try {
  const out = path.join(temporary, 'package');
  await exportRelease(root, out, { skillsCopy: true });
  const lock = path.join(out, 'foundation-lock.json');
  const baseline = await verifyLock(lock, root, { requireBodies: true });
  const copy = path.join(out, 'release/skills/code-review');
  fs.rmSync(copy, { recursive: true, force: true });
  fs.symlinkSync(path.join(root, '.agents/skills/code-review'), copy, 'dir');
  const unsafeVerify = await verifyLock(lock, root, { requireBodies: true });
  // Repoint only the PRIVATE package link to a PRIVATE outside directory.
  fs.unlinkSync(copy);
  const outside = path.join(temporary, 'outside-package-user-data');
  fs.cpSync(path.join(root, '.agents/skills/code-review'), outside, { recursive: true });
  const sentinel = path.join(outside, 'SKILL.md');
  fs.writeFileSync(sentinel, 'unowned private user sentinel\n');
  const before = sha(fs.readFileSync(sentinel));
  fs.symlinkSync(outside, copy, 'dir');
  await exportRelease(root, out, { skillsCopy: true });
  const after = sha(fs.readFileSync(sentinel));
  console.log(JSON.stringify({ baselineOK: baseline.ok, symlinkSelectedBodyAccepted: unsafeVerify.ok,
    verifierDrifts: unsafeVerify.drifts, exportFollowedSelectedDirectoryLink: before !== after,
    outsideSentinelBeforeSha256: before, outsideSentinelAfterSha256: after }));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
