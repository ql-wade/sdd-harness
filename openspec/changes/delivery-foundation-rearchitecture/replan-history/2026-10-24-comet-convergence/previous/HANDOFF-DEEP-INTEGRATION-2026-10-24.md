# 交接文档：深度结合 Comet 的剩余实施（run rework-seven-p1-r1 完成后）

日期：2026-10-24 · 交接人：控制器会话（终态 0dcfec1 + a87b797）· 接收人：全新 agent（零上下文）

## 0. 你的使命

上一轮 run（rework-seven-p1-r1）已完成 39/39 节点验收并交付三产物（verification-report.md / grill-report.md /
verification-results.json，共识 PASSED）。但它完成的是**引擎执法逻辑层**。原架构要求的是**深度结合 Comet**——
六角色容器化执行、controller 派发真实工作包、回执经 runner 流转。这层还有四项未完成。你的使命就是把它们
按同样的质量门做完。

## 1. 开工前必读（顺序）

1. `/Users/mac/Code/sdd-harness/AGENTS.md` + `.claude/rules/sdd-harness.md`（纪律入口）
2. `openspec/changes/delivery-foundation-rearchitecture/operations-runbook.md`（运维面 v2，14 节）
3. `docs/delivery/managed-delivery-quickstart.md`（Comet CLI 动手走查，10 步实测）
4. `openspec/changes/delivery-foundation-rearchitecture/verification-report.md`（终态与 U1-U8 未验清单）
5. 本文件第 3-5 节

## 2. 当前状态快照（勿重复劳动）

- 终候选 master **0dcfec1**；39/39 节点 ACCEPTED；全量回归签名 **475/472/2/1**（已知失败集恰 {C08 negative,
  not ok 62} + {B08 preservation, not ok 463}，1 skip = 隔离版 openspec 1.11.0）
- 已真实验证并验收：状态机门禁（dispatch/accept/transition + P1-02 pass-evidence 契约）、知识义务阻断
  （Kp 缺失卡归档/Kt 缺失不到 completed）、恢复语义（同 Run 两次真实 SIGKILL：回滚+恰一次前滚）、
  单写者 fencing（RESTORE_REFUSED_OLD_WRITER_LIVE 真实进程）、验收器反向审计（终审抓到过登记不实）、
  六容器角色边界矩阵（uid/只读根/caps/控制卷独写）、Outline 真实发布/撤权/恢复三通道读回
- Comet 构建：`.sdd/vendor/comet/c90af44a…/builds/d4370930…/work/bin/comet.js`（指纹钉定；gitignored，
  只在配备 .sdd 的 worktree/主检出在位）。CLI 命令面见 quickstart 文档
- 共识记录：`review-runs/rework-verify-final-20261023-v2/`（zcode 因 ZCode.app 更新损坏 UNAVAILABLE，
  两方降级为用户授权，规则修订已入 review_gate.py）

## 3. 环境事实（硬约束）

- **Bash 沙箱**拒 docker.sock（EPERM）、滤回环 HTTP（curl 000=无效探针）。docker/外部 CLI 一律走
  **终端面板通道**（mcp__terminal__run_in_terminal，用户逐条批准；命令只能 printable ASCII，中文脚本先写文件再 bash 执行）
- Outline 栈在运行（内核证据：`lsof -nP -iTCP:3000/5556 -sTCP:LISTEN` 见 com.docker LISTEN）
- node 22.13.1（npm test）/ 24.15.0（comet build）；.sdd 预备态只在主检出与 rw-p4-4 worktree
- 证据纪律：只许 .txt 后缀（*.log 被忽略）；零宿主绝对路径；零 secret；活配置写入必须 finally 恢复
- ZCode.app 3.16.2 起内置 provider 配置解析损坏（多方共识降级路径见
  `.claude/skills/multi-agent-consensus-review/references/agent-adapters.md` 末节）

## 4. 剩余工作（按建议顺序；每项独立成变更新，走完门禁再下一个）

### W1 凭据 provisioning + Comet S7/S8 正向链与恢复入口（解锁 I02 真实半）
- **前置**：用户裁决四 runner ref 的密钥来源（`PUBLISHER_ISOLATOR_CREDS`，open_decisions 在案）。
  建议形态：.sdd 本地密钥库（gitignored），I01 catalog 只登记引用不存值（I01 契约不变）
- **实施**：执行 `worker-reports/I02-rework/terminal-channel-commands.sh` 的 **S7**（controller 真实派发
  → worker 容器回执 → 独立读回 generation/role/inputDigest 三绑定）与 **S8**（杀 controller 后 worker
  不能自行领取；clone 卷第二实例启动被拒 COPIED_STATE_FORBIDDEN；原 RunID/operation 恢复读回一致）
