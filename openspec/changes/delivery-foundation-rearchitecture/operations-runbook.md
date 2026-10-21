# operations-runbook.md — 交付基础架构运维手册（P5_3，A10/A11/H09）

> 所有者：P5_3（本手册）；机械校验由 `test/delivery-cases/5_3.mjs` 执行（J1 命令清单存在性+退出码、
> J2 演练回执结构、J3 回退门、J4 边界声明）。删命令、藏门控、伪造回执时间戳都会变 RED。

## 1. 定位与读者

值班工程师按本手册执行：启动、验收、归档、恢复、回退。每条命令都在本仓库真实存在（入口文件可
grep），退出码约定与工具实现一致。本手册不假设跨机器能力：跨机范围未启用
（`CROSS_MACHINE_SCOPE_NOT_ENABLED`），所有"分布式"语义都按单权威 + 明确迁移处理，禁止共享挂载
本地目录假装分布式（tasks.md P5_3 原文禁令）。

## 2. 入口与退出码约定

| 工具 | 入口 | 0 | 1 | 2 |
| --- | --- | --- | --- | --- |
| 跨机范围门 | `node services/delivery-control/gate.mjs` | 锚定状态读回 | 输入无效 | 拒绝（scope 未启用 / enable 需配对提交） |
| 监督器 | `node tools/infra/monitor.mjs` | 验证通过 | 输入无效 | BLOCKED/UNVERIFIED |
| 备份恢复/权威迁移 | `node tools/infra/backup-restore.mjs` | 验证通过 | 输入无效 | 拒绝（活写者/缺批准/证据不足） |
| 发布协议 | `node tools/ci/release.mjs` | VERIFIED | 输入无效 | BLOCKED/UNVERIFIED（回退四门） |
| 平台身份评估 | `node tools/infra/platform.mjs` | VERIFIED | 输入无效 | BLOCKED/UNVERIFIED |
| 交付门 | `node tools/ci/verify-delivery.mjs` | VERIFIED | 输入无效 | BLOCKED/UNVERIFIED |
| 演练执行器 | `node openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs` | 演练 VERIFIED | 输入无效 | 演练未通过 |

## 3. 启动（start）

1. 范围状态读回（只读，永远安全）：`node services/delivery-control/gate.mjs status --json` —
   锚定态 `NOT_ENABLED`，退出码 0；`positiveAuthStatus` 保持 `UNVERIFIED`——未启用不是通过。
2. 团队 Control API 启动在跨机范围启用前被拒绝（退出码 2，`CROSS_MACHINE_SCOPE_NOT_ENABLED`）。
   运行时 `enable` 记录同样被拒（`ENABLEMENT_REQUIRES_PAIRED_COMMIT`）——启用只能走第 9 节的配对提交。
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

恢复要点：恢复永远从权威状态 + 外部读回续接，不重复副作用（A11）；另一机器复制的状态不能独立开第二写者
——回原权威环境或走经确认的权威迁移（`backup-restore.mjs transfer`），不以普通会话标签绕过（H09）。

## 7. 回退（rollback）

发布协议（P4_2，ReleaseProtocol.v1）的回退四门全部真实可验：

| 门 | 触发条件 | 退出码 |
| --- | --- | --- |
| `ROLLBACK_NOT_APPROVED` | 缺 RollbackApproval.v1 批准文件（policy fail-closed） | 2 |
| `ROLLBACK_RETENTION_MISSING` | 无保留的前一批准产物 | 2 |
| `ROLLBACK_DIGEST_MISMATCH` | 回退目标不是保留的前一批准 digest | 2 |
| `ROLLBACK_TERMINAL_STATE_UNCONFIRMED` | 独立业务终态读回不能确认 | 2（UNVERIFIED） |

正例：批准的同 digest 回退 → 退出码 0，receipt `VERIFIED`，业务终态读回回退后 digest，I06 评估器独立确认链
（`registry-environment-identity`）。全部 LOCAL_ONLY：真实生产晋级/部署保持 UNVERIFIED
（environment owner + runtime admission，`ISOLATED_RELEASE_ENVIRONMENT_REQUIRED`）。

