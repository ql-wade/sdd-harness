# Classic 归档后知识收尾、恢复与重复触发

日期：2026-10-19。状态：最小受控扩展设计，未实施。

## 0. 已确认关闭边界

R06 已确认：必需 LLMWiki 未闭合阻断 Verify→Archive；必需 Outline 未发布允许规格归档成功，但整体交付保持未完成。目标后默认自动推进，原授权有效时不重复询问。TeamAI 与 Ponytail 不拥有派发/推进权，Comet 是唯一主控候选。

基线仍为实际 npm @rpamis/comet@0.4.5 / c90af44，不把下文新 step、operation 字段或动作冒充原生接口。

## 1. 原生已有通道与确切缺口

- classic-archive.js 已能找到从 active 移到 archive 的 Change，保留 Run/状态/工件引用，并对部分中断做恢复；但约 410–454 行会写 status=completed 并清 pending。
- classic-resolver.js:50–56 见 archived=true 直接返回 completed，未检查知识义务。
- classic-recovery.js 在 phase=archive 且 archived 时已选择 delivery 恢复，而非要求再次 archive；这条通道可复用。
- classic-resume-probe.js 的 discoverPendingArchivedChanges 已扫描归档目录，但以 Git delivery 的 complete/local-verified 排除完成项；知识未完成而 Git 已完成的 Run 当前会漏掉。
- classic-current-change.js 的 validateSelectableChange 同样允许部分 pending archived delivery，但 Git 交付完成即不能按该分支选择；需按聚合 closeout 而非单一 Git 状态判断。
- 原生 RunStatus 为 running/waiting/completed/failed；无需发明外部控制器或先引入新顶层 status 枚举。知识阻塞可用 waiting 加结构化原因，实际迁移仍需测试。

## 2. 归档成功后保留同一个 Run

目标投影示例（step 名为拟议扩展）：

```text
phase = archive
archived = true
run_id = 原 run_id
run.status = running 或 waiting
current_step = full.archive.knowledge-publish / reconcile / finalize
```

OpenSpec 正文和归档规格不因知识补发重新打开/重写；后续只在该 Run 的允许范围追加操作记录/回执。规格归档回执与知识/平台回执分别保留。当前归档完成只清理 archive 自己的 pending intent，不无条件清空其他收尾或宣布 Run 完成。

保持 stable project_id/run_id，而不是用会变化的目录位置、日期、Session ID 作为任务身份。归档迁移后每次操作重新解析位置并检查 run_id；已有路径解析与 archive pointer 重定位优先复用。发生迁移中间态或同名多归档歧义时阻断/恢复，不能随便挑最新目录。

可选的 Run 定位索引只能由 Comet 维护且可重建；它保存位置指针，不保存另一套业务阶段/完成状态。状态权威仍为原 Run 与其事务/工件记录。

### 单一权威执行环境（R01 已确认 A）

同一个 run 必须绑定唯一 authority/store/受管执行环境。文件锁和 operation_key 只能约束共享同一权威状态的调用者；把 Run 复制到另一台机器各自恢复，不能因此获得全局去重保证。用户已确认首期固定受管 Runner，每个 Run 绑定其权威状态；其他宿主只查询或向该权威环境请求动作；没有远程接入能力时提示回原环境，不在本机克隆后独立继续。

authority 身份与可信状态由运行环境配置和 Comet 校验，不以客户端自填 host/session 标签获得执行权。Runner 只承载/驱动 Comet，没有自己的业务 current-stage。迁移执行环境需停旧写者、调和 pending、转移完整 Run 并验证新归属；不把复制目录或 lease 超时当完成迁移。

## 3. 恢复动作按事实选择

| 当前事实 | Comet 的唯一下一动作 |
| --- | --- |
| archive 操作仍 pending，规格结果未核对 | 恢复原规格事务并读回，不能先发布依赖最终规格的知识 |
| 规格归档成功，无团队晋升义务或有有效 no-op 结果 | 检查其他交付义务后 finalize |
| 需要 Outline 发布但审批/分享授权缺失 | waiting-approval，保留对象与内容摘要；不重做 archive |
| 有批准且无发布 operation | 原子登记唯一 publish intent，再启动受控写执行 |
| 发布 operation 在运行 | 返回原 operation；其他会话只观察，不再次启动 |
| 远端结果未知 | reconcile 原目标，保持 waiting；不能直接生成新 ID 重发 |
| 已发布且独立读回有效 | 接纳知识回执，进入下一收尾动作 |
| 全部必需义务当前有效 | 同一 Run 原子转 completed，再允许安全清理 |

