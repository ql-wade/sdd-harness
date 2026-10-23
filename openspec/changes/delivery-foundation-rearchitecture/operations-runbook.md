# operations-runbook.md — 交付基础架构运维手册（P5_3，A10/A11/H09；返工 rework-seven-p1-r1）

> 所有者：P5_3（本手册）；机械校验由 `test/delivery-cases/5_3.mjs` 执行（J1 命令清单存在性+退出码、
> J2 演练回执结构与复跑、J3 协议回退门、J3b git/.sdd 层回退配方、J4 能力边界台账——v2 门读回+逐字
> 门清单+冒充突变拒绝）。删命令、藏门控、伪造回执时间戳、把 NOT_ENABLED 标进 PASS 位都会 RED。
>
> 范围区分：本手册覆盖本 run（rework-seven-p1-r1）的交付运维面；I08 的恢复/备份专属手册在
> `infra/delivery/recovery/operations-runbook.md`（权威迁移/恢复拒绝码细节以彼处为准），两者不互相替代。

## 1. 定位与读者

值班工程师按本手册执行：启动、验收、归档、恢复、回退。每条命令都在本仓库真实存在（入口文件可
grep），退出码约定与工具实现一致。本手册不假设跨机器能力：跨机范围未启用
（`CROSS_MACHINE_SCOPE_NOT_ENABLED`），所有"分布式"语义都按单权威 + 明确迁移处理；共享本地目录/
单机状态冒充分布式或团队级能力被 tasks.md P5_3 明确禁止，且由机械负向突变拒绝（见第 11 节冒充禁令）。

## 2. 入口与退出码约定

| 工具 | 入口 | 0 | 1 | 2 |
| --- | --- | --- | --- | --- |
| 跨机启用门（v2） | `node services/delivery-control/gate.mjs` | 合法状态读回 | 输入无效 | 拒绝（scope 未启用 / enable 需登记裁决） |
| 监督器 | `node tools/infra/monitor.mjs` | 验证通过 | 输入无效 | BLOCKED/UNVERIFIED |
| 备份恢复/权威迁移 | `node tools/infra/backup-restore.mjs` | 验证通过 | 输入无效 | 拒绝（活写者/缺批准/证据不足） |
| 发布协议 | `node tools/ci/release.mjs` | VERIFIED | 输入无效 | BLOCKED/UNVERIFIED（回退四门） |
| 平台身份评估 | `node tools/infra/platform.mjs` | VERIFIED | 输入无效 | BLOCKED/UNVERIFIED |
| 交付门 | `node tools/ci/verify-delivery.mjs` | VERIFIED | 输入无效 | BLOCKED/UNVERIFIED |
| 演练执行器 | `node openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs` | 演练 VERIFIED | 输入无效 | 演练未通过 |
| 判定器/索引重生成 | `node test/delivery-cases/4_3.mjs --generate` | 重生成索引 | — | —（重生成后 diff 仅 generated_at 为幂等） |

## 3. 启动（start）

1. 范围状态读回（只读，永远安全）：`node services/delivery-control/gate.mjs status --json` —
   v2 回执 `status: OK`、`enabled: false`、`refuse=[start,release,implement]`、
   `f10State: UNVERIFIED_NOT_ENABLED`、`construction: NOT_BUILT`、`positiveAuthStatus: UNVERIFIED`，
   退出码 0。未启用不是通过。
2. 团队 start/release/implement 在跨机范围启用前被拒（退出码 2，`CROSS_MACHINE_SCOPE_NOT_ENABLED`）。
   运行时 `enable` 记录只做摘要留痕、永不信任（退出码 2，`ENABLEMENT_REQUIRES_REGISTERED_DECISION`，
   `recordTrusted: false`）——启用只能走第 9 节的裁决登记 + 配对提交。
3. 本地交付启动：候选先过交付门再进发布协议——`node tools/ci/verify-delivery.mjs --chain <chain.json> --policy-dir infra/delivery/platform --json`
   （`SDD_DELIVERY_LAUNCH_AUTHORITY` 携带受信 launcher secret），随后 R08 promote。

