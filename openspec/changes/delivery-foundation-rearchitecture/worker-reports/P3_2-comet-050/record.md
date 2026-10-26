# P3_2 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: P3_2 首个真实 R→V 纵向切片（串行）。本报告记录真实宿主执行：本 LLM 会话即
组合应用的技能宿主（SDK 入口协议：领取 Action → 加载钉版 SKILL.md → 真实工作 →
recordOutcome），评审由真实子进程代理（claude-code / zcode / codex-agent CLI）执行。

## Scope honored（只改 Owns 文件 + 本报告目录）

- `openspec/changes/delivery-foundation-rearchitecture/pilot-journey/same-run-delivery.case.json`（重写为 comet-050 配方）
- `test/delivery-cases/3_2.mjs`（V_E06 三测重写；B0x/F08/A15 角色链用例原样保留）
- `openspec/changes/delivery-foundation-rearchitecture/pilot-journey/evidence/comet-050-run/`（新增：真实旅程证据 33+ 文件）
- 本报告目录。未 commit 本仓库；试点世界在 /private/tmp（macOS /tmp 物理路径，安装器拒绝穿越符号链接——已记录）。

## 1. 试点环境（全部真实）

- 项目副本：pilot copy = 仓内 verifier 工具 19 文件 import 闭包 + 钉版 node_modules
  （commonmark/mdurl/entities）；git 仓库；`.comet/config.yaml` 手工装配
  （workflows classic、artifact_layout legacy——B8 受管路径，不跑 init，Superpowers
  从未进入宿主）。
- 组合包：`comet application install integrations/comet/application/package/application.json`
  （preview-first：confirmationHash b29ec13d…，非 contentHash——首装曾错用 contentHash
  被拒「安装预览已变化」，如实记录）。安装到 `.comet/applications/sdd-managed-delivery/`。
- Comet：钉版 0.5.0 构建 de39629a…（aeb1a659+0005）；OpenSpec：钉版 1.11.0 经
  COMET_OPENSPEC（抑制 B6 浮动升级的已证缓解）。
- Run 面：`comet runtime dispatch --application-file`；内置 state/guard/handoff/archive
  命令对组合 Run 一律拒绝（「belongs to application sdd-managed-delivery」——真实拒
  绝面，见 kp-block 证据）。

## 2. 真实 R→P（同 Run add-journey-version-r3；三次运行迭代，前两次诚实取消）

| 门 | 真实执行 | 结果 |
| --- | --- | --- |
| R | grill-me（钉版技能，会话执行；6 问 grill 记录于 proposal）→ open.evidence（3 工件 hash 收据）→ R 扩展 outcome 经打包验证器 sdd.delivery.gate.r@1 判定 | PASS |
| A | 设计 handoff（上游 compact 上下文包逐字节复刻）→ design.evidence → **真实三代理共识**：r1 claude APPROVE 8.6 / zcode APPROVE 8.8 / codex REJECT 7.5（1 blocking：strict parseArgs 先失败→优先级无保证）→ DEBATE_REQUIRED → AC3+设计修订（argv 预扫描）→ revise-requirements 同 Run 回环 → r2 全票（8.3/8.5/8.5，codex 明确撤回 blocker）→ A 扩展接受 | PASS（1 次真拒绝+返工） |
| T | TestPack + 可执行套件；**真实独立充分性审查**（codex 真子进程，只读）：6 轮，r1-r5 全部 REJECT（每轮实质发现：exit 契约 oracle 过松→文件系统边界→stderr 静默/证据目录→c5 断言流错→直接 exit-0 缺失），逐轮返工，r6 sufficient=true oracleStrength=strong → T 扩展接受 | PASS（5 次真拒绝+返工） |
| P | 上游 canonical plan 契约（task authority 标记 + 稳定任务 id + plans 目录）→ plan.evidence → P 扩展接受 | PASS |

第三次运行（r3）前两次运行诚实取消（原因见 §4 blocker 1/2，皆为真实上游面发现）。

## 3. 实现 / 审查 / V / Kp 阻断（真实进程证据）

- **TDD**：冻结套件 11 例。RED：4 fail（c1/c1b/c2/c3a——`Unknown option '--version'`，
  行为 RED）/ 6-7 pass（契约用例）。GREEN：实现（TOOL_VERSION 常量 + argv 预扫描 +
  usage 行）→ 11/11 exit 0。审查后追加 c7 → 11/11。
