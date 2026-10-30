import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checker=path.join(repo,'tools/verify/check-construction-artifact.mjs');
function run(...args){const env={...process.env};delete env.NODE_TEST_CONTEXT;return spawnSync(process.execPath,[checker,...args],{cwd:repo,env,encoding:'utf8'});}
function decision(result){try{return JSON.parse(result.stdout)}catch{return null}}
function runAt(root,...args){const env={...process.env};delete env.NODE_TEST_CONTEXT;return spawnSync(process.execPath,[checker,...args],{cwd:root,env,encoding:'utf8'});}
function fixture(root,modify){const dir=path.join(root,'openspec/changes/delivery-foundation-rearchitecture');fs.mkdirSync(dir,{recursive:true});const source=JSON.parse(fs.readFileSync(path.join(repo,'openspec/changes/delivery-foundation-rearchitecture/execution-contract.json'),'utf8'));const bytes=JSON.stringify(modify(source));fs.writeFileSync(path.join(dir,'execution-contract.json'),bytes);fs.writeFileSync(path.join(dir,'drift-lock.json'),JSON.stringify({execution_contract_sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));}

test('an absent P2_4 construction manifest cannot qualify an artifact',()=>{
 const result=run('--mode','construction','--consumer','P1_3');
 assert.equal(result.status,2);assert.equal(decision(result)?.verdict,'NOT-EXERCISED');
});
test('preverify cannot pass while registration and protected sources are missing',()=>{
 const result=run('--mode','preverify','--consumer','VERIFY');
 assert.equal(result.status,2);assert.equal(decision(result)?.verdict,'NOT-EXERCISED');
});
test('a construction result cannot be substituted for preverify or used by other consumers',()=>{
 for(const args of [['--mode','construction','--consumer','VERIFY'],['--mode','preverify','--consumer','P1_3']]){
  const result=run(...args);assert.equal(result.status,1);assert.equal(decision(result)?.verdict,'NOT-EXERCISED');
 }
});

test('self-reported construction and reviewer cannot establish protected origin',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'p31-checker-'));
 try {
  fixture(root, contract=>contract);
  fs.mkdirSync(path.join(root,'worker-reports'),{recursive:true});
  fs.writeFileSync(path.join(root,'worker-reports/P2_4-construction-manifest.json'),JSON.stringify({status:'APPROVED',qualified:true,reviewer:'fake-independent'}));
  const result=runAt(root,'--mode','construction','--consumer','P1_3');
  assert.equal(result.status,2);assert.equal(decision(result)?.reason,'PROTECTED_CONSTRUCTION_VERIFIER_UNAVAILABLE');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('self-reported registrations do not establish protected preverify readiness',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'p31-checker-'));
 try {
  fixture(root, contract=>{for(const binding of contract.repair_obligation_bindings)for(const item of binding.assertions)item.registration='REGISTERED';return contract;});
  const result=runAt(root,'--mode','preverify','--consumer','VERIFY');
  assert.equal(result.status,2);assert.equal(decision(result)?.reason,'PROTECTED_PREVERIFY_VERIFIER_UNAVAILABLE');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('a changed contract cannot be accepted by the stale lock',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'p31-checker-'));
 try {
  fixture(root, contract=>contract);
  fs.appendFileSync(path.join(root,'openspec/changes/delivery-foundation-rearchitecture/execution-contract.json'),' ');
  const result=runAt(root,'--mode','construction','--consumer','P1_3');
  assert.equal(result.status,2);assert.equal(decision(result)?.reason,'CONTRACT_DRIFT');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('a contracted registry with missing obligation identities cannot be ready',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'p31-checker-'));
 try {
  fixture(root, contract=>{contract.repair_obligation_closure.atomic_assertion_ids.pop();return contract;});
  const result=runAt(root,'--mode','preverify','--consumer','VERIFY');
  assert.equal(result.status,2);assert.equal(decision(result)?.reason,'ASSERTION_REGISTRY_INVALID');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