## 4. 验收（verify）

- 单用例旅程：`node --test test/delivery-cases/<case>.mjs`（每个文件独立可跑；`.sdd` 依赖项见第 8 节环境门控）。
- 回归总入口：`npm test`（`test/*.test.js`；已知环境失败项见第 8 节，除此之外必须零新增）。
- 提交前总检查：`bash scripts/check.sh`（含 whitebox/multi-agent 技能自测与 YAML/JSON 静态校验）。
- 受管驱动能力抽样（本手册对应的旅程）：`node --test test/delivery-cases/5_3.mjs` ×2 全绿。

## 5. 归档（archive）

归档是单 closeout owner 的排他动作，Kp（知识收尾义务）先于归档封印（`KNOWLEDGE_CLOSEOUT_REQUIRED`）；
重复 closeout 执行被驱动门拒绝（`ARCHIVE_ALREADY_SEALED`——上游 CLI 收敛幂等，排他在驱动门）。
可执行规格见 `test/delivery-cases/1_3.mjs`（sealCloseout / ARCHIVE_*）与 `test/delivery-cases/4_6.mjs`
（归档后 pending Run 的发现/选择/恢复 H01–H09）。Comet CLI 经本地构建提供：

```console
node tools/comet/prepare-source.mjs --archive <integrity-locked-tarball>
node tools/comet/build.mjs --archive <integrity-locked-tarball>
```

构建产物按 lock 指纹落在 `.sdd/vendor/comet/<commit>/builds/<fingerprint>/work/bin/comet.js`
（gitignored 本地缓存；换机器须重建，或按 I08 先例做可审计复制——manifest 校验在任何字节漂移时失败）。

## 6. 恢复（recovery）

三个真实演练（真进程、真 SIGKILL、零 mock），回执存 `team-recovery/receipt-*.json`（可随时用下述命令复跑）：

```console
node openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs --drill 1 --out <receipt.json>
node openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs --drill 2 --out <receipt.json>
node openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs --drill 3 --out <receipt.json>
```

- **drill 1（SIGKILL 后原实例幂等续作）**：真实子进程 + 心跳，真实 SIGKILL，旧写者终止确认后监督器
  按原 authority 重启原实例（restart-original：同固定 authority、单存活实例、预算 window 300s / max 3）。
  复用 I07 `MonitorInfra.v1`。
- **drill 2（fencing 旧 writer 拒绝）**：存活 pid 持 lease 时恢复被拒（`RESTORE_REFUSED_OLD_WRITER_LIVE`），
  真实 SIGKILL + 终止确认后恢复启用；权威迁移缺批准（`REFUSAL_CONTROLLED_APPROVAL_REQUIRED`）、伪装围栏
  （`AUTHORITY_FENCE_NOT_PROCESS_LEVEL`）被拒；真实围栏下 epoch 严格单调 +1。复用 I08 手法。
- **drill 3（lock 竞争双开拒绝）**：真实 Comet Classic 状态锁 `.comet-state.lock`——第二写者 `wx` 独占打开
  被拒（EEXIST）；受管 CLI 在 lease 被持有期间双开被拒（30s 锁超时、非零退出）；持锁进程被真实 SIGKILL 后
  下一条真实 CLI 命令恢复 lease 并幂等续作同一 operation（同 execution id、attempt 不变）；被中断的事务日志
  `.comet-state-transaction.json`（comet.classic.state-transaction.v1，YAML rename = commit point）在下一次
  锁获取时被恢复；异机锁 owner 永不被本地恢复（跨机边界保持关闭）。

恢复要点：恢复永远从权威状态 + 外部读回续接，不重复副作用（A11 的单机半）；另一机器复制的状态不能独立开
第二写者——回原权威环境或走经确认的权威迁移（`backup-restore.mjs transfer`），不以普通会话标签绕过（H09
的单机半；跨机器半 NOT_ENABLED，见第 11 节）。

