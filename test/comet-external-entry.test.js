import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const wrapper=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../bin/comet');
function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'external-comet-'));
 const log=path.join(root,'calls');
 const make=(dir,version='0.5.1')=>{fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'comet');fs.writeFileSync(file,`#!/bin/bash\nprintf '%s\\n' "$1" >> "$FAKE_LOG"\ncase "$1" in\n --version) printf '%s\\n' '${version}' ;;\n --help) printf '%s\\n' 'fake diagnostic help' ;;\n *) printf '%s\\n' 'unexpected command' >&2; exit 42 ;;\nesac\n`,{mode:0o755});return file;};
 const run=(args,env={})=>spawnSync('/bin/bash',[wrapper,...args],{encoding:'utf8',env:{PATH:path.join(root,'bin'),HOME:root,FAKE_LOG:log,...env},timeout:5000});
 return {root,log,make,run,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('version diagnostic invokes externally selected 0.5.1 without a local vendored build',()=>{
 const f=fixture();try {f.make(path.join(f.root,'bin'));const result=f.run(['--version']);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'0.5.1\n');assert.equal(fs.readFileSync(f.log,'utf8'),'--version\n');}finally{f.cleanup();}
});

test('missing external executable fails closed without invoking anything',()=>{
 const f=fixture();try{const result=f.run(['--version']);assert.equal(result.status,2);assert.match(result.stderr,/not found/i);assert.equal(fs.existsSync(f.log),false);}finally{f.cleanup();}
});

test('first external PATH entry controls selection; wrong version does not fall back',()=>{
 const f=fixture();try{const a=path.join(f.root,'first'),b=path.join(f.root,'second');f.make(a,'0.5.0');f.make(b,'0.5.1');const result=f.run(['--version'],{PATH:a+':'+b});assert.equal(result.status,2);assert.match(result.stderr,/version mismatch/i);assert.equal(fs.readFileSync(f.log,'utf8'),'--version\n');}finally{f.cleanup();}
});

test('PATH may contain the wrapper itself or its symlink without recursion',()=>{
 const f=fixture();try{const linked=path.join(f.root,'self');fs.mkdirSync(linked);fs.symlinkSync(wrapper,path.join(linked,'comet'));const ext=path.join(f.root,'external');f.make(ext);const result=f.run(['--version'],{PATH:path.dirname(wrapper)+':'+linked+':'+ext});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'0.5.1\n');assert.equal(fs.readFileSync(f.log,'utf8'),'--version\n');const none=f.run(['--version'],{PATH:path.dirname(wrapper)+':'+linked});assert.equal(none.status,2);assert.match(none.stderr,/not found/i);}finally{f.cleanup();}
});

test('distinct nested wrapper copies fail closed without looping',()=>{
 const f=fixture();try{for(const name of ['one','two']){const dir=path.join(f.root,name);fs.mkdirSync(dir);fs.copyFileSync(wrapper,path.join(dir,'comet'));fs.chmodSync(path.join(dir,'comet'),0o755);}const result=f.run(['--version'],{PATH:path.join(f.root,'one')+':'+path.join(f.root,'two')});assert.equal(result.status,2);assert.equal(result.error,undefined,'recursive wrapper must not time out');assert.match(result.stderr,/version check failed/i);}finally{f.cleanup();}
});

test('PATH entry with spaces and shell metacharacters is treated as a literal path',()=>{
 const f=fixture();try{const dir=path.join(f.root,'bin $(touch INJECTED)');f.make(dir);const result=f.run(['--version'],{PATH:dir});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'0.5.1\n');assert.equal(fs.existsSync(path.join(f.root,'INJECTED')),false);}finally{f.cleanup();}
});

test('version probe failure is rejected without trying the next PATH entry',()=>{
 const f=fixture();try{const a=path.join(f.root,'first'),b=path.join(f.root,'second');const bad=f.make(a);f.make(b);fs.writeFileSync(bad,'#!/bin/bash\nexit 13\n',{mode:0o755});const result=f.run(['--version'],{PATH:a+':'+b});assert.equal(result.status,2);assert.match(result.stderr,/version check failed/i);assert.equal(fs.existsSync(f.log),false);}finally{f.cleanup();}
});

test('workflow commands and extra arguments are refused before invoking an external binary',()=>{
 const f=fixture();try{f.make(path.join(f.root,'bin'));for(const args of [[],['state','next','change'],['--version','extra'],['help','state'],['--','--help']]){const result=f.run(args);assert.equal(result.status,2,JSON.stringify(args));assert.match(result.stderr,/blocked/i);}assert.equal(fs.existsSync(f.log),false);}finally{f.cleanup();}
});

test('help stays diagnostic and is forwarded only after a matching version probe',()=>{
 const f=fixture();try{f.make(path.join(f.root,'bin'));const result=f.run(['help']);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'fake diagnostic help\n');assert.match(result.stderr,/diagnostic-only/i);assert.match(result.stderr,/Node \^22\.16\.0 or >=24\.0\.0/);assert.equal(fs.readFileSync(f.log,'utf8'),'--version\n--help\n');}finally{f.cleanup();}
});

test('PATH-selected executable receives PATH unmodified and ignores Node injection variables',()=>{
 const f=fixture();try{const dir=path.join(f.root,'bin');const fake=f.make(dir);fs.writeFileSync(fake,'#!/bin/bash\nprintf "%s\\n" "$PATH" "${NODE_OPTIONS-unset}" > "$FAKE_LOG"\nprintf "0.5.1\\n"\n',{mode:0o755});const chosen=dir+':'+path.join(f.root,'node-via-nvm');const result=f.run(['--version'],{PATH:chosen,NODE_OPTIONS:'--require=/untrusted.js'});assert.equal(result.status,0,result.stderr);assert.deepEqual(fs.readFileSync(f.log,'utf8').trimEnd().split('\n'),[chosen,'unset']);}finally{f.cleanup();}
});
