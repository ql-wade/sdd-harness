> 2026-10-20：三方同摘要架构共识已通过，允许分批实施；本文件描述目标，运行启用尚未验收。原92场景与所有权不变。

> 当前修订：用户要求先预研后更新为官方 overlay 优先。隔离预研和兼容审查已完成，见 overlay-integration-design.md；保留原92场景，新增 OV01–OV08。新候选锁通过结构检查不代表独立架构批准，OVR 必须先接纳本次制品；旧锁/旧票已保留为历史，不改当前执行者状态或扩大旧完成勾选。

## Context

现场基线 c42d3ce，OpenSpec 1.3.1，无已有活动变更。既有 ADR-0015 排除编排；历史 Foundation 设计曾评估 TeamAI workflow；本轮用户已确认 TeamAI 只分发、Comet 唯一交付主控候选、目标后默认自动推进。

## Goals / Non-Goals

目标：六环节输入/输出与失败路由明确，状态单写者、证据可信、固定基线、恢复和 CI/CD 闭环。非目标：重造调度器、批量修改技能、首期多服务部署。

## Decisions

采用 [统一设计](../../../docs/architecture/delivery-architecture.md) 与 [ADR-0019](../../../docs/architecture/adr/0019-delivery-foundation.md)。TeamAI 首期只分发，Comet 为唯一交付主控候选，Gate 无 current-stage，Spec Adapter 在 Comet 唯一收尾路径中工作；所选模式和硬门禁接入仍需实证。默认旧 scaffold，实证后显式启用 delivery profile。

当前固定 Classic 路径；方法层先复用官方 comet-five-phase-overlay，design/plan producer 满足原 schema，控制节点只 require/augment；Ponytail advisory。复用原 canonical plan/稳定ID/任务 revision 和 handoff，不重新实现同义协议。原生 completedChecks 可手填且空摘要在隔离预研中被接受，因此不能转为可信回执；来源认证、共同推进谓词、失效/事务/最终完成仍按实证 gap 扩展。精确分工、任务映射和风险见 [overlay 接入设计](overlay-integration-design.md)。

## Risks / Trade-offs

- 上游源码与分发包不一致：固定产物与完整性，真实探针。
- 双 Guard/配置覆盖：正反序装配、用户条目保留、单 reconciler，失败 NO-GO。
- 自评伪造证据：受管 Runner/受保护策略；本机模式明确协作信任限制。
- 状态重复或漂移：唯一 owner、关联 ID、旧 attempt 拒绝、恢复读回。
- 旧技能 controller 活跃：profile 切换需显式停用/接管实证，不能仅改文案。
- Ponytail 与项目 Hook 重复注入、模式串扰或静默失败：分别管理注册、固定方法资产并逐宿主验证实际上下文；模式不作角色授权，方法缺失不能放松 Runtime 门禁。首期 full 是受管 profile 的设计默认，尚未修改插件配置。
- overlay schema 通配路径/字段存在不绑定当前候选：用其他 Change、旧文件、null evidence 和同名 schema 弱化做负例，项目可信 Gate 单独拒绝，不更换原 schema 伪造兼容。

## Breaking Changes

本批仅文档，无 CLI/config/schema 破坏变更。目标 profile 会改变技能调用职责；旧报告经 adapter 兼容，不静默重写。未来 schema 或上游 pin 变化需要显式迁移。

## Migration Plan

Batch 0 文档；Batch 1 固定产物与装配实证；Batch 2 契约/Gate；Batch 3 单任务；Batch 4 CI/CD；Batch 5 团队扩展。详见 tasks.md。启用前保留配置备份和旧入口；停用 profile 不删除历史，外部副作用独立恢复。

## Validation

100 个 Given/When/Then 场景见 specs/delivery-foundation/spec.md，原92项内容/身份保留。分四层报告：内核/夹具、CLI/装配、真实宿主、业务/CI。prestudy 仅证明生成脚本与原协议的隔离观察，不替代 OVQ 资格或产品 PASS。