归属落点（机器可校验）：

- `team-recovery/capability-boundary.json`（TeamRecovery.CapabilityBoundary.v1）——单机 VERIFIED 能力的
  证据指针、跨机 NOT_ENABLED 台账、缺席登记（daemon/分布式租约面）、冒充禁令、复审触发器（T1–T5）。
- `team-recovery/rollback-recipe.json`（TeamRecovery.RollbackRecipe.v1）——git/.sdd 层候选回退配方
  （5.3.b），强制已知集 fail-closed 期望。

## 7. 回退（rollback）

### 7.1 协议层（ReleaseProtocol.v1，P4_2 门，复用）

发布协议的回退四门全部真实可验：

| 门 | 触发条件 | 退出码 |
| --- | --- | --- |
| `ROLLBACK_NOT_APPROVED` | 缺 RollbackApproval.v1 批准文件（policy fail-closed） | 2 |
| `ROLLBACK_RETENTION_MISSING` | 无保留的前一批准产物 | 2 |
| `ROLLBACK_DIGEST_MISMATCH` | 回退目标不是保留的前一批准 digest | 2 |
| `ROLLBACK_TERMINAL_STATE_UNCONFIRMED` | 独立业务终态读回不能确认 | 2（UNVERIFIED） |

正例：批准的同 digest 回退 → 退出码 0，receipt `VERIFIED`，业务终态读回回退后 digest，I06 评估器独立确认链
（`registry-environment-identity`）。全部 LOCAL_ONLY：真实生产晋级/部署保持 UNVERIFIED
（environment owner + runtime admission，`ISOLATED_RELEASE_ENVIRONMENT_REQUIRED`）。

### 7.2 git/.sdd 层候选回退演练（5.3.b，本 run 真实执行）

配方：`team-recovery/rollback-recipe.json`（J3b 机械校验；删任一强制步骤即 RED）。演练概要：

1. 回退前时点：工作区净、`.sdd` 指纹钉定核验（upstream.lock 重算 fingerprint 与
   `.sdd/vendor/comet/<commit>/builds/<fingerprint>/distribution.json` 一致），`npm test` 全量记签名。
2. `git checkout --detach <前一验收提交>`（本 run 实例：f13af35 = accept P5_1）。
3. 回退点时点：`npm test` 全量再记签名——已知集失败保持原样（KNOWN_SET_FAIL_CLOSED：既不允许零失败
   幻想，也不允许新增失败），证明回退后质量门仍 fail-closed。
4. 判定器幂等：`node test/delivery-cases/4_3.mjs --generate` 重生成 acceptance-index.json，diff 仅
   `generated_at`；随后 `git checkout --` 还原，不把漂移留在工作区。
5. `git checkout rework/p5-3` 回到分支头，工作区净，签名与回退前一致。

本 run 的真实演练记录（两时点回归签名 + 幂等证据）：`worker-reports/P5_3-rework/evidence/05-rollback-drill.txt`。
回退不删除历史：旧产物与历史证据保持原位（回退只移动候选指针，不改写台账）。

## 8. 已知环境门控清单

与 `acceptance-index.json :: environment_gates.from_partial_nodes` 逐字一致（J4 机械比对，隐瞒即 RED）：

| 任务 | 门控步 | 登记原文（逐字） |
| --- | --- | --- |
| I03 | Step 3 | 原生浏览器/独立读回: 无真实 Outline 实例/凭据/文集/OIDC/对象存储 — holder: user/Outline 部署波次 |
| P1_6 | Step 5 | 宿主会话证明(真实 Runner/host) — holder: 真实 Runner 验证(manifest unverified[0]) |
| I05 | Step 3 | 真实容器/认证API/MCP读回: docker 沙箱拒+上游未选定 — holder: user/runtime admission |
| P5_2 | Step 1-4 | 跨机门门控: CROSS_MACHINE_SCOPE_NOT_ENABLED(冻结计划原文); 启用态建设(5.2.a API/5.2.b 正向隔离撤权恢复断联)未执行; F10 正向认证 UNVERIFIED + holder |

