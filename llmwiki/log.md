# Log

## [init] LLMWiki 实例初始化

## [writeback] 2026-06-29 — autoresearch 试跑闭环

verify 阶段产出的两个架构级发现 writeback 回知识库，闭环 knowledge→spec→code→test→verify→knowledge：
- engineering/sdd-harness/code-notes/claude-p-no-tty-hang.md（ptyClaude 非 TTY hang + 孤儿进程）
- engineering/sdd-harness/code-notes/hook-exit-code-semantics.md（hook exit 1 vs exit 2）
- engineering/sdd-harness/adr/ADR-0011-hook-exit-code-2.md（决策知识视角）
同步修复 archive gate 路径不一致（llmwiki/engineering → llmwiki/wiki/engineering）。

## [ingest] 2026-06-29 — 三个 raw source 提炼为 source 摘要

raw → knowledge 的提炼真正发生（此前只有 raw 文件 + 下游条目，缺中间的 sources 摘要层）：
- sources/minicraft-probe-steering.md → 支撑 product/REQ + testing/TC；识别与 Wikipedia 原版的命名矛盾
- sources/minicraft-original-wikipedia.md → 澄清命名溯源（同名不同物）
- sources/claude-code-hooks-and-cli.md → 支撑 engineering 两条 code-note + ADR-0011

ingest 关键发现：minicraft-probe 与 minicraft-original 同名但不同形态（3D 第一人称 vs 2D 俯视），产品知识里已显式澄清。
