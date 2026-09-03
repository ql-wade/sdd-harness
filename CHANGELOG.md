# AI Coding Scaffold Changelog

## 0.2.1 (2026-09-03)

### Repositioned（ADR-0015）
- **v0.2.0**：项目从 SDD Harness 9-stage 工作流重定位为团队 AI coding scaffold（mono 平铺模板）。9-stage 编排、stage skills、live-e2e 删除；AGENTS.md 约定层、`.agents/skills/` vendoring、hooks 控制平面、MCP 能力清单、openspec 引导落地；lib/ gate-audit 验证库与回归测试全量保留。

### Fixed（共识评审 run1/run2：BLOCKED → 修复）
- **F-HOOKS-001（BLOCKER）**：CC adapter 只编译第一个 PreToolUse deny matcher，dangerous-command-blocklist 对 Bash 永不生效（死代码）。改为全部 deny matcher 并集 + 编译期断言 + 装配级回归测试。
- **供应链 pin**：npx/@latest、llmwiki HEAD clone、pip mcp 浮动 → 全部固定（`MCP_PINS` + commit `075c5b4` + `mcp[cli]==1.27.0`）；`.mcp.json` 重新生成。
- **fail closed**：pre-tool-gate 在 python3 缺失或 hook 输入 JSON 不可解析时拦截（exit 2），不再静默放行。
- **可移植性（F-002/F-003）**：vendored 技能从机器特定软链改为真实拷贝（skill-check 新增 symlink 断言）；adapter 技能软链目标从 `../.agents`（断链）修正为 `../../.agents` 并加解析断言。
- **合并语义（F-HOOKS-002）**：adapter 对用户已有 hook 条目合并且去重，不再整体覆盖；回归测试带 finally 状态恢复。
- 清除 stage 遗留 `.sdd/hooks` 注册与 `.claude/skills` 内 sdd-*/trinity-* 遗留目录；opendeepwiki 以 degraded（user-local）入清单恢复单一真相源；whitebox-verify 校验器路径改仓库相对。

## 0.1.1 (2026-06-29)

### Fixed
- **ptyClaude 进程执行架构重写**：用 macOS `script` 分配真 PTY（修复 claude -p 在非 TTY 下 hang 不退出的 bug）+ `detached` 进程组 + `process.kill(-pid)` 整组清理（修复 SIGKILL 只杀 bash 导致 claude 成孤儿进程的 bug）
- **Hook gate 退出码修复（架构级 bug）**：pre-tool-gate.sh 和 stop-gate.sh 的拦截路径从 `exit 1` 改为 `exit 2`。Claude Code 的退出码语义：exit 1 = 非阻塞（工具照跑），exit 2 = 硬性拦截。原版 exit 1 导致 governance 层形同虚设，src/ 越界写入从未被真正拦住。拦截原因改走 stderr。
- **fill code cfgPrompt 跨语言优化**：从 JS 中心主义（硬编码 package.json）改为按语言区分 manifest 约定（JS/TS → package.json，Python → pyproject.toml 完整结构，其他语言按惯例）

### Added
- `.autoresearch/` 工具链：goal-state.json（验收锚点）、run-cycle.mjs（PTY 执行引擎）、validation/ 三项目类型测试集、results.jsonl 循环历史、best_prompt.txt
- ADR-0011：Hook gate 必须用 exit code 2（含完整实证链 + 根因分析）

### Validated
- autoresearch 优化：baseline 17/18 → 18/18（跨 Three.js/Python/React 三项目类型）
- ptyClaude 修复验证：exit=0, timedOut=false, 孤儿进程 0→0, 文件正确落地
- Hook 修复验证：自动化触发真实 claude code，exit 2 双向验证（grill 拦截 ✅ / code 放行 ✅）
- MiniCraft 回归：18/18 tests, build exit 0, 0 孤儿进程

## 0.1.0 (2026-06-26)
- Fork from sdd-cli, rebrand to SDD Harness
- 9-stage workflow: grill→product→dev→test→code→review→verify→release→archive
- sdd-harness shared skill + 9 stage skills
- 5 MVP hooks (SessionStart/PreToolUse/Stop/PreCompact/SubagentStop)
- Real dependency init: openspec CLI, open-code-review, LLMWiki MCP, Understand-Anything
- LLMWiki knowledge closed-loop (MCP verified working)
- Governance: hooks + 9 gates + artifact ownership
- Discovery routing + steering docs (borrowed from cc-sdd)
