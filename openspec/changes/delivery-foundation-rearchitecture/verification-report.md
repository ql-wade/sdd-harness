# VERIFY — 最终验证报告（delivery-foundation-rearchitecture）

## 1. 总览

| 项 | 值 |
| --- | --- |
| 最终基线 | `68f79635d1fd5f6c0cddd40321692ee0b91ed4a9`（2026-10-21T15:30:52+08:00，分支 impl/verify-final，基于 master） |
| 执行环境 | 本机真实执行；node v22.13.1（会话默认）/ v24.15.0（comet 钉定）；真实 `.sdd` 固定产物（fingerprint `beab355d…`，APFS 字节级克隆自同宿主集成工作树） |
| 合同全项 | 108 项全部真实执行：**pass 87，environment_gated 18，unverified 1，failed 2**（failed 逐项有因：V_FULL_CHECK、V_INFRA_I08，见 §5/§6） |
| 92 场景 verdict | **PASS 76 / GATED 15 / UNVERIFIED 1**，与 acceptance-index.json 零未解释差异 |
| Whitebox Journey | 27 个 delivery-case 模块逐个真实运行：25 全绿 + 3_4.mjs 2/4（已知 B08 漂移对）+ 1_1/1_5 各 1 项环境条件 skip；npm test 423/425（仅已知 C08/B08 漂移对）；check.sh 止于 base 起 pre-existing 夹具缺口；索引抽样复验 10/10 MATCH |
| 完成判定四硬门 | 全部满足（§7）；failed 2 项均为 base 已存在的缺口且逐项有因，非本轮集成引入 |

VERIFY 三个步骤（tasks.md VERIFY Step 1–3）由本报告 + grill-report.md + verification-results.json + worker-reports/VERIFY.json + evidence/ 落地。归档动作明确不由本节点执行（唯一 Comet closeout owner 所有）。

## 2. 四层证据（acceptance-index 分层口径）

| 层 | 定义 | 本轮独立复核方式 | 结果 |
| --- | --- | --- | --- |
| kernel 内核层 | node --test 各套件 | npm test 全量 + 27 个 delivery-case 模块逐个执行 + 10 项索引抽样复验 | 423/425（2 已知漂移对）；模块层零新增失败 |
| cli CLI/装配层 | tools/ 各 validate/probe 入口 | delivery-journey 92 场景（每个 spawn 真实 CLI/模块）+ comet build --check-generated/--runtime-smoke（PASS，fingerprint=当前锁）+ openspec validate --strict（exit 0） | 见 §3/§6 |
| host 宿主层 | hook/adapter 装配 | 适配器真实编译（SDD_TARGET_ROOT 隔离目标模式，7 deny 策略）后 4_5/1_2 装配旅程全绿 | E05/E06 等 PASS |
| ci 业务/CI 层 | delivery-cases 回归 + check.sh + 真实平台记录 | 上述全量 + check.sh（止于夹具缺口，后续子步手工补跑） | 真实平台侧由 GATED 项 holder 分离承接 |

## 3. 合同 108 项执行汇总（逐项见 verification-results.json per_check）

| 分类 | 数量 | 明细 |
| --- | --- | --- |
| pass | 87 | 旅程 75（含 4 项 flake/夹具后 rerun-PASS，finding F-2/F-3/F-4）+ 辅助 12（npm 类 2 项归门控；infra I01–I07、openspec-strict、comet-native、3 项组合运行） |
| environment_gated | 18 | 旅程 16（A11 交叉污染 + 15 索引 GATED 项）+ npm 回归 2（V_NPM_REGRESSION/V_SCOPED_REGRESSION，同 HOST_OPENSPEC_DRIFT 根因） |
| unverified | 1 | V_F10（conditional_pre_enable；未启用分支真实执行，正向隔离恢复认证保留 UNVERIFIED，未豁免为 PASS） |
| failed | 2 | V_FULL_CHECK（base 起 pre-existing 夹具缺口）；V_INFRA_I08（合同文件名 vs 实际文件名，I08_FILENAME_DEVIATION 待裁决；实际测试 13/13+4/4 全绿） |

已知环境门控项全部真实执行后才标注：C08/B08（宿主 openspec 1.3.1→1.14.3 漂移，fail-closed 报错原文留证）、adapter-quoting（本工作树未触发 EPERM，两用例通过）、llmwiki venv ENOENT（会话工件分支，I04 套件 11/11 全绿）、F08 浏览器、跨机门项（F10/H09 等）。

## 4. 92 场景逐项

verdict 与 acceptance-index.json 逐项一致；GATED/UNVERIFIED 均有 holder 与解锁条件（详见 grill-report.md 逐场景质询记录）。

