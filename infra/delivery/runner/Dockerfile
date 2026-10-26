# Comet Runner 镜像构建声明（RunnerInfra.v1 / RoleBoundary.v1）：当前候选未取得镜像/OS资格。
# 历史daemon观察不能替代当前构建；状态见 image.lock.json sourceInputs.containerBuildStatus。
# 基镜像与全部固定哈希经 --build-arg 从 infra/delivery/runner/image.lock.json 解析注入；本文件不内嵌任何 tag/digest/哈希值。
# 补丁链/工具链/确定性入口完全由 integrations/comet/upstream.lock.json 当前内容导出（RW_RUNNER_BUILD：
# 有序补丁全链消费 + fingerprint 确定性入口，见 tools/infra/runner.mjs build-plan）；构建契约复用
# toolchain-baseline.json extension_delivery 的限定 build 工具（P1_1/P1_6，hostBuildFingerprint 见 lock）。
# Node/Python来自锁定公共源；pnpm与所有包必须来自显式SRI校验的输入，资源构建不等于角色/OS资格。

ARG RUNNER_BASE_IMAGE
ARG PYTHON_BASE_IMAGE
FROM ${PYTHON_BASE_IMAGE} AS python-runtime
COPY infra/delivery/runner/image.lock.json /build/runner-image.lock.json
# Same immutable image supplies interpreter, measured libraries and original copyright bytes.
RUN python3 -I - <<'PY'
import hashlib,json,pathlib,shutil,subprocess,sys
lock=json.loads(pathlib.Path('/build/runner-image.lock.json').read_text())
source=lock['sourceInputs']['runtime']['python']
assert sys.version.split()[0]==source['version']
root=pathlib.Path('/public-pydeps');(root/'lib').mkdir(parents=True);(root/'provenance').mkdir()
def verified(file,expected):
    data=file.read_bytes()
    assert len(data)==expected['bytes'] and hashlib.sha256(data).hexdigest()==expected['sha256']
    return data
records=source['provenance']['libraries']
assert [item['path'] for item in records]==source['libraries']
for item in records:
    file=pathlib.Path('/')/item['path'];assert str(file.resolve(strict=True))=='/'+item['realpath']
    verified(file,item)
    owner=None
    for name in [str(file),'/'+item['realpath']]:
        query=subprocess.run(['dpkg-query','-S',name],capture_output=True,text=True)
        if query.returncode==0:
            owner=query.stdout.splitlines()[0].split(': ',1)[0];break
    assert owner==item['owner']
    assert subprocess.run(['dpkg-query','-W','-f=${Version}',owner],capture_output=True,text=True,check=True).stdout==item['version']
    shutil.copyfile(file,root/'lib'/file.name)
    copyright=pathlib.Path('/')/item['copyright']['path'];data=verified(copyright,item['copyright'])
    (root/'provenance'/(owner.replace(':','_')+'-copyright')).write_bytes(data)
license=source['provenance']['pythonLicense'];data=verified(pathlib.Path('/')/license['path'],license)
(root/'provenance'/'Python-LICENSE.txt').write_bytes(data)
(root/'provenance'/'source.json').write_text(json.dumps({'component':source['component'],'version':source['version'],'libraries':records,'pythonLicense':license},sort_keys=True)+'\n')
PY
FROM ${RUNNER_BASE_IMAGE}
ARG PYTHON_VERSION
ARG EXPECTED_NODE_VERSION
COPY --from=python-runtime /usr/local/ /usr/local/
COPY --from=python-runtime /public-pydeps/lib/ /lib/aarch64-linux-gnu/
COPY --from=python-runtime /public-pydeps/provenance/ /usr/share/sdd-runtime-provenance/python/
RUN node -e 'if(process.version!=="v"+process.env.EXPECTED_NODE_VERSION)process.exit(1)' \
  && python3 -I -c 'import sys,ssl,tarfile,hashlib,bz2,lzma,ctypes,sqlite3,readline,curses,dbm.gnu; assert sys.version.split()[0]==sys.argv[1]' "${PYTHON_VERSION}"
