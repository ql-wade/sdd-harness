import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import test from 'node:test';
const runner=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools/verify/direct-target-test.mjs');const head="import test from 'node:test';import assert from 'node:assert/strict';\n";
function run(body,names,opts={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sdd-contract-target-'));try{const change=path.join(dir,'openspec/changes/delivery-foundation-rearchitecture');fs.mkdirSync(change,{recursive:true});fs.writeFileSync(path.join(dir,'fixture.test.mjs'),head+body);const target={file:'fixture.test.mjs',pattern:'GROUP',requiredNames:names,minimumPerName:1,uniquePerName:true};Object.assign(target,opts.target??{});const row={id:'V_TEST',required:true,testTarget:target};const contract=JSON.stringify({checks:opts.duplicate?[row,row]:[row]});fs.writeFileSync(path.join(change,'execution-contract.json'),contract);const hash=crypto.createHash('sha256').update(contract).digest('hex');fs.writeFileSync(path.join(change,'drift-lock.json'),JSON.stringify({execution_contract_sha256:opts.drift?'0'.repeat(64):hash}));const env={...process.env};delete env.NODE_TEST_CONTEXT;return spawnSync(process.execPath,[runner,'--check-id','V_TEST'],{cwd:dir,env,encoding:'utf8',timeout:10000});}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function verdict(r){const l=r.stdout.split('\n').find(x=>x.startsWith('# target-verdict '));return l?JSON.parse(l.slice('# target-verdict '.length)).verdict:null;}
test('all frozen named targets execute and pass',()=>assert.equal(run("test('GROUP A',()=>{});test('GROUP B',()=>{});",['GROUP A','GROUP B']).status,0));
test('missing one frozen target is not exercised',()=>assert.equal(verdict(run("test('GROUP A',()=>{});",['GROUP A','GROUP B'])),'NOT-EXERCISED'));
test('zero matched targets is not exercised',()=>assert.equal(verdict(run("test('other',()=>{});",['GROUP A'])),'NOT-EXERCISED'));
test('skipped target is not exercised',()=>assert.equal(verdict(run("test('GROUP A',{skip:true},()=>{});",['GROUP A'])),'NOT-EXERCISED'));
test('failed target reports failure',()=>assert.equal(verdict(run("test('GROUP A',()=>assert.equal(1,2));",['GROUP A'])),'FAIL'));
test('duplicate target is not exercised',()=>assert.equal(verdict(run("test('GROUP A',()=>{});test('GROUP A',()=>{});",['GROUP A'])),'NOT-EXERCISED'));
test('contract hash mismatch is not exercised',()=>assert.equal(verdict(run("test('GROUP A',()=>{});",['GROUP A'],{drift:true})),'NOT-EXERCISED'));
test('nested required cases are all verified',()=>assert.equal(run("test('GROUP',async t=>{await t.test('A',()=>{});await t.test('B',()=>{});});",['GROUP','A','B']).status,0));
test('a missing nested case cannot pass from the parent',()=>assert.equal(verdict(run("test('GROUP',async t=>{await t.test('A',()=>{});});",['GROUP','A','B'])),'NOT-EXERCISED'));
test('a skipped nested case cannot pass',()=>assert.equal(verdict(run("test('GROUP',async t=>{await t.test('A',{skip:true},()=>{});await t.test('B',()=>{});});",['GROUP','A','B'])),'NOT-EXERCISED'));
test('a todo target cannot pass',()=>assert.equal(verdict(run("test('GROUP A',{todo:'later'},()=>{});",['GROUP A'])),'NOT-EXERCISED'));
test('unrelated output cannot forge a registered target',()=>assert.equal(verdict(run("console.log('ok 1 - GROUP A');test('other',()=>{});",['GROUP A'])),'NOT-EXERCISED'));

test('empty frozen target list is rejected',()=>assert.equal(verdict(run("test('GROUP A',()=>{});",['GROUP A'],{target:{requiredNames:[]}})),'NOT-EXERCISED'));
test('duplicate frozen target identities are rejected',()=>assert.equal(verdict(run("test('GROUP A',()=>{});",['GROUP A','GROUP A'])),'NOT-EXERCISED'));
test('duplicate registered checks are rejected',()=>assert.equal(verdict(run("test('GROUP A',()=>{});",['GROUP A'],{duplicate:true})),'NOT-EXERCISED'));
test('escaped test target is rejected',()=>assert.equal(verdict(run("test('GROUP A',()=>{});",['GROUP A'],{target:{file:'../outside.test.mjs'}})),'NOT-EXERCISED'));

test('test file changed during execution is not exercised',()=>assert.equal(verdict(run("import fs from 'node:fs';test('GROUP A',()=>{fs.appendFileSync(new URL(import.meta.url),'\\n//changed');});",['GROUP A'])),'NOT-EXERCISED'));
test('contract changed during execution is not exercised',()=>assert.equal(verdict(run("import fs from 'node:fs';test('GROUP A',()=>{fs.appendFileSync('openspec/changes/delivery-foundation-rearchitecture/execution-contract.json',' ');});",['GROUP A'])),'NOT-EXERCISED'));
test('lock changed during execution is not exercised',()=>assert.equal(verdict(run("import fs from 'node:fs';test('GROUP A',()=>{fs.appendFileSync('openspec/changes/delivery-foundation-rearchitecture/drift-lock.json',' ');});",['GROUP A'])),'NOT-EXERCISED'));
test('module loading failure is not an observed behavioral failure',()=>assert.equal(verdict(run("import './missing-module.mjs';test('GROUP A',()=>{});",['GROUP A'])),'NOT-EXERCISED'));
test('a test worker killed by signal is not an observed behavioral failure',()=>assert.equal(verdict(run("test('GROUP A',()=>{process.kill(process.pid,'SIGKILL');});",['GROUP A'])),'NOT-EXERCISED'));
test('passing target with an environment failure signal remains not exercised',()=>assert.equal(verdict(run("test('GROUP A',()=>{console.error('ECONNREFUSED');});",['GROUP A'])),'NOT-EXERCISED'));

test('a required parent without registered leaf cannot prove a requirement',()=>assert.equal(verdict(run("test('GROUP',async t=>{await t.test('unrelated child',()=>{});});",['GROUP'])),'NOT-EXERCISED'));
test('all leaves beneath a required parent must be individually registered',()=>assert.equal(verdict(run("test('GROUP',async t=>{await t.test('A',()=>{});await t.test('unrelated child',()=>{});});",['GROUP','A'])),'NOT-EXERCISED'));
test('a parent and its child cannot share one required identity',()=>assert.equal(verdict(run("test('GROUP',async t=>{await t.test('GROUP',()=>{});});",['GROUP'])),'NOT-EXERCISED'));
test('a nested todo leaf cannot pass through its parent',()=>assert.equal(verdict(run("test('GROUP',async t=>{await t.test('A',{todo:'later'},()=>{});});",['GROUP','A'])),'NOT-EXERCISED'));
test('a nested parent and all its exact leaves can pass',()=>assert.equal(run("test('GROUP',async t=>{await t.test('branch',async b=>{await b.test('A',()=>{});await b.test('B',()=>{});});});",['GROUP','A','B']).status,0));

test('separate groups require only their own exact registered leaves',()=>assert.equal(run("test('GROUP first',async t=>{await t.test('first-leaf',()=>{});});test('GROUP second',async t=>{await t.test('second-leaf',()=>{});});",['GROUP first','first-leaf','GROUP second','second-leaf']).status,0));
test('leaves of a different group cannot stand in for an unregistered leaf',()=>assert.equal(verdict(run("test('GROUP first',async t=>{await t.test('first-leaf',()=>{});});test('GROUP second',async t=>{await t.test('second-leaf',()=>{});});",['GROUP first','first-leaf','GROUP second'])),'NOT-EXERCISED'));
