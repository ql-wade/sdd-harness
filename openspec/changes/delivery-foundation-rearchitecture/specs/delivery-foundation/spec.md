## ADDED Requirements

### Requirement: Delivery contract and evidence
系统 SHALL 对六环节的基线、候选、证据和发布事实执行可追踪、来源认证、保守失效的判定。

#### Scenario: A01
- **GIVEN** 缺少产品、设计或用例基线
- **WHEN** 请求实现派发
- **THEN** 拒绝并列出缺项

#### Scenario: A02
- **GIVEN** 已有 AC 确认与下游回执
- **WHEN** 修改 AC 或范围
- **THEN** 失效相关下游适用性与旧批准

#### Scenario: A03
- **GIVEN** 测试文件新增但为空或全跳过
- **WHEN** 申请验收
- **THEN** 零有效执行不能通过

#### Scenario: A04
- **GIVEN** 测试失败原因是环境未启动
- **WHEN** 申请行为 RED 记录
- **THEN** 拒绝把环境故障作为有效行为 RED

#### Scenario: A05
- **GIVEN** Builder 自写 pass JSON
- **WHEN** 申请可信证据准入
- **THEN** 拒绝未登记来源并保留审计

#### Scenario: A06
- **GIVEN** Builder 和 Verifier execution 相同
- **WHEN** 申请独立验收
- **THEN** 身份检查拒绝

#### Scenario: A07
- **GIVEN** 旧报告已通过
- **WHEN** 源码、测试、锁文件或迁移变化后复用
- **THEN** 拒绝摘要不匹配的报告

#### Scenario: A08
- **GIVEN** 项目含 Java、Python 和部署配置
- **WHEN** 相关文件变化
- **THEN** 完整输入摘要变化或显式范围错误

### Requirement: Runtime ownership and recovery
系统 SHALL 为每个状态对象指定唯一 owner，并通过关联身份、版本与外部读回恢复副作用。

#### Scenario: A09
- **GIVEN** 宿主支持不同写入渠道
- **WHEN** 通过编辑、Shell、MCP 尝试越阶段写入
- **THEN** 逐渠道记录实际拒绝或能力缺口，不能把缺口记已拦截

#### Scenario: A10
- **GIVEN** 两个会话和旧租约执行者
- **WHEN** 并发推进、重复派发及旧 epoch 回调
- **THEN** 有效推进唯一、重复幂等、过期拒绝

#### Scenario: A11
- **GIVEN** 派发、证据或归档进行中
- **WHEN** 进程中断再恢复
- **THEN** 从权威状态和外部读回续接，不重复副作用

#### Scenario: A12
- **GIVEN** 子任务分别通过
- **WHEN** 集成后父目标 Journey 失败
- **THEN** 父任务阻断并对新候选重验

#### Scenario: A13
- **GIVEN** 旧 PR 检查已通过
- **WHEN** PR head 或合并队列 SHA 变化
- **THEN** 对精确新集成候选重验

#### Scenario: A14
- **GIVEN** 已验证一个构建 digest
- **WHEN** 部署 tag 指向另一个 digest
- **THEN** 拒绝提升并记录实际身份不符

#### Scenario: A15
- **GIVEN** UI 显示保存成功
- **WHEN** 独立检查持久化
- **THEN** 未落盘则 Journey 失败

#### Scenario: A16
- **GIVEN** 部署请求超时但外部已成功
- **WHEN** 恢复同一关联操作
- **THEN** 查询后绑定原结果，不重复部署

#### Scenario: A17
- **GIVEN** 发布失败且有批准回滚方案
- **WHEN** 执行回滚
- **THEN** 读回回滚 digest、环境和关键业务终态

#### Scenario: A18
- **GIVEN** 工具未装、服务未启或必需观察能力缺失
- **WHEN** 汇总验收
- **THEN** 标记 blocked 或事前确认的不适用，不得伪造通过

