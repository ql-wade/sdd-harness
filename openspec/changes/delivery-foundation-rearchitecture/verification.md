# 本批验证与交接

时间：2026-10-19T15:39:56+08:00

范围：Batch 0 架构文档迁移。无运行时代码、依赖、hooks 配置或 vendored 技能修改。ADR-0019 为提议；未做共识评审，未将未来能力标 ready。

## 已执行命令

| 命令/检查 | 真实结果 | 证明边界 |
| --- | --- | --- |
| openspec --version | 1.3.1 | 本机校验器版本 |
| openspec validate delivery-foundation-rearchitecture --strict | exit 0，Change is valid | 规格结构有效 |
| openspec status --change delivery-foundation-rearchitecture --json | 四件 artifacts done，isComplete=true | 仅指 proposal/design/specs/tasks 材料齐全；实施任务未完成 |
| 本地场景 ID 和新增架构/ADR/design 链接检查 | 40 个唯一 ID，链接可解析 | 静态检查，不表示场景已执行 |
| git diff --check | exit 0 | 已跟踪修改无空白错误 |
| bash scripts/check.sh（当前工作区） | exit 1；规则/技能检查通过，Whitebox 夹具 os.utime 受 .agents 只读沙箱阻止 | 环境限制，不能算总检查通过 |
| bash scripts/check.sh（独立可写临时副本，同一内容） | exit 1；Whitebox GREEN/负例 8/8、共识 gate 回归通过；npm test 46/47 | 绕开只读夹具问题仍有既有 Node 25 测试发现问题；后续 YAML/JSON 段未执行 |
| npm test（当前工作区） | exit 1，46 pass / 1 fail / 47 total | Node v25.2.1 自动发现浏览器 .ts 夹具，document is not defined |
| npm test（git archive HEAD 未修改基线的独立副本） | exit 1，46 pass / 1 fail / 47 total | 同一个夹具同一错误；失败不是本次文档引入 |
| node --test test/*.test.js | exit 0，41/41 | 显式选定真实回归套件通过，不能代替 npm test 或总入口通过 |

失败夹具：test/fixtures/probe/source-debug-injection/src/main.ts:1。默认 node --test 在当前 Node v25.2.1 将其直接执行，document 不存在。未改测试发现策略或放宽断言；这是另一个工具链兼容问题。

## 未验证与下一门

- A01–A20、B01–B10、F01–F10 都是待执行场景；本批仅完成规范迁移。
- 未安装/运行 TeamAI、Comet；未确认实际 npm 产物与固定源码一致；未认证宿主 Guard/浏览器或远程 workflow。
- 未完成架构全票共识，未批准 ADR-0019；未生成 planner 执行交接或声称通过其 plan_guard。
- 未接入可信 Runner、真实业务、规格收尾链、平台 required checks、部署/回滚/API。
- 下一批先验证固定产物、配置组合幂等、写 driver 与开发子任务接口。具体业务试点、验证环境及 owner 在 Batch 3 前确定。
- 本设计可直接审阅；目标设计批准和实际运行通过分开记录，不因静态材料齐全推进上线状态。

## 后续单主控 Grill 更新

本轮下载并只读检查 npm @rpamis/comet@0.4.5 发行包，SHA-512 与 registry integrity 一致，元数据存 comet-package-baseline.json。实际 npm gitHead 与初始研究 commit 不同，未混用。未安装依赖、未运行 Comet 或知识服务。静态发现与待执行七项实证见 comet-single-controller-review.md。

用户范围已更新为 TeamAI 仅分发、Comet 唯一主控候选、目标后默认自动推进；同步修改 proposal/design/tasks/规格 F07 和入口。git diff --check、openspec validate delivery-foundation-rearchitecture --strict 通过。仅设计/静态证据更新；没有重跑无关实现回归，也不据此关闭运行验收任务。

## Classic 接入细化

用户已允许最小受控扩展、禁止再造主控。新增 classic-integration-design.md、C01–C08 场景；总场景 48 项，仍全部是待执行规范。当前新增判定探针使用实际 OpenSpec 1.3.1 status 与发行包原样 requiredArtifactClosure 纯函数，得到缺 requires 的兼容拒绝；只证明该边界，不是完整 adapter 运行。证据 classic-openspec-compatibility-probe.json。

本轮仅文档/规范与来源证据更新，检查为 git diff --check、openspec validate delivery-foundation-rearchitecture --strict 及本地场景/JSON/链接静态核对；不把它们视为运行实现验收。

## A/T 独立审查与运行时门禁契约

用户已选择架构与测试设计都独立自动审查；新增 classic-gate-runtime-contract.md 及 D01–D08 场景，总计 56 项待执行场景。源码静态核对覆盖 Classic store 的锁/事务、resolver 的 archived→completed、直接转换入口和 tasks checkbox 归一化。

本轮检查：git diff --check、openspec validate delivery-foundation-rearchitecture --strict、56 个场景 ID 唯一及新增文档本地链接可解析。未改运行代码，未执行 Comet/知识服务；所有 gate 行为、返工和恢复均尚未运行验证，R09 失效保守程度待确认。

## 知识关闭、架构方法与 Ponytail hook

用户确认 R09 首版需求/设计变化全部下游证据失效；架构步骤要求 grill-me 与 consensus。新增 classic-closeout-and-hook-contract.md，区分产品验收、规格归档、Outline 发布和整体完成；所建议 R06 关闭顺序仍待确认。E01–E06 为新增待执行场景，总计 62。

本轮只读本地 Ponytail 5.3.2 的 Codex 插件元数据、claude-codex-hooks 注册、activation/runtime/subagent 源码，观察 SessionStart/SubagentStart/UserPromptSubmit 与保会话静默失败路径；没有执行 Hook，没有改装配/信任/缓存，没有启动三方外部共识，没有发布知识。仅更新架构与规范，执行 strict OpenSpec、git diff --check、场景 ID 和链接检查，不把历史审计或上游测试当本轮产品证明。

## 归档后 Outline 恢复和重复触发

R06 用户确认：项目知识先卡归档，必需 Outline 可归档后继续但卡整体完成。新增 classic-post-archive-recovery.md 与 H01–H09，总计 71 项待执行场景。源码确认原生已有 pending archived delivery 的发现与选择路径，但判断集中于 Git delivery，且 archive/resolver 存在提前 completed/清当前选择的路径。

只读获取当前 Outline 官方 OpenAPI，确认 documents.create 可指定 UUID、documents.update 可用 lastRevision 并约定 409；观察与源码摘要见 outline-public-api-observation.json。未连接/写入实际 Outline，未验证部署版或 MCP 参数，不能称为远端幂等实证。

本轮检查：strict OpenSpec、git diff --check、71 项场景 ID 唯一与新文档本地链接/观察 JSON。未执行 Comet、Hook、评审或发布，无新安装/活配置改动。R01 权威 Runner 位置和 R10 工作区保留仍待决定，单主控不能被解释成不同机器复制状态后有全局去重保证。

## G04 预授权与防自批

用户确认预授权内独立审查自动发布，超范围/敏感交有权人。新增 knowledge-preauthorization-contract.md 与 U01–U08；当前共 79 项待执行场景。官方 GitHub 权限列表、Outline 分享规则与现有 OpenAPI 已读取；飞书权限入口仅定位，页面无完整正文，未验证源实例或完整企业规则。

本轮未签发 grant、未查询私有权限、未运行独立审查或发布；仅设计/规范修改。检查 strict OpenSpec、git diff --check、79 个场景 ID 唯一及新文档本地链接。真实隔离/权限闭包/发布/持续撤权仍未验证，首期受管范围 G13 待确认。

## 技能整理聊天核对与已发布知识维护

通过 read_thread 读取用户引用的技能整理聊天最新 5 回合，最新多代理/20分钟/Journey 请求当时仍在执行；读取当前工程路由和停用验证报告，本轮抽查 Matt 入口与 Superpowers 标准发现路径/Claude 插件 false。不能宣称本轮全量原生重扫或另一个聊天的长期完整流程已完成。

当前共享 planner 已采用 Matt 且自身拥有执行/监督合同；仓库旧 vendored planner 和原生 Classic 仍有 Superpowers 调用，显式 Comet 目标与默认路由必须隔离，不能偷偷套两层 controller。新增 matt-method-profile-migration.md 记录此边界，没有改全局技能或插件。

G13 已确认登记源域/专用文集。新增 knowledge-revocation-and-restoration.md 与 L01–L07/M01–M02，总场景 88。官方 Outline 分享/操作面已读取，未查询私人 ACL、执行隔离/恢复或调用维护 Run；G14 保证强度仍待决定。

本轮仅设计/规范变更，执行 strict OpenSpec、git diff --check、88 个场景 ID/本地链接静态检查。运行时、持续撤权、全部访问路径和方法迁移的真实验收仍未执行。

## G14 事件＋周期核验、故障告警与补偿

用户已选 G14 A。撤权恢复契约新增正常依赖检测 3 分钟/隔离读回 2 分钟、Runner 外监控 2 分钟判障＋30 秒告警送达等推荐配置；数值与 G15 故障覆盖边界尚待确认。单 Runner 或目标权限 API 不可用时不能承诺 5 分钟资源端隔离，违约不得通过暂停计时抹去。监控只告警，进程监督器只重启原实例，Comet 保存唯一业务 operation/重试/补偿；未新增常驻服务或运行时实现。

新增 L08–L11，总计 92 个待实证场景。已执行 openspec validate delivery-foundation-rearchitecture --strict（有效）、git diff --check（通过）、92 场景 ID 唯一/本地链接检查（通过）。未运行故障注入、计时、监控、Comet 维护或 Outline 隔离，数值没有真实 SLO 证据。

本轮重新 read_thread 读取两个引用聊天的最新回合；技能整理聊天已报告本地 CLI Journey 通过，但真实 20 分钟监控回执仍在等待，不能把该聊天整体标为已完成。

## G15 A 已确认

用户选择 A：正常依赖下以 5 分钟完成隔离和独立读回为目标；故障期间独立告警、原实例恢复补偿和人工应急，允许超时但保留暴露窗口/违约。同步撤权契约、架构与实施任务；细分运维参数仍需准入实证。严格 OpenSpec 校验通过；本轮只更新设计，无运行时隔离或故障计时实证。

## 执行授权、R10 A 与可复现基线

用户要求计划、端到端实施和验证，R10 A 已确认；更新了保留契约/任务与 DAG 未决标记。取得固定 Comet 精确源码并实际隔离构建、generated check；原版 smoke 243通过/2skip，OpenSpec1.11.0 隔离上游兼容1/1。源码状态白名单和 hook 控制文件写入缺口已登记，尚未实施 managed Runtime。

发现 Node25误执行浏览器 .ts夹具；package.json 改显式 test/*.test.js，严格 package-contract 同步，未改业务断言。真实 RED 保留，Node24/25各41通过，独立只读审查接纳该有限修复；可写副本check.sh全通过。活目录只读夹具失败仍保留。原始日志/运行版本绑定在 .local/delivery-foundation-baseline，摘要与结论见 verification-results.json、verification-report.md。

架构三方共识首次启动失败/ABSTAIN；重试被自动审批以具体资料及目的地披露授权不足拒绝，已向用户明确请求授权。未绕路外发、未减少 quorum。Goal保持active，监控sdd已创建读回后因用户动作阻塞暂停，授权后复用同一监控。92目标场景不因基线回归而标为验收通过；正式执行锁、真实平台与最终Journey仍未完成。
