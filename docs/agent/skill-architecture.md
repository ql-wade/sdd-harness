# Coding Agent 技能架构

> **状态**：权威（Coding Agent 协作层）。Agent 指开发执行器（Claude Code、Codex、Cursor 等），不是项目业务中的运行时 Agent。

> 当前交付方法与角色绑定以 [收敛架构](../architecture/comet-ai-devops-convergence.md) 和 [HANDOFF](../../openspec/changes/delivery-foundation-rearchitecture/HANDOFF.md) 为准。本页保留基础方法职责；快照存在不等于实际调用或产品验收，当前运行资格从原始证据核验。

## 1. 目标与边界

本仓库把可复用的开发方法 vendored 进仓库（`.agents/skills/`），帮助开发者和 Coding Agent 完成理解、计划、实现、审查和验证。技能是**方法论**，不规定工作流；阶段划分、任务编排、模型选择由执行 agent 和团队自定。

明确不引入：

- Agent 身份/记忆/心跳等运行时产品层。
- `config/model-routing.yaml`、模型等级映射和供应商路由配置——复杂度由执行 agent 运行时判断。
- 把 `.agents/` 之外的本地产物（session、prompt、ledger、截图、临时报告）提交到 Git。

## 2. 分层架构

| 层 | 权威位置 | 作用 | 是否进入 Git |
| --- | --- | --- | --- |
| 仓库总约束 | `AGENTS.md` | 范围、事实来源、安全红线、命令和交接 | 是 |
| 兼容入口 | `CLAUDE.md -> AGENTS.md` | 兼容读取 `CLAUDE.md` 的 agent；不维护第二份规则 | 是 |
| 原始技能 | `.agents/skills/**/SKILL.md` | 方法论的版本化快照（见 §3） | 是 |
| 控制平面 | `hooks.yaml` + `hooks/` | agent 原生 hook 的约束/触发策略（见架构文档 §4） | 是 |
| MCP 能力 | `mcp-capabilities.yaml` + `.mcp.json` | MCP 注册与诚实能力清单 | 是 |
| 变更工件 | `openspec/changes/<change-id>/` | 变更提案、任务与证据 | 是 |
| 架构决策 | `docs/architecture/adr/` | 不可逆决策记录 | 是 |
| 临时执行状态 | `.superpowers/`、`.zcode/`、`.local/`、`.planning/` | 本地 ledger、prompt、截图、调试输出 | 否 |

`.agents/skills/` 是项目级、可审阅、随仓库版本化的技能定义；`CLAUDE.md` 只是指向 `AGENTS.md` 的兼容软链，规范正文以 `AGENTS.md` 和 `.agents/skills/` 为唯一来源。`scripts/agent-skill-check.sh` 校验完整性。

## 3. 技能清单（基础层）

判断标准：**任何任务都用得上的方法论**进基础层；某种流程的执行协议或与上游原生能力重复的不进。

| 技能 | 来源 | 职责 |
| --- | --- | --- |
| `tdd` + `diagnosing-bugs` + `code-review` | Matt Pocock (mattpocock/skills) | 基础实现方法（P1_6 方法档案）：测试先行 TDD、困难缺陷诊断循环、Standards/Spec 双轴审查 |
| `grill-me` + `grilling` | mattpocock/skills | 前置事实质询：一次一问、给推荐答案、消除分支和术语歧义，直到共同理解（架构共识入口） |
| `whitebox-verify` | 内部演化 | 三模式验证：调试模式（浏览器链路白盒）/ Journey 验收（No GREEN without Journey closure）/ Slice 模式（本地 TDD）；独立验收权威 |
| `test-authoring` | 内部演化 | 测试设计与可执行测试编写，独立于实现与独立验收 |
| `openspec-lifecycle-guard` | 内部演化 | OpenSpec 变更生命周期守护：证据化任务完成、严格校验、归档就绪 |
| `claude-parallel-tdd-planner` | 内部（共享源快照，P1_6 升级） | 并行计划协议与数据契约/校验工具：context pack、任务 DAG、CONFIRM_ALIGNMENT、RED/GREEN ledger、plan_guard；已去 Superpowers 硬依赖，交付中不作为第二 controller 激活 |
| `multi-agent-consensus-review` | 内部 | 三方全票共识评审：多 agent 独立冷启动投票、unanimous gate（全票 APPROVE + 分数门槛 + 同 digest）、分歧走 evidence-based debate；默认 quorum claude-code/zcode/codex-agent |
| `ponytail` | 上游插件（5.3.2 快照，supplement_delta） | 最小完整方案方法：先查必要与复用再增代码；插件生命周期 Hook 由插件入口管理（§7.2 分工），不复制进项目配置 |

