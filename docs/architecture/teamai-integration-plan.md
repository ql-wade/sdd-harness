# TeamAI-CLI 集成方案（v1 提案）

> 状态：**提议**——待用户确认后按 ADR-0018 定稿并分阶段实施。
> 调研对象：[Tencent/teamai-cli](https://github.com/Tencent/teamai-cli) v0.22.0（MIT，npm 公发，纯 JS 无原生编译）。
> 本文与 ADR-0018 草案配套；事实来源：上游 README/usage-guide/架构文档/源码结构（zread 交叉核对）。

## 1. 调研结论

### 1.1 它是什么

Git-native 的团队 AI 协作层：**一个共享 Git 仓库 + 一个 CLI**，把团队的 skills/rules/docs/env/agents/hooks/MCP 分发到 9 种 coding agent（Claude Code、Codex、Cursor、Qoder、CodeBuddy、OpenCode、WorkBuddy、OpenClaw、Hermes、DeepSeek Harness），并在其上构建团队知识与改进回路。无服务端、无数据库依赖——审计/权限/备份全部继承 Git 托管平台。

### 1.2 三层能力 vs 我们的缺口

| TeamAI 层 | 能力 | 我们的现状 | 判定 |
|-----------|------|-----------|------|
| **Team Execution**（分发） | team repo + `push→MR→pull`；9-agent hooks/MCP/skills 幂等注入（统一 HookDef → 各 agent 原生格式 reconcile，不覆盖用户配置） | 只做了 CC adapter（ADR-0015 决策 2 的"适配层留而未建"） | **正好补我们的缺口** |
| **Team Context**（知识） | recall 双层检索（TF-IDF 经验索引 + BM25+图谱增强 teamwiki）；代码图谱（tree-sitter WASM AST + 启发式双轨） | LLMWiki MCP（SQLite+FTS，策展知识）；代码图谱随 `sdd graph` 删除 | 互补：见 §3.3 |
| **Team Improvement**（改进） | 摩擦信号（打断/拒绝/重试）触发经验沉淀、session 分析、digest 周报、dashboard | **无** | 纯增量 |

### 1.3 成熟度评估

- **优点**：Tencent 官方维护、活跃（CHANGELOG 持续）、配置三层 Zod 校验、hooks reconcile 幂等（数组 diff 零差异不写盘、用户钩子永不被覆盖）、Codex hooks 不自动 trust（安全姿态正确）、供应链纯 JS。
- **风险**：v0.x API 可能变动；hooks 格式是 command 型（无 deny/action 语义）；teamwiki 与 LLMWiki 职责需划界；中文团队产品（我们 check 脚本需容忍其输出）。
- **关键验证点（P0 必做）**：它注入 CC settings.json 时与我们 adapter 的 upsert 是否互不破坏——双方都声称幂等，但**互不感知的幂等**不等于组合幂等（F-HOOKS-001 教训：装配层出问题组件测试全绿）。

## 2. 契合点：两个架构是同构的

```text
我们的分层（ADR-0015）                teamai 的模型
─────────────────────────          ─────────────────────────
约定层 AGENTS.md（单一入口）    ≈     rules → reconcile 为 CLAUDE.md/.cursor/rules/AGENT.md
技能层 .agents/skills（vendored） ≈    skills/ → 同步各工具目录
控制层 hooks.yaml → CC adapter  ≈     hooks/hooks.yaml → 9-agent reconcile
工具层 mcp-capabilities → .mcp.json ≈ mcp/mcp.yaml → 各工具原生格式
工件层 openspec/ + ADR          ≈     team repo 的 git 审查流（push→MR）
（无）                          ≈     teamwiki 图谱 + recall + 摩擦沉淀
```

差异本质：我们是**仓库即模板**（clone + bootstrap），它是**仓库即团队源**（init + pull）。二者不冲突——团队 fork 本仓库当 team repo，`teamai.yaml` 支持 `mode: self` 自举（clone 后任意命令自动完成初始化）。

## 3. 三个碰撞点与决策

### 3.1 Hooks 双真相源（最高风险）

我们：`hooks.yaml`（policies + deny 语义）→ CC adapter 编译 → settings.json + .compiled.env。
它：`hooks/hooks.yaml`（command 声明）→ reconcile 到 9 agent。

**决策 D1**：我们的 policy 引擎保持唯一策略语义源；`hooks/hooks.yaml` 定位为**分发注册产物**（由 adapter 从我们的 hooks.yaml 生成，指向我们的脚本），与 `.compiled.env` 同纪律：生成物不手改、check 校验同步。deny 语义靠脚本自身实现（CC 下 exit 2 即硬拦，已被我们实证）；非 CC agent 的拦截语义差异如实标注（Codex 需人工 trust，OpenClaw 不支持 hooks）。

### 3.2 MCP 双注册格式

**决策 D2**：`mcp-capabilities.yaml` 保持唯一事实源；`register-mcps.mjs` 增加第二产物 `mcp/mcp.yaml`（teamai 格式，含 `${VAR}` 密钥占位）。`.mcp.json`（CC 本地）与 `mcp/mcp.yaml`（teamai 分发）都是生成物，check 校验两产物与清单一致。

### 3.3 知识层划界

**决策 D3**：双知识层并存、职责互斥：
- **LLMWiki**（保留）：策展知识——结构化 wiki，MCP 写入，kb-write-protection hook 保护，`sdd wiki init/ingest` 流程。
- **teamwiki**（新增）：自动知识——代码图谱（AST 提取）+ 摩擦经验（share-learnings），只读 recall 查询。
- 边界由现有 hooks 守住：直接写 `llmwiki/wiki/` 仍被拦；teamwiki 由 teamai 自管理。

### 3.4 技能目录

**决策 D4**：`.agents/skills/` 保持源真相（可移植性红线不动）。CC 的技能注入暂保持我们的软链方案（幂等，双方去重不冲突）；P2 验证 teamai 注入质量后再决定是否移交。不采用把 vendored 技能搬进 `skills/` 的方案（会破坏 .claude/skills 软链解析和 AGENTS.md 引用链）。

## 4. 分阶段实施

| 阶段 | 内容 | 验收门 |
|------|------|--------|
| **P0 评估验证**（先于一切） | 本机 pin 安装 `teamai-cli@0.22.0`；临时副本仓库跑 `teamai init`；验证：与 CC adapter 组合幂等（先 bootstrap 后 teamai init、反序各跑两遍，settings.json 终态一致）、hooks inject 不破坏用户条目、uninstall 干净 | 装配级实证报告；任何覆盖用户配置即为 NO-GO |
| **P1 兼容层** | `teamai.yaml`（mode: self）+ adapter 生成 `hooks/hooks.yaml` + register-mcps 双产物 + bootstrap `--with-teamai`（pin 0.22.0）+ check 增加产物一致性校验 | check.sh 全绿含新校验；测试钉住双产物 |
| **P2 多 agent GA** | 按 P0 结论决定技能注入归属；补 Codex/Cursor/OpenCode 验证矩阵；hooks deny 语义在非 CC agent 的实际拦截力实测 + 诚实标注 | 至少 2 个非 CC agent 装配验证；能力矩阵如实标注 |
| **P3 Context/Improvement 试点** | `teamai import` 生成 teamwiki 图谱；`recall enable`；share-learnings 摩擦沉淀试点；与 LLMWiki 的知识边界实测 | recall 查询返回带 Sources 锚点；双知识层无写入冲突 |

## 5. 供应链与治理

- **Pin**：`teamai-cli@0.22.0` 写入 bootstrap（与 llmwiki commit / mcp[cli]==1.27.0 同纪律）；升级 = 显式改 pin + P0 复验。
- **ADR-0018**：引入外部基础设施层属不可逆决策，P0 通过后定稿。
- **能力清单**：teamai 不入 mcp-capabilities.yaml（它不是 MCP）；在架构文档新增"分发层"小节如实标注其状态（P0=评估中 / P1=ready）。
- **我们的不变量全部保留**：AGENTS.md 单一入口、供应链禁浮动版本、测试污染红线、装配级验证纪律。

## 6. 未验证项（诚实声明）

- teamai 与我们 CC adapter 的组合幂等性（P0 待实证，双方各自幂等 ≠ 组合幂等）
- hooks exit 2 deny 在 Codex/Cursor 的实际拦截语义
- teamwiki 图谱质量对私有大型 monorepo 的效果（PAV2 实测才知道）
- v0.x 的 API 稳定性（升级成本未知）
