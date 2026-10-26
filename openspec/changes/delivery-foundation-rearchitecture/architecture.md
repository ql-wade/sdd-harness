# 当前实施证据与接口登记（command-first）

本文件登记同一design/ADR-0021，不是第二设计权威。旧登记/接口/假设已在replans/2026-10-26-command-first/before/保存。当前新修订仅规划，Goal仍暂停。

## 证据现实矩阵

| 声明 | 当前事实来源 | 结论 |
| --- | --- | --- |
| 六角色Docker是现成执行链 | infra/delivery/runner/compose.yaml声明六服务；此前只读观察旧容器全部exit1，旧镜像非最新候选 | 文档/配置有，运行未证明；本修订从默认路线退休 |
| Host可完整驱动真实作者 | lib/adapters/comet-executor.js仍返回authoring UNVERIFIED，按gate单角色注册 | 代码证明接线缺口，P1_3返工，不以自建RPC补齐 |
| 知识链已完成 | worker-reports/P2_4-knowledge-R3-handoff/R3-PROGRESS.md | 机械CODE局部证明；最后2通过2失败，不是真实MCP/角色资格 |
| Runner构建可复用 | worker-reports/Root-I02-full-runner-build/REPORT.md | 构建/工具链读回已证明；旧SDK/bootstrap，不认证新流程，也不是新前置 |
| 当前代码已经回归全绿 | worker-reports/Root-P1_3-host-components-integration/REPORT.md | 最新未插桩1161/1164，3失败；诊断1164全绿不可覆盖 |
| 已有预授权与知识可随意写 | I01/I03及旧一次只读/共识记录 | 不成立；已消耗许可不复用，真实发布/隔离/owner权限仍须核验 |

## 原任务接口与公开测试边界

- Comet原Run/phase/锁/事务与Guard；覆盖正常命令、直接transition、next/resume、适用hook、archive/completed，不建阶段账本。
- 基线/测试/证据/Gate公共接口及薄CLI；保留真实执行分母、输入类别、当前版本、独立审查、单调失效。
- Host.Execution.v2 / Host.RoleBoundary.v2：原宿主实际会话与技能/工具、只读/路径范围、真实事件引用和保护CI/连接器；不是六OS主体或角色容器。
- OpenSpec与真实知识MCP/API的公开接口；Kp→原生归档→Kt同Run恢复、实际索引/版本/受众读回。
- 必要平台与维护/备份恢复；已有调度只触发原Comet，不成为重试或phase owner。

精确声明统一在drift-lock.json及各任务Interfaces字段；原有纯函数/CLI/fixture只证明原范围。不能修改vendored技能正文来塞入项目控制，也不增加新phase Skill薄壳。

## 实施取舍

先证实原生命令在当前宿主能调用实际技能/独立Agent、门禁确实阻断；再补原Comet确有缺口的最小扩展。原SDK源码pin与安全补丁可以按适用范围复用，不要求重新构建一个运行平台。基础设施按I01/I03–I08接真实需要，I02只退休过度部署并约束可选临时作业。

P3_2首个真实R→V切片不等待六容器/I02完整镜像、Outline/代码Wiki全部就绪。正式知识与最终平台/权限/恢复义务在各原任务及VERIFY关闭，不能因此缩减129/103。字段、文件或工具实际缺失时如实阻断，不发明已存在API。

## 假设与待证

- 0.4.5固定版本是可复用基线，不是所有宿主插件已正确安装的证明：P1_1/P1_2验证。
- 原生宿主可提供所需真实工具权限、独立会话和事件：P1_3/P5_1实测；不能证实则标该宿主不支持，不构造六服务替代。
- 必要Outline/LLMWiki/deepwiki及平台资源/owner可用：各域实测，旧healthy/管理员可读不充抵。
- 当前文档修订未执行清理、真实模型/知识操作、故障注入或最终验收；所有新检查保持未验证。

## 当前权威源摘要

- `docs/architecture/comet-ai-devops-convergence.md` SHA256 `0e5ff079c4ff6d1b447a7866ef31c2aa024fc0c84a57634eae841d726d155049`
- `docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md` SHA256 `eab105e6f356215709fa798164332d935357863ba45bab82cf14dfca5c69d1a9`

## 修订 2026-10-26-comet-050-adoption-v1

依据ADR-0022（Proposed）：基线升级Comet 0.5.0；门禁实现由0.4.5补丁链（0001/0002）改为官方classic-full组合应用——replacements承载Matt方法技能、extensions落R/A/T/P/V/Kp检查点并经bindings.mjs委托lib/delivery纯组件；0004随上游安全修复删除；0003由最小后继补丁0005（Kt完成谓词，B1）接替。并行执行启用：宿主并发子代理派发已实测、worker独立worktree、同波所有权无重叠；串行仅P3_2/P4_2/P4_8/P5_1/VERIFY。P0_1–P0_4与P2_1接纳原样保留，P3_1完成待提交，P1_1重开做0.5.0资格重验。本修订为计划层，未实施、未激活goal。
