# I03 — 必要Outline栈与受管文集（2026-10-26-comet-050-adoption-v1）

- run：comet-convergence-20261024-r1（revision 2026-10-26-comet-050-adoption-v1）；任务节 tasks.md "### Task I03"
- 工作目录 /Users/mac/Code/sdd-harness（共享工作树，未 commit、未 push）
- 本轮语义：**核验 + 登记**（既有栈的事实登记），不是新建部署、不宣称资源资格
- 证据：本目录 `evidence/`（命令头 + exit 的日志与只读观察 JSON）；`diff.txt`（全部改动）

## 1. 完成范围（改动文件，均在 I03 Owns 清单内）

| 文件 | 改动 |
| --- | --- |
| `infra/delivery/outline/images.lock.json` | 新增顶层 `runtimeVerification`：运行容器本地镜像 repo digest 与 4 个 lock pin + runtime env.images 全部匹配（`runtimePinMatch: true`，RECORDED 级本地配置事实）；不改 components 的 `status: RECORDED`/`digestAuthenticated` 语义，不开 upGate |
| `infra/delivery/outline/storage-policy.json` | 新增顶层 `runtimeVerification`：三个具名卷（db/attachments/data）存在且挂载、redis 为匿名卷（cache 非权威不变）、已发布端口仅 `127.0.0.1:3000`（app）与 `127.0.0.1:5556`（dex）、postgres/redis/object-store 端口未发布、网络 internal + access(masquerade 关闭)；`restartPersistenceProbe: "UNVERIFIED"` |
| `infra/delivery/outline/collection-registration.example.json` | instance 下新增 `localApiReachability`：`status: "VERIFIED-LOCAL-API"`，只登记 loopback 可达性（`/_health` 200 OK、未认证 `documents.list` 401 authentication_required、`/api/config` 404）；instance 原 `HISTORICAL_IDENTITY_ONLY` 与全部 owner/audience UNVERIFIED/UNREGISTERED 原样保留 |
| `infra/delivery/outline/oidc-registration.example.json` | provider 下新增 `runtimeObservation`：dex issuer `http://127.0.0.1:5556/dex` 的 discovery 读回 200 且 issuer 匹配；provider `status: UNPROVISIONED`、`loginProof`/`realIssuanceProof` UNVERIFIED 原样保留 |
| `test/infra-outline.test.js` | 新增 1 个回归：登记事实与证据文件绑定 + 权限边界不升级（audience/owner 非 VERIFIED、upGate 关闭、restartPersistenceProbe/oidc 登录 UNVERIFIED、证据引用仓库相对且存在、scanForForbiddenValues 干净） |

未改动：`tools/infra/outline.mjs`、`compose.yaml`、`outline.env.example`（复用既有接口，无契约扩展）；未动 `mcp-capabilities.yaml`（P1_3 所有）；未动 `.sdd/outline/runtime`（只读盘点 + issuer 单行 grep，secrets.env 未读取、未读任何值）。

## 2. 核验事实（全部只读观察，2026-10-26T10:30–10:35Z）

1. **栈现状**：compose project `outline` running(5)（base `infra/delivery/outline/compose.yaml` + `.sdd/outline/runtime/compose.override.yaml`）；容器 outline/app、postgres、redis、object-store(minio)、dex 均 Up（app healthy 3 天，dex/redis 4 天）。**本任务未启动、未停止、未重启任何容器**——栈在本任务开始前已在运行，结束时保持原状（继续运行）。
2. **镜像 pin**：5 个运行容器的本地镜像 repo digest 与登记 pin 逐一匹配（4 个 lock 组件 + runtime-only 的 dex，dex pin 来自 `.sdd/outline/runtime/env.images`；env.images 与 lock 完全一致）。容器自身 RepoDigests 为空（镜像引用状态），匹配经容器 ImageSha → `docker image inspect` repoDigest 交叉核对（`evidence/pin-match.json`，allPinsMatch=true）。这是**本地配置事实，不是来源再认证**。
3. **持久化（配置事实）**：具名卷 `outline_outline-db`（postgres）、`outline_outline-attachments`（object-store）、`outline_outline-data`（app）存在并 rw 挂载；redis 挂匿名卷（cache 非权威）。**未读任何卷内数据**；restart/备份恢复未执行。
4. **端口（loopback）**：已发布端口仅 `127.0.0.1:3000->3000`（outline）与 `127.0.0.1:5556->5556`（dex）；postgres 5432 / redis 6379 / object-store 9000 未发布（仅容器网内）。网络：`outline_outline-internal` internal=true；`outline_outline-access` internal=false 但 `enable_ip_masquerade=false`（compose.override 声明的出网关闭，附件 host-port 发布所需）。
5. **API 可达（VERIFIED-LOCAL-API，非权限）**：
   - `GET http://127.0.0.1:3000/_health` → 200，body `OK`（sha256 565339bc…，与 2026-10-25 I03-convergence 观察一致，未重跑任何认证探针）。
   - `POST /api/documents.list`（未认证）→ 401 `authentication_required`；`POST /api/auth.info` → 401；`GET /api/config` → 404（该版本不提供此路由；可达性由 health + API 路由 JSON 错误响应证明）。
   - `GET http://127.0.0.1:5556/dex/.well-known/openid-configuration` → 200，issuer 与 dex 配置 issuer 行一致（config.yaml 仅 grep issuer 单行，未读其余内容）。
   - 全程未使用任何凭据；HANDOFF 声明已消耗的 owner key 三 API 一次只读核验**未重跑、未读值**。