open decisions 登记（源 execution-state.json，清单见 acceptance-index.json
`environment_gates.open_decisions`）含 `HOST_OPENSPEC_DRIFT`（宿主全局 openspec 漂移，owner: user，
阻断 B08/C08 钉定复跑）等条目；运维注记：

- 主检出 adapter-quoting 2 例沙箱 EPERM（denyWithinAllow）— 集成回归须在 worktree 运行（65/65 已验证）。
- llmwiki 会话 worktree venv ENOENT 分支 — 会话工件指向缺失副本，非宿主缺陷（LLMWIKI_RUNTIME_VERIFIED 更正）。
- comet 依赖回归（1_3/1_4/1_5/1_6 setup）须在 .sdd 装备工作树运行。
- scripts/check.sh whitebox 夹具缺口在全新 worktree 为 base 起 pre-existing。

`npm test` 基线：475 tests / 472 pass / 2 fail（上表 C08、B08 两条已知环境项）/ 1 skipped，exit 1；
除已知项外零新增是回归门。

## 9. 跨机门未启用态与启用流程（DeliveryControl.EnablementGate.v2）

- 现状：`services/delivery-control/enablement.json`——`enabled: false`、`decision_record: null`、
  `refuse=[start,release,implement]`、`f10_state: UNVERIFIED_NOT_ENABLED`。门语义与
  `team-host-matrix/matrix.json :: machine_dimension` 通配符宿主同源（default-deny；
  `refuse_start`/`refuse_release` = NOT_ENABLED；a10-cross-machine-concurrency /
  a11-cross-machine-recovery / a12-cross-machine-parent-revalidation / team-release 全 NOT_ENABLED）。
- 门行为（exit 0 = 合法读回 / 1 = 输入无效 / 2 = 拒绝，全部 fail-closed）：
  - enabled 被手改 true 而 `decision_record` 仍 null → `ENABLEMENT_DECISION_RECORD_REQUIRED`（防手改绕过）；
  - `decision_record` 解析不到有效裁决 → `ENABLEMENT_DECISION_RECORD_UNRESOLVED`；
  - 门文件损坏、refuse 语义被删空、或把 F10 标进 PASS 位 → `GATE_FILE_FAIL_CLOSED`（连 status 读回也拒绝）；
  - 裁决完整可解析但服务本体未建设 → `ENABLED_CONSTRUCTION_PENDING`（此时 f10_state =
    `UNVERIFIED_ENABLED_CONSTRUCTION_PENDING`，仍非 PASS）。
- 启用条件（唯一路径）：用户（跨机器范围裁决 holder）显式裁决，先登记进
  `openspec/changes/delivery-foundation-rearchitecture/execution-state.json` 的 `open_decisions`
  （`decision: "ENABLE_CROSS_MACHINE_SCOPE"`、`decided_by: "user"`、`status` 非 OPEN），再以**配对提交**
  更新 `enablement.json`：`enabled=true` + `decision_record={source, decision_id}` +
  `f10_state=UNVERIFIED_ENABLED_CONSTRUCTION_PENDING` 三者同一提交。任何运行时记录、环境变量、
  带外文件编辑都不能翻转该门（configVersion 教训：配对变更，无 boolean flag TOCTOU）。
- 启用后仍须先重建服务本体（届时按 5.2.a/5.2.b RED-first 实施：复用既有 PostgreSQL / 证据存储 /
  身份服务；API 只管证据/审批/回执，不接管步骤调度）；正向隔离/撤权/恢复认证在真实运行前保持
  UNVERIFIED——F10 的验收状态由 VERIFY 按真实执行记录，不由本门自证。
- 未启用不等于 F10 通过：`acceptance-index.json` F10 条目保持 UNVERIFIED
  （holder 见 `enablement.json :: positive_auth_holder`）。
