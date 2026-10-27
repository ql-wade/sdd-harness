# P5_1 + P5_3 worker record — 实际宿主能力 + 运维与交接（合并派发）

- 修订：`2026-10-26-comet-050-adoption-v1`；工作树：主检出（按指令禁止 commit）。
- 时间：2026-10-27；宿主：ZCode CLI agent 子代理会话（本会话即 P5_1 登记的真实宿主之一）。
- 派发边界：仅改 P5_1+P5_3 Owns 文件 + 本目录；P5_2/F10 明确另期不做；ledger/state 由唯一控制器管，未触碰。

## P5_1 — 实际宿主能力与团队使用

### 真实 RED（修订基点，非环境缺失）

`node --test test/delivery-cases/5_1.mjs` = 12/14 pass、2 fail（`red-5_1-mjs.txt`）：

1. **5.1.a-4**：父目标重验仪器仍钉旧 run 分母 92 场景/118 检查，当前 acceptance-index（2026-10-24 重生成、
   comet-convergence 修订）持有 **104 场景/130 required**，且 summary 形态已换（status 计数取代
   layer_statuses）。
2. **5.1.b-6**：机器启用裁决 decision_record 指向现行 architecture.md，但该文件经 replans 重写后不再含
   「环境能力裁决」标记（原文保全于 replans/before 副本；ledger token `env-capability-20261022` 在案）。

### 实现（最小 GREEN）

- `team-host-matrix/matrix.json`（schema 3，revision 字段登记）：
  - 新增第 6 平台宿主 **zcode-session**（本会话）：discovery=VERIFIED（which/--version 六命令 + 技能目录
    实测）、write-protection=SUPPORTED（四渠道 ALLOWED_MEASURED，如实记允许、绝不记已拦截）、
    browser-evidence=UNVERIFIED+holder、recovery=SUPPORTED（真实独立子代理派发在案；脚本化会话恢复
    journey 未执行=登记缺口）。
  - 机器维度：decision_record 改指 `replans/2026-10-26-command-first/before/.../architecture.md`（裁决
    原文可解析事实源，台账 token 不变）；新增 `agent-cli-claude-code`（2.1.304）与 `agent-cli-codex`
    （0.163.0）本机可用性实测（SUPPORTED：安装+版本读回=发现面；真实团队使用旅程 UNVERIFIED，G-T2-06
    holder）；docker/knowledge-stack-outline/web-evidence-channel 三格追加 2026-10-27 zcode 会话实测
    （daemon 可达/回环 HTTP 200）——与 2026-10-23 claude-code 会话实测**并存**，互不覆盖互不推断。
- `test/delivery-cases/5_1.mjs`：
  - 5.1.a-4 仪器重写到当前索引形态：分母 104/130、status_rule 词汇自裁、scenario↔check 交叉引用、
    summary 计数从条目重算（VERIFIED/NOT_VERIFIED、supporting_pass/failed/not_executed）、rw_completion
    与计数/open_p1 一致性、complete=true 阻断、case_module 在盘解析（本体或覆盖场景携带）。
  - 新增 5.1.a-4b：当前修订接纳事件（`*_ACCEPTED_COMET_050|COMMAND_FIRST`）必须绑定真实计划节点且
    文件序单调（≥15 在案）。
  - 新增 5 个仪器负例（手改 summary/删层/悬空指针/提前 complete/伪造接纳节点）。
  - HOST_SPECIFIC_EVIDENCE 增 zcode-session 根（worker-reports/P5_1-P5_3-comet-050/evidence/）。
- 并行集成重验事实：本修订的并行 worktree 集成与父目标重验已在 P2_4-R3/P3_2 实现（ledger：
  P2_4_REOPENED_R1_R6 → P2_4_R3_ACCEPTED_BLOCKERS_CLOSED、P3_2_ACCEPTED_FIRST_REAL_RV）；5.1.a-1..3
  对两前序 run 的 dispatch/integration 词汇继续机械验证（31 dispatch / 73 live worktree 对账通过）。
- `team-host-matrix/README.md`：宿主表 + 修订说明 + 渠道实测随会话沙箱而异的并存纪律。

### 验证

`node --test test/delivery-cases/5_1.mjs` ×2 全绿（16/16；钉版 node 24.15.0 复跑同绿）。

## P5_3 — 运维与交接

### 真实 RED（修订基点）

`node --test test/delivery-cases/5_3.mjs` = 13/16 pass、3 fail（`red-5_3-mjs.txt`）：

1. **J2 drill 3**：`.sdd` 钉版 0.5.0 build 在场（指纹 de39629a…），但 drill 仍驱动 0.4.5 退役面——
   `state init <change> full --managed-delivery` 在 0.5.0 拒绝（usage error），真实复跑 exit 2。
2. **J4 门清单 ×2**：acceptance-index 环境门控已换形态（readonly_observations + observation_rule），
   旧 `from_partial_nodes` 推导得 0 条 → 断言 ≥3 失败（正例与负例两测试）。

### 实现（最小 GREEN）

- `team-recovery/run-drills.mjs` drill 3 重写到 0.5.0 组合期经典锁面（诊断实证驱动，非猜测）：
  - 托管门面退役 → 驱动 `comet state init/set/get`；每变更锁移至 workspace runtime 根
    （`<HOME>/.comet/workspaces/<id>/runtime/classic-changes/<uuid>/.comet-state.lock`，经 dist
    resolveClassicRunDirectory 真实解析）；legacy change 目录锁位=迁移围栏。
  - 十步全真：init → state-init → 基线锁定写 → 解析 runtime 锁根 → (a) EEXIST → (b) CLI 双开 30s 超时
    拒绝（exit 70）→ (c) 真 SIGKILL 后恢复 lease + 读回 + 同值重放幂等 → (d1) **legacy 位置残留事务日志
    被迁移围栏保守拒绝**（字节不动；0.5.0 与 0.4.5 语义差异如实入 receipt）→ (d2) runtime 根真实 schema
    事务日志在下一次锁获取被恢复（消费 + YAML 原样）→ (e) 异机 owner 永不恢复。
  - 路径净化正则补全角冒号（实测堵住一处 verbatim 输出泄漏）。
