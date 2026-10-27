import fs from 'node:fs';import path from 'node:path';
const out=path.dirname(new URL(import.meta.url).pathname);
let watcher,timer,finished=false;
const finish=(result)=>{if(finished)return;finished=true;clearTimeout(timer);watcher?.close();const value={utc:new Date().toISOString(),pid:process.pid,node:process.versions.node,scope:'one ordinary tmp directory watch; no candidate/product/peer invocation',result};fs.writeFileSync(path.join(out,'watch-resource-proof.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
try{watcher=fs.watch(out,()=>{});watcher.once('error',error=>finish({kind:'watch-error',code:error.code,syscall:error.syscall,message:error.message}));timer=setTimeout(()=>finish({kind:'watch-created-without-error-during-bounded-probe'}),100);}
catch(error){finish({kind:'watch-sync-error',code:error.code,syscall:error.syscall,message:error.message});}