> superpowers 核心子集已于 v0.2.2 移除（ADR-0016）：实现 TDD 由 Matt `tdd` 承接，独立验收由 `whitebox-verify` 承接，架构质询由 `grill-me` 承接；受管产品 P 仅复用原始计划协议与只读校验器。
> P1_6 方法档案（method-profile-manifest.json）：唯一可选 profile ID 为 `comet-managed-v2`，数据在 `foundation/profiles/comet-managed.json`，状态为 `UNQUALIFIED`（未启用、未签运行验收）；交付主控是 Comet Classic（单一 controller，禁止嵌套 planner/implement-spec），实现方法默认 Matt tdd/diagnosing-bugs/code-review，专门方法（test-authoring、Whitebox、grill-me/共识等）保留各自职责；Superpowers 不是安装或执行依赖，`docs/superpowers` 等旧名仅是受控兼容产物路径。Ponytail 补充（用户裁决 A）：受管 profile 默认 full，用户启停只改方法上下文不改 Gate/权限；插件 Hook / 项目 hooks.yaml / CC adapter 受管生成三线注册互不复制，同仓库 mode 文件最后写入生效（cooperative-local），不承诺并发角色级不同模式。

**约束**：项目约束只写在 `AGENTS.md` 和 `docs/agent/`，不改技能正文、不加项目品牌前缀。技能以真实目录快照分发（禁止符号链接——可移植性红线），升级 = 显式替换 `.agents/skills/` 下的快照 + 更新 `openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json` 的来源与摘要 + 跑 `bash scripts/agent-skill-check.sh`（校验存在性与 frontmatter 完整性；内容级 hash 清单自 P1_6 起由 method-profile-manifest 固定）。

## 3.1 可选受管方法绑定

`foundation/profiles/comet-managed.json` 只声明原生 Comet 动作、角色、方法、输入输出及门的绑定；文件名不是第二个 profile 别名。保留原 Open/Design/Build/Verify/Archive 五 phase、同一 Run、锁、事务及 continuation。TeamAI 只分发；方法不维护第二 phase、DAG、派发或恢复循环。

| 动作 | 原样方法与职责 | 接纳边界 |
| --- | --- | --- |
| R | grill-me 澄清需求，正式范围及 AC 写 OpenSpec | 需求确认独立于架构 |
| A | grill-me 架构质询，独立 multi-agent-consensus-review | 受保护参与者/阈值、当前原摘要、原票和 tally，不复用迁移计划票 |
| T | test-authoring 设计 case、oracle、覆盖、环境和清理 | 独立语义审查，不用结构有效或作者自检放行 |
| P | 原 planner 的计划协议段及纯校验器 | 同一 Change 的任务身份/tasks/DAG，不激活完整 controller |
| Build | test-authoring 编写测试；Builder 使用 Matt tdd/diagnosing-bugs；独立 code-review | 作者测试、实现与独立审查分开，真实行为 RED→GREEN |
| V | 独立 whitebox-verify | 当前候选、typed ledger、validator、真实业务终态读回 |
| Kp/规格/Kt | 知识作者/独立审查、唯一 Spec Adapter、受管 Publisher | Kp 阻断所有归档入口，Kt 阻断整体完成；同 Run 继续与恢复 |

P 的允许列表是原样 `claude-parallel-tdd-planner/references/plan-contract.md` 的 `One root and acceptance source`、`DAG` 两节，以及只读 `scripts/plan_guard.py`。在 `Execution contract` 前停止；不得加载完整 SKILL、automation/parallel-execution/execution-prompt/completion/openspec-closeout 引用或 lifecycle/render/install 脚本。保留完整来源快照不表示激活其 Goal/监督/派发/归档合同；运行适配器仍须落实该允许列表。