## 8. 已知环境门控清单

与 `acceptance-index.json :: known_environment_gates` 逐字一致（J4 机械比对，隐瞒即 RED）：

- I01/I02/I03/I05 Step 3、P1_6 Step 5 — 环境门与承接者见 execution-state.json
- 宿主全局 openspec 1.3.1→1.14.3 漂移（HOST_OPENSPEC_DRIFT，owner: user）— 阻断 B08/C08 钉定复跑
- 主检出 adapter-quoting 2 例沙箱 EPERM（denyWithinAllow）— 集成回归须在 worktree 运行（65/65 已验证）
- llmwiki 会话 worktree venv ENOENT 分支 — 会话工件指向缺失副本，非宿主缺陷（LLMWIKI_RUNTIME_VERIFIED 更正）
- comet 依赖回归（1_3/1_4/1_5/1_6 setup）须在 .sdd 装备工作树运行（impl-p1-3 在位）
- scripts/check.sh whitebox 夹具缺口在全新 worktree 为 base 起 pre-existing

补充：主 checkout 的 `npm test` 基线为 425 tests / 422 pass / 2 fail（C08、B08 两条上述已知环境项）/ 1 skip；
除已知项外零新增是回归门。

## 9. 跨机门未启用态与启用流程

- 现状：`services/delivery-control/scope-gate.json` `status: NOT_ENABLED`，`gateCode: CROSS_MACHINE_SCOPE_NOT_ENABLED`；
  start/publish 拒绝（exit 2），enable 拒绝（exit 2，`ENABLEMENT_REQUIRES_PAIRED_COMMIT`），status 只读（exit 0）。
- 启用条件（唯一路径）：用户（跨机器范围裁决 holder）显式裁决，落为**配对提交**——同一提交内同时修改
  `scope-gate.json` 的 status 与 `gate.mjs` 内 `EXPECTED_SCOPE_DIGEST`（锚定摘要）。任何运行时记录、环境变量、
  带外文件编辑都不能翻转该门（configVersion 教训：配对变更，无 boolean flag TOCTOU）。
- 启用后按 tasks.md P5_2（5.2.a）复用既有 PostgreSQL / 证据存储 / 身份服务建设；API 只管证据/审批/回执，
  不接管步骤调度；正向隔离/撤权/恢复认证在真实运行前保持 UNVERIFIED。
- 未启用不等于 F10 通过：`acceptance-index.json` F10 条目保持 UNVERIFIED（holder: P5_2 owner + 用户跨机器范围裁决）。

## 10. 值班判定树

| 症状 | 第一归属 | 动作 |
| --- | --- | --- |
| `HOST_OPENSPEC_DRIFT`（B08/C08 失败） | user | 等用户裁决宿主 openspec 钉定版本；不要"修"测试 |
| adapter 测试沙箱 EPERM（denyWithinAllow） | 集成回归 | 在 worktree 内重跑（主检出会话沙箱限制，非代码缺陷） |
| comet 用例 setup 失败 / `.sdd` 缺失 | 环境装配 | `tools/comet/prepare-source.mjs && build.mjs` 重建，或按 I08 先例可审计复制同指纹缓存 |
| llmwiki MCP ENOENT | 会话工件 | 会话工件指向缺失副本；非宿主缺陷（LLMWIKI_RUNTIME_VERIFIED 已更正） |
| 恢复/备份/权威迁移拒绝码 | I08 owner 面 | 按拒绝码补真实围栏/批准证据；永远不要绕过围栏 |
| 回退被拒（任一回退门） | release-owner | 按第 7 节表格补批准或确认 retention/readback；不是 bug |
| 监督器重启预算耗尽 | I07 面 | STOP_AND_ESCALATE（window 300s / max 3）；不要手工再拉实例 |
| 需要"多机同时写" | 用户跨机器范围裁决 | 走第 9 节启用流程；在此之前按单权威 + 显式迁移处理 |
| 归档/closeout 拒绝 | 单 closeout owner | 检查 Kp 义务与 seal 入口条件；重复 closeout 是排他拒绝 |
| 演练回执/手册命令失效 | P5_3 owner | `node --test test/delivery-cases/5_3.mjs` 定位（J1/J2/J4 会指出缺口） |