- **验收判据**：S7 三绑定读回一致+worker 无自签发路径；S8 拒绝与恢复回执齐全；回执落
  `worker-reports/I02-rework/evidence/`；I02 node_status 的 UNVERIFIED 项按实关闭或维持（不虚转 PASS）
- **归属**：I02 系（recovery/runner 面）

### W2 上游第 7 补丁：controller 服务模式（T2 触发器落地，一次解决 S5 判据+常驻控制面）
- **前置**：W1 完成（服务要有可派发的真实角色与凭据）；用户批准写第 7 补丁
- **实施要点**：上游补丁新增 `comet state serve --port 7300` 类服务模式（只读控制面 API +
  dispatch 入口），`integrations/comet/patches/0004-*.patch` 按既有六补丁同格式；upstream.lock 登记；
  指纹重算（d4370930 → 新值）→ 全量重验链（3_2/3_3/4_4/4_6/4_8 五个 case + npm 已知集）→
  镜像重建（terminal 通道 S2）→ S5 判据执行（六服务 running + GET 7300 真实可达）→ S7/S8 在常驻栈复跑
- **验收判据**：新指纹全链验绿；S5 判据逐项满足；drift-lock amendment 登记指纹与补丁变更；
  runner build-plan 消费新 lock 无漂移
- **红线路径**（若用户不批补丁）：修订 S5 判据为“CLI+文件回执面执法”并在 verification-report 登记——
  不得静默维持旧判据

### W3 F10 / 跨机器 delivery-control（用户裁决后执行）
- **路径 A（启用）**：按 `services/delivery-control/README.md` 四步——open_decisions 登记
  ENABLE_CROSS_MACHINE_SCOPE → 成对提交 enablement.json(enabled=true+decision_record) → 按 5.2.a
  RED-first 建设本体（复用 PostgreSQL/身份/存储；API 只管证据/审批/回执，不接管步骤调度）→ 验收
- **路径 B（关闭）**：amendment 以“范围内不适用”关闭 F10，启用门机制保留为控制（永不删检查）
- **验收判据**：A 路径=F10 正向认证真实执行且读回；B 路径=amendment 在 drift-lock 登记+门读回仍
  UNVERIFIED_NOT_ENABLED→若关闭则改判诚实状态
- **归属**：P5_2 系

### W4 小项清单（可与 W1-W3 并行的机械项）
1. V_F01/V_F03 断言映射缺口（P1-04 类 NOT-EXERCISED）——owner：case-module（P3_1 系）：给 1_1.mjs
   补 F01/F03 可映射测试点或修订契约断言映射
2. V_RW_RUNNER_BUILD 引用退役 probe case 名 current-build-role-isolation → 改为现行
   role-denial|duplicate-authority 之一（contract owner；I08_FILENAME_DEVIATION 先例）
3. V_A15 陈旧前提（3_1.mjs 点 23 断言 journeys 仍 TO_IMPLEMENT，实际已 IMPLEMENTED）——按现实修订
4. ZCode.app 更新后复测 zcode CLI（`agent-adapters.md` 末节步骤 3）；`/config/provider` 布局或已修复
5. run-checks.sh 宿主绝对路径 sanitize（终审 N-1）
6. OpenSpec 归档准备：tasks.md 残余 30 个未勾框属被取代的工作包节与文档节——归档时逐条 disposition
   （Comet closeout owner 职责，本文件仅登记）

## 5. 质量门（不可变，违者打回）

1. 真实 RED 先行（oracle/命令/输入/日志存 worker-reports/<任务>-rework/evidence/*.txt）
2. 最小 GREEN（只动归属路径）；3. 全量回归守已知集；4. 独立评审（冷启 clone 亲手重跑）；
5. 控制器串行接纳（唯一控制器翻勾/记账，验收步不重生索引——重生成归 VERIFY 类节点）
- execution-state.json / execution-ledger.jsonl / drift-lock.json / execution-contract.json /
  verification-case-plan.json 为控制平面：实施工人零触碰；W2 的指纹/补丁变更走 drift-lock amendment
- UNVERIFIED 不转 PASS；历史 PASS 不继承；holder/触发器必须如实登记

## 6. 协作模型（与其他 agent 实施时的分工）

- 每个工作项一个隔离 worktree（`git worktree add .claude/worktrees/rw-<task>`）+ 独立分支；
  派发用完整自包含 prompt（范围/归属路径/质量门/返回契约 JSON）
- W2 需要 .sdd 预备态：优先复用主检出或 rw-p4-4（勿重建）
- 独立评审冷启 clone（--no-hardlinks）亲手重跑；真实链允许在预核验过的 worktree 复跑（先验
  porcelain 干净 + HEAD 正确）
- 人类触点：W1/W3 的用户裁决、终端通道逐条批准、终局验收
