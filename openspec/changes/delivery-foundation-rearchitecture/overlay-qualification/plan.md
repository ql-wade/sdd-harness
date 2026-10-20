# OVQ 官方生命周期隔离验证执行计划

范围：原 tasks.md 的 OVQ 资格调查。仅创建隔离候选并尝试官方生命周期，不接管原实施控制器，不勾选 OVQ/OV01–OV08，不安装到本仓库或全局宿主，不修改 Runtime。

目标：以固定 Comet 0.4.5、最小 Open required grill-me overlay，检验官方创作、评估、发布、平台分发和真实恢复链能达到哪一步。用户已授权制定计划、实施和验证；隔离项目可逆写入在授权范围内。真实模型运行仅使用本任务可用且已授权的评估配置；不复用其他项目凭据，不伪造 eval/批准票。

测试边界沿用已确认的公开 Comet CLI、实际生成脚本、宿主 hooks 装配及独立状态读回。所有执行结果保留退出码、输出与实际候选摘要；未抵达的步骤标 BLOCKED/NOT_EXECUTED。

| 顺序 | 操作 | 验证条件 |
| --- | --- | --- |
| 1 | 核对固定构建、源方法、Docker/uv/评估入口，冻结本计划 | 来源与当前能力有记录 |
| 2 | creator propose/init；按官方 authoring DAG 派发六个独立创作角色并记录 | 原生方案不 override control；来源真实；无未编写占位 |
| 3 | creator generate；status/next 与 eval collect | 官方脚本/schema/来源/方法产物一致；collect 不算真实 eval |
| 4 | 尝试官方真实 eval 与 publish review、distribute preview | 缺配置或 readiness 时正确阻断；不伪造证据继续发布 |
| 5 | 仅在 readiness 与批准满足时向隔离项目实际分发 | 实际平台配置中 hooks 完整、路径可解析、重复装配一致 |
| 6 | 分发成功后测试缺证据、真实方法产物、合法推进与进程中断恢复 | 原 Run 与 evidence/continuation 一致；不能只读 phase 判断放行 |
| 7 | Whitebox Journey 证据复核、Grill 和报告 | 未执行链保留阻塞，候选/结构通过不冒充验收 |

当前宿主执行本次有界资格调查，串行控制 CLI 状态；作者子角色只返回草稿，按官方 DAG 运行，不持有业务阶段。沿用原总计划的目标与进度源；不创建第二 native goal 或激活指向其他聊天的旧监督器。预计本地创作/资格检查约20分钟；真实模型评估和宿主事件时间取决于可用配置，未知则明确阻塞。

此记录不是第二任务 DAG 或新的架构批准。OVR 与 I02 前置未完成时，本轮仅提供隔离调查证据，不进行受管启用或产品验收。OpenSpec 生命周期守护已实际读取，现有 Change strict 校验通过；完整交付未完成，不归档。
