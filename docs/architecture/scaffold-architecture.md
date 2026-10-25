# 团队 AI Coding Scaffold 架构

> 状态：权威（v2 定位）。本文是仓库重构的实施依据。
> 前身：SDD Harness 9-stage 工作流（2026-09-04 必要性审计移除其文档，历史见 git log 与 ADR-0015/0017）。

> 当前交付实施见 [Comet流程与知识收敛架构](comet-ai-devops-convergence.md) 和 [ADR-0020](adr/0020-comet-command-knowledge-convergence.md)。本文继续规定基础scaffold分层；可选profile按ADR-0019接入原Comet，运行资格单独验收。

## 0. 定位

**本仓库 = 团队 AI coding 项目的 scaffold（脚手架）。** 团队新建或改造项目时，以本仓库为模板：获得统一的规则入口、协作方法（skills）、约束与触发（hooks）、MCP 能力、变更工件约定和最小验证体系。

**不做什么**：不规定开发工作流。阶段划分、任务编排、模型选择由执行 agent 和团队自定。scaffold 只提供设施和方法论。

### 关键决策（grilling 结论，2026-09-03）

| # | 决策 | 理由 |
|---|------|------|
| 1 | 9-stage 工作流出局；控制平面 = code agent 原生 hooks | 工作流是流程意见，不是设施；hooks 由 agent 原生执行，无自造引擎 |
| 2 | Claude Code 为 reference 实现，架构保留 agent 适配层 | 策略定义一次（中立格式），各 agent 落地由 adapter 负责；首日只实现 CC adapter |
| 3 | 技能以 mono 模式 vendor 进仓库（`.agents/skills/`），不装 `~/.claude/skills` | 随 repo 版本化、可审阅、对全部 agent 生效 |
| 4 | trinity-* 家族不进 scaffold | 与 OpenSpec 原生 opsx:* 重复，且是旧工作流引擎 |
| 5 | claude-parallel-tdd-planner / openspec/ 引导 / 事实源治理**进**基础层 | 团队基础设施，非可选 |
| 6 | MCP 预制但能力不具备的，必须在能力清单中如实标注 | 诚实性原则：杜绝 stub 依赖重演 |
| 7 | 仓库形态 = mono 平铺：模板内容住根目录，builder 收缩 | 单一真相源，初始化 = clone + bootstrap.sh |

## 1. 分层架构

```text
┌─────────────────────────────────────────────────────┐
│ 约定层   AGENTS.md（单一规则入口；CLAUDE.md 软链兼容）  │
├─────────────────────────────────────────────────────┤
│ 协作层   docs/agent/（技能触发矩阵、任务交接模板）       │
├─────────────────────────────────────────────────────┤
│ 技能层   .agents/skills/（vendored 版本化快照）        │
├─────────────────────────────────────────────────────┤
│ 控制层   hooks 策略源 hooks.yaml → agent adapter 落地  │
├─────────────────────────────────────────────────────┤
│ 工具层   MCP 注册 + 能力清单（诚实标注）               │
├─────────────────────────────────────────────────────┤
│ 工件层   openspec/ 变更工件 + docs/architecture/adr/  │
├─────────────────────────────────────────────────────┤
│ 验证层   gate/audit 程序化验证（lib/）+ check.sh 窄检查  │
└─────────────────────────────────────────────────────┘
```

数据流向：约定层是唯一规则源；协作层声明"什么任务用什么方法、必须产出什么"；控制层在 agent 运行时约束/触发行为；验证层用程序化工具（gate/audit）+ 脚本检查校验各层完整性。

## 2. 目标目录结构（mono 平铺）

