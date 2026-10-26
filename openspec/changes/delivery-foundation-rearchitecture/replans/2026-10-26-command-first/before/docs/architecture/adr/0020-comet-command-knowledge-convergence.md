# ADR-0020：收敛Command与知识驱动的Comet交付Profile

- 状态：冻结修订已于2026-10-25经独立三方全票批准实施（见[原票与回执](../../../openspec/changes/delivery-foundation-rearchitecture/architecture-review/comet-convergence-r1/receipt.json)）；运行、profile启用及发布仍未验收或授权。
- 适用范围：本仓库可选受管交付profile；不替代基础scaffold定位。

## 背景

原目标是基于Foundation、项目/团队知识和Command门禁完成AI DevOps。后续已选Comet单主控，但出现旧sdd命令、退役Trinity/Superpowers调用、自动迁移技能与新门禁并存；协议测试被用于支撑真实角色链和知识闭环。用户现明确要求清理旧流程，依最新架构实际落地并端到端验证。

## 决定

1. 旧九个业务命令和迁移副本退出当前profile发现/安装/分发，不暗中兼容转发。保存可恢复备份、原始证据和旧Run；用户全局/其它项目资产不属清理范围。
2. 对用户的流程入口统一到原生Comet。保留其原phase/Run/事务；动作绑定只描述方法、输入、输出、权限和门，不生成第二状态机。TeamAI只分发，Runner只执行，Gate只判断。
3. 方法技能原样版本化；产品P只消费计划方法/产物，完整planner控制器仅用于迁移实施。测试作者、Builder、独立Reviewer/Whitebox分离；禁止角色标签和自填pass成为可信结果。
4. LLMWiki是单项目Agent知识，Outline是团队精华知识，deepwiki-open是代码Wiki，CodeGraph可选。OpenSpec持有需求/设计/测试意图/任务；不把整仓源码/所有聊天入团队知识，不继续要求团队正文全部在Git。
5. 知识检索贯穿R/A/实施；已验证经验经审查晋升。必需Kp阻断归档，Kt可归档后同Run恢复并阻断整体完成。权限事件/周期核验由同Comet引擎维护；监控和进程监督不取得业务控制权。
6. 首期仍CLI+固定Runner，按真实需要接通执行驱动；不为健康端口或方法数量新增业务服务。跨机器API继续按原独立范围门，未启用不等于认证通过。
7. 旧通过数不继承。保留原任务/唯一DAG与原92场景、118检查，追加12贯通场景和检查；新基线0通过。错误oracle按原需求修正并重新RED/GREEN，不为保留历史绿色维持错误行为。

## 与原ADR关系

落实ADR-0015/0016的退役入口和方法边界；在ADR-0019允许的可选profile范围内细化实际Command/知识接线。不重新授权双主控或旧九阶段引擎。旧知识/vault/TeamAI外层workflow视图只作历史，已确认的源权限、预授权、R10及G15边界继续适用。

## 验证与回退

详见[收敛架构](../comet-ai-devops-convergence.md)和原Change的唯一tasks/DAG。先隔离目标与全新会话验证发现/注册，再真实角色链、平台、知识、权限与恢复。框架安装/发布评估不代替业务Run验收。失败时停用新profile并保留已发布副作用的恢复义务；只读旧记录不恢复旧流程的执行权。外部发布、告警、平台写及敏感内容仍服从明确授权。