#### Scenario: A19
- **GIVEN** 开发身份试图访问发布密钥或控制账本
- **WHEN** 尝试绕过 Gate
- **THEN** 受保护 Runner 或平台权限拒绝并审计

#### Scenario: A20
- **GIVEN** 正确性契约已冻结
- **WHEN** 停用 CodeGraph/RTK 后执行
- **THEN** 正确性协议仍可执行，优化收益单独评估

### Requirement: Method and closeout boundaries
系统 SHALL 隔离计划、测试编写、独立验收与规格收尾，并保留历史证明边界。

#### Scenario: B01
- **GIVEN** 用户只请求计划
- **WHEN** 执行 planner
- **THEN** 只输出 PlanBundle，不派发、监控或改运行状态

#### Scenario: B02
- **GIVEN** 产品功能缺失
- **WHEN** 测试作者发现行为 RED
- **THEN** 保留 RED 并交 Builder，不擅改产品源码

#### Scenario: B03
- **GIVEN** 作者测试自检全绿
- **WHEN** 导入结果
- **THEN** 仅记 authoring 自检，不签独立验收

#### Scenario: B04
- **GIVEN** Whitebox 发现弱 oracle 或缺 case
- **WHEN** 记录缺口
- **THEN** 返回测试作者，不偷偷改冻结测试

#### Scenario: B05
- **GIVEN** Whitebox 发现产品缺陷
- **WHEN** 修复并再次提交
- **THEN** Builder 产生新候选后重新独立验收

#### Scenario: B06
- **GIVEN** 必验 console 缺失但 DOM/截图通过
- **WHEN** 汇总结果
- **THEN** 必验项未闭合，服务日志不能冒充 console

#### Scenario: B07
- **GIVEN** 旧 Journey/Slice 与新契约版本不兼容
- **WHEN** 导入证据
- **THEN** 明确拒绝或经审查迁移，不虚构字段

#### Scenario: B08
- **GIVEN** 验收通过后主规格被另一 Change 修改
- **WHEN** 执行 closeout
- **THEN** 摘要冲突阻断并重新预演，保留旧场景

#### Scenario: B09
- **GIVEN** 旧技能 controller 仍活跃
- **WHEN** 新 runtime 尝试取得同一任务
- **THEN** 拒绝第二写者，不重复派发、监控或归档

#### Scenario: B10
- **GIVEN** 只有 schema 和归档夹具通过
- **WHEN** 生成交付报告
- **THEN** 仅声明该层证据，不宣称真实产品闭环

### Requirement: Foundation distribution and deployment
系统 SHALL 冻结可验证资产、避免配置双写，并按部署模式声明能力限制。

#### Scenario: F01
- **GIVEN** 干净成员工作区
- **WHEN** 接入同一 Foundation release
- **THEN** 实际工具版本、技能、契约、hooks/MCP 内容与清单一致

#### Scenario: F02
- **GIVEN** 已有用户配置
- **WHEN** 正反序 bootstrap/init、重复 pull、升级和卸载
- **THEN** 保留用户条目，不重复 Guard，配置可回退

#### Scenario: F03
- **GIVEN** 安装资产完成
- **WHEN** 新宿主会话开始真实任务
- **THEN** 实际发现所需技能与工具，文件存在不足以通过

#### Scenario: F04
- **GIVEN** 已有冻结运行
- **WHEN** pull 新资产后恢复旧 run
- **THEN** 保持完整旧基线或显式迁移重验，不能静默换门禁

#### Scenario: F05
- **GIVEN** 需要写测试或产品文件
- **WHEN** 选择只读 prompt driver
- **THEN** 拒绝误用并使用经验证的受管写执行器

#### Scenario: F06
- **GIVEN** workflow 步骤成功或被 skip
- **WHEN** 必验项缺失、过期或失败
- **THEN** Gate 和受保护 CI 实际阻断，workflow success 不代替交付

#### Scenario: F07
- **GIVEN** Comet 子任务失联或回执重复乱序
- **WHEN** 恢复单一主控及受管 Driver
- **THEN** 核对 backend/attempt/关联 ID，不重复叶子派发

