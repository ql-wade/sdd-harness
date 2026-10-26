---
name: whitebox-verify
description: >-
  验证代码变更和真实用户流程，排查功能不工作，执行 E2E/end-to-end、白盒验证、Journey 验收、浏览器交互检查和截图取证。
  当用户要求“前端改好了帮我验收”“检查按钮/表单/登录/保存是否生效”“在内置浏览器验证并截图”“验证修复/回归/跨服务终态”时使用。
  对含 UI 的功能验收优先发现并使用当前 agent harness 原生浏览器，连接请求证据、截图与业务终态回读；本地无 UI 规则走 Slice。
  写测试、设计用例、生成自动化脚本转 test-authoring；本技能只做独立验证和验收。纯翻译、一般网页阅读、仅截图无功能验收、仅颜色间距对齐不触发。
metadata:
  version: "2.5.0"
---

# Whitebox Verify

目标：用本次实际执行的证据证明用户操作、接口/事件与业务终态一致。加载技能、生成测试、页面渲染、截图或 STRUCTURE_PASS 都不能单独证明功能完成。

## 职责边界

whitebox 独立检查需求、源码和已有测试覆盖，核对作者交付设计，派生已有需求/契约差异的诊断探针，执行已批准测试、原生浏览器操作和权威回读，组装并冻结验收范围与证据。不得发明业务 oracle、设计缺失用例、编写/修改测试或产品/配置来转绿。缺必要场景、断言、脚本或可信期望时登记缺口并交回 `test-authoring`；已有批准测试/手工用例无需为普通 Debug 强制改制 TestPack。作者自检不等于验收通过。操作与探针必须来自可追溯需求/契约及授权范围，不借诊断补做测试设计。先读 `references/acceptance-handoff.md`。

## 默认触发与执行入口

用户要求验证功能、验收前端变更、回归修复、E2E 或交互截图时，主动加载本技能，不要求用户念出技能名。description 负责可发现性；隐式触发是否生效仍须用目标 harness 的新会话验证，不能靠元数据声称“保证自动调用”。

1. 从用户/当前工作区确定可信项目根，再接收 TestPack 或已有批准测试/手工用例，审查原始需求、源码、调用者和已有测试；核对目标环境/构建与作者交付的成功/失败终点。
2. 按下表选模式；含 UI 的任务**在任何模式下都先读 `references/browser-execution.md`**，发现当前 harness 能力、读取其原生浏览器技能/工具文档，再决定具体 API。没有 Chrome MCP 不等于没有浏览器。
3. 审查交付用例、操作、断言、终态判定点与证据计划，补齐并冻结本模式所需的验收元数据后执行；schema 3 scope-plan 只在所选 Journey/Slice 契约要求时使用。缺失设计交回作者；检查不授权修改测试、产品或配置。
4. 记录真实步骤、结果与证据；修复后重跑受影响路径；交付截图与未验证项。未执行标 planned，不得编造调用、时间、截图路径或子代理活动。

| 用户意图 | 模式 / 按需阅读 |
|---|---|
| 写/设计/生成测试、补用例、自动化实现或测试修复 | 转 `test-authoring`，不在验收角色中编写 |
| “按钮为什么不工作”、前端交互排查 | Debug；主文件 + `references/debug-decision-tree.md`、`references/quick-reference.md`；实操再读 `debug-methodology.md`、`debug-workflow.md`、`debug-io-contract.md` |
| 验收跨模块/服务/持久化/异步消息/权限边界的实质性变更 | Journey；`references/journey-contract.md` 为权威，`references/test-dimensions.md` 选维；含 UI 追加浏览器入口 |
| 单个无跨边界本地规则或组件修复 | Slice；读 Journey 契约的 Slice 节。无 UI 不开浏览器、不要求截图；纯函数使用返回值/异常的独立期望，不虚构数据库 |
| 需要报告 | 保持按任务范围选定的模式，使用 `references/report-template.md`，不因“写报告”改走 Debug |
| 仅颜色/间距/布局对齐 | 转 `ui-alignment`；若还需功能验收，再使用本技能 |

Debug 的 Mode A=前端、Mode B=Agent/后端；与 Journey 维度无关。Debug-A…H=功能/渲染/UX/集成/权限/数据/性能/并发；Journey-A…J=业务/浏览器/无障碍/持久化/权限/契约/并发/补偿/兼容/CI。报告必须保留模式前缀，禁止跨模式借用字母。

## 浏览器与 E2E 共同门槛