ENV npm_config_offline=true npm_config_ignore_scripts=true COREPACK_ENABLE_NETWORK=0 PIP_NO_INDEX=1

# 固定输入（构建入口注入，对照 integrations/comet/upstream.lock.json 与 image.lock.json sourceInputs）：
#   SOURCE_COMMIT / SOURCE_SHA256       <- upstream source.commit / source.sha256
#   EXPECTED_FINGERPRINT                <- sourceInputs.hostBuildFingerprint（archive+patches+toolchain 现算指纹）
#   OPENSPEC_VERSION / OPENSPEC_TARBALL_SHA256 <- sourceInputs.openspec（P1_1 钉定的隔离兼容候选）
#   PATCH_<n>_SHA256                    <- upstream.patches[n-1].sha256（顺序即 lock 顺序）
ARG SOURCE_COMMIT
ARG SOURCE_SHA256
ARG EXPECTED_FINGERPRINT
ARG OPENSPEC_VERSION
ARG OPENSPEC_TARBALL_SHA256
ARG PATCH_1_SHA256
ARG PATCH_2_SHA256
ARG PATCH_3_SHA256
ARG PATCH_4_SHA256
ARG PATCH_5_SHA256
ARG PATCH_6_SHA256
ARG PATCH_7_SHA256

# 构建上下文 = 独立白名单快照。限定工具、lock 与当前完整补丁链以仓库布局镜像进容器（相对路径与 lock 逐字一致），
# 使 build.mjs 的补丁完整性检查（PATCH_INTEGRITY_MISMATCH 纪律）按原相对路径生效。
COPY tools/comet/ /build/repo/tools/comet/
COPY integrations/comet/upstream.lock.json /build/repo/integrations/comet/upstream.lock.json
COPY integrations/comet/patches/0001-matt-method-profile.patch /build/repo/integrations/comet/patches/0001-matt-method-profile.patch
COPY integrations/comet/patches/tests/1_6.patch /build/repo/integrations/comet/patches/tests/1_6.patch
COPY integrations/comet/patches/0002-managed-delivery-runtime.patch /build/repo/integrations/comet/patches/0002-managed-delivery-runtime.patch
COPY integrations/comet/patches/tests/2_4.patch /build/repo/integrations/comet/patches/tests/2_4.patch
COPY integrations/comet/patches/0003-post-archive-closeout.patch /build/repo/integrations/comet/patches/0003-post-archive-closeout.patch
COPY integrations/comet/patches/tests/4_6.patch /build/repo/integrations/comet/patches/tests/4_6.patch
COPY integrations/comet/patches/0004-upstream-security-backports.patch /build/repo/integrations/comet/patches/0004-upstream-security-backports.patch
COPY .sdd/cache/runner-build/comet-source.tar.gz /build/comet-source.tar.gz
COPY .sdd/cache/runner-build/openspec-${OPENSPEC_VERSION}.tgz /build/openspec.tgz

# 输入完整性：archive、openspec tarball 与全部补丁的 sha256 必须与 lock 一致，任何不一致立即终止构建。
RUN echo "${SOURCE_SHA256}  /build/comet-source.tar.gz" | sha256sum -c - \
  && echo "${OPENSPEC_TARBALL_SHA256}  /build/openspec.tgz" | sha256sum -c - \
  && echo "${PATCH_1_SHA256}  /build/repo/integrations/comet/patches/0001-matt-method-profile.patch" | sha256sum -c - \
  && echo "${PATCH_2_SHA256}  /build/repo/integrations/comet/patches/tests/1_6.patch" | sha256sum -c - \
  && echo "${PATCH_3_SHA256}  /build/repo/integrations/comet/patches/0002-managed-delivery-runtime.patch" | sha256sum -c - \
  && echo "${PATCH_4_SHA256}  /build/repo/integrations/comet/patches/tests/2_4.patch" | sha256sum -c - \
  && echo "${PATCH_5_SHA256}  /build/repo/integrations/comet/patches/0003-post-archive-closeout.patch" | sha256sum -c - \
  && echo "${PATCH_6_SHA256}  /build/repo/integrations/comet/patches/tests/4_6.patch" | sha256sum -c - \
  && echo "${PATCH_7_SHA256}  /build/repo/integrations/comet/patches/0004-upstream-security-backports.patch" | sha256sum -c -

