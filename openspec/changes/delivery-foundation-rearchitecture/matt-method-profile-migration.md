# Matt 方法迁移核对与 Comet 显式选择

日期：2026-10-19。状态：当前本机读回 + 目标接入约束，未实施项目技能升级。

## 1. 已读取的证据

已通过 read_thread 读取用户指定聊天 01a152e7-3253-7403-89ee-0c64f856345d 的最新 5 回合，包含 Superpowers 备份停用、Matt 升级与最新进行中的多代理/20分钟监督/Journey 请求；只取相关事实，不把聊天助手结论当未经核验的现行命令。

另读取其停用/验证报告与当前本机工程路由；本轮核对标准发现目录的 brainstorming/writing-plans/test-driven-development/systematic-debugging/executing-plans/subagent-driven-development/verification-before-completion 不存在，Claude 对应插件 enabled=false，Matt tdd/diagnosing-bugs/code-review/grilling 发现链接与正文可读。

因此可确认本轮抽查与“已备份停用，默认 Matt 基础能力”的迁移状态一致；不是永久删除全部上游源，也不是本轮重新原生扫描 27/27。该聊天的长期多代理、20分钟监督与完整 Journey 当时仍在执行，不能据此报全链验收完成。

## 2. 当前本机默认与本项目明确目标

默认普通实现使用 Matt tdd/diagnosing-bugs/code-review；默认并行交付可由本地 planner 控制。Wayfinder/implement/implement-spec 等用户专用控制器不能因安装或引用而自动启动。

本项目用户已明确选择 Comet 作为唯一交付主控候选。这个目标不因本机默认路由改变而悄悄切回 planner；planner 完整 controller 的 DAG/监督/归档合同不能与 Comet 叠加。可复用其数据契约/校验工具或经显式提供的方法导出入口，不加载完整 controller 后靠提示忽略它自己的合同。

目标记录应保持 controller=Comet Classic、implementation_method=Matt primitives、spec_source=OpenSpec、plan_source=唯一 tasks/DAG、progress_source=同一 Comet Run、acceptance_authority=Whitebox/受控 Gate（字段名仅表示语义，不是现成配置）。规划方法不另激活目标/监控/归档循环。

## 3. 项目尚未迁移的真实缺口

- 本仓库 vendored planner 仍硬调用 superpowers:writing-plans；共享源新版已去掉该依赖，两者不是同版本。按仓库真实快照/显式升级纪律处理，不直接改 vendored 正文或将机器软链提交。
- Comet Classic 0.4.5 原生 Skill 与初始化集成还包含 Superpowers 方法/安装路径。不能在接入时自动重新安装、启用或调用被用户停用的技能。必须在最小受控扩展范围中替换方法调用和初始化选择，并实际验证新会话轨迹。
- 旧 docs/superpowers 或 classic-superpowers-root 名字可以作为受控兼容路径，不等于允许执行 Superpowers；目标工件单一权威与路径迁移另验，不只做字符串全局替换。
- tdd→Matt tdd，排障→Matt diagnosing-bugs，普通代码审查→Matt code-review。test-authoring、Whitebox、grill-me/适用 grilling、architecture-grill、consensus 等专门方法保留其职责，不因“用 Matt”被抹掉。
- 架构仍按用户指定 grill-me + 全票共识；测试设计独立自动审查。Matt 用户入口策略继续保留，不隐式调用 to-spec/to-tickets/Wayfinder/implement-spec 作为替代控制器。
- test-authoring/Whitebox 中 Superpowers 方法来源链接是归属引用，不是运行依赖，不为停用删除学术/方法来源。

## 4. 本轮未做

没有修改全局技能/插件、重新启用 Superpowers、运行 Matt 开发 controller、分发项目新快照或启动 Comet。后续验收要分别证明发现/安装、真实方法读取、单主控无重复 DAG、测试作者与独立验收、完整交付与恢复，不能把引用聊天里的小任务通过泛化为本架构通过。
