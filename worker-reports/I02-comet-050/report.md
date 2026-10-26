# I02 worker report — 退休六角色常驻部署与按需临时作业边界

- Change: `delivery-foundation-rearchitecture`
- 修订: `2026-10-26-comet-050-adoption-v1`（amendment `task_disposition_delta.I02`: retire six-role deployment; dispose pending runner/iso worktree diffs）
- 依据: [ADR-0021](../../../docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md)、[infrastructure-plan.md「I02退休的安全顺序」](../infrastructure-plan.md)、tasks.md `### Task I02`
- 运行环境: macOS darwin 24.6.0 arm64；node 24.15.0（钉版）/ 22.13.1（默认 PATH，check.sh 实际所用）；python 3.14.7 + PyYAML 6.0.3；docker 29.6.2（仅只读盘点）
- 边界遵守: 只改 tasks.md I02 Owns 文件 + worker-reports/I02-comet-050/；未动 `integrations/comet/upstream.lock.json`、`integrations/comet/patches/0005*`、`lib/adapters/spec.js`、`test/spec-closeout.test.js`、`foundation/**`（P1_2 所有）。未 commit；除只读盘点外无 docker 操作。

## 1. 退休清单（做了什么）

| 面 | 处置 |
| --- | --- |
| 六服务 compose 默认链 | `infra/delivery/runner/compose.yaml` 保留为历史/按需声明文件，头部加 RETIRED 标注（ADR-0021 + 后继边界 createCliJobDriver + 数据保留声明）；无任何默认入口引用（普查见下） |
| runner.mjs 角色/镜像资格面 | `tools/infra/runner.mjs` 重写为退休边界 CLI（1797→1396 行）：`up`/`build-plan` 一律退休拒绝（`RUNNER_RESIDENT_DEPLOYMENT_RETIRED` / `RUNNER_IMAGE_BUILD_CHAIN_RETIRED`，退出 2，`dockerInvoked:false`，不导出任何 argv/上下文）；删除 build-context 导出、runtime bootstrap 闭包校验、openspec 工程校验、上游锁镜像/指纹对照、up 门准入与 docker daemon 探测等全部构建前置 |
| 默认入口普查（机械 oracle） | 新增 `residentRoleReferenceFindings()` 导出纯函数 + `defaultEntryCensus()`：扫描 package.json / tools/bootstrap.sh / bin/cli.js / hooks.yaml / scripts/*.sh / .github/workflows/* 对六角色栈的引用；validate 把普查结果并入违规（`DEFAULT_ENTRY_RESIDENT_ROLE_REFERENCE`）；实测 9 个入口零引用 |
| 按需临时作业边界 | `createCliJobDriver`（单次容器、network none、只读根、cap drop ALL、单一原始 start、固定物理作用域、HMAC dispatch 绑定）原样保留——这是旧候选中复用的主体，与镜像资格前置完全解耦（imageDigest/sdkFingerprint 由注册数据提供，不再读锁） |
| 必要通用检查保留 | PyYAML compose 语义校验、Dockerfile 卫生（宿主路径/秘密形状/ARG 基镜像/非 root）、role-policy/workspace-mounts/authority 结构校验、secret-ref 分层与 I01 解析语义、method-state 作用域、catalog gap 上报——全部沿用既有实现 |
| image.lock.json | 改写为退休记录（341884→16656 字节）：新增 `retirement` 块（status/decision/revision/retiredSurface/successorBoundary/dataDisposition/historicalProvenance）；保留三组件 digest（镜像识别）、七补丁识别清单、工具链、指纹（改从记录自身现算校验）、`historicalBuilds`/`historicalSourceInputs`、以及 **openspec pin 原样保留**（infra/delivery/registry.json 的 `openspec-isolated-tools.lockRef` 仍指向本文件）；删除 0.4.5 `runtime` 闭包（252KB，git 历史保全）；`containerBuildStatus: RETIRED`；upGate 永关 |
| Dockerfile | 字节冻结保留（`RUNNER_RECIPE_TEMPLATE` 哈希校验继续成立）；补丁链一致性改为对照退休记录（ARG/COPY/门数量=7），不再对照活锁 |

## 2. 删除文件清单（git rm，由控制器提交）

- `integrations/comet/patches/0001-matt-method-profile.patch`（处置: deleted，replaced by composition bundled skills）
- `integrations/comet/patches/0002-managed-delivery-runtime.patch`（处置: shrink → checkpoint extensions）
- `integrations/comet/patches/0003-post-archive-closeout.patch`（处置: succeeded by 0005）
- `integrations/comet/patches/0004-upstream-security-backports.patch`（处置: deleted，upstream 0.5.0 含后移内容）
- `integrations/comet/patches/tests/{1_6,2_4,4_6}.patch`（tests 目录随之清空移除）

残留引用核查：全树仅 (a) 我改写的 iso 测试、(b) P1_5 所有的 `test/delivery-cases/1_4.mjs`/`1_5.mjs`（对 lock.patches 的字符串断言，锁已空、先于文件访问失败，删除不改变其状态）、(c) `test/comet-security-backports.test.js`（动态 `lock.patches.find`，0004 缺失时 assert 先失败，不读盘）、(d) 历史 Dockerfile 的 COPY 行（冻结历史记录）。`infra-registry.test.js` 的 0004 引用是 registry.json 里的 patchDisposition 文本（I01 已动态化），与文件存在性无关——实测 infra-registry 套件全绿。

## 3. 三件旧候选 diff 处置

| 候选 | 处置 | 来源标注 |
| --- | --- | --- |
| `tools/infra/runner.mjs`（+`lib/adapters/spec.js` 进 safeBootstrapFile 白名单） | **丢弃该增量**。spec.js 白名单属 0.4.5 七补丁镜像 bootstrap 闭包（`RUNTIME_RECIPE`/`bootstrap.files`）——该闭包随镜像构建链一并退休，镜像内 bootstrap 文件集不复存在。spec.js 本体的 P3_4 候选不受影响（未触碰） | 旧 diff 已被重写覆盖；退休记录 `historicalProvenance` 指向 git 历史 |
| `test/infra-runner-isolation.test.js`（spec.js bootstrap 断言 + 更好的失败回显） | **复用回显改进、丢弃 bootstrap 断言**。`assert.equal(x, status, JSON.stringify({...}))` 式失败上下文保留在改写中的关键 RED 断言；`lib/adapters/spec.js` bootstrap 期望与 `BOOTSTRAP_DEPENDENCY_MISSING`/`BOOTSTRAP_FILE_SET_INVALID` 用例随 build-plan 退休删除 | 同上 |
| `infra/delivery/runner/image.lock.json`（+spec.js 进 sourceInputs 文件清单） | **丢弃该增量，文件整体改写为退休记录**（见 §1）。341KB 的 0.4.5 源输入闭包是旧候选的载体；新记录只保留识别与活性 pin | 同上 |

## 4. iso 测试改写（退休不是删测试）

`test/infra-runner-isolation.test.js` 全量重写（1884→1532 行，106→75 tests）。新 oracle 面：
- 退休契约: committed 域 validate 干净 + 回执带 `residentRoleServices:RETIRED`/retirement 块/census=0；qualify 诚实 exit 2（退休不是 PASS）。
- **census 双向**: 真实 9 入口零引用（正向）+ 合成入口五类引用逐一命中（RED）+ 相邻词负对照（`comet-authority`/`comet-executor.js` 不误报）。
- **退休拒绝先于资格化**: up/build-plan 在声明漂移 fixture 上仍返回退休码（镜像资格前置已不存在）。
- **缺 Docker 不阻**: 私有 PATH（仅 python3，docker 不可解析）下 validate=0、qualify=2（诚实拒绝非环境崩溃）、`bin/cli.js --help`=0。
- 退休记录完整性 RED 族: 浮动 tag/坏 digest/重开 up 门/缺 retirement 块/坏 status/缺数据保留声明/指纹不自洽/坏补丁识别/丢 openspec pin/坏 containerBuildStatus。
- 历史配方冻结 RED 族: 补丁 COPY/ARG 缺失、find 入口、尾随执行/heredoc/解析器指令/非执行文本化等 13 变体 + 注释里的宿主路径/秘密形状。
- compose/workspace/authority/secret-tier/method-state RED 族与 committed 契约: 沿用旧套件（仍被 validate 调用的通用检查）。
- probes/stop: UNVERIFIED 结构化 + `role-denial` 的证据面改为宿主原生 read/tool/path scopes（不再有角色容器措辞）+ stop 声明不删除任何资源。
- 旧补丁文件删除 + 0005 不被触碰的磁盘事实断言；registry 无六角色资源注册断言。
- **按需作业组件套件原样保留**（createCliJobDriver 10 个用例 + execution slot 全族，fixture Docker CLI 协议）。
- 无 skip、无 mock 转绿（`skipped 0`）。

## 5. 失败数前后对比（真实执行）

| 运行 | 命令 | tests | fail | 明细 |
| --- | --- | --- | --- | --- |
| RED 基线（改动前） | `node --test test/*.test.js`（node 24.15.0） | 1149 | **39** | iso 31（全属本任务）+ classic-integration 4 + comet-flow-acceptance 2 + comet-security-backports 1 |
| RED 基线（本套件） | `node --test test/infra-runner-isolation.test.js` | 106 | **32** | 根因: image.lock 七补丁镜像 vs 空 patches 活锁 → PATCH_LOCK_MISMATCH/UPSTREAM_SHAPE_INVALID 全线红 |
| GREEN（本套件） | 同上 | 75 | **0** | skipped 0；node 24.15.0 与 22.13.1 双版本均 75/75 |
| GREEN（全量） | `node --test test/*.test.js`（node 24.15.0） | 1118 | **10** | 见下方归因 |
| GREEN（总入口） | `bash scripts/check.sh`（默认 node 22） | 1118 | **9** | 规则层/技能层/whitebox/YAML-JSON 全过；iso 0 失败 |

余量 9–10 失败全部在他人 Owns 文件，逐一归因：
- classic-integration ×4、comet-flow-acceptance ×1~2、comet-security-backports ×1：基线即红（0.4.5 时代证据，P1_5-era/backports 波次所有）。
- foundation-distribution ×2、comet-method-binding ×1：**并行 P1_4 会话中途改写 `integrations/comet/upstream.lock.json`（patches []→[0005]，mtime 23:26 晚于我 15:19 的基线）**所致。归因证据 `evidence/foundation-drift-attribution.txt`：sealed 基线 531 个源镜像文件中唯一漂移者是 upstream.lock.json；我的 runner 文件不在 P1_2 的 foundation 资产闭包（CODE_ASSETS/组合包）内。该漂移须由 P1_4 接纳后 P1_2 重新封存 foundation 锁，非本任务可修（foundation/** 为 P1_2 所有）。

## 6. 旧容器/卷/镜像盘点（只读）

`evidence/docker-readonly-inventory.txt`（docker 29.6.2，只读命令）：
- 容器：无任何六角色容器（无 comet-controller/author/test-author/reviewer/publisher/isolator）。
- 卷：无 `ws-*` 或 `comet-control-state/comet-receipts/comet-issuance` 命名卷（匿名卷均为哈希名，属其他项目）。
- 镜像：存在一枚退休时代镜像 `comet-runner:locked-local`（id `4dfd24ed0677`）——按 ADR-0021 迁移条款保留不删（退休授权不含镜像/卷/知识删除）；其识别信息（源 commit/七补丁 sha/指纹）已保存在退休记录中。
- 属主区分：host 上 outline/postgres/redis/minio/dex 等容器属其他项目（outline 栈 = I03 面），不属于六角色部署残留。

## 7. UNVERIFIED / 需人工或后继波次确认

1. **真实宿主角色拒绝证据**（Host.RoleBoundary.v2）: probe `role-denial` 的 Edit/Shell/MCP 负写矩阵需真实独立会话执行，本任务只保留结构化 UNVERIFIED 探针（qualify 类别如实 UNVERIFIED）。
2. **duplicate-authority 实测**: 需真实 Comet 原生 state（comet-state.yaml + 原生锁/事务），未在本任务执行。
3. **旧资源存在性跨宿主**: 盘点仅覆盖本机；其他宿主的旧容器/卷归属未观测。
4. **按需作业真实 dispatch**: createCliJobDriver 仅有 fixture Docker CLI 组件协议证据；真实授权 dispatch 后的一次性容器运行未发生（有意为之—— retirement 不得虚构运行证据）。
5. **foundation 锁重封**: P1_4 接纳 0005 后 foundation-distribution 2 失败需 P1_2 波次重封 `foundation/foundation-lock.json`（本任务禁改）。
6. **openspec 隔离工具链落地副本**: `.sdd/tools/openspec-1.11.0` 与 `.sdd/cache/runner-build/openspec-1.11.0.tgz` 在本机在场且 pin 保持；registry 引用只声明不重验（I01/P1_1 面）。

## 8. 关键文件

- 改写: `tools/infra/runner.mjs`、`test/infra-runner-isolation.test.js`、`infra/delivery/runner/image.lock.json`、`infra/delivery/runner/compose.yaml`（头部）
- 不变保留: `infra/delivery/runner/Dockerfile`（字节冻结）、`role-policy.json`、`workspace-mounts.json`、`authority-registration.example.json`
- 删除: `integrations/comet/patches/000{1,2,3,4}-*.patch`、`integrations/comet/patches/tests/{1_6,2_4,4_6}.patch`
- 证据: `worker-reports/I02-comet-050/evidence/`（红/绿基线与全量日志、四张回执、docker 盘点、漂移归因）