#### Scenario: F08
- **GIVEN** 同次原生浏览器验收
- **WHEN** 执行交互和收集证据
- **THEN** 关联截图、请求和独立业务读回；缺能力保持未验证

#### Scenario: F09
- **GIVEN** 集成候选和制品已冻结
- **WHEN** CI 验证并提升
- **THEN** 精确 integration SHA 和同 digest 贯通验证/目标环境

#### Scenario: F10
- **GIVEN** 启用团队 Control API
- **WHEN** 测试跨项目访问、凭证撤销、恢复与 API 断联
- **THEN** 隔离和恢复权限成立，断联不得用缓存绿灯发布


### Requirement: Classic single-controller integration
系统 SHALL 在同一 Comet Run 内分别约束需求、架构、测试设计、计划、独立验收与必需知识闭合，统一执行所有正常和恢复推进路径的前提检查。测试设计门 MUST 核对覆盖、oracle、可执行验证路径和版本适用性，不能因低风险直接跳过或只凭 TestPack 结构有效放行。

#### Scenario: C01
- **GIVEN** 需求范围或 AC 尚未确认，或者存在影响业务结果的未决问题
- **WHEN** 请求开始被当作正式决策的架构动作或推进需求阶段
- **THEN** 缺少当前需求基线的 R 回执时被阻断，不以产物文件存在代替确认

#### Scenario: C02
- **GIVEN** 需求已确认，但架构、测试设计或计划任一前置门缺失或过期
- **WHEN** 请求写产品源码或进入实施
- **THEN** 同一 Runtime 拒绝推进，并指出应恢复的动作和失效输入

#### Scenario: C03
- **GIVEN** 测试作者提交结构合法的 design_only TestPack，但仍有未解决的预期结果或必验覆盖缺口
- **WHEN** 请求测试设计门通过
- **THEN** 不能将结构合法当作语义充分，保持阻断并返回测试作者

#### Scenario: C04
- **GIVEN** planner 产出 OpenSpec tasks/DAG，而 Classic 需要 plan 指针和任务映射
- **WHEN** 导入计划并恢复执行
- **THEN** tasks 保持唯一可写任务权威，Classic 视图引用同一任务与输入版本，不创建第二套任务勾选或启动第二 controller

#### Scenario: C05
- **GIVEN** Whitebox 报告来自测试作者或 Builder 的同一执行，或者候选/测试集已变化
- **WHEN** 请求独立验收通过
- **THEN** 身份或版本不符被拒绝，保留原报告但不得推进

#### Scenario: C06
- **GIVEN** policy 要求更新项目或团队知识，但缺少有效授权、正确目标版本或独立读回
- **WHEN** 请求对应收尾或最终完成
- **THEN** 同一 Comet Run 保持未完成，恢复原知识动作，不用原生 remember 提示或本地成功声明代替外部知识证据

#### Scenario: C07
- **GIVEN** 某必需 gate 缺失、失败或失效
- **WHEN** 分别从正常 Guard、直接 transition、源码写入、next/continuation 恢复或 archive 请求推进
- **THEN** 所有受管入口执行同一前置规则，不能通过未覆盖的入口绕过门禁

#### Scenario: C08
- **GIVEN** 当前 OpenSpec CLI 响应缺少 Classic 要求的依赖字段或路径能力
- **WHEN** 初始化或恢复 Classic 与 OpenSpec 的接入
- **THEN** 明确拒绝兼容性，不猜测依赖、不全局自动升级；固定兼容版本后重新实证

### Requirement: Classic gate runtime enforcement
系统 SHALL 在同一 Classic Runtime 内接纳来源可信且输入版本匹配的回执，架构与测试设计采用独立自动审查；角色不得自行将审查结果或阶段设为通过。需求/设计修订和失败返工必须触发对应依赖证据重算，并覆盖所有受管推进与恢复入口。