P1_6 已显式整份升级共识方法登记源码 19 文件与 Whitebox 139 文件，来源及逐文件清单见仓库根目录的 `worker-reports/P1_6-convergence/source-upgrades.json`。其余九份方法保留既有快照。Whitebox 的 `tests/run_all.sh` 自测完整供应内容，包含原八负例、增至十五负例及三不变量；这些是方法源自测，不签产品 Journey。仓库 `scripts/check.sh` 必须调用该入口，入口缺失或失败均阻断。

Comet 的双语分发资产、init/update 安装调用、doctor 诊断及原生 Hook 计划恢复指引通过项目自有 `0001-matt-method-profile.patch` 修订，未修改这些原样方法正文。真实执行器、受信角色、结果来源、硬门及新宿主完整旅程分别归原下游任务与 VERIFY；缺能力返回 UNQUALIFIED，不回退退役方法，不因文件/hash/安装通过启用 profile。Ponytail full 只影响方法上下文，不改变权限或门禁；运行隔离限制仍须独立验证。

## 4. 触发矩阵

<!-- TODO(team): 按项目任务类型增删行。骨架示例： -->

| 任务 | 必读技能 | 必须产出 |
| --- | --- | --- |
| 需求不清、事实不足 | `grill-me` | 事实来源、已确认目标、范围、非目标、未决问题和决策 owner |
| 单文件低风险修复 | `whitebox-verify`（Slice 模式） | 失败测试先行、窄测试/静态检查 |
| 多文件、新能力规划 | `grill-me` + `claude-parallel-tdd-planner` | context pack、DAG、CONFIRM_ALIGNMENT、RED/GREEN 计划 |
| 跨模块/跨服务验收 | `whitebox-verify`（Journey 模式） | 终态业务 oracle、真实 first-party 路径证据 |
| 本地规则/组件 TDD | `whitebox-verify`（Slice 模式） | 失败测试先行、窄验证 |
| 完成、合并前 | `whitebox-verify` + `test-gate` 机械证据 + 人工审查 | 真实命令、结果、未验证项清单 |
| 架构/跨 agent 决策、高风险变更授权 | `multi-agent-consensus-review` | 三方独立 ballot、tally 报告、final/blocked report + next-step plan |
| 实现中发现事实冲突 | 重新调用 `grill-me` | 冲突事实、决策 owner、更新后的 ADR/计划 |

机械证据与技能方法互补：技能定义"怎么验"；`lib/` 的验证工具提供"验过了"的程序化证据——

| 工具 | 用途 | 调用 |
| --- | --- | --- |
| `node bin/cli.js test-gate` | 运行项目测试并持久化证据（sha256 绑定） | 完成/合并前 |
| `node bin/cli.js probe` | 校验浏览器/运行时 probe 证据（debug 泄漏、布局越界、状态迁移） | UI 验收 |
| `node bin/cli.js generation-capture / generation-evaluate` | 测试用例编写完整性（前后清单比对） | TDD 生成后 |
| `node bin/cli.js deliverable-audit / evidence-audit / workflow-audit` | 交付物 / 证据 / 运行状态审计 | 高风险变更、归档前 |

## 5. 证据位置

- 变更事实：`openspec/changes/<change-id>/`。
- 质询结论：写回 OpenSpec `findings.md` 或 ADR；不把一次问答伪装成实现 review。
- 验证证据：真实命令输出 + `test-gate` / `probe` 持久化的 sha256 绑定报告。
- 完成声明必须列出真实命令、结果和未验证项；Mock 成功不能冒充真实验证。

## 6. 入口兼容

- 各 Coding Agent 读取 `AGENTS.md`，再按触发矩阵加载 `.agents/skills/`（Claude Code 由 `tools/bootstrap.sh` 建立 `.claude/skills` 软链注入）。
- 某技能不可用时，人工执行同一问答/证据协议，并如实标记缺失能力和未验证项，不得降级为"已通过"。