| ID | verdict | journey 执行 | 任务 | 语义（GIVEN/WHEN/THEN 摘要） |
| --- | --- | --- | --- | --- |
| A01 | PASS | exit=0/PASS | P2_1 | GIVEN 缺少产品、设计或用例基线 WHEN 请求实现派发 THEN 拒绝并列出缺项；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A02 | PASS | exit=0/PASS | P2_1 | GIVEN 已有 AC 确认与下游回执 WHEN 修改 AC 或范围 THEN 失效相关下游适用性与旧批准；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A03 | PASS | exit=0/PASS | P2_1 | GIVEN 测试文件新增但为空或全跳过 WHEN 申请验收 THEN 零有效执行不能通过；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A04 | PASS | exit=0/PASS | P2_1 | GIVEN 测试失败原因是环境未启动 WHEN 申请行为 RED 记录 THEN 拒绝把环境故障作为有效行为 RED；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A05 | PASS | exit=0/PASS | P2_2 | GIVEN Builder 自写 pass JSON WHEN 申请可信证据准入 THEN 拒绝未登记来源并保留审计；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A06 | PASS | exit=0/PASS | P2_2 | GIVEN Builder 和 Verifier execution 相同 WHEN 申请独立验收 THEN 身份检查拒绝；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A07 | PASS | exit=0/PASS | P2_1 | GIVEN 旧报告已通过 WHEN 源码、测试、锁文件或迁移变化后复用 THEN 拒绝摘要不匹配的报告；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A08 | PASS | exit=0/PASS | P2_1 | GIVEN 项目含 Java、Python 和部署配置 WHEN 相关文件变化 THEN 完整输入摘要变化或显式范围错误；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A09 | PASS | exit=0/PASS | P1_3 | GIVEN 宿主支持不同写入渠道 WHEN 通过编辑、Shell、MCP 尝试越阶段写入 THEN 逐渠道记录实际拒绝或能力缺口，不能把缺口记已拦截；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判 |
| A10 | PASS | exit=0/PASS | P3_3 | GIVEN 两个会话和旧租约执行者 WHEN 并发推进、重复派发及旧 epoch 回调 THEN 有效推进唯一、重复幂等、过期拒绝；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A11 | PASS | exit=2/FAIL | P3_4 | GIVEN 派发、证据或归档进行中 WHEN 进程中断再恢复 THEN 从权威状态和外部读回续接，不重复副作用；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A12 | PASS | exit=0/PASS | P3_3 | GIVEN 子任务分别通过 WHEN 集成后父目标 Journey 失败 THEN 父任务阻断并对新候选重验；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A13 | PASS | exit=0/PASS | P4_1 | GIVEN 旧 PR 检查已通过 WHEN PR head 或合并队列 SHA 变化 THEN 对精确新集成候选重验；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A14 | GATED | exit=0/PASS | P4_2 | GIVEN 已验证一个构建 digest WHEN 部署 tag 指向另一个 digest THEN 拒绝提升并记录实际身份不符；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A15 | PASS | exit=0/PASS | P3_1 | GIVEN UI 显示保存成功 WHEN 独立检查持久化 THEN 未落盘则 Journey 失败；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A16 | GATED | exit=0/PASS | P4_2 | GIVEN 部署请求超时但外部已成功 WHEN 恢复同一关联操作 THEN 查询后绑定原结果，不重复部署；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A17 | GATED | exit=0/PASS | P4_2 | GIVEN 发布失败且有批准回滚方案 WHEN 执行回滚 THEN 读回回滚 digest、环境和关键业务终态；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A18 | PASS | exit=0/PASS | P2_2 | GIVEN 工具未装、服务未启或必需观察能力缺失 WHEN 汇总验收 THEN 标记 blocked 或事前确认的不适用，不得伪造通过；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A19 | PASS | exit=0/PASS | P2_2 | GIVEN 开发身份试图访问发布密钥或控制账本 WHEN 尝试绕过 Gate THEN 受保护 Runner 或平台权限拒绝并审计；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| A20 | PASS | exit=0/PASS | P2_3 | GIVEN 正确性契约已冻结 WHEN 停用 CodeGraph/RTK 后执行 THEN 正确性协议仍可执行，优化收益单独评估；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B01 | PASS | exit=0/PASS | P1_6 | GIVEN 用户只请求计划 WHEN 执行 planner THEN 只输出 PlanBundle，不派发、监控或改运行状态；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B02 | PASS | exit=0/PASS | P3_2 | GIVEN 产品功能缺失 WHEN 测试作者发现行为 RED THEN 保留 RED 并交 Builder，不擅改产品源码；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B03 | PASS | exit=0/PASS | P3_2 | GIVEN 作者测试自检全绿 WHEN 导入结果 THEN 仅记 authoring 自检，不签独立验收；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B04 | PASS | exit=0/PASS | P3_2 | GIVEN Whitebox 发现弱 oracle 或缺 case WHEN 记录缺口 THEN 返回测试作者，不偷偷改冻结测试；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B05 | PASS | exit=0/PASS | P3_2 | GIVEN Whitebox 发现产品缺陷 WHEN 修复并再次提交 THEN Builder 产生新候选后重新独立验收；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B06 | PASS | exit=0/PASS | P3_2 | GIVEN 必验 console 缺失但 DOM/截图通过 WHEN 汇总结果 THEN 必验项未闭合，服务日志不能冒充 console；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B07 | PASS | exit=0/PASS | P3_2 | GIVEN 旧 Journey/Slice 与新契约版本不兼容 WHEN 导入证据 THEN 明确拒绝或经审查迁移，不虚构字段；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B08 | GATED | exit=2/FAIL | P3_4 | GIVEN 验收通过后主规格被另一 Change 修改 WHEN 执行 closeout THEN 摘要冲突阻断并重新预演，保留旧场景；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| B09 | PASS | exit=0/PASS | P1_2 | GIVEN 旧技能 controller 仍活跃 WHEN 新 runtime 尝试取得同一任务 THEN 拒绝第二写者，不重复派发、监控或归档；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PA |
| B10 | PASS | exit=0/PASS | P4_3 | GIVEN 只有 schema 和归档夹具通过 WHEN 生成交付报告 THEN 仅声明该层证据，不宣称真实产品闭环；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| C01 | PASS | exit=0/PASS | P1_5 | GIVEN 需求范围或 AC 尚未确认，或者存在影响业务结果的未决问题 WHEN 请求开始被当作正式决策的架构动作或推进需求阶段 THEN 缺少当前需求基线的 R 回执时被阻断，不以产物文件存在代替确认；实际执行计数大于0，记录当前候选和环 |
| C02 | PASS | exit=0/PASS | P1_5 | GIVEN 需求已确认，但架构、测试设计或计划任一前置门缺失或过期 WHEN 请求写产品源码或进入实施 THEN 同一 Runtime 拒绝推进，并指出应恢复的动作和失效输入；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNV |
| C03 | PASS | exit=0/PASS | P1_5 | GIVEN 测试作者提交结构合法的 design_only TestPack，但仍有未解决的预期结果或必验覆盖缺口 WHEN 请求测试设计门通过 THEN 不能将结构合法当作语义充分，保持阻断并返回测试作者；实际执行计数大于0，记录当前候选 |
| C04 | PASS | exit=0/PASS | P1_5 | GIVEN planner 产出 OpenSpec tasks/DAG，而 Classic 需要 plan 指针和任务映射 WHEN 导入计划并恢复执行 THEN tasks 保持唯一可写任务权威，Classic 视图引用同一任务与输入版本 |
| C05 | PASS | exit=0/PASS | P1_5 | GIVEN Whitebox 报告来自测试作者或 Builder 的同一执行，或者候选/测试集已变化 WHEN 请求独立验收通过 THEN 身份或版本不符被拒绝，保留原报告但不得推进；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零 |
| C06 | PASS | exit=0/PASS | P1_5 | GIVEN policy 要求更新项目或团队知识，但缺少有效授权、正确目标版本或独立读回 WHEN 请求对应收尾或最终完成 THEN 同一 Comet Run 保持未完成，恢复原知识动作，不用原生 remember 提示或本地成功声明代替外 |
| C07 | PASS | exit=0/PASS | P2_4 | GIVEN 某必需 gate 缺失、失败或失效 WHEN 分别从正常 Guard、直接 transition、源码写入、next/continuation 恢复或 archive 请求推进 THEN 所有受管入口执行同一前置规则，不能通过未 |
| C08 | GATED | exit=2/NOT-EXERCISED | P1_5 | GIVEN 当前 OpenSpec CLI 响应缺少 Classic 要求的依赖字段或路径能力 WHEN 初始化或恢复 Classic 与 OpenSpec 的接入 THEN 明确拒绝兼容性，不猜测依赖、不全局自动升级；固定兼容版本后重新实 |
| D01 | PASS | exit=0/PASS | P2_4 | GIVEN 作者在工作区写入 passed 回执或伪填 reviewer execution，但没有匹配的 Runtime 独立派发记录 WHEN 请求架构或测试设计门通过 THEN Runtime 拒绝接纳，不能凭文件存在、角色标签或自报 |
| D02 | PASS | exit=0/PASS | P2_4 | GIVEN 独立 A/T 审查已经开始 WHEN 输入设计或测试意图在结果返回前被修改 THEN 接纳时重新核对摘要，旧结果只能作为历史，不能覆盖或放行当前版本；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED |
| D03 | PASS | exit=0/PASS | P2_4 | GIVEN 架构审查发现设计覆盖缺口，或测试设计审查发现弱 oracle WHEN 接收结构化拒绝结果 THEN 同一 Run 分别返回架构作者或测试作者修复并独立重审，修复前不允许源码实施，不新建平行 controller；实际执行计数大 |
| D04 | PASS | exit=0/PASS | P2_4 | GIVEN 当前 Change 的旧 A/T/P/V 回执有效且任务已勾选 WHEN 需求、AC 或正式设计发生修订，甚至未主动调用修订动作 THEN 下一次派发/受管写入/转换/恢复/完成前根据输入重算有效性，旧回执和旧勾选不能为新版本放 |
| D05 | PASS | exit=0/PASS | P2_4 | GIVEN R/A/T/P 的输入未变且仍适用于当前允许范围 WHEN Builder 修改实现或测试代码形成新候选 THEN 旧候选验收与相关知识结果不可复用；不会仅因正常实现写入循环撤销未变的需求与计划；实际执行计数大于0，记录当前候选 |
| D06 | PASS | exit=0/PASS | P2_4 | GIVEN 知识发布请求超时，或者 Runtime 在远端成功后、本地回执接纳前中断 WHEN 恢复同一任务 THEN 先按原操作关联与目标版本独立读回，结果未知保持阻断，不盲目重复创建或发布；实际执行计数大于0，记录当前候选和环境；依赖缺 |
| D07 | PASS | exit=0/PASS | P2_4 | GIVEN OpenSpec 归档已成功，但本次 policy 要求的知识/平台回执仍缺失或过期 WHEN 调用 next、恢复入口或请求最终完成 THEN 不因 archived=true 返回 completed，指向同一 Run 中尚 |
| D08 | PASS | exit=0/PASS | P2_4 | GIVEN 对应 gate 的新结果已经产生 WHEN 在接纳回执、审计和阶段更新之间发生中断或并发修订 THEN 恢复后得到一致且可追溯的有效回执与允许动作，或明确 recoveryrequired 阻断，不展示无依据的通过；实际执行计数 |
| E01 | PASS | exit=0/PASS | P4_4 | GIVEN 本次 policy 要求项目知识更新，产品验收已通过但 LLMWiki 的必要写入或独立读回失败 WHEN 请求规格归档 THEN 按所选关闭策略执行相应前置 gate，不得因产品测试通过就跳过必需知识义务；仍有效产品证据保留， |
| E02 | PASS | exit=0/PASS | P4_4 | GIVEN policy 允许先完成规格归档再发布团队知识，规格已归档而必需 Outline 授权/发布/读回尚未完成 WHEN 请求 next 或整体完成 THEN 不撤销成功归档，也不返回 completed；同一 Comet Run  |
| E03 | PASS | exit=0/PASS | P2_5 | GIVEN 架构已形成，但 grillme 的承重问题未闭合，或者共识出现拒绝、缺席、低分、blocker 或不完整票 WHEN 请求架构门通过 THEN 不因已加载技能或多数票同意而推进，按原任务质询/修改/重审或报告阻塞；实际执行计数大 |
| E04 | PASS | exit=0/PASS | P2_5 | GIVEN 对设计旧摘要的共识票已产生 WHEN 设计或需求版本变化并请求接纳旧共识 THEN 旧票对新审查包无效且全部下游证据失效，必须冻结新 revision 重新评审，不修改旧票摘要；实际执行计数大于0，记录当前候选和环境；依赖缺失退 |
| E05 | PASS | exit=2/FAIL | P4_5 | GIVEN Ponytail 方法 hook 缺失、静默失败或会话 mode 改变 WHEN Comet 的必需门禁仍缺失或失败 THEN Runtime 依然阻断，hook 不得自行通过、切阶段或后台派发业务流程；实际执行计数大于0，记录 |
| E06 | PASS | exit=0/PASS | P4_4 | GIVEN 恢复/压缩/子会话启动重复发生，或规格已归档而 Outline 发布曾超时 WHEN 读取下一动作并恢复处理 THEN hook 仅恢复方法上下文，Comet 绑定原审查/发布 operation；不重复派发评审、不重复创建知识 |
| F01 | PASS | exit=0/PASS | P1_1 | GIVEN 干净成员工作区 WHEN 接入同一 Foundation release THEN 实际工具版本、技能、契约、hooks/MCP 内容与清单一致；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不 |
| F02 | PASS | exit=2/FAIL | P1_2 | GIVEN 已有用户配置 WHEN 正反序 bootstrap/init、重复 pull、升级和卸载 THEN 保留用户条目，不重复 Guard，配置可回退；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不 |
| F03 | PASS | exit=0/PASS | P1_1 | GIVEN 安装资产完成 WHEN 新宿主会话开始真实任务 THEN 实际发现所需技能与工具，文件存在不足以通过；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| F04 | PASS | exit=2/FAIL | P1_2 | GIVEN 已有冻结运行 WHEN pull 新资产后恢复旧 run THEN 保持完整旧基线或显式迁移重验，不能静默换门禁；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| F05 | PASS | exit=0/PASS | P1_3 | GIVEN 需要写测试或产品文件 WHEN 选择只读 prompt driver THEN 拒绝误用并使用经验证的受管写执行器；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| F06 | GATED | exit=0/PASS | P4_1 | GIVEN workflow 步骤成功或被 skip WHEN 必验项缺失、过期或失败 THEN Gate 和受保护 CI 实际阻断，workflow success 不代替交付；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/U |
| F07 | PASS | exit=0/PASS | P1_3 | GIVEN Comet 子任务失联或回执重复乱序 WHEN 恢复单一主控及受管 Driver THEN 核对 backend/attempt/关联 ID，不重复叶子派发；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERI |
| F08 | GATED | exit=0/PASS | P3_2 | GIVEN 同次原生浏览器验收 WHEN 执行交互和收集证据 THEN 关联截图、请求和独立业务读回；缺能力保持未验证；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判PASS。 |
| F09 | GATED | exit=0/PASS | P4_1 | GIVEN 集成候选和制品已冻结 WHEN CI 验证并提升 THEN 精确 integration SHA 和同 digest 贯通验证/目标环境；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不得跳过判 |
| F10 | UNVERIFIED | exit=0/PASS | P5_2 | GIVEN 启用团队 Control API WHEN 测试跨项目访问、凭证撤销、恢复与 API 断联 THEN 隔离和恢复权限成立，断联不得用缓存绿灯发布；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UNVERIFIED，不 |
| H01 | PASS | exit=0/PASS | P4_6 | GIVEN Change 已从 active 移到 archive，Git 交付完成但 Outline 必需义务 pending WHEN 选择任务、执行 next 或恢复发现 THEN 找到原 run_id 并指向知识收尾，不因归档或 G |
| H02 | PASS | exit=0/PASS | P4_6 | GIVEN SessionStart、compact、SubagentStart 等方法 hook 重复触发 WHEN 注入方法或读取当前允许动作 THEN hook 不领取执行权、不发起共识或知识写入，Comet 的必需 gate 与当前 |
| H03 | PASS | exit=0/PASS | P4_6 | GIVEN 两个会话共享同一权威 Run 并同时请求执行同一有效 job_key WHEN 原子登记和领取执行 THEN 只有一个当前 owner/attempt 可启动，其余调用观察或恢复原 operation，不重复派发；实际执行计数大 |
| H04 | GATED | exit=0/PASS | P4_6 | GIVEN 新 Outline 文档创建已成功，但响应或本地接纳回执丢失 WHEN 恢复原发布 operation THEN 按首次请求前固定的目标 UUID 读回并核验，重试不生成新逻辑文档；403/超时不能当作不存在；实际执行计数大于0 |
| H05 | GATED | exit=0/PASS | P4_6 | GIVEN Outline 目标 revision 在读取后被其他合法写者改变 WHEN 使用原 lastRevision 更新返回冲突 THEN 读回判断预期结果或保持冲突，不能刷新版本后盲目覆盖他人编辑；实际执行计数大于0，记录当前候选 |
| H06 | PASS | exit=0/PASS | P4_6 | GIVEN 同一架构审查包的共识作业已派发，或其旧 attempt 结果晚到 WHEN 会话恢复、重复触发或设计已产生新 revision THEN 相同 job_key 恢复原作业；过期输入/归属的结果不能完成新任务，改变制品的新评审保持 |
| H07 | PASS | exit=0/PASS | P4_6 | GIVEN 规格归档成功而必需 Outline 发布或其他收尾仍未完成 WHEN 归档命令结束、恢复、输出状态或判断是否清除当前任务 THEN 状态、continuation、发现/选择和界面一致保留未完成，不因原生 completed/c |
| H08 | PASS | exit=0/PASS | P4_6 | GIVEN 运行记录、批准 payload 或原 operation 的唯一副本仍在待收尾工作区 WHEN 请求自动清理工作区 THEN 未证明完整状态迁移与恢复前阻断清理，不能删除原状态后创建空 Run 假装恢复；实际执行计数大于0，记录 |
| H09 | GATED | exit=0/PASS | P4_6 | GIVEN Run 已绑定原权威执行环境，另一机器持有复制的状态或不匹配 authority WHEN 请求自动恢复/派发发布 THEN 不能独立开第二写者；回原权威环境或执行经确认且可验证的归属迁移，不以普通会话标签绕过；实际执行计数大于 |
| L01 | PASS | exit=0/PASS | P4_8 | GIVEN 已发布知识存在 source→派生条目的完整关联，可信事件表明源权限缩小或目标受众扩大 WHEN Comet 接纳并核对事件 THEN 受影响当前权限/消费回执与在途接纳失效，受管读取/发布暂停，按影响闭包安排维护；未核验资源端 |
| L02 | GATED | exit=0/PASS | P4_8 | GIVEN 某条目已标 stale 或移动到隔离位置，但原分享/继承/搜索/附件等 required 通道仍可被不再授权的身份访问 WHEN 请求隔离完成 THEN 保持 isolating/unknown，继续同一 operation 并 |
| L03 | PASS | exit=0/PASS | P4_8 | GIVEN publish_until 已到期，但持续披露许可和当前源/目标受众仍合法且有效 WHEN 判断已发布内容和新发布操作 THEN 阻断新发布/更新，不自动把过去合法内容当作必须撤回；持续使用语义不明确时不得走自动发布或默认永久授 |
| L04 | GATED | exit=0/PASS | P4_8 | GIVEN 已发布内容的持续披露许可到期或当前目标受众不再落在源许可交集 WHEN 到期/权限核验维护动作执行 THEN 不能以原发布成功或未到期的其他操作凭证继续消费，按已授予的隔离能力收窄访问并独立验证；实际执行计数大于0，记录当前候选 |
| L05 | PASS | exit=0/PASS | P4_8 | GIVEN 原产品 Change 已交付完成，此后出现知识权限事件 WHEN 处理权限维护 THEN 保留原交付历史，由同一 Comet 引擎建立关联原发布回执的维护作业，不重开产品需求或启动另一个监听器主控；实际执行计数大于0，记录当前候 |
| L06 | PASS | exit=0/PASS | P4_8 | GIVEN 条目已隔离，当前源/目标许可后来重新满足，但旧受众或旧恢复 callback 已不适用 WHEN 恢复发布/消费 THEN 使用当前授权、新维护代际和独立审查/访问读回；不原样恢复旧 ACL，不让旧回调重加离组成员或覆盖新隔离； |
| L07 | PASS | exit=0/PASS | P4_8 | GIVEN 重复/乱序权限事件、隔离执行中断或远端结果未知 WHEN 恢复维护 THEN 按可信当前权限及同一 operation 调和，失败保留暴露未消除状态与告警，不重复派发或伪报安全；实际执行计数大于0，记录当前候选和环境；依赖缺失退 |
| L08 | PASS | exit=0/PASS | P4_8 | GIVEN 权限事件被漏报但登记资源仍可完整查询 WHEN 周期核验或故障恢复全量对账 THEN Comet 对实际权限差异登记同一幂等维护动作，按批准的检测/隔离时限计时；不能只重放事件游标或从通知到达才计算源变更检测时间；实际执行计数大 |
| L09 | GATED | exit=0/PASS | P4_8 | GIVEN Runner 进程宕机或仍有心跳但完整核验水位不再推进 WHEN 独立监控超过批准的阈值 THEN 在批准时限内告警；监督器仅重启原 Comet 服务，不产生第二业务 owner，不能把告警成功当作 Outline 已隔离；实际 |
| L10 | PASS | exit=2/FAIL | P4_8 | GIVEN 隔离 API 失败、限流或远端执行结果未知 WHEN 首次失败和快速隔离预算耗尽 THEN 首次失败即告警，Comet 持久保存调和/重试和升级；超时保留未消除暴露与违约，权限拒绝不盲重试，监听器/执行器不自行派生业务重试循环； |
| L11 | PASS | exit=0/PASS | P4_8 | GIVEN 宕机期间发生漏报、grant 到期、分享变化或迟到旧恢复写入 WHEN 原 Comet 恢复 THEN 暂停新发布，先调和未知写入，再完整对账并优先隔离；事件接收游标、完整核验水位、隔离证据分别维护，未覆盖对象或访问路径保持未知 |
| M01 | PASS | exit=0/PASS | P1_6 | GIVEN 本机 Superpowers 已停用，项目选择 Matt 基础方法 WHEN 初始化/分发/恢复 Classic 或加载方法 THEN 不自动安装、启用或调用 Superpowers，实际使用预先固定的 Matt 方法；仅保留的 |
| M02 | PASS | exit=0/PASS | P1_6 | GIVEN 本项目显式选择 Comet 单主控，而本机默认并行 planner 合同拥有自身执行/监督权 WHEN 需要规划或方法校验 THEN 只经明确兼容的方法/工具入口复用，不加载完整 controller 后无视其合同，也不隐式启动 |
| U01 | PASS | exit=0/PASS | P4_7 | GIVEN 作者自写批准记录，或者凭证的 issuer/approver 无对应源/目标权力、已过期或被撤销 WHEN 请求知识自动发布 THEN Comet 拒绝授权，不因有签名、PR 合并或 approved 字段就放行；实际执行计数大 |
| U02 | PASS | exit=0/PASS | P4_7 | GIVEN 候选由多个不同授权域的实际资料提炼，目标受众落在来源受众并集但不在其允许披露交集 WHEN 独立内容审查通过后请求发布 THEN 权限 gate 仍拒绝，审查通过不扩大资料授权，交有权主体处理明确范围；实际执行计数大于0，记录当 |
| U03 | PASS | exit=0/PASS | P4_7 | GIVEN 预授权与独立审查曾有效 WHEN 源权限、grant 或目标受众在实际写入前收缩/改变 THEN 写前复核阻断旧发布判定，不能靠旧快照继续或用同 operation 自动续期；实际执行计数大于0，记录当前候选和环境；依赖缺失退出 |
| U04 | PASS | exit=0/PASS | P4_7 | GIVEN 审查和批准绑定了候选版本 WHEN 作者修改标题、正文、附件/引用、目标集合或可见性 THEN 旧审查/发布判定失效，不能凭语义类似或同一文档 ID 沿用旧授权结论；实际执行计数大于0，记录当前候选和环境；依赖缺失退出非零/UN |
| U05 | PASS | exit=0/PASS | P4_7 | GIVEN 目标集合名字和 ID 符合 allowlist，但继承、单页/子树分享或公开入口使实际读者越界 WHEN 请求正式发布 THEN Comet 按有效受众拒绝，不向更大受众先写草稿再审核，也不自动改 ACL 使之通过；实际执行计数 |
| U06 | PASS | exit=0/PASS | P4_7 | GIVEN 源/目标权限分页不完整、principal 无法映射或权限 API 返回错误 WHEN 自动发布核验 THEN 保持 blocked，不能把未知当空集/公开，也不能只凭连接器服务账号能读就放行；实际执行计数大于0，记录当前候选和 |
| U07 | PASS | exit=0/PASS | P4_7 | GIVEN author、reviewer、publisher 与授权签发主体按受管角色隔离 WHEN 普通 Agent 尝试修改可信策略/批准、获取签发或超范围写凭据、调用任意集合/分享修改 THEN 被实际受管权限/发布入口拒绝并审计， |
| U08 | GATED | exit=0/PASS | P4_7 | GIVEN 合法 owner 的预授权有效，真实输入来源完整，当前源/目标权限和 payload 均匹配，独立审查通过 WHEN Comet 执行已登记的允许发布操作并完成独立读回 THEN 自动接纳对应知识回执并继续同一 Run，不重复人 |

