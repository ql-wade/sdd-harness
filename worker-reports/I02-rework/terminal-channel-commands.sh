TMPDIR_NATIVE="${TMPDIR_NATIVE:-/tmp/claude-i02}"
mkdir -p "$TMPDIR_NATIVE"
#!/bin/sh
# =============================================================================
# I02 rework r1 — 终端通道清单（真实 docker 操作；本代理沙箱无 daemon（EPERM），本清单不代跑）。
# 执行环境：具备 docker daemon 的终端通道；cwd = 仓库内任意位置（下面用 git 解析仓库根，零宿主绝对路径）。
# 用法：逐段人工执行，每段末尾判据必须全部满足才算该段 PASS；任何一段不满足即停，
#       未执行/未满足的段落一律记 UNVERIFIED——绝不因前面的 PASS 推断后面段落已验证。
# 证据：各段输出按 evidence/ 编号落盘（相对仓库根），不写活配置 hooks/MCP；tasks/ledger/drift-lock 不碰。
# =============================================================================
set -u
REPO="$(git rev-parse --show-toplevel)" || exit 1
RUN="$REPO/tools/infra/runner.mjs"
RDIR="$REPO/infra/delivery/runner"
EV="worker-reports/I02-rework/evidence/terminal-channel-run.txt"
RUNNER_TAG="comet-runner:locked-local"          # 本地构建 tag（commit+fingerprint 锁定，非 registry 发布引用）
EXPECTED_FINGERPRINT="d437093083ad4500253795fe231484c606e925b2404f958e5a7dd4fd4c11cba6"
EXPECT_COMMIT="c90af44a4474662d7853aae76ce785404974fb0a"

# -----------------------------------------------------------------------------
# S0 前置门
# -----------------------------------------------------------------------------
# S0.1 daemon 可达
docker version --format '{{.Server.Version}}'
# 判据 S0.1：输出版本号（非 EPERM/连接错误）；失败即整清单 UNVERIFIED 终止。
# S0.2 构建计划与锁一致（本清单不硬编码 sha——以下列期望指纹为准绳对照）
node "$RUN" build-plan --dir "$RDIR" --json | tee "$TMPDIR_NATIVE/i02-plan.json"
# 判据 S0.2：exit 0；.drift==[]；.fingerprint==d4370930…cba6（即 $EXPECTED_FINGERPRINT）；
#            .sourceCommit==c90af44a…fb0a；.patches 长度 6 且逐项 sha256Verified==true；
#            .upGate=="CLOSED"（build-plan 永不开门）。
python3 - <<'PY'
import json,sys
plan=json.load(open('$TMPDIR_NATIVE/i02-plan.json'))
assert plan['drift']==[], plan['drift']
assert plan['fingerprint']=='d437093083ad4500253795fe231484c606e925b2404f958e5a7dd4fd4c11cba6', plan['fingerprint']
assert plan['sourceCommit']=='c90af44a4474662d7853aae76ce785404974fb0a'
assert len(plan['patches'])==6 and all(p['sha256Verified'] for p in plan['patches'])
assert plan['upGate']=='CLOSED'
assert plan['entrypoint']==f"/build/repo/.sdd/vendor/comet/{plan['sourceCommit']}/builds/{plan['fingerprint']}/work/bin/comet.js"
print('S0.2 PASS')
PY