#### Scenario: D01
- **GIVEN** 作者在工作区写入 passed 回执或伪填 reviewer execution，但没有匹配的 Runtime 独立派发记录
- **WHEN** 请求架构或测试设计门通过
- **THEN** Runtime 拒绝接纳，不能凭文件存在、角色标签或自报通过推进

#### Scenario: D02
- **GIVEN** 独立 A/T 审查已经开始
- **WHEN** 输入设计或测试意图在结果返回前被修改
- **THEN** 接纳时重新核对摘要，旧结果只能作为历史，不能覆盖或放行当前版本

#### Scenario: D03
- **GIVEN** 架构审查发现设计覆盖缺口，或测试设计审查发现弱 oracle
- **WHEN** 接收结构化拒绝结果
- **THEN** 同一 Run 分别返回架构作者或测试作者修复并独立重审，修复前不允许源码实施，不新建平行 controller

#### Scenario: D04
- **GIVEN** 当前 Change 的旧 A/T/P/V 回执有效且任务已勾选
- **WHEN** 需求、AC 或正式设计发生修订，甚至未主动调用修订动作
- **THEN** 下一次派发/受管写入/转换/恢复/完成前根据输入重算有效性，旧回执和旧勾选不能为新版本放行

#### Scenario: D05
- **GIVEN** R/A/T/P 的输入未变且仍适用于当前允许范围
- **WHEN** Builder 修改实现或测试代码形成新候选
- **THEN** 旧候选验收与相关知识结果不可复用；不会仅因正常实现写入循环撤销未变的需求与计划

#### Scenario: D06
- **GIVEN** 知识发布请求超时，或者 Runtime 在远端成功后、本地回执接纳前中断
- **WHEN** 恢复同一任务
- **THEN** 先按原操作关联与目标版本独立读回，结果未知保持阻断，不盲目重复创建或发布

#### Scenario: D07
- **GIVEN** OpenSpec 归档已成功，但本次 policy 要求的知识/平台回执仍缺失或过期
- **WHEN** 调用 next、恢复入口或请求最终完成
- **THEN** 不因 archived=true 返回 completed，指向同一 Run 中尚未满足的收尾义务

#### Scenario: D08
- **GIVEN** 对应 gate 的新结果已经产生
- **WHEN** 在接纳回执、审计和阶段更新之间发生中断或并发修订
- **THEN** 恢复后得到一致且可追溯的有效回执与允许动作，或明确 recovery-required 阻断，不展示无依据的通过

### Requirement: Architecture methods and advisory hooks
系统 SHALL 在架构门使用 grill-me 质询闭合关键问题并冻结审查制品，经 multi-agent-consensus-review 的同版本全票机械结果才接纳架构通过；Ponytail 等方法 hook 不得替代 Runtime 放行权。知识、规格与整体完成须按事前 policy 独立核验。

#### Scenario: E01
- **GIVEN** 本次 policy 要求项目知识更新，产品验收已通过但 LLMWiki 的必要写入或独立读回失败
- **WHEN** 请求规格归档
- **THEN** 按所选关闭策略执行相应前置 gate，不得因产品测试通过就跳过必需知识义务；仍有效产品证据保留，不重复部署

#### Scenario: E02
- **GIVEN** policy 允许先完成规格归档再发布团队知识，规格已归档而必需 Outline 授权/发布/读回尚未完成
- **WHEN** 请求 next 或整体完成
- **THEN** 不撤销成功归档，也不返回 completed；同一 Comet Run 指向原知识收尾动作并支持幂等恢复

#### Scenario: E03
- **GIVEN** 架构已形成，但 grill-me 的承重问题未闭合，或者共识出现拒绝、缺席、低分、blocker 或不完整票
- **WHEN** 请求架构门通过
- **THEN** 不因已加载技能或多数票同意而推进，按原任务质询/修改/重审或报告阻塞

#### Scenario: E04
- **GIVEN** 对设计旧摘要的共识票已产生
- **WHEN** 设计或需求版本变化并请求接纳旧共识
- **THEN** 旧票对新审查包无效且全部下游证据失效，必须冻结新 revision 重新评审，不修改旧票摘要