差异说明（仅 1 项，已如实上报不静默改判）：A11 索引 VERIFIED、场景 verdict=PASS（其自身 2 个测试点全绿），但合同检查 V_A11 因共享模块 3_4.mjs 内 B08 两个点在漂移宿主 openspec 下失败而 exit 2 —— 归入 ENVIRONMENT_GATED（holder=HOST_OPENSPEC_DRIFT），finding F-1。

## 5. 69 工作包处置（任务步骤级）

tasks.md 共 39 个 `### Task` 节点（30 原任务投影 + 8 基础设施 I01–I08 + VERIFY）+ 末节 69 个工作包子 ID 行。checkbox 全量核对：**217 已勾 / 38 未勾**，未勾 38 项全数显式处置：

| 未勾项 | 数量 | 处置 |
| --- | --- | --- |
| 原任务 1.1–5.3 别名行 | 26 | 机械别名区（“原任务状态与机械别名”），文档明示进度以 Schema2 投影为准、原文逐字保留不改勾 —— 非未完成工作 |
| P1_6 Step 5 | 1 | 显式处置：跨宿主会话实证未做，node_status PARTIAL_ACCEPTED，holder=P1_6 owner+宿主环境（M01/M02/B01/B09 证据仍全绿） |
| P5_2 Step 1–4 | 4 | 显式处置：CROSS_MACHINE_SCOPE_NOT_ENABLED（用户未启用跨机范围）；未启用分支由 5_2.mjs 真实证伪（J1/J2/J3），F10 保持 UNVERIFIED，holder=P5_2 owner+用户裁决 |
| I01/I02/I03/I05 Step 3 | 4 | 显式处置：独立读回需真实外部资源（GitHub TLS 拦截 / 真实 container / 真实 Outline / 真实 deepwiki），全部如实 UNVERIFIED，holder 见 execution-state node_status 各条 |
| VERIFY Step 1–3 | 3 | 本节点交付（本报告+grill+results+worker report+commits） |