自动恢复读取相同的聚合完成谓词；不能因 phase=archive 无条件要求人重新选归档。审批范围/目标内容发生变化才需要新的决定。多个可恢复 Run 且没有显式任务绑定时才询问目标，hook 不替用户猜。

## 4. 两层去重，都由 Comet 持有

### 4.1 本地派发去重

- 评审 job_key：project_id + run_id + gate_id + 审查包 digest + policy digest。普通 SessionStart/compact/SubagentStart 不改变 key。
- 发布 operation_key：project_id + run_id + 逻辑知识条目 ID + 批准内容 digest + 目标知识空间/文档身份。重试 attempt 不是新业务 operation。
- Comet 在自己的锁/事务内做 create-if-absent/reserve；相同 key 已完成且仍有效就引用结果，已在运行就返回现状，未知就恢复原操作。不能“先发请求，再补记 key”。
- 每次实际执行有 owner/attempt/epoch，接纳结果校验当前归属与输入。超时不等于旧进程停止；接管前检查实际执行，未确定终止则不重复派发。旧回调不能覆盖新 attempt。
- 需求/设计变化后旧票与下游回执失效，新输入创建新 job key；旧作业历史不删除，也不能把旧 manifest 的 digest 改成新设计继续使用旧票。

这些记录在既有 Run/trajectory/pending/artifacts 中，不在 Ponytail flag、单独 hook 状态文件或新的数据库中建立另一套任务状态。

### 4.2 远端写入收敛

当前官方 Outline OpenAPI 声明 documents.create 可接受客户端 UUID，documents.update 可提供 lastRevision，并在 revision 不匹配时拒绝为 409。仅文档核对，具体部署和原生 MCP 是否暴露这些字段尚待实测；观察摘要见 outline-public-api-observation.json。

建议发布协议：

1. 内容先提炼、批准并冻结；Comet 记录预期 payload、目标集合/父节点、允许身份、source/approval 与稳定 document_id，再发网络请求。
2. 新知识的 document_id 在第一次请求前分配并持久化，必要时由 project + 逻辑 knowledge_id + 目标空间确定性派生。与 operation_key 区分：同一知识条目的新修订应更新同一个文档，不因 run/attempt/时间戳改变而新建一页。
3. 超时或崩溃后，按确定 ID 调 documents.info；核对来源身份、集合/受众、内容、发布状态和 revision，匹配则形成读回依据；不能把 403/网络错误当成“文档不存在”。
4. 确认不存在时才用同一 document_id create。并发返回“已存在”后读回该 ID；UUID 唯一/冲突和超时行为必须在部署版本负例中证明，不只相信本地去重。
5. 更新前读取 lastRevision，并随更新提交原值。冲突后重新读回：预期结果已存在则接纳，否则保留冲突待处理，不能刷新 revision 后盲目覆盖他人编辑。
6. API/MCP 响应成功不等于知识门通过。独立授权观察器读回实际内容、版本、集合/发布状态与授权范围，Runtime 才接纳 Kt。

如果原生 MCP 工具没有这些必要参数，则用同一受管身份的薄 MCP/API 适配暴露它们；不能省掉幂等/并发条件，也不另建知识服务或调度器。内容摘要须基于明确的可复现规范化，不能由模型说“语义一样”就认可。

目标是一个逻辑文档和可恢复操作；不宣称 HTTP 跨系统 exactly-once。旧执行已发出的网络请求不能仅因本地 epoch 撤销就被收回；输入变化/取消后要保留 in-flight/unknown 并调和实际远端结果，不能把新版本误标完成。尚未验证的远端防护必须显式记录，不以本地锁替代。

## 5. Ponytail Hook 重复触发的处理

原 Ponytail hook 保持方法上下文/模式功能，不调用共识派发、Outline 写入或 Classic phase 转换。若需要项目 session/resume 辅助 hook，它最多只读请求 Comet 的当前动作并给 Agent 方法引用；查询不能领取执行 lease 或启动 side effect。