- 工具优先级：用户明确指定 → 当前 harness 原生浏览器 → 已配置浏览器工具 → 项目现有 Playwright runner。先发现能力再回退；不安装多套工具，不用 CLI 替换用户要求的内置浏览器。
- 从实际 DOM/快照构造语义定位器，一次交互后观察预期效应；等待具体 DOM/URL/响应状态，不把固定 sleep、`networkidle` 或 document.readyState 当业务完成。
- 核心用例覆盖成功、相关错误/权限/边界，以及保存后刷新/重新进入的状态；真实第一方 API 与终态系统不可被 route/fulfill、HAR replay、假成功 toast 替代。
- 用户要求截图或 UI 验收时，捕获加载态、关键操作终态及失败现场；按原生工具协议实际展示图像，并提供可访问产物或原生附件。DOM 快照不是截图，路径不是已交付图片。
- 原生浏览器不支持网络/console/trace 等能力时逐项记缺口；可用同一次真实请求的服务端接收日志补充链路证据，不能冒充浏览器网络/console/trace，也不能替代 Journey 冻结的必需证据。
- Journey 沿用原有 ledger、route-scan、身份/摘要、终端回读及校验器门槛；仅 IAB 交互证据不足时保持未闭合，不能为了通过而改弱 schema。
- 失败先区分产品缺陷、测试缺陷和环境问题，附证据交回相应作者；本技能不自动修复。不得放宽业务断言、删除必测场景或把 skip/fixme 算成功；重试转绿保留不稳定状态，修复后另开明确的新运行确认。
- 新鲜证据先于完成声明；报告测试命令、退出码、失败/跳过/重试计数与实际覆盖范围，不用 agent 自述代替独立复核。

## Debug 验证矩阵

对每个维度判断适用性并独立登记证据，不能把未测写成 PASS。核心 UI 用例至少覆盖 Debug-A/B/C/E；无攻击面或无持久化等项需要仓库依据。Slice/Journey 使用各自选维规则，不能强迫无 UI 任务执行浏览器检查。

| 维度 | 检查与证据 |
|---|---|
| A 功能 | 用户操作、状态转换、请求/响应断言及反向用例 |
| B UI 渲染 | 实际浏览器 DOM、关键截图、实际可观测 console；缺能力记未验证 |
| C UX | 错误/空/loading 状态、操作反馈、可逆性 |
| D 集成 | mutation 后跨服务、缓存与关联视图的效应传播 |
| E 权限 | 相关用户/角色/租户的允许与拒绝路径；不自动扩成安全扫描 |
| F 数据 | 实际 schema/事务/迁移与独立终态读回 |
| G 性能 | 相关日志、SQL 数量、等待耗时；不自动扩成负载测试 |
| H 并发 | 相关幂等、版本冲突、并发一致性 |

非适用项在适用性表解释；现有 verdict 微格式没有 N/A 值，无法验证项仍按契约写 UNVERIFIED+证据，不伪造 PASS。系统安全审计、完整性能分析和跨浏览器兼容性不属于默认范围。

## 验证纪律：踩坑铁律（持续追加）

> 每条来自一次真实的 false-green 或误诊。核心教训：**plausibility is not correctness**。完整展开（事故背景 / 操作要点 / 正反例）统一收敛在 [`references/iron-laws.md`](./references/iron-laws.md)；铁律 6-9 的规范正文与 few-shot 另见 [`references/verification-completeness.md`](./references/verification-completeness.md)。