## 6. 环境门控与承接者（GATED/UNVERIFIED/FAILED 汇总）

| 项 | 类别 | holder | 解锁条件 |
| --- | --- | --- | --- |
| A14/A16/A17 | GATED | 环境 owner + 运行时准入（真实 Registry endpoint / 隔离环境登记后，release.mjs --registry/--environ… | 真实 Registry endpoint/隔离环境登记后 release.mjs --registry/--environment 指向真实形态 |
| B08/C08 | GATED | 宿主全局 openspec 漂移 1.3.1→1.14.3（open decision HOST_OPENSPEC_DRIFT，owner: user）；重钉 … | 用户重钉 openspec 1.3.1 / 迁移基线 1.14.3 / 显式重冻结三选一裁决 |
| F06 | GATED | 平台准入 owner（真实注册 delivery-gate required check + secrets.SDD_DELIVERY_LAUNCHER_AUT… | 平台准入 owner 注册 delivery-gate required check + secrets + GitHub runner 端到端 |
| F08 | GATED | 具备原生浏览器能力的试点环境（UI 试点任务；正相原生浏览器验收与独立业务读回）… | 具备原生浏览器能力的试点环境 |
| F09 | GATED | 平台准入 owner + 环境 owner（真实 CI 验证与提升贯通到目标环境；A14/A16/A17 的生产侧同批闭合）… | 平台准入+环境 owner：真实 CI 验证与提升贯通 |
| H04/H05 | GATED | I03 Outline 独立资料域实际部署后实测 documents.create/info 读回与 MCP 参数暴露（P4_6 残留项）… | I03 Outline 独立资料域实际部署后实测 |
| H09 | GATED | 第二物理宿主认证（P5_1/跨机范围显式启用裁决）+ authority 对抗性防伪造（同 OS 账户改写绑定文件）… | 第二物理宿主认证+authority 对抗性防伪造 |
| L02/L04 | GATED | I03 Outline 部署后资源端隔离实测（Web/直接链接/分享/搜索/附件渠道真实读回；P4_8 残留项）… | I03 Outline 部署后资源端隔离实测 |
| L09 | GATED | I07 监控真实部署 + 批准时限的真实墙钟实测（90s 心跳/120s 水位/5 分钟端到端；P4_8 残留项）… | I07 监控真实部署+真实墙钟时限 |
| U08 | GATED | 真实 Outline 试点集合/实例不可变 ID 与受众登记 + 受保护签发工作流与 issuer 凭据（I03 + 运行时准入；P4_7 残留项）… | 真实 Outline 试点集合登记+受保护签发工作流 |
| F10 | GATED | P5_2 owner + 用户跨机器范围裁决（CROSS_MACHINE_SCOPE_NOT_ENABLED；tasks.md P5_2 明示未执行的正向隔离恢… | 用户跨机器范围显式启用后实施正向隔离恢复认证 |
| V_A11（检查层） | GATED | HOST_OPENSPEC_DRIFT（owner: user） | 同 B08 裁决；解锁后 3_4.mjs 整模块复跑即恢复 exit 0 |
| V_NPM_REGRESSION / V_SCOPED_REGRESSION | GATED | HOST_OPENSPEC_DRIFT（owner: user） | 同 B08 裁决；其余 423 项零新增失败 |
| V_F10 | UNVERIFIED | P5_2 owner + 用户跨机器范围裁决 | 跨机范围启用后建设 services/delivery-control 并执行正向隔离恢复认证 |
| V_FULL_CHECK | FAILED（base 起 pre-existing） | repo/skill owner（绿夹具 6 个 artifacts 文件从未提交） | 补提交 fixture 缺失 artifacts 或修 ledger 后 check.sh 恢复贯通 |
| V_INFRA_I08 | FAILED（命名偏差） | I08_FILENAME_DEVIATION（owner: user/plan-owner） | 机械改名 infra-backup-restore→infra-recovery 或改合同文件名；机制证据 13/13+4/4 已全绿 |

