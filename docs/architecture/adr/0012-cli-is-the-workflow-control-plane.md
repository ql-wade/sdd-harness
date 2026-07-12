---
status: accepted
---

# CLI 是唯一的 workflow control plane

SDD Harness 以 `sdd` CLI 作为唯一有权创建或恢复 run、执行最终 gate、以及修改 `workflow-frame` stage/history/status 的控制面。Claude Code、Codex、OpenCode 的 commands、skills 和 agent adapters 负责调用外部工具、生产 artifacts 并向 CLI 请求转换；hooks 只负责阻断与记录。这样牺牲了 skill 直接推进状态的便利，换取跨平台一致性、单一状态机和可审计的确定性 gate。

## Considered Options

- 由各平台 skill 直接推进 stage：实现直接，但会形成多套状态机和不一致的证据语义。
- CLI 与 skill 都能推进 stage：局部灵活，但存在重复执行、竞态和绕过 gate 的风险。