- `team-recovery/receipt-3-lease-contention.json`：以真实 0.5.0 运行重生成（10 步 VERIFIED；零宿主路径；
  0.4.5 版回执保全于 git 历史与旧报告）。
- `operations-runbook.md`：
  - §6 drill 3 描述重写；新增 **§6b R10 保留运维入口**（recovery.mjs validate/retention/probe +
    `--form comet-050` 原生布局说明 + I08 深度手册指针）、**§6c 知识维护**（Kp→归档→Kt 闭环、P4_6 探针、
    I07 维护作业、4_7/4_8 旅程指针）。
  - 新增 **§7.3 升级/回退路径**：0.4.5→0.5.0 已走过（relock/补丁链重组 0005/表面迁移/runtime dispatch/
    openspec 1.11.0→1.15.0/.sdd 重指纹/回归收口）+ 后续 0.5.x 五步注意事项（顺序不可颠倒）。
  - §8 门清单改当前索引形态逐字串 + 当前 npm test 基线（1159/1159/0/0 exit 0，钉版 node）。
  - 新增 **§13b 交接**：execution-prompt.md 由 render 脚本管理（哈希取自 drift-lock）、终态核对=
    plan_guard 四哈希、已知 plan 哈希漂移事实与处置（控制器重封，值班不手改）。
  - 命令清单新增 R19/R20（recovery validate / R10 pending-cleanup-denial probe，direct 行实测 exit 0）。
- `test/delivery-cases/5_3.mjs`：J4 门清单推导改当前索引形态（readonly observations + rule，逐字隐藏
  即 RED 的强度不变）；文件头登记修订差异。

### execution-prompt.md 最终状态核对（不重写）

plan_guard 实跑：architecture/DAG/contract 三哈希一致；**plan 哈希漂移**——tasks.md 在 P2_4 REOPENED
标注（prose）落锁后被改而 drift-lock 未重封（台账在案）。处置：VERIFY 派发前由控制器重封 drift-lock
并重渲染 prompt；本 worker 未改 prompt/lock/tasks 任何一侧（`execution-prompt-final-state.txt`）。

## 验证总表（钉版 node 24.15.0，主检出）

```
node --test test/delivery-cases/5_1.mjs   -> 16/16 pass, exit 0（两次）
node --test test/delivery-cases/5_3.mjs   -> 16/16 pass, exit 0（两次；J2 live 复跑含 drill1/2/3 全 VERIFIED）
npm test                                  -> 1159/1159 pass / 0 fail / 0 skip, exit 0
bash scripts/check.sh                     -> exit 0（回归 + 技能自测 + YAML/JSON 静态校验全绿）
```

证据：本目录 `evidence/`（red/green/npm-test/check-sh/execution-prompt/host-probes/zcode-session-capability）。

## P4_3 缺口清单对接

- 一档（G-T1-01..08）全部属他人 Owns（VERIFY-prep/I02/hooks 属主/P4_6/P3_3/ci-parity），无一落入
  P5_1/P5_3 Owns——本 worker 未越权补验；全量 npm test + check.sh 在本 worker 复跑全绿为共享回归信号。
- 二档 **G-T2-06（P5_1 真实团队宿主）即本派发处置对象**：本会话（ZCode）作为真实宿主全量登记 + claude/
  codex CLI 本地可用性实测；其余真实团队使用证据保持 UNVERIFIED（holder 不变）。
- 三档（G-T3-01..06）外部资源项原样移交，未动。

## UNVERIFIED（如实）

| 项 | holder |
| --- | --- |
| claude/codex CLI 在当前修订下的真实团队使用旅程（只有 which/version 发现面实测） | 真实团队宿主使用记录（G-T2-06） |
| ZCode 宿主脚本化会话中断-恢复 journey | 后续脚本化 journey（派发事实≠恢复认证） |
| F08 正相原生浏览器验收（全部宿主） | 具备原生浏览器能力的试点环境（与 acceptance-index F08 同源） |
| 多机 fencing/跨机归属迁移/正向隔离恢复 | 用户跨机器范围裁决 + P5_2（F10 另期） |
| 真实生产晋级/部署与环境读回 | environment owner + runtime admission |
| drift-lock 重封（plan 哈希漂移） | 唯一控制器（VERIFY 派发前） |

## 改动文件（全部在本派发 Owns 内）

- `openspec/changes/delivery-foundation-rearchitecture/team-host-matrix/matrix.json`
- `openspec/changes/delivery-foundation-rearchitecture/team-host-matrix/README.md`
- `openspec/changes/delivery-foundation-rearchitecture/operations-runbook.md`
- `openspec/changes/delivery-foundation-rearchitecture/team-recovery/run-drills.mjs`
- `openspec/changes/delivery-foundation-rearchitecture/team-recovery/receipt-3-lease-contention.json`
- `test/delivery-cases/5_1.mjs`、`test/delivery-cases/5_3.mjs`
- `openspec/changes/delivery-foundation-rearchitecture/worker-reports/P5_1-P5_3-comet-050/**`（本目录）