## 11. 能力核实结论（判定面，含如实边界）

- **租约 lease：本地单机 VERIFIED。** 真实 `.comet-state.lock`：`wx` 独占创建 + owner 身份
  （pid/nonce/hostname/processIdentity）；存活 holder 期间第二写者等待后超时拒绝；仅 owner 确认死亡才回收；
  异机 owner 永不回收。事务文件 `.comet-state-transaction.json`（comet.classic.state-transaction.v1）在
  下一次锁获取时恢复，YAML rename 是 commit point，不覆盖无关手工编辑。证据：`receipt-3-lease-contention.json`
  （EEXIST / 30s 超时 / SIGKILL 恢复 / 日志恢复 / 异机拒绝五步全真）；源位置：钉定构建
  `domains/comet-classic/classic-store.ts` + `platform/fs/plugin-store.ts`（upstream.lock 指纹 beab355d…）。
- **fencing：本地单机 VERIFIED；跨机 UNVERIFIED（门控）。** epoch 严格单调（transfer 每次 +1）、旧 writer
  活 pid 拒绝、SIGKILL+终止确认启用、伪装围栏拒绝（drill 2，I08 手法复用）。Comet 层权威绑定
  （`COMET_RUN_AUTHORITY` + `state authority-transfer`）引用 4_6 H09 真实证据 + 抽样复跑 EXIT=0
  （`worker-reports/P5_3/evidence/sample-rerun-4_6-mjs.txt`）。**多机 fencing 属跨机门后**
  （`CROSS_MACHINE_SCOPE_NOT_ENABLED`，scope-gate.json）——不假装。
- **后台运行 background run：进程级 VERIFIED；宿主级容量 UNVERIFIED。** supervisor restart-original 绑定同一
  固定 authority（drill 1，I07 MonitorInfra.v1 真实进程注入）；重启预算 window 300s / max 3、超限
  STOP_AND_ESCALATE；P4_8 faultPolicy=alert-and-record 同一套时限（G15A_DEADLINES）。真实外部宿主故障的
  检测容量/时限证据保持 UNVERIFIED（probe capabilityScope: PROCESS_LEVEL）。
- **版本回退 version rollback：LOCAL_ONLY VERIFIED。** 回退四门 + 批准同 digest 正例 + I06 独立确认（J3 旅程）。
  真实生产晋级/部署 UNVERIFIED（environment owner + runtime admission）。

## 12. 机械命令清单（machine-verified）

以下清单被 `test/delivery-cases/5_3.mjs :: J1` 机械校验：`direct` 行逐条真实执行并断言退出码；`journey` 行由
J2/J3/J4 旅程内复跑覆盖（journey 名与测试名对应）。`<...>` 为运行时 fixture 占位（由旅程或值班现场提供）。

```json runbook-commands
[
  {
    "id": "R01",
    "command": "node services/delivery-control/gate.mjs status --json",
    "expectedExit": 0,
    "verify": "direct",
    "note": "anchored scope readback while CROSS_MACHINE_SCOPE stays NOT_ENABLED"
  },
  {
    "id": "R02",
    "command": "node services/delivery-control/gate.mjs start --request <request.json> --json",
    "expectedExit": 2,
    "verify": "journey",
    "journey": "J4",
    "note": "denied CROSS_MACHINE_SCOPE_NOT_ENABLED until the user enables the scope by paired commit"
  },
  {
    "id": "R03",
    "command": "node services/delivery-control/gate.mjs enable --record <record.json> --json",
    "expectedExit": 2,
    "verify": "journey",
    "journey": "J4",
    "note": "ENABLEMENT_REQUIRES_PAIRED_COMMIT — a runtime record never flips the gate"
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
  }
]
```
