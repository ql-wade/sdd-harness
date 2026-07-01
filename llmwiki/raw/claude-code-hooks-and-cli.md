# Claude Code hooks 退出码语义 + CLI 行为（外部文档）

> Raw source：Claude Code 官方 hooks 文档 + 检索验证（code.claude.com/docs/en/hooks 等）。
> 这是两条 engineering code-note 的 raw 根源。

## Hooks 退出码三档语义

PreToolUse hook 的退出码不是 Unix 通行语义，是 Claude Code 自己的三档：

| exit code | 含义 | PreToolUse 行为 |
|:-:|------|------|
| 0 | 成功 | 工具继续执行 |
| 1 | 非阻塞错误 | 记录并反馈，**但工具仍执行** |
| 2 | 硬性拦截 | 工具调用中止，stderr 反馈给模型 |

关键：拦截原因必须输出到 stderr（exit 2 的反馈通道）。

## --dangerously-skip-permissions 与 hooks 的关系

该 flag 绕过的是**交互式授权 UI**（permission prompt），不绕过 hooks pipeline。
hooks 在 permission 步骤之前执行，exit 2 的拦截力独立于 permission 模式。
bypassPermissions 影响授权 UI，不影响 hook 的 exit 2。

## claude -p 的终端依赖

`claude -p --bare` 在非 TTY（非交互、管道）环境下行为异常：写完任务后进程不主动退出，
会 hang 等待终端输入。必须分配真 PTY（如 script /dev/null）才能正常退出。

来源：code.claude.com/docs/en/hooks, code.claude.com/docs/en/agent-sdk/hooks
