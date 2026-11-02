// classic Open evidence receipt — uses the global comet dist helper.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const realCli = execFileSync('bash', ['-c', 'realpath $(which comet)'], { encoding: 'utf8' }).trim();
const globalRoot = path.resolve(path.dirname(realCli), '..');
const { classicOpenEvidenceReceipt } = await import(pathToFileURL(path.join(globalRoot, 'dist/domains/comet-classic/classic-sdk-application.js')).href);
const evidence = await classicOpenEvidenceReceipt(process.argv[2], `openspec/changes/${process.argv[3]}`);
console.log(JSON.stringify({ ref: evidence.ref, contentHash: evidence.contentHash }));
