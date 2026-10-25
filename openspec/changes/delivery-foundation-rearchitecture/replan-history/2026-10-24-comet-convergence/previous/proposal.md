## Why

现有 scaffold 有方法和机械检查，但不能保证产品到发布的状态恢复、独立验收及可信放行。需要迁移已形成的六环节与 Foundation 方案，并消除多 controller 和文档冲突。

## What Changes

- 增加 ADR-0019、统一交付架构、共享契约与逐批验收计划。
- 目标采用 Foundation（TeamAI 仅分发）+ Comet 唯一主控候选 + 无调度权检查器 + 受保护 CI/CD。
- 保留基础 scaffold；架构评审通过后按批实施契约、源码补丁、接入与独立验收，以实证启用 delivery profile。

## Options

1. 叠加技能：成本低但无法解决可信状态。
2. 全量 Comet：开发复用多，但六环节与发布不足。
3. 分层组合（推荐）：复用设施，明确单一所有权，增加契约/适配成本。

## Non-goals

不恢复九阶段 CLI，不改全局技能，不手改 vendored 正文；必要快照显式升级，不立即部署 API，不引入模型路由、MQ、中央浏览器池，不修改生产流水线。

## Success Metrics

设计 strict 校验通过；92 项场景可追踪（原 40 项、Classic 接入 8 项、运行时门禁 8 项、架构方法与关闭 6 项、归档恢复 9 项、发布授权 8 项、权限维护 11 项、方法迁移 2 项）；实际启用必须通过组合幂等、单任务闭环、真实平台阻断与独立读回；未运行项保持未完成。

## Capabilities

### New Capabilities
- `delivery-foundation`: 六环节、所有权、可信证据、恢复、收尾和平台门禁。

### Modified Capabilities

无；基础 scaffold 兼容保留。

## Impact

入口文档、ADR、架构视图、OpenSpec及分批运行实现。用户已授权实施与验证；触及 contracts/lib/adapters/hooks/CI 和 Comet 源补丁时逐批实证，未通过项保持未完成。