Agent/Runner 真要执行动作时，回到 Comet 的 reserve/execute/accept 路径。即使两个窗口同时看到了同一 continuation，也只能由 Comet 原子登记的 owner 执行。重复 hook 不生成新 review/publish key，不创建定时器或私有重试队列。

共享 Ponytail mode、Hook event id、Session ID 都不是交付身份。缺 hook、静默失败或未注入规则不改变 hard gate，Comet 的共同前置条件仍阻断；不向 Ponytail 插件缓存添加业务策略。

共识作业内部使用自己的有限轮 ballot/manifest，但业务 job_key/派发/接纳与修复预算归 Comet。丢失会话时恢复已有 review run 或报告其未知状态，不能因重复 SessionStart 再冷启动同一制品的整组三方评审。

## 6. 原生模块的最小改动面

| 原生模块 | 改动责任 |
| --- | --- |
| classic-archive / transitions | archive 只确认规格事实；只完成自身 pending，不提前完成整个 Run；已归档重入不再执行 OpenSpec archive |
| classic-resolver + classic-runtime-run | 注册同 Run 的授权知识发布/调和/finalize 动作；聚合必需义务后才 completed，缺失 step 不以 done 兜底 |
| classic-recovery | 恢复原 operation 与输入/授权/目标绑定，避免再次 archive、重新选择交付方式或重复写知识 |
| classic-resume-probe + current-change | 复用并扩展 pending archived delivery 发现/选择：即使 Git 已完成，只要知识/平台义务 pending 仍可找回；已授权收尾自动恢复 |
| classic-paths / archive-pointer / workspace binding | active→archive 路径重定位保持 run_id；歧义/迁移中断不得错绑另一任务 |
| classic-store + engine state/run-store/types | 存储/恢复 job_key、operation、owner/attempt/epoch、输入与回执；沿用同一锁/事务，不建并行账本 |
| classic-progress / evidence / diagnostics / 输出与 Dashboard | Git delivery、spec-archived、knowledge-published、整体完成分别展示，共用一个完成谓词 |
| classic-hook-guard + project hook adapter | archived-pending 只允许本次授权收尾动作；源码/规格正文继续受保护；装配 matcher 与用户条目保留 |
| 新的 Outline/共识薄适配模块 | 只执行 Comet 已登记动作、返回真实远端/评审结果；不能决定业务下一阶段 |

这是预期相关改动面，不表示每个模块都要新造抽象。实施前应以调用关系缩到最少共享函数，并覆盖旧 CLI/恢复/归档回归。没有稳定插件入口时按已批准的最小受控 Runtime 扩展处理，不直接修改 vendored 技能或插件缓存。

## 7. 工作区清理与保留（R10 A 已确认）

恢复依赖仍可找到 Run 状态、批准内容、原始 manifest/operation 与回执。不能因规格已归档/Git 已交付就删除唯一工作区，导致 Outline pending 消失。

用户已确认 R10 A：整体 completed 前不自动删除该任务工作区/唯一运行记录；业务代码可按既有授权合并或推送。若以后要提前清理，先由 Comet 将必要运行记录迁移到其持久位置并验证恢复，再清理；这是一条后续能力，不靠 hook 复制文件冒充迁移。

## 8. 必须实证的故障点

archive 移动前后断电；归档后 Git 已完成但知识 pending 的发现/选择；两个会话同时执行同一 continuation；重复 Hook 不派发；Review 同 key 恢复不重开整组；Outline create 成功但回执丢失；client UUID 冲突；update 409；403/超时不是不存在；旧 attempt 回调不能完成新任务；取消后 in-flight 请求调和；未完成时工作区清理阻断。

目前这些都没有运行验证。已有源码/官方契约只能证明可复用的接口/通道，不能证明扩展后已提供恢复和幂等保证。

## 来源

实际 Comet 发行包相对定位：classic-archive.js:245–270、410–454、496–499；classic-resolver.js:50–56；classic-resume-probe.js:214–260；classic-current-change.js:31–47；classic-recovery.js 的 archive delivery 分支。

[Outline 官方 API 契约](https://github.com/outline/openapi/blob/main/spec3.yml)，本轮只读当前版本，不向实际知识库写入，也未改 Comet/Ponytail Hook。