# Every package below is an explicit verified public input, never host node_modules/cache.
COPY infra/delivery/runner/image.lock.json /build/repo/infra/delivery/runner/image.lock.json
COPY .sdd/cache/runner-build/public/ /build/repo/.sdd/cache/runner-build/public/
COPY .sdd/cache/runner-build/openspec-project/ /build/repo/.sdd/cache/runner-build/openspec-project/
COPY .sdd/cache/runner-build/comet-pnpm-project/ /build/pnpm-seed/
COPY .sdd/cache/runner-build/openspec-${OPENSPEC_VERSION}.tgz /build/repo/.sdd/cache/runner-build/openspec-${OPENSPEC_VERSION}.tgz
COPY package.json package-lock.json /opt/sdd/
COPY lib/ /opt/sdd/lib/
COPY contracts/ /opt/sdd/contracts/
COPY tools/infra/ /opt/sdd/tools/infra/
COPY tools/comet/ /opt/sdd/tools/comet/
COPY infra/delivery/ /opt/sdd/infra/delivery/
COPY integrations/comet/ /opt/sdd/integrations/comet/
ENV npm_config_userconfig=/build/config/empty-user.npmrc npm_config_globalconfig=/build/config/empty-global.npmrc
RUN node --input-type=module - <<'JS'
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const lock=JSON.parse(fs.readFileSync('/build/repo/infra/delivery/runner/image.lock.json')),runtime=lock.sourceInputs.runtime;
assert(runtime.dependencies.every(group=>group.closed&&group.files.length));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
for(const group of runtime.dependencies)for(const item of group.files){const bytes=fs.readFileSync('/build/repo/'+item.path);assert.equal(bytes.length,item.bytes);assert.equal(digest(bytes),item.sha256);if(item.integrity)assert.equal('sha512-'+crypto.createHash('sha512').update(bytes).digest('base64'),item.integrity);}
for(const [kind,project]of Object.entries(runtime.projects))for(const item of Object.values(project)){const file=kind==='comet'?'/build/pnpm-seed/'+path.basename(item.path):'/build/repo/'+item.path;const bytes=fs.readFileSync(file);assert.equal(bytes.length,item.bytes);assert.equal(digest(bytes),item.sha256);}
fs.mkdirSync('/build/config',{recursive:true});for(const name of ['empty-user.npmrc','empty-global.npmrc'])fs.writeFileSync('/build/config/'+name,'');
const run=(name,args)=>execFileSync(name,args,{stdio:'inherit',env:{...process.env,npm_config_cache:'/build/npm-cache',npm_config_offline:'true',npm_config_ignore_scripts:'true',NO_UPDATE_NOTIFIER:'1'}});
run('dpkg',['-i',...runtime.dependencies.find(group=>group.id==='git-deb').files.map(item=>'/build/repo/'+item.path)]);
for(const item of [...new Map(runtime.dependencies.filter(group=>['bootstrap-npm','openspec-npm','pnpm'].includes(group.id)).flatMap(group=>group.files).map(item=>[item.sha256,item])).values()])run('npm',['cache','add','/build/repo/'+item.path,'--offline','--ignore-scripts','--no-audit','--no-fund']);
run('npm',['ci','--prefix','/opt/sdd','--offline','--ignore-scripts','--no-audit','--no-fund']);
const manager=runtime.dependencies.find(group=>group.id==='pnpm');assert.equal(manager.files.length,1);run('npm',['install','--global','/build/repo/'+manager.files[0].path,'--offline','--ignore-scripts','--no-audit','--no-fund']);
run('npm',['ci','--prefix','/build/repo/.sdd/cache/runner-build/openspec-project','--offline','--ignore-scripts','--no-audit','--no-fund']);
run('python3',['-I','-m','pip','install','--no-index','--no-deps','/build/repo/'+runtime.dependencies.find(group=>group.id==='python-wheel').files[0].path]);
assert.equal(execFileSync('pnpm',['--version'],{encoding:'utf8'}).trim(),lock.sourceInputs.toolchain.pnpm);
JS
# Reassert the immutable Python libraries after Debian installs; preserve their provenance.
COPY --from=python-runtime /public-pydeps/lib/ /lib/aarch64-linux-gnu/
RUN ln -s /build/repo/.sdd/cache/runner-build/openspec-project/node_modules/.bin/openspec /usr/local/bin/openspec \
  && ln -s /opt/sdd/lib/adapters/comet-executor.js /opt/sdd/runner-host.mjs \
  && chmod -R a+rX /opt/sdd
