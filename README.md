# AI Coding Scaffold

> 交付架构迁移设计已进入仓库：[新架构](docs/architecture/delivery-architecture.md) · [ADR-0019 提案](docs/architecture/adr/0019-delivery-foundation.md) · [分批实施与验收](openspec/changes/delivery-foundation-rearchitecture/tasks.md)。目标为 Foundation（TeamAI 仅分发）+ Comet 唯一主控候选 + 检查器 + CI/CD；当前运行仍为下述 scaffold，新增能力尚未实现。

团队 AI coding 项目的脚手架：**统一规则入口 + 方法论技能 + hooks 控制平面 + MCP 能力清单 + 验证工具**。

不规定工作流——阶段划分、任务编排、模型选择由执行 agent 和团队自定。scaffold 只提供设施和方法论（[ADR-0015](docs/architecture/adr/0015-scaffold-repositioning.md)）。

## 分层

```text
约定层   AGENTS.md（单一规则入口；CLAUDE.md 软链兼容）
协作层   docs/agent/（技能触发矩阵、任务交接模板）
技能层   .agents/skills/（vendored 版本化快照）
控制层   hooks.yaml → adapter → agent 原生 hooks（约束 + 触发）
工具层   mcp-capabilities.yaml + .mcp.json（诚实能力清单）
工件层   openspec/ + docs/architecture/adr/
验证层   lib/ gate/audit 程序化验证 + scripts/check.sh
```

详见 [docs/architecture/scaffold-architecture.md](docs/architecture/scaffold-architecture.md)；交付生命周期视角（角色×环节×能力）见 [ai-devops-architecture.md](docs/architecture/ai-devops-architecture.md)；知识闭环架构（生产×消费×桥）见 [knowledge-architecture.md](docs/architecture/knowledge-architecture.md)。

## 快速开始

```bash
git clone <本仓库> my-project && cd my-project
bash tools/bootstrap.sh                # hooks 落地 + skills 注入 + MCP 注册
bash tools/bootstrap.sh --with-llmwiki # 额外安装 LLMWiki MCP（python venv）
```

然后：

1. 填 `AGENTS.md` 和 `openspec/project.md` 的 `TODO(team)` 内容
2. `bash scripts/check.sh` 确认骨架完整
3. 重启 Claude Code 会话，hooks/skills 生效

## 技能（基础层）

| 技能 | 职责 |
|------|------|
| grill-me + grilling | 前置事实质询（一次一问、推荐答案、消除歧义） |
| whitebox-verify | 三模式验证（调试 / Journey 验收 / Slice TDD） |
| claude-parallel-tdd-planner | 并行计划协议（DAG / RED-GREEN ledger） |
| multi-agent-consensus-review | 三方全票共识评审（unanimous gate + evidence-based debate） |

触发矩阵：[docs/agent/skill-architecture.md](docs/agent/skill-architecture.md)。技能以版本化快照 vendor 在 `.agents/skills/`，项目约束不改技能正文。

## 验证工具（lib/ 机械证据层）

```bash
node bin/cli.js test-gate --project . --evidence-dir .sdd/evidence   # 跑测试 + sha256 证据
node bin/cli.js probe --project . --evidence evidence.json           # probe 证据校验
node bin/cli.js generation-capture --project . --out before.json     # 测试清单（生成前）
node bin/cli.js generation-evaluate --project . --before before.json # 测试编写完整性
node bin/cli.js deliverable-audit --project . --run <id>             # 交付物审计
node bin/cli.js evidence-audit --project . --change <id>             # 证据审计
node bin/cli.js workflow-audit --project . --run <id>                # 运行状态审计
node bin/cli.js wiki init                                            # LLMWiki 骨架 + raw/ 复制
node bin/cli.js doctor                                               # 环境自检
```

退出码契约：`0` 通过，`1` 输入无效，`2` 验证不通过。

## MCP 能力清单（诚实标注）

| MCP | status | 说明 |
|-----|--------|------|
| chrome-devtools | ready | 浏览器调试 / trace（whitebox-verify 调试模式依赖） |
| playwright | ready | 浏览器自动化 |
| github | degraded | 需 `GITHUB_TOKEN`，未配置时降级 |
| llmwiki | ready | 知识库（需 venv；`bootstrap --with-llmwiki`） |

唯一事实源：[mcp-capabilities.yaml](mcp-capabilities.yaml)。`planned` 状态的 MCP 禁止被文档当作可用。

## Hooks 控制平面

策略定义一次（[hooks.yaml](hooks.yaml)），adapter 落地：

- `kb-write-protection` — 禁止直接写 `llmwiki/wiki/`（绕过索引），必须走 MCP
- `dangerous-command-blocklist` — `git push --force` / `git reset --hard` / `rm -rf /` 等禁入
- `session-context-injection` — SessionStart 注入规则入口 + ADR 索引
- `stop-sediment-reminder` — Stop 时提醒未沉淀的 findings/ADR

新增 agent 支持 = 写一个 `tools/adapters/<agent>.sh`；首日只实现 Claude Code。

## 开发（本仓库自身）

```bash
npm install
npm test               # gate/audit 回归套件
bash scripts/check.sh  # 总检查（规则层 + 技能层 + 回归 + YAML/JSON）
```