# -----------------------------------------------------------------------------
# S1 构建输入获取（仅当 build-plan inputs 报 ACQUISITION_REQUIRED；已 PRESENT 则跳过）
# -----------------------------------------------------------------------------
# 上游锁源（两 URL 都来自锁/baseline 记录，非本清单发明）：
#   comet archive : https://codeload.github.com/rpamis/comet/tar.gz/c90af44a4474662d7853aae76ce785404974fb0a (40474019 bytes)
#   openspec      : https://registry.npmmirror.com/@fission-ai/openspec/-/openspec-1.11.0.tgz (471694 bytes)
cd "$REPO" || exit 1
mkdir -p .sdd/cache/runner-build
[ -f .sdd/cache/runner-build/comet-source.tar.gz ] || curl -fsSL "https://codeload.github.com/rpamis/comet/tar.gz/$EXPECT_COMMIT" -o .sdd/cache/runner-build/comet-source.tar.gz
[ -f .sdd/cache/runner-build/openspec-1.11.0.tgz ] || curl -fsSL "https://registry.npmmirror.com/@fission-ai/openspec/-/openspec-1.11.0.tgz" -o .sdd/cache/runner-build/openspec-1.11.0.tgz
shasum -a 256 .sdd/cache/runner-build/comet-source.tar.gz | grep -q '^28a7e2faefa7817244bdc1e54fdca3443fb9e16d947f89df9d51391e45faaa1f' && echo 'archive sha OK'
shasum -a 256 .sdd/cache/runner-build/openspec-1.11.0.tgz | grep -q '^84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f' && echo 'openspec tarball sha OK'
node "$RUN" build-plan --dir "$RDIR" --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:v["status"] for k,v in d["inputs"].items()})'
# 判据 S1：两个 sha grep 命中（OK 行出现）；build-plan inputs 两项 status 均 PRESENT。
#           sha 不命中即停（绝不"先构建再说法"）。

# -----------------------------------------------------------------------------
# S2 真实镜像构建（容器内 node 24.15.0 由基镜像提供；补丁链六门 + fingerprint 确定性入口在构建内强制）
# -----------------------------------------------------------------------------
# S2.1 选基镜像（资源准入决策，非本清单发明）：提供 node 24.15.0 / pnpm 10.18.3 工具链，digest 认证后登记。
#      执行前先 export，形态如（不得使用 :latest 浮动 tag）：
#      export RUNNER_BASE_IMAGE='docker.io/library/node:24.15.0-bookworm-slim@sha256:<64hex>'
: "${RUNNER_BASE_IMAGE:?S2.1 需要 resource-admission digest 钉定的基镜像（先 export RUNNER_BASE_IMAGE 再重跑本段）}"
python3 - "$RUNNER_BASE_IMAGE" <<'PY'
import json,subprocess,sys
plan=json.load(open('$TMPDIR_NATIVE/i02-plan.json'))
cmd=plan['dockerBuild']['command']
base=sys.argv[1] if len(sys.argv)>1 else ''
assert base and '@sha256:' in base, 'RUNNER_BASE_IMAGE must be digest-pinned by admission'
cmd=cmd.replace('<resolved-at-admission:image.lock.json:components.runner-base>', base)
print(cmd)
open('$TMPDIR_NATIVE/i02-build-command.txt','w').write(cmd)
PY
# S2.2 执行构建（命令来自 build-plan 原样输出，仅替换基镜像占位；tag 必须在命令串内，sh -c 的 -t 会被当作 $0 丢弃——评审 nb-2 修正）
BUILDCMD="$(cat /tmp/claude/i02-build-command.txt) -t $RUNNER_TAG"
sh -c "$BUILDCMD" 2>&1 | tee "$EV.part-build"
# 判据 S2.2：构建 exit 0；日志中 build.mjs 输出的 fingerprint == $EXPECTED_FINGERPRINT
#            （若不一致，Dockerfile 的 test -f 确定性入口门已先失败、构建不可能成功——这正是 RW_RUNNER_BUILD 的门）。
# S2.3 构建内确定性入口回读
docker run --rm --entrypoint /bin/sh "$RUNNER_TAG" -c 'readlink -f /usr/local/bin/comet-runner && node /usr/local/bin/comet-runner --version'
# 判据 S2.3：readlink 输出 == /build/repo/.sdd/vendor/comet/c90af44a…fb0a/builds/d4370930…cba6/work/bin/comet.js；
#            --version 输出 == 0.4.5（upstream.lock package.version）。

