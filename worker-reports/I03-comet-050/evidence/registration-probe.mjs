// I03-comet-050 registration RED/GREEN probe: are runtime verification facts registered in the owned domain files?
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2] ?? '.');
const read = (n) => JSON.parse(fs.readFileSync(path.join(dir, 'infra/delivery/outline', n), 'utf8'));
const missing = [];
const lock = read('images.lock.json');
if (!lock.runtimeVerification?.runtimePinMatch) missing.push('images.lock.json runtimeVerification.runtimePinMatch');
const domain = read('collection-registration.example.json');
if (domain.instance?.localApiReachability?.status !== 'VERIFIED-LOCAL-API') missing.push('collection-registration instance.localApiReachability=VERIFIED-LOCAL-API');
if (domain.collections.some((c) => c.audience?.status !== 'UNVERIFIED')) missing.push('AUDIENCE MUST STAY UNVERIFIED (unexpected state!)');
const policy = read('storage-policy.json');
if (!policy.runtimeVerification?.volumes) missing.push('storage-policy runtimeVerification.volumes');
if (policy.runtimeVerification?.restartPersistenceProbe !== 'UNVERIFIED') missing.push('storage-policy restartPersistenceProbe must stay UNVERIFIED');
const oidc = read('oidc-registration.example.json');
if (!oidc.provider?.runtimeObservation) missing.push('oidc provider.runtimeObservation (dex discovery readback)');
if (oidc.provider?.status !== 'UNPROVISIONED' || oidc.evidence?.loginProof !== 'UNVERIFIED') missing.push('oidc provider/evidence statuses must stay UNPROVISIONED/UNVERIFIED');
if (missing.length) { console.log('RED: ' + missing.join('; ')); process.exit(1); }
console.log('GREEN: all runtime verification registrations present; audience/grant remain UNVERIFIED');