#### Scenario: E05
- **GIVEN** Ponytail 方法 hook 缺失、静默失败或会话 mode 改变
- **WHEN** Comet 的必需门禁仍缺失或失败
- **THEN** Runtime 依然阻断，hook 不得自行通过、切阶段或后台派发业务流程

#### Scenario: E06
- **GIVEN** 恢复/压缩/子会话启动重复发生，或规格已归档而 Outline 发布曾超时
- **WHEN** 读取下一动作并恢复处理
- **THEN** hook 仅恢复方法上下文，Comet 绑定原审查/发布 operation；不重复派发评审、不重复创建知识页，不产生第二控制器

### Requirement: Post-archive continuation and idempotent control
系统 SHALL 在 OpenSpec 已归档但必需知识发布未完成时保留同一 Comet Run，并以权威操作记录、稳定目标身份和远端读回恢复。重复 hook、会话和回调不得创建独立的业务控制器或把归档误判为整体完成。

#### Scenario: H01
- **GIVEN** Change 已从 active 移到 archive，Git 交付完成但 Outline 必需义务 pending
- **WHEN** 选择任务、执行 next 或恢复发现
- **THEN** 找到原 run_id 并指向知识收尾，不因归档或 Git complete 排除任务，不重新执行规格归档

#### Scenario: H02
- **GIVEN** SessionStart、compact、SubagentStart 等方法 hook 重复触发
- **WHEN** 注入方法或读取当前允许动作
- **THEN** hook 不领取执行权、不发起共识或知识写入，Comet 的必需 gate 与当前业务阶段不受 mode 变化影响

#### Scenario: H03
- **GIVEN** 两个会话共享同一权威 Run 并同时请求执行同一有效 job_key
- **WHEN** 原子登记和领取执行
- **THEN** 只有一个当前 owner/attempt 可启动，其余调用观察或恢复原 operation，不重复派发

#### Scenario: H04
- **GIVEN** 新 Outline 文档创建已成功，但响应或本地接纳回执丢失
- **WHEN** 恢复原发布 operation
- **THEN** 按首次请求前固定的目标 UUID 读回并核验，重试不生成新逻辑文档；403/超时不能当作不存在

#### Scenario: H05
- **GIVEN** Outline 目标 revision 在读取后被其他合法写者改变
- **WHEN** 使用原 lastRevision 更新返回冲突
- **THEN** 读回判断预期结果或保持冲突，不能刷新版本后盲目覆盖他人编辑

#### Scenario: H06
- **GIVEN** 同一架构审查包的共识作业已派发，或其旧 attempt 结果晚到
- **WHEN** 会话恢复、重复触发或设计已产生新 revision
- **THEN** 相同 job_key 恢复原作业；过期输入/归属的结果不能完成新任务，改变制品的新评审保持独立 manifest

#### Scenario: H07
- **GIVEN** 规格归档成功而必需 Outline 发布或其他收尾仍未完成
- **WHEN** 归档命令结束、恢复、输出状态或判断是否清除当前任务
- **THEN** 状态、continuation、发现/选择和界面一致保留未完成，不因原生 completed/clear-current 路径丢失恢复入口

#### Scenario: H08
- **GIVEN** 运行记录、批准 payload 或原 operation 的唯一副本仍在待收尾工作区
- **WHEN** 请求自动清理工作区
- **THEN** 未证明完整状态迁移与恢复前阻断清理，不能删除原状态后创建空 Run 假装恢复

#### Scenario: H09
- **GIVEN** Run 已绑定原权威执行环境，另一机器持有复制的状态或不匹配 authority
- **WHEN** 请求自动恢复/派发发布
- **THEN** 不能独立开第二写者；回原权威环境或执行经确认且可验证的归属迁移，不以普通会话标签绕过