ARG BOOTSTRAP_DIGEST
LABEL sdd.sdk="${EXPECTED_FINGERPRINT}" sdd.bootstrap="${BOOTSTRAP_DIGEST}"
# Root-observed same429/original8ecc cache mechanism; local static bytes only, network remains none.
RUN node --input-type=module - <<'JS'
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const lock=JSON.parse(fs.readFileSync('/build/repo/infra/delivery/runner/image.lock.json')),runtime=lock.sourceInputs.runtime,root='/mechanism',served=root+'/registry';
fs.mkdirSync(root);fs.mkdirSync(served);fs.mkdirSync(root+'/seed');fs.mkdirSync(root+'/fresh-seed');
const mapping=runtime.dependencies.find(group=>group.id==='comet-pnpm').files.map(item=>{const url=new URL(item.url);assert.equal(url.protocol,'https:');assert.equal(url.hostname,'registry.npmjs.org');const relative=url.pathname.slice(1);assert(relative&&!relative.split('/').some(part=>part==='..'||part==='.'||!part));const target=path.join(served,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync('/build/repo/'+item.path,target);return{requestPath:url.pathname,relativeFile:relative,bytes:item.bytes,sha256:item.sha256,integrity:item.integrity};});
assert.equal(mapping.length,429);assert.equal(new Set(mapping.map(item=>item.requestPath)).size,429);
fs.copyFileSync('/build/pnpm-seed/pnpm-lock.yaml',root+'/seed/pnpm-lock.yaml');fs.copyFileSync('/build/pnpm-seed/package.json',root+'/fresh-seed/package.json');
fs.writeFileSync(root+'/input-lock.json',JSON.stringify({scope:'formal recipe public429 cache hydration only;not fullRunner qualification',mapping,lockSha256:runtime.projects.comet.pnpmLock.sha256}));
JS
RUN timeout --signal=TERM --kill-after=5s 300s node --max-old-space-size=1024 --input-type=module - <<'JS'
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
const root='/mechanism',input=JSON.parse(fs.readFileSync(root+'/input-lock.json')),served=root+'/registry',seed=root+'/seed',store='/build/repo/.sdd/cache/pnpm-store';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');const before=hash(seed+'/pnpm-lock.yaml');assert.equal(before,input.lockSha256);
const actual=[];function walk(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),rel=prefix+entry.name,stat=fs.lstatSync(file);assert(!stat.isSymbolicLink());if(entry.isDirectory())walk(file,rel+'/');else{assert(stat.isFile());actual.push(rel);}}}walk(served);assert.deepEqual(actual.sort(),input.mapping.map(item=>item.relativeFile).sort());
for(const item of input.mapping){const file=served+'/'+item.relativeFile,bytes=fs.readFileSync(file);assert.equal(bytes.length,item.bytes);assert.equal(hash(file),item.sha256);assert.equal('sha512-'+crypto.createHash('sha512').update(bytes).digest('base64'),item.integrity);}
const environment={...process.env,npm_config_ignore_scripts:'true',npm_config_fetch_retries:'0',npm_config_fetch_timeout:'15000',npm_config_network_concurrency:'4',npm_config_audit:'false',npm_config_update_notifier:'false'};
async function terminateOwned(child, closed) {
 if(child.exitCode!==null||child.signalCode!==null)return closed;
 child.kill('SIGTERM');let timer;
 const status=await Promise.race([closed.then(value=>({closed:true,value})),new Promise(resolve=>{timer=setTimeout(()=>resolve({closed:false}),5000);})]);
 clearTimeout(timer);
 if(!status.closed&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 return status.closed?status.value:closed;
}
async function run(args,env){
 const child=spawn('pnpm',args,{cwd:seed,env,stdio:['ignore','pipe','pipe']});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 const stdout=[],stderr=[];let observedBytes=0,retainedBytes=0,overflow=false,timedOut=false,stopping;
 const stop=()=>{stopping??=terminateOwned(child,closed);stopping.catch(()=>{});};
 const timer=setTimeout(()=>{timedOut=true;stop();},240000);
 const collect=chunks=>bytes=>{observedBytes+=bytes.length;const available=Math.max(0,16*1024*1024-retainedBytes);if(available){const kept=bytes.subarray(0,available);chunks.push(Buffer.from(kept));retainedBytes+=kept.length;}if(bytes.length>available){overflow=true;stop();}};
 child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));
 let terminal;
 try{terminal=await closed;if(stopping)await stopping;}finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)await terminateOwned(child,closed);}
 process.stdout.write(Buffer.concat(stdout));process.stderr.write(Buffer.concat(stderr));
 assert.equal(timedOut,false,'PNPM_TIMEOUT');assert.equal(overflow,false,'PNPM_OUTPUT_LIMIT');assert.equal(terminal.code,0,JSON.stringify(terminal));
 return Buffer.concat(stdout).toString('utf8').trim();
}
let server,closed,stdout='',stderr='',port,terminal;
try{
 server=spawn('python3',['-I','-u','-m','http.server','--bind','127.0.0.1','--directory',served,'0'],{env:environment,stdio:['ignore','pipe','pipe']});closed=new Promise((resolve,reject)=>{server.once('error',reject);server.once('close',(code,signal)=>resolve({code,signal}));});server.stderr.on('data',b=>{stderr+=b;if(stderr.length>4*1024*1024)server.kill('SIGKILL');});
 port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('SERVER_START_TIMEOUT')),15000);server.stdout.on('data',b=>{stdout+=b;if(stdout.length>4096){clearTimeout(timer);reject(new Error('SERVER_STDOUT_LIMIT'));return;}const match=/Serving HTTP on 127\.0\.0\.1 port (\d+)/.exec(stdout);if(match){clearTimeout(timer);resolve(Number(match[1]));}});server.once('exit',()=>{clearTimeout(timer);reject(new Error('SERVER_EARLY_EXIT'));});});
 const local={...environment,npm_config_registry:'http://127.0.0.1:'+port+'/',npm_config_offline:'false'};assert.equal(await run(['--version'],local),'10.18.3');assert.equal(await run(['config','get','ignore-scripts'],local),'true');assert.equal(await run(['config','get','fetch-retries'],local),'0');
 await run(['fetch','--store-dir',store],local);
 terminal=await terminateOwned(server,closed);server=null;
 const requests=[...stderr.matchAll(/"(\w+) ([^ ]+) HTTP\/[0-9.]+" (\d+)/g)],members=new Set(input.mapping.map(item=>item.requestPath));assert(requests.length>0);for(const request of requests){assert.equal(request[1],'GET');assert(members.has(request[2]),'UNDECLARED_HTTP_REQUEST');assert.equal(request[3],'200');}
 const offline={...environment,npm_config_offline:'true',npm_config_registry:'https://registry.npmjs.org/'};assert.equal(await run(['config','get','offline'],offline),'true');await run(['fetch','--store-dir',store],offline);
 assert.equal(hash(seed+'/pnpm-lock.yaml'),before);fs.writeFileSync(root+'/result.json',JSON.stringify({scope:input.scope,constructionOnly:true,productionQualified:false,platform:process.platform,arch:process.arch,sourceLockSha256:before,requests:requests.length,listenerClosed:true,terminal,offlineSecondFetch:true})+'\n');process.stdout.write(fs.readFileSync(root+'/result.json'));
}finally{if(server)terminal=await terminateOwned(server,closed);fs.writeFileSync(root+'/http.stdout.txt',stdout);fs.writeFileSync(root+'/http.stderr.txt',stderr);}