- legacy 说明：旧跑的 ScopeGate.v1（摘要锚点模型——允许任何能改代码的提交者开闸而不需要用户裁决记录）
  已被本 v2 取代（P5_2 rework GREEN 0eb9959）；capability 边界台账见
  `team-recovery/capability-boundary.json`。

## 10. 本 run 返工运维面（compose 项目 / Outline 栈 / 判定器）

- **compose 项目（I02 S5）**：六角色 comet-runner compose。会话沙箱内 docker socket EPERM 是如实登记的
  缺口；真实 daemon 操作（镜像构建/启动/容器内探针）走用户可见终端面板通道，命令与判据归档于
  `worker-reports/I02-rework/terminal-channel-commands.sh`（每段带判据），启动证据
  `worker-reports/I02-rework/evidence/s5-compose-up.txt`（six comet-runner containers started）。会话内
  不冒充沙箱内 docker 可达。
- **Outline 栈**：3000/5556 端口内核级 `lsof -nP -iTCP -sTCP:LISTEN` 复核为 com.docker 双 LISTEN
  （`worker-reports/P5_1-rework/evidence/correction-outline-stack-listening.txt`）。有效探针通道是同源
  Playwright 浏览器（P4_4 step11 / P4_8 先例：真实写入 + 三通道独立读回）；会话沙箱 Bash curl 的
  ECONNREFUSED（exit 7/000）是沙箱过滤回环 HTTP 的伪影通道，不作服务状态证据。
- **判定器/索引重生成**：`node test/delivery-cases/4_3.mjs --generate`（幂等：重生成 diff 仅
  `generated_at`）。`RW_COMPLETION_REQUIRED`：任何 required check FAIL/GATED/UNVERIFIED、缺失 journey/
  真实读回、open P1 都保持整个 change NOT complete——重生成后如出现非 generated_at 漂移，先
  `git checkout --` 还原并按 RED 流程上报，不要手改索引。

## 11. 已知边界与复审触发器汇总

机器可校验的事实源：`team-recovery/capability-boundary.json`（TeamRecovery.CapabilityBoundary.v1，
J4 机械校验）。运维摘要：

- **S5 无服务模式**：本构建 comet CLI 无 daemon/服务模式（全命令清单证据
  `worker-reports/I02-rework/evidence/s5-runner-help.txt`，I02 S5 架构发现）；无分布式租约面
  （`integrations/comet/upstream.lock.json` 的 lock/patch 面）。因此 A10/A11 的跨机器半与 H09 团队发布
  一律 NOT_ENABLED——不建设、不假装、不冒充。
- **S7/S8 待凭据**：I02 正向链（S7）/恢复入口（S8）env-gated 保持 UNVERIFIED，holder = 终端通道
  （凭据 / authoritative state 卷到位后按真实执行记录重审）。
- **F10 NOT_ENABLED**：`UNVERIFIED_NOT_ENABLED`；未启用不算通过（第 9 节）。
- **会话沙箱缺口**：docker socket EPERM / sysctl EPERM / loopback HTTP 过滤（伪影通道）——逐渠道如实
  登记，不冒充硬边界。
- **冒充禁令**：共享本地目录/单机状态不得被标记为分布式或团队级能力。负向突变（NOT_ENABLED 标 PASS 位 /
  本地目录标分布式 / 删复审触发器或恢复步骤）由 5_3.mjs J4/J3b 机械拒绝（M1–M4）。

复审触发器（何时重审本边界；全文见 capability-boundary.json `recheck_triggers`）：

