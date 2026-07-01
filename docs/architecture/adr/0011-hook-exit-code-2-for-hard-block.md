## Hook gate 必须用 exit code 2（非 exit 1）—— Claude Code 退出码语义实证

**Status**: Accepted
**Date**: 2026-06-29
**Discovery**: autoresearch hook 实证（通过自动化触发 claude code 验证 hooks）

### Context（背景）

SDD Harness 的 governance 层依赖 5 个 bash hooks，其中两个是 **gate 型**（需要真正阻止 agent 行为）：
- `pre-tool-gate.sh`：阻止在非 code/review 阶段写入 src/
- `stop-gate.sh`：阻止在 gate 未通过时结束 session

两个 hook 原来都用 `exit 1` 表示"拦截"。SUMMARY #13 记录了 `--dangerously-skip-permissions` 绕过 hook 的现象，当时的结论是"用 permissions.allow 替代，hook 唯一 gate"。

### Problem（问题）

通过自动化触发真实 claude code 验证，发现 **exit 1 从未产生过拦截效果**。实证链：

```
probe: pre-tool-gate FIRED                          ← hook 确实触发
probe: tool=Write path=src/probe_test.ts           ← 正确识别工具和路径
probe: stage=grill                                  ← 正确读取阶段
probe: BLOCKING (stage=grill blocking src write)    ← 执行了 exit 1
---
src/probe_test.ts                                   ← 但文件还是创建了！
```

改用 `--allowedTools Write`（permission_mode=default）后同样不拦截，推翻了 SUMMARY #13 "permissions.allow 替代" 的结论。

### Root Cause（根因）

Claude Code 的 PreToolUse hook 退出码是**三档语义**：

| exit code | 含义 | PreToolUse 行为 |
|:-:|------|------|
| 0 | 成功 | 工具继续执行 |
| 1 | 非阻塞错误 | 记录错误并反馈，**但工具仍执行** |
| **2** | **硬性拦截** | 工具调用被中止，stderr 反馈给模型 |

harness 用了 exit 1——它是"报错但不拦截"，工具照样跑。hooks 形同虚设。

`--dangerously-skip-permissions` 绕过的是 **permission prompt**（交互式授权 UI），不绕过 hooks pipeline。hooks 没拦住是因为自己用错了退出码，不是 permission 模式的问题。

### Decision（决策）

Gate 型 hook 的拦截路径改用 `exit 2`，拦截原因输出到 `stderr`（exit 2 的反馈通道）：
- `pre-tool-gate.sh`：src/ 越界写入 → `exit 2`
- `stop-gate.sh`：status=failed → `exit 2`

非 gate 型 hook（session-start / pre-compact / subagent-stop）保持 `exit 0`（它们是提示型，不拦截）。

### Validation（验证）

自动化触发真实 claude code（`claude -p` + PTY）双向验证：
- stage=grill + 写 src/ → `exit 2` 拦截成功，文件未创建 ✅
- stage=code + 写 src/ → `exit 0` 放行，文件创建 ✅
- exit 2 拦截消息正确反馈给 claude（模型看到 "stage=grill 不允许写入"）✅

### Consequences（影响）

SUMMARY #13 的结论需修正：真正的修复不是 "permissions.allow 替代"，而是 "exit 1 → exit 2"。permissions 模式不影响 hook 的 exit 2 拦截力——hook 是独立于 permission 模式的 gate。

harness 的 governance 层从此具备真实的强制力。此前所有声称"hook 拦截了越界写入"的 session 实际上从未被拦住过。