### Requirement: Knowledge publication authorization
系统 SHALL 将预授权签发、候选编写、独立审查和正式发布分离；自动发布仅在真实源用途/权限、当前内容版本和目标有效受众均落于有效预授权内时允许。作者声明、服务账号可读、同名组或单一集合 ID 均不得替代真实授权证据。

#### Scenario: U01
- **GIVEN** 作者自写批准记录，或者凭证的 issuer/approver 无对应源/目标权力、已过期或被撤销
- **WHEN** 请求知识自动发布
- **THEN** Comet 拒绝授权，不因有签名、PR 合并或 approved 字段就放行

#### Scenario: U02
- **GIVEN** 候选由多个不同授权域的实际资料提炼，目标受众落在来源受众并集但不在其允许披露交集
- **WHEN** 独立内容审查通过后请求发布
- **THEN** 权限 gate 仍拒绝，审查通过不扩大资料授权，交有权主体处理明确范围

#### Scenario: U03
- **GIVEN** 预授权与独立审查曾有效
- **WHEN** 源权限、grant 或目标受众在实际写入前收缩/改变
- **THEN** 写前复核阻断旧发布判定，不能靠旧快照继续或用同 operation 自动续期

#### Scenario: U04
- **GIVEN** 审查和批准绑定了候选版本
- **WHEN** 作者修改标题、正文、附件/引用、目标集合或可见性
- **THEN** 旧审查/发布判定失效，不能凭语义类似或同一文档 ID 沿用旧授权结论

#### Scenario: U05
- **GIVEN** 目标集合名字和 ID 符合 allowlist，但继承、单页/子树分享或公开入口使实际读者越界
- **WHEN** 请求正式发布
- **THEN** Comet 按有效受众拒绝，不向更大受众先写草稿再审核，也不自动改 ACL 使之通过

#### Scenario: U06
- **GIVEN** 源/目标权限分页不完整、principal 无法映射或权限 API 返回错误
- **WHEN** 自动发布核验
- **THEN** 保持 blocked，不能把未知当空集/公开，也不能只凭连接器服务账号能读就放行

#### Scenario: U07
- **GIVEN** author、reviewer、publisher 与授权签发主体按受管角色隔离
- **WHEN** 普通 Agent 尝试修改可信策略/批准、获取签发或超范围写凭据、调用任意集合/分享修改
- **THEN** 被实际受管权限/发布入口拒绝并审计，不能仅以提示词声明禁止作为验收

#### Scenario: U08
- **GIVEN** 合法 owner 的预授权有效，真实输入来源完整，当前源/目标权限和 payload 均匹配，独立审查通过
- **WHEN** Comet 执行已登记的允许发布操作并完成独立读回
- **THEN** 自动接纳对应知识回执并继续同一 Run，不重复人工确认，也不把批准扩大到其他对象或未来版本

### Requirement: Published knowledge revocation and restoration
系统 SHALL 区分授权回执失效与实际访问隔离，在源/目标授权变化或持续披露许可到期时使关联知识当前消费/发布证据失效，并由同一 Comet 引擎安排隔离、核验和恢复。既有产品交付历史不得因后续权限维护被改写，状态标签不得冒充资源端不可访问。

#### Scenario: L01
- **GIVEN** 已发布知识存在 source→派生条目的完整关联，可信事件表明源权限缩小或目标受众扩大
- **WHEN** Comet 接纳并核对事件
- **THEN** 受影响当前权限/消费回执与在途接纳失效，受管读取/发布暂停，按影响闭包安排维护；未核验资源端前不能显示已隔离

#### Scenario: L02
- **GIVEN** 某条目已标 stale 或移动到隔离位置，但原分享/继承/搜索/附件等 required 通道仍可被不再授权的身份访问
- **WHEN** 请求隔离完成
- **THEN** 保持 isolating/unknown，继续同一 operation 并告警，不因标签、unpublish、archive 或管理员能读到就宣称不可访问