## 7. 完成判定核对（四条硬门）

1. **零剩余 required 波次**：Schema2+工作包区除上表显式处置项外全勾；6 个 PARTIAL 节点（I01/I02/I03/I05/P1_6/P5_2）步骤级缺口全部为环境门/未启用门且带 holder —— 无未显式处置的 required 剩余。**满足**。
2. **无未解决 P0/P1**：open_decisions 9 项（UTILS_SECRET_REF、PUBLISHER_ISOLATOR_CREDS、EVIDENCE_INPUT_MISSING_EXIT_CODE、DELIVERY_CASES_NODE_PIN、I08_FILENAME_DEVIATION、OV_OVERLAY_CANDIDATE、HOST_OPENSPEC_DRIFT、REMOTE_URL_DISCREPANCY、GH_AUTH_TOKEN）逐项核对：全部为用户裁决类（工具钉定/凭据/生产端点/命名 canonical/语料处置/推送目标），无一阻塞本机实施与验证证据链；其中 4 项直接构成本报告 GATED/FAILED 的 holder（HOST_OPENSPEC_DRIFT→B08/C08/npm 对；I08_FILENAME_DEVIATION→V_INFRA_I08；GH_AUTH_TOKEN→I01 Step3）。**满足（如实标注，不冒充关闭）**。
3. **三方一致性**：自研对账脚本核对 tasks.md checkbox ↔ execution-state node_status ↔ worker-reports：39 节点全覆盖、状态与勾选零矛盾、node_status 引用 commit 全部可解析。发现 2 项证据指针缺口（见 findings F-8/F-9，非阻塞、超出本节点允许改动范围，如实上报）：execution-state.P3_4.review 引用的 worker-reports/P3_4.review.json 在任何分支均不存在；I01.json 无 evidence 字段且无 I01/ 证据目录（其回执依赖 I01.review.json 与 git 提交链）。**满足（差异已显式上报）**。
4. **基线绑定**：git rev-parse HEAD=`68f79635d1fd5f6c0cddd40321692ee0b91ed4a9`；spec-baseline.json sha256=`a89cfcf9cde72459df180e7ca11ca9be5b1b402f894f05d82984f5ba8025d86a`（与 halt refreeze 记录一致）；execution-contract.json=`0250b905377c681b7d3cb93833adefe1365566696283f4017dc9a2d2b31e2a8a`；acceptance-index.json=`7e800fc81197a35e4ec4f70a30ebd6eb7f1b84dfac0c26813c2bcb67150c9a2b`；verification-case-plan.json=`18a14185a38f1ee6b93871860d08cc82e5fb750a84f02747a749360af18e9a33`。**满足**。

