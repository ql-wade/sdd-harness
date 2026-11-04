<!-- 同步纪律（readme-restructure，2026-11-04）：改 RUNBOOK 第 0-3 步命令、陷阱表、
     应用版本时，同一次变更里同步下方的快速开始、五入口、文档地图三节。
     对 README.md 与 README.zh.md 同时适用。 -->

# AI Coding Scaffold（团队 AI 交付脚手架）

[English](README.md) | 中文

给任意仓库装上一套团队 AI 交付基建：统一的规则入口、评审技能、hooks 控制平面、
如实标注的 MCP 能力清单、可机器校验的验证工具。如果想进一步用受管交付，还有一个
可选的六门流程应用：每次变更走六道门，人只在审批点拍板。

下文会用两个词：

- **脚手架**——上面那五样设施。它不规定你的工作流
  （[ADR-0015](docs/architecture/adr/0015-scaffold-repositioning.md)）。
- **受管交付**——可选的六门流程应用。agent 干活，但每道门都要求一条独立的证据链，
  过了才放行。

暂无 badge：两个 CI workflow 在默认分支上目前都是红的，转绿后再挂。仓库还没有
LICENSE 文件。

## 为什么是这套架构

AI agent 写代码的速度早就超过了人审查的速度。失败场景大家都不陌生：agent 说
"做完了"，diff 看着像那么回事，两周后没人说得清到底验证过什么。这套脚手架的回答
是靠结构，不靠信任。

**每道门独立评审。**作者不签自己的名。每道门都是独立的评审步骤，有自己的收据，
由代码裁决，不由写代码的那个 agent 的自信裁决。

**证据高于声称。**每道门产出一份收据束：HMAC 签名、绑定输入摘要、record 期再
逐条哈希比对。"agent 说做完了"在这里没有分量——证据链要么成立，要么门直接拒。

**人决策，agent 干活。**你批准需求、设计、测试判据、计划和最终验证结果。推进
Run、构造证据、提交 outcome，全部自动化。

**知识收敛。**项目收尾（Kp）和团队发布（Kt）把每次交付的教训变成可检索的知识，
而不是口口相传。

**在真实交付上验证过。**两轮试点把变更完整走过了六门、归档和 Kt。范围说清楚：
试点验证的是 RUNBOOK 旅程和证据链，不是收敛目标架构（那部分设计已完成，实施另账
追踪）。这个仓库也拿自己的标准要求自己——你现在读的这份 README，初稿经过了三席
对抗评审，被抓出三处事实错误后重写。

## 六道门

```text
R ───► A ───► T ───► P ───► Build ───► V ───► Kp ───► 归档 ───► Kt
需求确认  架构共识  测试设计  构建计划  实现        白盒验证  知识收尾  归档     知识发布
```

| 门 | 裁决的问题 | 判定词汇 |
|---|---|---|
| R 需求确认 | 范围是否真实且达成一致？ | pass / repair / revise-requirements |
| A 架构共识 | 设计是否可靠并经独立评审？ | pass / repair / revise-requirements |
| T 测试设计 | 写代码之前，"正确"是什么意思？ | pass / repair / revise-requirements |
| P 构建计划 | 任务 DAG 按这个顺序真的可执行吗？ | pass / repair / revise-requirements |
| V 白盒验证 | 真实产物跑通了吗，机器证据在哪？ | pass / repair |
| Kp 知识收尾 | 这次变更教会了项目什么？ | confirmation |

每道门 = 一次独立评审 + 一份收据束 + 一条已记录的 outcome。被拒就打回重走，任何
一步都不靠承诺放行。

## 架构分层

```text
约定层   AGENTS.md                 agent 和人最先读的规则入口
协作层   docs/agent/               技能触发矩阵、任务交接模板
技能层   .agents/skills/           版本化技能快照（vendored）
控制层   hooks.yaml → adapter → agent 原生 hooks    策略只定义一次，按 agent 编译
工具层   mcp-capabilities.yaml + .mcp.json          如实标注的能力清单
工件层   openspec/ + docs/architecture/adr/         规格与不可逆决策
验证层   lib/ + scripts/check.sh                    gate/audit 回归套件
```