JS
RUN timeout --signal=TERM --kill-after=5s 300s node --max-old-space-size=1024 --input-type=module - <<'JS'
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
const root='/mechanism',fresh=root+'/fresh-seed',store='/build/repo/.sdd/cache/pnpm-store';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expected=JSON.parse(fs.readFileSync(root+'/input-lock.json')),oldResult=JSON.parse(fs.readFileSync(root+'/result.json'));
assert.equal(oldResult.listenerClosed,true);assert.equal(sha(root+'/seed/pnpm-lock.yaml'),expected.lockSha256);
assert.equal(fs.existsSync(fresh+'/node_modules'),false,'fresh target must not inherit any virtual store');
assert.equal(sha(fresh+'/package.json'),'594d4f6334e09e317f08fdb8bb4f177817b236ddfdd9c390a31a1f8b15883a09');
fs.copyFileSync(root+'/seed/pnpm-lock.yaml',fresh+'/pnpm-lock.yaml',fs.constants.COPYFILE_EXCL);assert.equal(sha(fresh+'/pnpm-lock.yaml'),expected.lockSha256);
async function terminateOwned(child,closed){if(child.exitCode!==null||child.signalCode!==null)return closed;child.kill('SIGTERM');let timer;const status=await Promise.race([closed.then(value=>({closed:true,value})),new Promise(resolve=>{timer=setTimeout(()=>resolve({closed:false}),5000);})]);clearTimeout(timer);if(!status.closed&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');return status.closed?status.value:closed;}
const env={...process.env,npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_registry:'https://registry.npmjs.org/',npm_config_fetch_retries:'0',npm_config_fetch_timeout:'15000',npm_config_audit:'false',NO_UPDATE_NOTIFIER:'1',COREPACK_ENABLE_NETWORK:'0'};
async function run(args){const child=spawn('pnpm',args,{cwd:fresh,env,stdio:['ignore','pipe','pipe']});const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});const stdout=[],stderr=[];let bytes=0,overflow=false,timedOut=false,stopping;const stop=()=>{stopping??=terminateOwned(child,closed);stopping.catch(()=>{});};const timer=setTimeout(()=>{timedOut=true;stop();},240000);const collect=chunks=>chunk=>{const remaining=Math.max(0,16777216-bytes);if(remaining){const kept=chunk.subarray(0,remaining);chunks.push(Buffer.from(kept));bytes+=kept.length;}if(chunk.length>remaining){overflow=true;stop();}};child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));let terminal;try{terminal=await closed;if(stopping)await stopping;}finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)await terminateOwned(child,closed);}const output=Buffer.concat(stdout).toString('utf8'),errors=Buffer.concat(stderr).toString('utf8');process.stdout.write(output);process.stderr.write(errors);assert(!overflow,'OUTPUT_LIMIT');assert(!timedOut,'TIMEOUT');assert.equal(terminal.code,0,JSON.stringify(terminal));return output.trim();}
assert.equal(await run(['config','get','offline']),'true');assert.equal(await run(['config','get','ignore-scripts']),'true');assert.equal(await run(['--version']),'10.18.3');
const installOutput=await run(['install','--frozen-lockfile','--offline','--ignore-scripts','--store-dir',store]);
assert.equal(sha(fresh+'/pnpm-lock.yaml'),expected.lockSha256);assert.equal(sha(root+'/seed/pnpm-lock.yaml'),expected.lockSha256);
const virtual=fresh+'/node_modules/.pnpm';assert.equal(fs.lstatSync(virtual).isDirectory(),true);assert.equal(fs.lstatSync(virtual).isSymbolicLink(),false);assert.notEqual(fs.realpathSync(virtual),fs.realpathSync(root+'/seed/node_modules/.pnpm'));
assert.equal(sha(fresh+'/package.json'),'594d4f6334e09e317f08fdb8bb4f177817b236ddfdd9c390a31a1f8b15883a09');
const progress=[...installOutput.matchAll(/resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/g)].at(-1);assert(progress,'actual fresh progress must be observable');assert.equal(Number(progress[1]),429);assert.equal(Number(progress[2]),429);assert.equal(Number(progress[3]),0);assert.equal(Number(progress[4]),429);
const result={scope:'fresh Linux original-manifest install from reused hydrated store only;not Comet build/Role/source qualification',constructionOnly:true,productionQualified:false,platform:process.platform,arch:process.arch,sourceLockSha256:expected.lockSha256,manifestSha256:sha(fresh+'/package.json'),initialNodeModulesAbsent:true,oldVirtualStoreNotReused:true,resolved:Number(progress[1]),reused:Number(progress[2]),downloaded:Number(progress[3]),added:Number(progress[4]),listenerFromPriorLayerClosed:true};fs.writeFileSync(root+'/result-fresh.json',JSON.stringify(result)+'\n');console.log(JSON.stringify(result));
JS

