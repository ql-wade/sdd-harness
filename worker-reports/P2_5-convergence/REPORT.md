# P2_5 收敛建设候选

仅交付原 P2_5 的适配器与测试建设候选，等待 Root 独立双审与主检出集成。whole P2_5、E03/E04/H06 的生产资格以及 N04/N06 真实方法/语义审查均为 UNVERIFIED；业务场景接纳数为 0。未改任务、DAG、合同、锁、主检出或活配置，未启动 I02、模型、Docker、外部 API 或秘密读取。

## 变更与依据

三份源文件：`lib/adapters/architecture-review.js`、`test/architecture-review-adapter.test.js`、`test/delivery-cases/2_5.mjs`。依据为当前 tasks P2_5、收敛架构、ADR-0020、合同 680f5be6…及 Root 已激活的 P2_5←P2_4 建设边。基点 ddb7849，源输入逐项摘要见 `candidate-inputs.json`。

- 原 T 失败来自子测试没有固定 TAP reporter；保持原断言，指定 reporter 后有实际执行数。
- 完成的共识重新核对当前制品、原票和真实 finalize 报告。原 tally/票/报告保持不变，重复票不覆盖，revision 即使恢复同字节、复用同 ID 也不继承旧 manifest。
- `managed` A 准备读取原 SDK collection、grill 闭合来源、三份不同执行/主体的原始 ballot 字节与机械 manifest/tally/finalize；当前 policy、ActionBinding 与材料一致才得到纯查询。
- `managed` T 只读取一份独立语义审查来源。原报告、原方法 trace、目标 TestContract、逐 case/oracle/check、环境与清理结论均绑定；完整字段、strong 标签和已认证执行本身不能覆盖独立“不充分”结论。
- 纯查询每次再匹配原 host 已读取的当前 Run/action/execution/attempt/epoch/revision/input/policy、资格与时钟；原 Native 在长 IO 后仍做自身接纳、失效和 replay 检查。适配器不接纳原 Run、不派发、不持有第二阶段或账本。
- 旧 dispatch-only 消费与 seat 只保留 component 兼容边界，`managedClosureEligible=false`，没有供 Native 使用的语义查询。

## 实际作者自检

精确 Node 24.15.0；隔离 Python 观察为 3.14.7。六个外部命令 guard 均真实校准为拒绝 97。最终两组期间 guard 调用数均为 0，输入前后字节摘要相等。

| 命令 | 结果 | 范围 |
|---|---|---|
| `node --test --test-reporter=tap test/architecture-review-adapter.test.js test/delivery-cases/2_5.mjs` | 67/67，0 skip，exit 0 | owned 建设、真实 Python 机械门禁与 6da Native 私有同 Run 切片 |
| `node --test --test-reporter=tap test/delivery-evidence.test.js test/delivery-gate.test.js test/delivery-baseline.test.js` | 74/74，0 skip，exit 0 | 直接相关 SDK 回归 |

实际固定解释器、PATH、UTC、每次 argv、原始及 display 日志摘要见 `run-results.json`。Node 行仅为便携显示，原命令和映射保留在 ignored 原始资料中。没有跑无关全仓或把旧全仓 10 个失败改写为通过。

7 组有效行为 RED→GREEN 均保留：原 T、完成后材料/票/报告漂移、T 缺 collection、A 缺真实独立来源、cached query 缺当前资格、非法包/轮次/闭合和不可变原票、同 ID/同字节跨 revision。首次 A 反例因本轮路径校验误拒 macOS `/var` 与 `/private/var` 别名，属于 setup 诊断；canonical realpath 修正后才得到有效 A 行为 RED，两份诊断不计入 7 组。

## 真实 Native 机制观察

只读使用 Root 已双审并提交的 official 6da 构建，未 rebuild 或改 SDK。两个新 Node 进程恢复同一个原 Run 和同一个 A execution/attempt；原生 `jobKey` 字段当前未赋值，不伪造它，复用原 pending execution。缺 A 子来源时原 Native 拒绝，补回相同原始证据后继续；重复接纳被拒。T 的已认证“不充分”被记为 reject，私有 fixture owner 直接修原 test-intent 后，同 Run 的新 T 独立审查可通过；P 仅完成计划。设计变化使 A/T/P 失效，恢复原字节仍保持失效。原控制状态/命令/快照索引见 `native-observations.json` 与 native-audits。

数据来源是明确标识的私有合成 reviewer/qualification/trace fixture。它验证 SDK 的真实字节/HMAC、Python 的真实 tally/finalize、Native 的真实事务和原 CLI 路径，不证明真实模型/身份、方法应用、OS 隔离或团队业务资格。

## 跨归属发现与未完成事项

原首跑 `native-chain-first` exit 1 原样保留：Design 的 T reject 提示 `test-design-repair`，但该事件只允许 build/verify，Design 实调拒绝。Root 已确认由原 P2_4 owner 校准阶段相关提示。本候选未改 SDK；最终切片由私有 fixture owner 使用 `fs.appendFileSync` 修改原 test-intent→同 Run 重派 T→独立重审。`authorizeWrite` 固定 false，没有执行受管作者 Tool.Write，因此只证明修订后的原生接纳/失效，不证明作者工具权限。Root 另外读到 6da `openSpecAllowed` 未包含精确登记的 test-intent.md，受管 authenticated Tool.Write 仍可能被末段拒绝；该共享 guard 缺口交原 P2_4 owner，真实作者闭环未验。

真实项目材料的 grill-me 应用、三方实际独立语义审查、固定 Runner/受管执行主体与用途资格、实际工具/ACL/OS 拒绝以及完整新 profile 旅程仍未验证。原 15 份资料外发许可已消耗，未复用旧票或启动模型。生产 P1_3/I02 必须用已核资格的原注册来源和受保护时钟供应当前事实，不能从本候选的 fixture 标签获得授权。全量下游 V/Kp/Kt、知识/权限/恢复和最终 required/Whitebox/Grill 仍归原 DAG。

`test-pack.template.json` 是便携模板，`materialize-test-pack.py` 只替换显式根/Node 路径，不运行包内命令；实际私有 TestPack 另经原验证器做结构检查。结构检查不是业务验收。