| 触发器 | 条件 | 动作 |
| --- | --- | --- |
| T1 启用裁决落地 | enablement.json enabled=true（或 matrix 通配符宿主 enabled=true），open_decisions 出现 ENABLE_CROSS_MACHINE_SCOPE 的 user 裁决 | 重审 A10/A11 跨机半 + H09 团队发布（转建设任务，RED 先行）+ F10 正向排期 |
| T2 上游服务模式 | upstream.lock source/patches 变更且引入 daemon/serve 类命令或分布式租约/协调面 | 重审缺席登记与 verified/not_enabled 划分（按新上游真实接口重核，禁止按旧清单推断） |
| T3 第二宿主启用 | matrix.json 出现第二台 enabled=true 具体宿主 | 重审跨机并发/恢复面与 no_cross_machine_inference 约束 |
| T4 S7/S8 凭据到位 | 终端通道凭据 / authoritative state 卷就绪 | 重审 S7/S8 UNVERIFIED 项（真实执行记录替代 env-gated 登记） |
| T5 F10 正向认证执行 | 项目隔离/凭据撤权/备份恢复重认证/API 断联任一真实执行 | VERIFY 按真实执行记录重登记 F10（本门不自证） |

## 12. 值班判定树

| 症状 | 第一归属 | 动作 |
| --- | --- | --- |
| `HOST_OPENSPEC_DRIFT`（B08/C08 失败） | user | 等用户裁决宿主 openspec 钉定版本；不要"修"测试 |
| adapter 测试沙箱 EPERM（denyWithinAllow） | 集成回归 | 在 worktree 内重跑（主检出会话沙箱限制，非代码缺陷） |
| comet 用例 setup 失败 / `.sdd` 缺失 | 环境装配 | `tools/comet/prepare-source.mjs && build.mjs` 重建，或按 I08 先例可审计复制同指纹缓存 |
| llmwiki MCP ENOENT | 会话工件 | 会话工件指向缺失副本；非宿主缺陷（LLMWIKI_RUNTIME_VERIFIED 已更正） |
| 恢复/备份/权威迁移拒绝码 | I08 owner 面 | 按拒绝码补真实围栏/批准证据；永远不要绕过围栏 |
| 回退被拒（任一回退门） | release-owner | 按第 7.1 节表格补批准或确认 retention/readback；不是 bug |
| 门 enable 被拒 `ENABLEMENT_REQUIRES_REGISTERED_DECISION` | 用户跨机器范围裁决 | 走第 9 节启用路径（open_decisions 登记 + 配对提交）；运行时记录永不生效，不是 bug |
| 需要"多机同时写"/分布式/团队级能力 | 用户跨机器范围裁决 | 先查 `team-recovery/capability-boundary.json` 与第 11 节触发器；未启用一律 NOT_ENABLED，禁止本地目录冒充 |
| 监督器重启预算耗尽 | I07 面 | STOP_AND_ESCALATE（window 300s / max 3）；不要手工再拉实例 |
| 归档/closeout 拒绝 | 单 closeout owner | 检查 Kp 义务与 seal 入口条件；重复 closeout 是排他拒绝 |
| 判定器重生成出现非 generated_at 漂移 | VERIFY 面 | `git checkout --` 还原索引，按 RED 流程上报；不要手改 acceptance-index.json |
| 演练回执/手册命令失效 | P5_3 owner | `node --test test/delivery-cases/5_3.mjs` 定位（J1/J2/J3b/J4 会指出缺口） |

## 13. 能力核实结论（判定面，含如实边界）

- **租约 lease：本地单机 VERIFIED。** 真实 `.comet-state.lock`：`wx` 独占创建 + owner 身份
  （pid/nonce/hostname/processIdentity）；存活 holder 期间第二写者等待后超时拒绝；仅 owner 确认死亡才回收；
  异机 owner 永不回收。事务文件 `.comet-state-transaction.json`（comet.classic.state-transaction.v1）在
  下一次锁获取时恢复，YAML rename 是 commit point，不覆盖无关手工编辑。证据：`receipt-3-lease-contention.json`
  （EEXIST / 30s 超时 / SIGKILL 恢复 / 日志恢复 / 异机拒绝五步全真）+ I08 step6 真实 comet run；源位置：
  钉定构建 `domains/comet-classic/classic-store.ts` + `platform/fs/plugin-store.ts`（upstream.lock 指纹）。