```text
/（repo root = scaffold = 团队项目模板）
├── AGENTS.md                        # 规则骨架：段落固定，内容团队填空
├── CLAUDE.md -> AGENTS.md           # 兼容软链，check 强制
├── docs/
│   ├── agent/
│   │   ├── skill-architecture.md    # 分层表 + 技能职责 + 触发矩阵
│   │   └── task-template.md         # 任务交接模板
│   └── architecture/
│       ├── adr/0001-*.md            # ADR 起步
│       └── scaffold-architecture.md # 本文
├── .agents/skills/                  # vendored 技能（见 §3）
├── openspec/                        # config.yaml + project.md + changes/
├── hooks.yaml                       # 策略源，中立格式（见 §4）
├── hooks/                           # 策略脚本实现（被 adapter 引用）
├── tools/
│   ├── bootstrap.sh                 # 初始化：环境检测 + hooks 落地 + MCP 注册
│   └── adapters/
│       └── claude-code.sh           # CC adapter：hooks.yaml → .claude/settings.json
├── scripts/
│   ├── check.sh                     # 总入口，编排窄检查
│   ├── agent-instructions-check.sh  # 规则文件完整性 + CLAUDE.md 软链
│   └── agent-skill-check.sh         # 必需技能存在 + 原始技能未被篡改
├── bin/cli.js                       # 薄 CLI：init/bootstrap + 验证工具入口
├── lib/                             # gate/audit 程序化验证库（见 §7 保留项）
│   ├── generation-gate.js           # 测试清单比对（用例编写完整性）
│   ├── probe-validator.js           # probe 行为验证（真实路径证据）
│   ├── deliverable-audit.js         # 交付物审计
│   ├── workflow-audit.js            # 运行状态审计
│   └── knowledge-seed.js            # 知识源发现 + raw/ 复制
├── test/                            # 上述库的测试（随库保留）
├── .mcp.json                        # MCP 注册（bootstrap 生成/合并）
├── mcp-capabilities.yaml            # MCP 能力清单（见 §5）
└── .gitignore                       # git 卫生（见 §6）
```

**初始化动作**：团队 `git clone` 本仓库 → 填 AGENTS.md / project.md 的项目特定内容 → 跑 `tools/bootstrap.sh`（检测环境、落地 hooks、注册 MCP）→ 跑 `scripts/check.sh` 确认骨架完整。

## 3. 技能 vendoring（基础层）

判断标准：**任何任务都用得上的方法论**进基础层；与 OpenSpec 原生能力重复或属旧工作流引擎的不进。

| 技能 | 来源 | 职责 |
|------|------|------|
| grill-me + grilling | mattpocock/skills | 前置事实质询，一次一问、给推荐答案、消除歧义 |
| whitebox-verify (v2.2+) | 内部演化 | 三模式验证：调试（Chrome MCP 链路）/ Journey 验收 / Slice TDD |
| claude-parallel-tdd-planner | 内部 | 并行计划协议：context pack、DAG、CONFIRM_ALIGNMENT、RED/GREEN ledger |
| multi-agent-consensus-review | 内部 | 三方全票共识评审（unanimous gate + evidence-based debate） |

**约束**（继承 mono 实践）：项目约束只写在 AGENTS.md / docs/agent/，不改技能正文、不加项目品牌前缀；`.agents/skills/` 是版本化快照，升级 = 显式替换 + `agent-skill-check.sh` 校验。

**触发矩阵**（skill-architecture.md 模板核心，示例行）：

| 任务 | 必读技能 | 必须产出 |
|------|---------|---------|
| 需求不清、事实不足 | grill-me | 事实来源、范围、非目标、未决 owner |
| 多文件/新能力规划 | grill-me + claude-parallel-tdd-planner | context pack、DAG、RED/GREEN 计划 |
| 跨模块/跨服务验收 | whitebox-verify（Journey 模式） | 终态业务 oracle、真实路径证据 |
| 本地规则/组件 TDD | whitebox-verify（Slice 模式） | 失败测试先行、窄验证 |
| 完成/合并前 | whitebox-verify + test-gate 机械证据 + 人工审查 | 真实命令、结果、未验证项清单 |
| 架构/跨 agent 决策授权 | multi-agent-consensus-review | 三方 ballot、tally、final/blocked report |

## 4. Hooks 控制平面

策略以中立格式定义在 `hooks.yaml`（一次定义），由 adapter 落地为各 agent 原生配置（首日只实现 Claude Code）。

```yaml
# hooks.yaml — 策略源
policies:
  - id: kb-write-protection
    hook: PreToolUse            # 约束
    matcher: Write|Edit
    action: deny
    target: "llmwiki/wiki/**"
    message: "直接写 wiki 会绕过索引，必须走 mcp__llmwiki__create / edit / append"

  - id: dangerous-command-blocklist
    hook: PreToolUse            # 约束
    matcher: Bash
    action: deny
    patterns: ["git push --force", "git reset --hard", "rm -rf /", "DROP TABLE"]
    message: "破坏性命令在禁入清单，确需执行请人工操作"

  - id: session-context-injection
    hook: SessionStart          # 触发
    action: run
    script: hooks/session-context.sh   # 注入 conventions 摘要、活跃 ADR、知识索引

  - id: stop-sediment-reminder
    hook: Stop                  # 触发
    action: run
    script: hooks/stop-reminder.sh     # 检查"该写而未写"的 findings/ADR 并提醒
```

扩展位（首日不实现）：steering/ADR 变更警告、PostToolUse 沉淀检测。新增策略 = 加 hooks.yaml 条目 + adapter 重跑，不写死在 agent 配置里。

