---
status: accepted
---

# 三级端到端验证作为发布门禁

SDD Harness 采用三级端到端验证：Core E2E 在隔离临时仓库中通过真实 CLI 与 fake adapters 走完九阶段并阻断每个 PR；Claude Reference Adapter E2E 验证 commands、skills、hooks 与 CLI control plane 的完整契约并阻断主分支；Live Integration E2E 在获准的真实项目上调用实际外部工具，按夜执行且在正式版本发布前必须全绿。能力不适用必须记录 `not-applicable` 及原因，外部工具缺失或未执行不得伪装成通过。

## Consequences

- 当前模块与 CLI 回归测试不能替代任何一级 E2E。
- Codex/OpenCode 从 preview 升为正式支持前必须通过与 Claude reference adapter 对等的 adapter E2E。
- Live Integration E2E 必须隔离测试变更、凭证和部署目标，不能污染真实项目主工作区或生产环境。
