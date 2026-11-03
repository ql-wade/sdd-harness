// Build the epoch-qualified record-evidence request (B-② derived submissionId).
import crypto from 'node:crypto';
import fs from 'node:fs';
const [ref, contentHash, change, rev, wid, out] = process.argv.slice(2);
const derived = crypto.createHash('sha256').update(ref + '\n' + contentHash).digest('hex').slice(0, 16);
fs.writeFileSync(out, JSON.stringify({ operation: 'record-evidence', runId: change, expectedRevision: Number(rev), evidenceId: wid, kind: 'classic-open-artifacts', ref, contentHash, submissionId: change + ':classic-open-artifacts:epoch-0:' + derived }));
console.log('submissionId:', change + ':classic-open-artifacts:epoch-0:' + derived);
