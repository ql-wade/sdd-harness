# ADR-0019: 在 Foundation 上增加可选交付 Profile

- 状态：架构已采纳，允许分批实施；Batch 1 适配与实际运行启用仍待验收。
- 日期：2026-10-19

> 最新范围：用户确认目标后自动推进、关键决策/阻塞才人工介入；TeamAI 首期只分发。Comet 是唯一交付主控候选；这不等于其模式、扩展方案或硬门禁已通过验收。

## 背景

ADR-0015 有意收缩为 scaffold，无法独自保证产品到发布的状态、恢复、独立验收和可信放行。继续向方法技能添加 controller 会混淆职责。新需求要求六环节闭环，同时保留现有设施。

## 决策提案

1. 基础 scaffold 保留；显式 delivery profile 引入制品依赖、证据和发布契约，不恢复固定九阶段引擎。
2. TeamAI 首期仅分发；Comet 优先验证为唯一交付主控，调度、阶段和恢复不得再由 TeamAI workflow/技能/Gate 重复持有。Classic/Native 只选一条权威执行路径，按 OpenSpec、独立验证、知识硬门禁与恢复实证决定；必要扩展另评审。
3. SDD Gate 只判定契约、证据和审批，不复制 Comet 执行状态。Spec Adapter 独占团队规格收尾；CI/CD 独占合并构建部署事实。
4. 允许最小受控扩展，但禁止第二主控；新增门禁必须接入 Comet 原有 Run/推进/恢复路径，不能仅靠技能提示。Planner、test-authoring、Whitebox 分别负责计划、测试编写、独立验收；确定性运行机制逐步迁出技能，保留全部有效负例。
5. 首期 CLI + 固定受管 Runner（用户已确认），同一 Run 只绑定一份权威状态；Runner 仅驱动 Comet，不另建业务调度器。优先复用既有 CI/执行环境，零新增常驻业务 Server；跨机器需要时再引入一个 Control API，复用数据库/存储/身份能力。
6. 首版需求/设计变更后全部下游证据失效；架构门使用 grill-me 与全票共识，测试设计门独立自动审查。Ponytail 可作方法辅助，不取得调度/放行权。hooks、MCP、技能唯一源与 pin、真实目录、装配验证纪律保持。代码/配置/测试/环境全输入绑定，digest 不等于可信来源。

## 与现行 ADR 的关系

本提案通过后，仅替代 ADR-0015 的“任何模式均不提供工作流”边界：基础层仍不规定流程，delivery profile 使用外部后端。ADR-0012 的旧九阶段 CLI 不复活；ADR-0016 不被替代；ADR-0018 仍须通过组合幂等实证，本提案扩展其候选范围，不将其自动转为 accepted。

2026-10-20 三方同摘要独立共识已通过，机械回执见 OpenSpec architecture-review/receipt.json。仅在本 ADR 明确替代范围内允许 delivery profile 接入 Comet；基础 scaffold 继续保留。架构批准与适配实证分别记录，不能将批准当作运行通过。

## 结果、风险和回退

### 2026-10-20 官方能力复用修订候选

用户要求先预研后更新。隔离预研支持官方 five-phase overlay 作为原 Classic 上的方法/产物合同层；原生 canonical plan 与 handoff 优先复用。原92场景保留，新增 OV01–OV08 验证来源、产物归属、不可绕过、漂移/恢复和宿主装配；具体设计与证据见 [overlay 接入设计](../../../openspec/changes/delivery-foundation-rearchitecture/overlay-integration-design.md)。

本修订保持单主控与既有权威边界，不授权 workflow-kernel/独立 Engine Run 嵌套。原架构采纳状态仅对应原冻结基线；新增 OVR 复审本次制品，未通过前不能据旧票启用新组合。overlay 原生标记可手工记录且预研中被生成 Guard 接受，不能据其 PASS 签发可信团队回执。Runtime 补丁范围按实证 gap 缩小，不预先自研方法生成器或任务映射协议。

新增契约与适配器维护成本；上游接口、宿主 Guard、发布身份、完整快照仍待验证。兼容失败不接管配置；后端缺扩展点不伪造集成。保留旧 CLI 与配置回退；真实发布副作用按回执恢复。

权威设计：[delivery-architecture.md](../delivery-architecture.md)。实施与验收：[OpenSpec](../../../openspec/changes/delivery-foundation-rearchitecture/tasks.md)。