# -----------------------------------------------------------------------------
# S3 digest 回填（真实构建证据落 lock；两组件都必须认证后才允许进入 S5）
# -----------------------------------------------------------------------------
docker image inspect "$RUNNER_TAG" --format '{{.Id}}'
python3 - "$RUNNER_TAG" <<'PY'
import json,subprocess,sys
tag=sys.argv[1]
image_id=subprocess.check_output(['docker','image','inspect',tag,'--format','{{.Id}}'],text=True).strip()
assert image_id.startswith('sha256:') and len(image_id)==71, image_id
lock=json.load(open('infra/delivery/runner/image.lock.json'))
runner=next(c for c in lock['components'] if c['component']=='comet-runner')
runner['reference']=tag; runner['digest']=image_id; runner['digestAuthenticated']=True
runner['selectionStatus']='SELECTED_LOCAL_BUILD'
runner['reason']='S2 真实容器化构建产物（terminal channel）；fingerprint d4370930… 构建内确定性入口回读一致'
json.dump(lock,open('infra/delivery/runner/image.lock.json','w'),ensure_ascii=False,indent=2);open('infra/delivery/runner/image.lock.json','a').write('\n')
print('backfilled comet-runner:',image_id)
PY
# （runner-base 的 digest 回填属同一模式：准入登记的基镜像 digest 写入 components[runner-base]，理由注明登记来源。）
node "$RUN" validate --registry infra/delivery/registry.json --dir "$RDIR" --json
# 判据 S3：validate exit 0；imageLock.components 两项 digest 均为 sha256:<64hex> 且 digestAuthenticated=true；
#          containerBuildStatus 依实改 VERIFIED 并在 reason 落证据路径；upGate.enabled 仍 false（S4 前）。
#          本段改动属 I02 Owns（image.lock.json），证据文本不写活配置。

# -----------------------------------------------------------------------------
# S4 准入 ACK 门（upGate 开启必须显式人工授权，清单绝不自动开门）
# -----------------------------------------------------------------------------
[ "${I02_ADMIT_ACK:-}" = "yes" ] || { echo 'S4 UNVERIFIED: 未获 I02_ADMIT_ACK=yes，停在 S3 之后（诚实未准入，不继续）'; exit 0; }
python3 - <<'PY'
import json
lock=json.load(open('infra/delivery/runner/image.lock.json'))
lock['upGate']['enabled']=True
lock['upGate']['reason']='资源准入显式 ACK（I02_ADMIT_ACK=yes）：S2/S3 真实构建与 digest 回填完成'
json.dump(lock,open('infra/delivery/runner/image.lock.json','w'),ensure_ascii=False,indent=2);open('infra/delivery/runner/image.lock.json','a').write('\n')
PY
node "$RUN" validate --registry infra/delivery/registry.json --dir "$RDIR" --json >/dev/null && node "$RUN" up --registry infra/delivery/registry.json --dir "$RDIR" --json
# 判据 S4：无 ACK 时清单到此为止（输出 UNVERIFIED 行）；有 ACK 时 validate 0；
#          up 或输出启动编排、或如实 UP_* 拒绝（拒绝理由落证据）——绝不 mock。

# -----------------------------------------------------------------------------
# S5 真实启动（compose 六角色；镜像经 lock 解析占位注入）
# -----------------------------------------------------------------------------
cd "$REPO" || exit 1
COMET_RUNNER_IMAGE="$RUNNER_TAG" docker compose -f infra/delivery/runner/compose.yaml -p comet-runner up -d
docker compose -f infra/delivery/runner/compose.yaml -p comet-runner ps
node "$RUN" probe --case role-denial --endpoint http://127.0.0.1:7300 --dir "$RDIR" --json | tee "$EV.part-probe"
# 判据 S5：六个服务（comet-controller/author/test-author/reviewer/publisher/isolator）全部 running；
#          端口仅 127.0.0.1 绑定；probe 的 observedSteps 记录 GET 7300/ 真实可达（httpStatus 落证据）。