控制平面单向工作：[hooks.yaml](hooks.yaml) 定义策略（知识库写保护、危险命令黑名单、
会话上下文注入），adapter 编译成各 agent 的原生 hooks，生成产物一律不手改。受管
交付应用在 [integrations/comet/](integrations/comet/application/composition.json)：
门禁校验器、六技能组合、证据端口。完整分层见
[scaffold-architecture.md](docs/architecture/scaffold-architecture.md)。

## 快速开始

前置：下面的工具链需要 Node ≥ 18。受管交付旅程需要 Node ≥ 22.16（24 最佳），
且 Comet 0.5.1 在 PATH 上。各版本退化陷阱见 RUNBOOK 的开始前清单。

```bash
git clone <本仓库> my-project && cd my-project   # 终端
bash tools/bootstrap.sh                          # hooks、skills、MCP 注册
# 补齐 AGENTS.md 和 openspec/project.md 里的 TODO(team)
bash scripts/check.sh                            # 骨架完整性检查
# 重启 Claude Code 会话——hooks 只在会话启动时加载
comet application install <scaffold>/integrations/comet/application/package/application.json \
  --project "$PWD" --preview --json              # 项目根——记下 confirmationHash
comet application install <scaffold>/integrations/comet/application/package/application.json \
  --confirmation-hash <hash> --project "$PWD"    # 项目根——正式安装
mkdir -p openspec/changes/my-change              # 不要跑 comet state init：见 RUNBOOK 陷阱表
export SDD_SESSION_ID="$(uuidgen)"               # 驱动器硬前置
bash tools/drive-journey.sh my-change            # 起 Run，到审批点会叫你
# 在驱动器所在终端输入：approved / 同意 / y / yes
```

每道门的交付物、证据构造和陷阱恢复都在 [RUNBOOK](docs/user/RUNBOOK.md)。

## 技能与工具

| 技能 | 职责 |
|---|---|
| grill-me + grilling | 设计前的事实质询，一次只问一个问题 |
| whitebox-verify | 三种验证模式：调试 / Journey 验收 / Slice TDD |
| claude-parallel-tdd-planner | 并行计划协议：DAG、RED-GREEN ledger |
| multi-agent-consensus-review | 三席全票共识评审，基于证据辩论 |

触发矩阵：[skill-architecture.md](docs/agent/skill-architecture.md)。验证 CLI 常用
三条：`node bin/cli.js doctor`、`test-gate`、`scripts/check.sh`。退出码：0 通过、
1 输入无效、2 验证不通过。完整命令清单：[docs/reference.md](docs/reference.md)。

MCP 集成只在 [mcp-capabilities.yaml](mcp-capabilities.yaml) 声明一次——ready、
degraded、planned 三态，状态只活在这一处。

## 文档地图

| 想了解 | 去读 |
|---|---|
| [RUNBOOK](docs/user/RUNBOOK.md) | 正在驱动交付——cookbook 加陷阱表 |
| [scaffold-architecture.md](docs/architecture/scaffold-architecture.md) | 完整分层架构 |
| [convergence](docs/architecture/comet-ai-devops-convergence.md) | 目标架构——设计修订完成，实施在变更 tasks/DAG 里追踪 |
| [adr/](docs/architecture/adr/) | 不可逆决策及其理由 |
| [skill-architecture.md](docs/agent/skill-architecture.md) | 技能何时如何触发 |
| [mcp-capabilities.yaml](mcp-capabilities.yaml) | 哪些集成今天真的能用 |
| [FRAMEWORK.md](FRAMEWORK.md) | 交付框架的结构与纯净线规则 |
| [delivery-foundation-rearchitecture](openspec/changes/delivery-foundation-rearchitecture/tasks.md) | 当前实施状态（tasks、DAG、HANDOFF） |
| [foundation/](foundation/) | 封存基线，供审计回读 |
| [managed-delivery-quickstart.md](docs/delivery/managed-delivery-quickstart.md) | 2026-10 时代的历史走查——现行以 RUNBOOK 为准 |

## 求助

交付陷阱与恢复都在 [RUNBOOK 陷阱表](docs/user/RUNBOOK.md)（state init 误绑、
failed-terminal Run、authority 合并）。问题走团队渠道；可复现的问题提 issue。

## 开发本仓库

```bash
npm install
npm test               # gate/audit 回归套件
bash scripts/check.sh  # 规则层 + 技能层 + 回归 + YAML/JSON
node integrations/comet/application/internal/build-application.mjs --out <仓库外新目录>
```

构建成功不等于运行资格。编译产物还需要宿主安装和逐门验证。
