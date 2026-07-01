# SDD Harness Changelog

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