- **fencing：本地单机 VERIFIED；跨机 NOT_ENABLED（门控）。** epoch 严格单调（transfer 每次 +1）、旧 writer
  活 pid 拒绝、SIGKILL+终止确认启用、伪装围栏拒绝（drill 2，I08 手法复用）。Comet 层权威绑定
  （`COMET_RUN_AUTHORITY` + `state authority-transfer`）引用 4_6 H09 真实证据 + 抽样复跑 EXIT=0
  （`worker-reports/P5_3/evidence/sample-rerun-4_6-mjs.txt`）。**多机 fencing 属跨机门后**
  （`CROSS_MACHINE_SCOPE_NOT_ENABLED`，`services/delivery-control/enablement.json`）——不假装。
- **后台运行 background run：进程级 VERIFIED；宿主级容量 UNVERIFIED；服务模式缺席（S5）。** supervisor
  restart-original 绑定同一固定 authority（drill 1，I07 MonitorInfra.v1 真实进程注入）；重启预算
  window 300s / max 3、超限 STOP_AND_ESCALATE；P4_8 faultPolicy=alert-and-record 同一套时限
  （G15A_DEADLINES）。本构建 comet CLI 无 daemon/服务模式（s5-runner-help 全命令清单），故不存在
  "受管驱动后台服务"面；真实外部宿主故障的检测容量/时限证据保持 UNVERIFIED
  （probe capabilityScope: PROCESS_LEVEL）。
- **版本回退 version rollback：LOCAL_ONLY VERIFIED。** 回退四门 + 批准同 digest 正例 + I06 独立确认
  （J3 旅程）；git/.sdd 层候选回退演练按第 7.2 节配方真实执行（J3b 配方 + 两时点签名证据）。
  真实生产晋级/部署 UNVERIFIED（environment owner + runtime admission）。

## 14. 机械命令清单（machine-verified）

以下清单被 `test/delivery-cases/5_3.mjs :: J1` 机械校验：`direct` 行逐条真实执行并断言退出码；`journey` 行由
J2/J3/J4 旅程内复跑覆盖（journey 名与测试名对应）。`<...>` 为运行时 fixture 占位（由旅程或值班现场提供）。

