import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('test fixtures resolve the first PATH Comet and refuse a stale version',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'comet-path-check-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const first=path.join(root,'first'),second=path.join(root,'second');fs.mkdirSync(first);fs.mkdirSync(second);
  const write=(dir,version)=>fs.writeFileSync(path.join(dir,'comet'),`#!/bin/sh\nprintf '%s\\n' '${version}'\n`,{mode:0o755});
  write(first,'0.5.0');write(second,'0.5.1');
  const helper=new URL('./helpers/comet-cli.js',import.meta.url).href;
  const env={...process.env,PATH:[first,second,'/usr/bin','/bin'].join(path.delimiter)};
  const probe=()=>spawnSync(process.execPath,['--input-type=module','-e',`import {resolveCometForTest} from ${JSON.stringify(helper)}; console.log(resolveCometForTest())`],{env,encoding:'utf8'});
  assert.notEqual(probe().status,0,'a stale first executable cannot be silently bypassed');
  write(first,'0.5.1');const result=probe();assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),path.join(first,'comet'));
});