## 3. RED/GREEN

- **RED**（`evidence/red-registration-probe.txt`，探针脚本存档为 `evidence/registration-probe.mjs`）：改动前登记缺口显式 exit=1——runtimeVerification/localApiReachability/存储卷登记/oidc runtimeObservation 均缺失。基线套件本身是绿的（validate ok=true；`node --test test/infra-outline.test.js` 43 pass/0 fail），RED 是登记缺口而非坏文件，不以缺环境当行为 RED。
- **GREEN**：同探针 exit=0；`validate --json` ok=true 0 violations；`node --test test/infra-outline.test.js` **44 pass / 0 fail / 0 skip**（含 1 个新回归）；相邻消费者 `test/infra-code-knowledge.test.js` 通过。

## 4. 真实执行的验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `node tools/infra/outline.mjs validate --json` | exit=0，ok=true，0 violations（登记前后一致） |
| `node tools/infra/outline.mjs qualify --json` | exit=2，ready=false，10 类 UNVERIFIED（image-digest-authenticated/secret-refs-registered 为 RECORDED）——登记不产生资格，fail-closed 如实 |
| `node tools/infra/outline.mjs probe --case oidc-principal-acl\|restart-persistence\|attachment-denial --endpoint http://127.0.0.1:3000 --json` | 三者均 exit=2、executed=false、UNVERIFIED（无认证会话/生命周期 grant，不 mock 不 skip） |
| `node --test test/infra-outline.test.js` | 44 pass / 0 fail（基线 43） |
| `node --test test/infra-code-knowledge.test.js` | pass / 0 fail（相邻消费者回归） |
| `bash scripts/check.sh` | **exit=1（如实记录）**：npm test 1126 pass / 39 fail，失败全部位于 I02 runner（V_INFRA_I02/RW_RUNNER_BUILD）、P1_1 comet-security-backports、mcp-capabilities↔hooks 声明、workflow-audit/drift 门——均非本任务车道（与 worker-reports/I01-comet-050 在同一共享树上记录的既有失败一致；outline 相关失败 grep 为 0）。不以局部绿关闭父义务，归控制器集成与 VERIFY |

## 5. UNVERIFIED 清单（缺环境/越权域，如实）

1. **受众/grant/发布权限（P4_7 域）**：两文集 audience `UNVERIFIED`、owner `UNREGISTERED`；`effectiveAudienceClosure` UNVERIFIED；VERIFIED-LOCAL-API 明确 scope 为"可达≠发布权限"。
2. **持久化与恢复**：restart-persistence（重启后 DB+附件读回）、备份/恢复演练、stale lastRevision 409、create UUID 契约——均未对活栈执行（需认证主体与生命周期授权，属受管探针/VERIFY）。
3. **OIDC 登录链**：issuer/client 注册、subject→principal 映射、真实签发与登录 proof、离组用户逐通道拒绝——provider 仍 UNPROVISIONED。
4. **凭据/资格**：7 个 secret-ref 仍 NOT_PROVISIONED；qualify 10 类 UNVERIFIED（对象存储访问、license-platform、role-isolation、backup-compatibility 等）。
5. **对象存储 S3 访问策略/签名 URL 期限/密钥轮换**：storage-policy 中相应字段仍为空/UNVERIFIED。
6. **docker compose 之外的恢复路径**（卷备份→独立资源→封闭恢复→OIDC 重验）：无任何演练证据。

## 6. 容器与资源处置

- 只读操作：`docker ps -a`、`docker compose ls`、`docker volume ls`、`docker inspect`（容器/镜像/网络）——零状态变更，未 exec 进入容器。
- 栈在本任务开始前已 running，**结束时保持运行原状**（未 up/down/restart，未创建/删除任何卷或容器；其他项目资源未触碰）。
- 本地 `.sdd/outline/runtime` 仅读取 compose.override.yaml、env.images、README 与 dex config 的 issuer 行；`secrets.env` 存在但未打开。

## 7. 边界遵守

未改 `mcp-capabilities.yaml`（P1_3 所有）；未 git commit/push；无对外网络写、无凭据访问（owner key 一次性核验未重跑）；Docker 只读本项目 outline 栈；改动仅限 I03 Owns 文件 + 本报告目录。共享树上其他 worker 的未提交改动未触碰。