```json runbook-commands
[
  {
    "id": "R01",
    "command": "node services/delivery-control/gate.mjs status --json",
    "expectedExit": 0,
    "verify": "direct",
    "note": "v2 status readback: OK / enabled=false / refuse=[start,release,implement] / f10State=UNVERIFIED_NOT_ENABLED / construction=NOT_BUILT while CROSS_MACHINE_SCOPE stays closed"
  },
  {
    "id": "R02",
    "command": "node services/delivery-control/gate.mjs start --request <request.json> --json",
    "expectedExit": 2,
    "verify": "journey",
    "journey": "J4",
    "note": "denied CROSS_MACHINE_SCOPE_NOT_ENABLED until the user adjudication lands per section 9 (open_decisions + paired commit on enablement.json)"
  },
  {
    "id": "R03",
    "command": "node services/delivery-control/gate.mjs enable --record <record.json> --json",
    "expectedExit": 2,
    "verify": "journey",
    "journey": "J4",
    "note": "ENABLEMENT_REQUIRES_REGISTERED_DECISION with recordTrusted=false — a runtime record is digested as evidence, never trusted"
  },
  {
    "id": "R04",
    "command": "node tools/infra/monitor.mjs probe --case runner-process-failure --json",
    "expectedExit": 0,
    "verify": "direct",
    "note": "real child, real SIGKILL, restart-original bound to the same fixed authority"
  },
  {
    "id": "R05",
    "command": "node tools/infra/backup-restore.mjs probe --case old-writer-denial --json",
    "expectedExit": 0,
    "verify": "direct",
    "note": "live pid refuses restore; real SIGKILL plus gone-confirmation enables it"
  },
  {
    "id": "R06",
    "command": "node tools/infra/backup-restore.mjs probe --case authority-transfer --json",
    "expectedExit": 0,
    "verify": "direct",
    "note": "missing approval / masquerade fences refused; real fence transfers with epoch+1"
  },
  {
    "id": "R07",
    "command": "node tools/infra/backup-restore.mjs validate --registry infra/delivery/registry.json --dir infra/delivery/backup --json",
    "expectedExit": 0,
    "verify": "direct",
    "note": "catalog gaps are reported honestly as catalogGaps, never as failures"
  },
  {
    "id": "R08",
    "command": "node tools/ci/release.mjs promote --chain <chain.json> --source <src-dir> --tag stable --registry <registry-dir> --environment <env-dir> --json",
    "expectedExit": 0,
    "verify": "journey",
    "journey": "J3",
    "note": "builds the gate-verified candidate into the isolated registry and deploys with a correlation id"
  },
  {
    "id": "R09",
    "command": "node tools/ci/release.mjs rollback --chain <chain-emitted.json> --registry <registry-dir> --environment <env-dir> --digest <sha256-digest> --json",
    "expectedExit": 2,
    "verify": "journey",
    "journey": "J3",
    "note": "unapproved rollback: ROLLBACK_NOT_APPROVED, active binding untouched"
  },
  {
    "id": "R10",
    "command": "node tools/ci/release.mjs rollback --chain <chain-emitted.json> --registry <registry-dir> --environment <env-dir> --digest <wrong-digest> --approval <approval.json> --json",
    "expectedExit": 2,
    "verify": "journey",
    "journey": "J3",
    "note": "approved but not the retained previous approved artifact: ROLLBACK_DIGEST_MISMATCH"
  },
  {
    "id": "R11",
    "command": "node tools/ci/release.mjs rollback --chain <chain-emitted.json> --registry <registry-dir> --environment <env-dir> --digest <retained-digest> --approval <approval.json> --json",
    "expectedExit": 0,
    "verify": "journey",
    "journey": "J3",
    "note": "approved same-digest rollback VERIFIED with independent business readback"
  },
  {
    "id": "R12",
    "command": "node tools/infra/platform.mjs probe --case registry-environment-identity --chain <chain-out.json> --json",
    "expectedExit": 0,
    "verify": "journey",
    "journey": "J3",
    "note": "the accepted I06 evaluator independently confirms the emitted chain"
  },
  {
    "id": "R13",
    "command": "node openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs --drill 1 --out <receipt.json>",
    "expectedExit": 0,
    "verify": "journey",
    "journey": "J2",
    "note": "SIGKILL restart-original drill receipt (requires no Comet build)"
  },
  {
    "id": "R14",
    "command": "node openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs --drill 2 --out <receipt.json>",
    "expectedExit": 0,
    "verify": "journey",
    "journey": "J2",
    "note": "fencing old-writer + epoch-monotonic transfer drill receipt (requires no Comet build)"
  },
  {
    "id": "R15",
    "command": "node openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs --drill 3 --out <receipt.json>",
    "expectedExit": 0,
    "verify": "journey",
    "journey": "J2",
    "note": "Comet lease contention drill receipt (requires the .sdd patched build — known environment gate)"
  },
  {
    "id": "R16",
    "command": "node tools/infra/backup-restore.mjs transfer --state <run-state.json> --approval <approval.json> --fence-evidence <fence.json> --out <out.json> --json",
    "expectedExit": 0,
    "verify": "journey",
    "journey": "J2",
    "note": "controlled authority transfer: epoch increments, refusal codes on missing/masquerade fences"
  },
  {
    "id": "R17",
    "command": "node services/delivery-control/gate.mjs release --request <request.json> --json",
    "expectedExit": 2,
    "verify": "journey",
    "journey": "J4",
    "note": "team release denied CROSS_MACHINE_SCOPE_NOT_ENABLED (H09 team half stays NOT_ENABLED)"
  },
  {
    "id": "R18",
    "command": "node services/delivery-control/gate.mjs implement --request <request.json> --json",
    "expectedExit": 2,
    "verify": "journey",
    "journey": "J4",
    "note": "team implement denied CROSS_MACHINE_SCOPE_NOT_ENABLED (refuse trio is same-source with enablement.json)"
  }
]
```