# 受控构建（声明）：补丁按 lock 校验应用，fingerprint 由工具按 archive+patches+toolchain 现算；
# --project /build/repo 使输出落在 /build/repo/.sdd/vendor/comet/<commit>/builds/<fingerprint>/work。
# 本步骤从未执行（UNVERIFIED）：准入时先在受控环境重建并核对 fingerprint 与 digest，再认证镜像。
RUN node /build/repo/tools/comet/build.mjs \
      --archive /build/comet-source.tar.gz \
      --project /build/repo \
      --lock /build/repo/integrations/comet/upstream.lock.json

# 非 root 运行身份与角色工作区挂载点（挂载策略见 workspace-mounts.json；控制卷只对 controller 可写）。
# 入口是确定性 fingerprint 路径：EXPECTED_FINGERPRINT 与构建工具现算值不一致时 test -f 失败、构建即拒——
# 禁止按路径搜索取首个匹配的漂移入口（历史缺陷：这类解析会静默吞掉指纹漂移，故确定性检测连注释一并禁止）。
RUN useradd --uid 10001 --user-group --create-home comet \
  && mkdir -p /comet/state /comet/receipts /comet/issuance /workspace \
  && test -f "/build/repo/.sdd/vendor/comet/${SOURCE_COMMIT}/builds/${EXPECTED_FINGERPRINT}/work/bin/comet.js" \
  && chmod a+rx "/build/repo/.sdd/vendor/comet/${SOURCE_COMMIT}" \
  && chmod -R a+rX "/build/repo/.sdd/vendor/comet/${SOURCE_COMMIT}/builds/${EXPECTED_FINGERPRINT}" \
  && ln -s "/build/repo/.sdd/vendor/comet/${SOURCE_COMMIT}/builds/${EXPECTED_FINGERPRINT}/work/bin/comet.js" /usr/local/bin/comet-runner \
  && chown -R comet:comet /comet /workspace

USER comet
WORKDIR /workspace
ENTRYPOINT ["node", "/usr/local/bin/comet-runner"]