# -----------------------------------------------------------------------------
# S6 容器内角色探针（负向写 + 运行时身份读回；三通道中 shell 通道必测，Edit/MCP 按部署通道如实补测）
# -----------------------------------------------------------------------------
for role in author test-author reviewer publisher isolator; do
  docker exec "comet-$role" sh -c 'id -u; touch /comet/state/probe 2>&1; echo errno=$?; ls -la /var/run/docker.sock 2>&1; touch /usr/share/probe 2>&1; echo errno=$?; touch /workspace/.probe && echo workspace-write=OK'
done
docker exec comet-controller sh -c 'touch /comet/state/controller-write-probe && echo controller-control-write=OK && rm /comet/state/controller-write-probe'
for service in comet-controller comet-author comet-reviewer; do
  docker inspect "$service" --format '{{.Name}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} caps={{.HostConfig.CapDrop}} no-new-privs={{.HostConfig.SecurityOpt}}'
done
# 判据 S6：五个 worker 容器 uid=10001；对 /comet/*（控制状态/回执/签发）、/usr（只读根）写入一律 errno 非 0
#          （EROFS/EACCES，原样记录）；docker.sock 不存在；各自 /workspace 写 OK；controller 对控制卷写 OK；
#          inspect 全部 readonly=true、caps=[ALL]、no-new-privs。Edit/MCP 通道无部署面时如实记 UNVERIFIED（不 claim）。

# -----------------------------------------------------------------------------
# S7 正向链（真实派发；凭据未 provisioning 时如实停在 S6）
# -----------------------------------------------------------------------------
# 前置（缺一即停，记 UNVERIFIED）：I01 四 runner ref 已真实 provisioning（secret 值经运行时授权机制解析）；
# authority-registration 的 authority/workspace 已由唯一 controller 登记为 authoritative + writerExclusivity=single。
# 步骤：controller 发起一次真实派发（真实方法资产 + inputDigest）→ worker 返回执行结果 →
#       controller 落回执（/comet/receipts）→ 独立读回该回执并核对 dispatch.generation/role/inputDigest 三绑定。
# 判据 S7：回执存在且含本次派发真实字段（不是模板值）；worker 侧不存在任何自签发/自批准路径（负向已在 S6 证）；
#          无法 provisioning 时本段记 UNVERIFIED——绝不以结构声明替代真实正向链。

# -----------------------------------------------------------------------------
# S8 恢复入口与 duplicate-authority（原 Comet 语义，不伪造新 operation）
# -----------------------------------------------------------------------------
docker compose -f infra/delivery/runner/compose.yaml -p comet-runner stop comet-controller
docker exec comet-author sh -c 'ls /comet/state/locks 2>&1; touch /comet/state/locks/probe 2>&1; echo errno=$?'
#   -> 杀掉 controller 后 worker 不能自行领取 phase/重试（控制状态不可写 + Comet 拒绝旧 owner/attempt，日志/回执留证）
docker compose -f infra/delivery/runner/compose.yaml -p comet-runner up -d comet-controller
node "$RUN" probe --case duplicate-authority --dir "$RDIR" --json
# 复制状态负例（两卷）：docker run --rm -v comet-control-state:/from -v comet-control-state-clone:/to alpine cp -a /from/. /to/
#   然后以同一 authority/workspace 指向 clone 卷启动第二实例 -> 启动必须拒绝（COPIED_STATE_FORBIDDEN 语义），
#   原实例恢复原 RunID/operation 读回一致；两个启动请求只允许一个有效 Comet 写者。
# 判据 S8：worker 无领取路径（errno + Comet 拒绝记录）；恢复只能经原入口（compose up comet-controller）；
#          clone 卷第二实例启动被拒；原实例 RunID/operation 恢复读回一致；基础设施全程未伪造任何新 operation。

# -----------------------------------------------------------------------------
# 证据归档（全部段落输出合并落盘；对照各判据逐条标注 PASS/UNVERIFIED）
# -----------------------------------------------------------------------------
# 判据 S9：worker-reports/I02-rework/evidence/terminal-channel-run.txt 存在，含 S0-S8 各段原样输出与逐段判定；
#          未执行段落必须标 UNVERIFIED 并写明缺的前置（不跳过、不 mock、不推定）。