| # | 铁律 | 规则句 | 一行事故教训 |
|---|------|--------|--------------|
| [1](./references/iron-laws.md#iron-law-1) | 追完整执行链 | 「日志里没有 X」≠「X 没发生」；grep 零命中先确认上游执行到了那一步 | grep 零命中当"未发生"，实际 MCP discovery 阻塞致 chat 根本没 dispatch |
| [2](./references/iron-laws.md#iron-law-2) | 陈旧状态 vs 当前行为 | 异常先问是持久化残留还是当前逻辑；重启清内存清不了 PG | 旧 session 的 ASKING 持久化在 PG，误诊为当前权限 bug |
| [3](./references/iron-laws.md#iron-law-3) | 查数据再读代码 | 行为异常先 SELECT 实际值，再读代码路径 | 代码路径全干净，SELECT 出手动 SQL 残留脏数据才是根因 |
| [4](./references/iron-laws.md#iron-law-4) | UnresolvedCompilationProblem | 先 `clean compile` 再调查 | ECJ 把语法错误编成"运行时抛异常的桩"，掩盖被截断的 log.debug |
| [5](./references/iron-laws.md#iron-law-5) | 日志时间戳间距 | 时间戳 delta 直接暴露串行/并行/阻塞模式，无需 profiler | 三个 MCP server 各隔 30s → 串行假死 90s |
| [6](./references/iron-laws.md#iron-law-6) | 两级动词 | 「入口在」≠「闭环通」；未达 L3 不得标 ✅ | 按钮 + grep 到端点就标 ✅，实际交互从未触发该 API |
| [7](./references/iron-laws.md#iron-law-7) | 旧 verdict 一律重推导 | 历史 verdict 只当线索；每次重新核对当前代码+浏览器+wire | 旧 issue 标 ❌ 的功能，浏览器里实际已建好 |
| [8](./references/iron-laws.md#iron-law-8) | 关闭前残留登记 | 先登记带 owner 的跟踪 issue，后关闭，顺序不可逆 | #158 关闭后才补 #407，残留项在关闭瞬间"丢失" |
| [9](./references/iron-laws.md#iron-law-9) | 逐 TC 8 维最低门槛 | 核心用例至少 A+B+C+E；缺维标 🟡 不虚标 | 8 维只跑 happy path 就声称领域通过，漏 E/C/F |
| [10](./references/iron-laws.md#iron-law-10) | 确定性证据纪律 | 条件等待 / 确定性数据 / 证据可复核 / 重跑不一致两级归因 | 固定 sleep 与"重跑到通过为止"制造 flaky 假绿 |
| [11](./references/iron-laws.md#iron-law-11) | 浏览器外证据 | UI 终态 ≠ 业务完成；外部副作用在效应系统内独立取证 | 页面显示"已发送"，邮件服务从未收到请求 |
| [C1](./references/iron-laws.md#iron-law-contract) | 三维度契约一致性（模式 A） | method / URL / 参数位置三维比对，任一不一致即 P0；不看后端代码无法确认前端调用正确 | 凭"感觉"写 URL/method/body 是一批 P0 的共同根源 |
| [C2](./references/iron-laws.md#iron-law-crud) | CRUD 全链路验证（模式 A） | READ 通过 ≠ 功能正确；C/R/U/D 全闭环 | GET 200 渲染正常，DELETE 打出 /undefined 400（e.id vs rowId） |
| [C3](./references/iron-laws.md#iron-law-graph) | 功能图谱关联验证 | 任何功能是有向图；遍历每条 edge 验证效应传播；修复后重跑全部 edge | 只验 edge 1 就 PASS，仪表盘永远"暂无记录"，修复时又剥出 4 层缺陷 |
| [C4](./references/iron-laws.md#iron-law-config) | 配置优先修复原则（模式 B） | P0 配置 > P1 启动参数 > P2 业务数据 > P3 源码 | tools.json allowlist 扩容即解决工具被过滤，零源码改动 |

**Anti-pattern #20**（把 UI 终态当业务完成）：UI 是效应的投影不是效应本身；凡有浏览器外节点，必须在该节点所在系统内取证一次——与铁律 11 配对执行，权威文本在 [`references/anti-patterns.md`](./references/anti-patterns.md) #20。

**验证者隔离与结果态优先**：verdict 只从原始证据推导，禁止参考被验证方自述（衔接铁律 7）；PASS verdict 抽样审计；Slice TDD 套 fail-to-pass + pass-to-pass 双门禁，Journey 查终端系统状态而非过程输出，判定保留 Unknown 出口（不强迫二值）→ 详见 [`references/verification-completeness.md`](./references/verification-completeness.md#verifier-isolation)。


## 报告与校验

报告使用 `references/report-template.md`；Agent/后端深度调试再读 `references/agent-debug-workflow.md`、`agent-debug-template.md`。报告保留 run/case、来源版本、harness/浏览器/tab/viewport、步骤→预期→实际→证据、失败与能力缺口、截图展示/产物、终态回读及回归命令。

- Debug 每维一行：`VERDICT|Debug-A|PASS/FAIL/UNVERIFIED/EVIDENCE_UNSTABLE|evidence-ref`，四态都要证据；终局禁 planned。执行 `python3 scripts/lint_debug_verdicts.py <report.md>`。
- Journey 执行 `python3 scripts/validate_journey_evidence.py <ledger.json>`，失败保持 RED；`STRUCTURE_PASS` 只证明结构，执行与真实性仍需原始工具输出。`scripts/render_journey_summary.py` 仅渲染派生汇总。
- 修改校验器后执行 `bash tests/run_all.sh`；技能触发/执行行为用 `tests/behavior/cases.json` 做隔离压力评测，并保留原始决策及正反例，不能用字符串匹配代替行为评测。
- finding 用 P0阻断/P1降级/P2体验，附置信度和复现证据；环境失败记录环境限制，不算产品缺陷。详见 `references/verification-completeness.md`。

## 按需参考

- 浏览器适配、截图、E2E 执行：`references/browser-execution.md`。
- 工具降级、超时与 3-Strike：`references/debug-io-contract.md`。
- 缺陷模式：`references/anti-patterns.md`；网络拦截可选实现：`references/network-interceptor.js`，仅在运行时明确支持注入时使用。
- 作者交付物的工程、契约与追踪审查：`references/professional-testing-patterns.md`；测试设计/实现交 `test-authoring`。
- 图与命名：`references/mermaid-guide.md`、`references/naming-traceability.md`；交付设计审查反幻觉：`references/domain-ux-few-shot.md`。
- 采纳来源与排除理由：`references/upstream-sources.md`；历史变更：`references/history.md`。