## 5. MCP 能力清单（诚实标注）

`mcp-capabilities.yaml` 是 MCP 层的唯一事实源，`bootstrap.sh` 据此注册，status 三态：

```yaml
mcps:
  - name: llmwiki
    status: ready                 # ready | degraded | planned
    provides: [知识库 create/edit/append/read/search/lint, SQLite+FTS+引用索引]
    depends: [python3 venv + mcp 包]     # bootstrap 负责 venv
    note: "写入必须走 MCP，直接 fs.write 绕过索引（hooks 策略 kb-write-protection 保护）"

  - name: chrome-devtools
    status: ready
    provides: [浏览器调试、性能 trace、a11y 快照]
    depends: [Chrome 本体]
    required_by: [whitebox-verify 调试模式]

  - name: playwright
    status: ready
    provides: [浏览器自动化]
    depends: [npx playwright install]

  - name: github
    status: degraded              # 预制注册，能力受 token 限制
    provides: [PR/issue 操作]
    depends: [GITHUB_TOKEN]
    note: "未配置 token 时只读降级，不阻塞其他能力"

  # status: planned = 预注册但能力未实现，agent 调用前必须先看本清单
```

**诚实性原则**：任何 status != ready 的 MCP，agent 在触发矩阵/技能中引用其能力前必须查阅本清单；禁止在文档中把 planned 写成可用。

## 6. Git 卫生

进 git：`AGENTS.md`、`docs/`、`.agents/skills/`、`openspec/`、`hooks.yaml`、`hooks/`、`tools/`、`scripts/`、`mcp-capabilities.yaml`、`.mcp.json`（无绝对路径，wrapper 用环境变量）。

不进 git：`.superpowers/`、`.zcode/`、`.local/`、`.planning/`、worktrees、`llmwiki/.staging/`、运行时 ledger/截图/调试输出。

## 7. 遗留处置（9-stage 资产）

| 资产 | 处置 |
|------|------|
| bin/cli.js 的 stage 编排（run/fill + 9-stage 安装分支） | 删除；doctor 的依赖检测逻辑移植进 bootstrap.sh |
| bin/cli.js 的验证工具入口 | **保留**，重定位为 gate/audit 的薄 CLI 入口 |
| lib/generation-gate.js（测试清单比对） | **保留** — 测试用例编写完整性验证（before/after inventory） |
| lib/probe-validator.js（probe 行为验证） | **保留** — 真实路径证据校验，供 whitebox-verify 及人工验证调用 |
| lib/deliverable-audit.js（交付物审计） | **保留** |
| lib/workflow-audit.js（运行状态审计） | **保留** |
| lib/knowledge-seed.js | **保留** — LLMWiki 集成（raw/ 复制；llmwiki-sediment 已删，ADR-0017） |
| lib 中的 DoS 加固、symlink 跳过等防御手法 | **保留**（已在库内，check 脚本沿用同思路） |
| test/（64 个 gate/audit 测试） | **保留**，随库走；stage 专属测试随 stage 代码删除 |
| templates/claude/skills/sdd-*（9 个 stage skill） | 删除（工作流出局） |
| templates/sdd-harness/dependencies.yaml | 内容并入 mcp-capabilities.yaml + skill 清单后删除 |
| sdd-context-mcp | 已删（前次会话） |

**验证层分工**：whitebox-verify 等技能提供**方法**（怎么验）；lib/ 的 gate/audit 提供**机械证据**（用例清单没缺、probe 证据与磁盘绑定、交付物齐全）。hooks（Stop/check.sh）和 agent 都可调用 lib/ 工具。

git 历史保留，不 squash。

## 8. 迁移步骤

1. ✅ 架构定稿（本文）
2. 模板内容平铺到根（AGENTS.md 骨架、docs/agent/、openspec/、ADR）
3. 技能 vendoring：从 mono `.agents/skills/` 与最新上游同步 whitebox-verify / planner / grill-me（superpowers 已移除，见 ADR-0016）
4. hooks.yaml + hooks/ 脚本 + CC adapter + bootstrap.sh
5. scripts/ 最小 check 核心（instructions/skill check，从 mono 移植去业务化）
6. mcp-capabilities.yaml + .mcp.json wrapper（沿用 env-driven 方案）
7. 删除 §7 中标记"删除"的遗留；gate/audit 库与测试保留并挂接新 CLI 入口
8. README 重写为新定位
9. 验证：`bootstrap.sh` 全新目录跑通 + `check.sh` 通过 + `claude -p` 冒烟（hooks/MCP 生效）