#### Scenario: L03
- **GIVEN** publish_until 已到期，但持续披露许可和当前源/目标受众仍合法且有效
- **WHEN** 判断已发布内容和新发布操作
- **THEN** 阻断新发布/更新，不自动把过去合法内容当作必须撤回；持续使用语义不明确时不得走自动发布或默认永久授权

#### Scenario: L04
- **GIVEN** 已发布内容的持续披露许可到期或当前目标受众不再落在源许可交集
- **WHEN** 到期/权限核验维护动作执行
- **THEN** 不能以原发布成功或未到期的其他操作凭证继续消费，按已授予的隔离能力收窄访问并独立验证

#### Scenario: L05
- **GIVEN** 原产品 Change 已交付完成，此后出现知识权限事件
- **WHEN** 处理权限维护
- **THEN** 保留原交付历史，由同一 Comet 引擎建立关联原发布回执的维护作业，不重开产品需求或启动另一个监听器主控

#### Scenario: L06
- **GIVEN** 条目已隔离，当前源/目标许可后来重新满足，但旧受众或旧恢复 callback 已不适用
- **WHEN** 恢复发布/消费
- **THEN** 使用当前授权、新维护代际和独立审查/访问读回；不原样恢复旧 ACL，不让旧回调重加离组成员或覆盖新隔离

#### Scenario: L07
- **GIVEN** 重复/乱序权限事件、隔离执行中断或远端结果未知
- **WHEN** 恢复维护
- **THEN** 按可信当前权限及同一 operation 调和，失败保留暴露未消除状态与告警，不重复派发或伪报安全

#### Scenario: L08
- **GIVEN** 权限事件被漏报但登记资源仍可完整查询
- **WHEN** 周期核验或故障恢复全量对账
- **THEN** Comet 对实际权限差异登记同一幂等维护动作，按批准的检测/隔离时限计时；不能只重放事件游标或从通知到达才计算源变更检测时间

#### Scenario: L09
- **GIVEN** Runner 进程宕机或仍有心跳但完整核验水位不再推进
- **WHEN** 独立监控超过批准的阈值
- **THEN** 在批准时限内告警；监督器仅重启原 Comet 服务，不产生第二业务 owner，不能把告警成功当作 Outline 已隔离

#### Scenario: L10
- **GIVEN** 隔离 API 失败、限流或远端执行结果未知
- **WHEN** 首次失败和快速隔离预算耗尽
- **THEN** 首次失败即告警，Comet 持久保存调和/重试和升级；超时保留未消除暴露与违约，权限拒绝不盲重试，监听器/执行器不自行派生业务重试循环

#### Scenario: L11
- **GIVEN** 宕机期间发生漏报、grant 到期、分享变化或迟到旧恢复写入
- **WHEN** 原 Comet 恢复
- **THEN** 暂停新发布，先调和未知写入，再完整对账并优先隔离；事件接收游标、完整核验水位、隔离证据分别维护，未覆盖对象或访问路径保持未知，事故关闭保留时限违约

### Requirement: Matt method profile without nested controllers
系统 SHALL 遵守用户停用 Superpowers、采用 Matt 基础工程方法的决定，同时保持本项目已明确选择的 Comet 单主控；普通方法技能和本机默认 controller 路由不得隐式重启另一套 DAG、监督或归档流程。

#### Scenario: M01
- **GIVEN** 本机 Superpowers 已停用，项目选择 Matt 基础方法
- **WHEN** 初始化/分发/恢复 Classic 或加载方法
- **THEN** 不自动安装、启用或调用 Superpowers，实际使用预先固定的 Matt 方法；仅保留的来源引用或兼容目录名不作为运行依赖

#### Scenario: M02
- **GIVEN** 本项目显式选择 Comet 单主控，而本机默认并行 planner 合同拥有自身执行/监督权
- **WHEN** 需要规划或方法校验
- **THEN** 只经明确兼容的方法/工具入口复用，不加载完整 controller 后无视其合同，也不隐式启动 Matt 用户专用控制器；交付仍只有一份 Comet 进度与任务权威