## 8. 发现清单（findings，全部如实上报，未静默修复）

- **F-1** V_A11 检查层 FAIL 为共享模块交叉污染：3_4.mjs 同文件承载 A11 与 B08 点，B08 两点在漂移宿主 openspec 下 fail-closed 拖累整模块 exit 1；A11 自身点 2/2 绿。建议后续将 B08 点隔离到独立文件（归 P3_4 owner）。
- **F-2** 1_2.mjs uninstall 断言无 stderr 捕获：V_F02/V_F04 初跑 uninstall exit 1（空 stderr、无夹具差异、立即复跑 PASS），负载诱发瞬态无法定因到语句级。
- **F-3** 4_8.mjs:406 JSON.parse 无空读保护：SIGKILL 竞态测试窗口内读到截断 JSON（V_L10 初跑 FAIL、复跑 PASS）。
- **F-4** 全新工作树缺 gitignored `hooks/.compiled.env` 会使 4_5.mjs 4/5 失败；已用真实 adapter 编译修复本工作树（与 execution-state“whitebox 夹具缺口 pre-existing”同类）。
- **F-5** check.sh 绿夹具缺口属仓库内容缺口（ledger 引用 6 个 artifacts 从未提交于任何分支），非工作树特异性。
- **F-6** 已提交证据文件 P1_6/evidence/green-3-contract-check.json 非 strict JSON（“Extra data: line 2”），静态校验会失败。
- **F-7** acceptance-index 个别指针为语义绑定而非字面测试 ID（M02→1_6.mjs 无字面 “M02” 点；复验经 P1_6.json targeted+evidence 文件+commit 链闭合）。
- **F-8** execution-state.node_status.P3_4.review 引用 worker-reports/P3_4.review.json（“APPROVED, 0 blocking”），该文件任何分支均不存在——引用悬空。
- **F-9** worker-reports/I01.json 无 evidence 字段、无 I01/ 证据目录；I01 证据链依赖 I01.review.json 与 node_status 提交链（95ee00b/b1b4be7/64841ef）。
- **F-10** V_INFRA_I08 合同命令引用的 test/infra-recovery.test.json 不存在（I08_FILENAME_DEVIATION 的合同侧体现）；实际文件 infra-backup-restore.test.js 13/13 + i08.mjs 4/4 全绿。

## 9. 证据索引

全部原始执行日志：`worker-reports/VERIFY/evidence/`（journey-A/B/C/D/E/F/H/L/M/U.txt、npm-test.txt、infra-tests.txt、combined-cases.txt、check-sh.txt、comet-native.txt、openspec-strict.txt、delivery-cases-modules.txt、acceptance-resample.txt、consistency-audit.txt）。结构化逐项结果：`verification-results.json`。逐场景质询：`grill-report.md`。