- **代码审查**（codex 真子进程，只读）：r1 REJECT——**复现了缺陷**（版本分支扫
  host process.argv 而非 args 参数，破坏程序化调用与 AC4 隔离）；修复为 args 扫描 +
  c7 用例 → r2 APPROVE。
- **V**：同候选真实旅程 `--scenario T01 …` → **PASS exit=0**，typed readback
  （verdict PASS / exitCode 0 / effectiveExecutions 1 / candidate 6e13a15）。含一次
  真实拒绝：首轮 frozen-baseline-drift（A15 保守失效——合成 pilot 契约冻结的工件
  在其后被修订），刷新契约后过。
- **Kp 阻断**：(a) 真实归档入口拒绝（组合 Run 归档所有权锁，exit 70）；(b) 打包
  Kp 验证器（bindings.mjs→evaluate）拒绝无凭 pass：`MISSING_OBSERVATION: required
  check archive/knowledge-closeout-verified has no receipt`。完整 Kp→归档→Kt 旅程归
  VERIFY（计划内）。

## 4. 真实上游发现（blocker，如实登记，未平滑）

1. **isolation initialState 死锁**：组合 Run initialState.isolation=null 时
   full.build.configure 永远无法通过（验证器要求 state.isolation 非空；输出 schema
   禁 null；transition 拒绝 failed configure；组合面无启动后 isolation 写路径）。
   0.5.0 pristine 测试全部以 isolation:'current' 启动——受管启动必须携带。Run#1 因
   此取消。
2. **submissionId 唯一性**：跨 epoch 复用 submissionId 使扩展 activation 绑到陈旧
   epoch-0 evidence wait（sourceCurrent 永假）。驱动器缺陷，非上游缺陷；已修正。
3. **write-once 每门工件 × revise 回环冲突**：固定 artifactRef
   （.sdd/delivery/gates/<g>/receipt-bundle.json）在 revise 后重跑同门时被新 epoch
   字节覆盖，旧 pass 的绑定哈希永久失配（旧字节含随机 id 不可重建；P 门 round-1
   pass 536b5b49… 重建 c08b738c… 失败）→ 后续 P 领取/记录全被拒。上游设计期望门
   工件字节 epoch-稳定；**建议：修订循环要么禁用同门重臂，要么 artifactRef 按
   epoch 派生**。Run#2/r3 尾段因此停驻（P 首过已接受；re-arm 后的 P 停在
   build 阶段，verifyResult=pending——从不假称完成）。

## 5. 旅程固化与验证（真实命令与结果）

| 命令 | 结果 |
| --- | --- |
| `node --test test/delivery-cases/3_2.mjs` | **13/13 pass, 0 fail**（重写后首红：GREEN 摘要 ℹ/# 报告器差异 + 证据文件尾行非 JSON——两处修复） |
| `node --test test/delivery-cases/3_1.mjs` / `2_4.mjs` / `1_3.mjs` | 25/25、21/21、10/10 全绿 |
| `node tools/verify/delivery-journey.mjs --journey same-run-delivery --profile comet-managed-v2` | **NOT-EXERCISED exit 2**（reason: journey-recipe-freeze-or-safe-path-missing）——verification-case-plan 的 journey_definitions 未注册 case_definition_sha256 分母；分母注册归 VERIFY 前步骤（该文件不在本任务 Owns），如实登记 |
| 配方 | 重写为 comet-050 面（E06；spawn 3_2.mjs + readback + inspect；verdictSemantics 明示 PASS 仅证建设切片、blocker 永不转为能力、尾段归 VERIFY） |

## 6. UNVERIFIED / 边界

- 组合 Run 的 verify/archive 段（V 扩展、Kp 扩展在真实 Run 内、真实 OpenSpec 归档、
  Kt）未在本切片走完（§4.3 blocker）；本报告的 V/Kp 证据来自同候选真实旅程执行与
  打包验证器 live 判定，非组合 Run 内扩展。
- 三代理评审为真实 CLI 子进程（claude-code/zcode/codex-agent，静默只读，机械
  review_gate 计票）；本会话为单宿主——技能宿主身份的独立性声明于各 bundle。
- 全量 `npm test` 未跑（串行任务时间盒；关联面 1_3/2_4/3_1/3_2 全绿）。
- 试点世界一次性（/private/tmp）；仓库内证据为命令/票据/账本固化副本（四门 receipt-bundle、漂移拒收原件、派发命令回执于 2026-10-27 复审后补冻；R 门收据绑定 proposal+design 两工件，tasks.md 哈希由 P 门收据绑定）。
