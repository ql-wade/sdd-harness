# P1_3 fixed Gate host checkpoint：独立 Standards 轴

**结论：PASS，0项本轴新增阻断/必改；仅当前 Gate 源码 checkpoint 可消费。whole P1_3、production及实际身份/OS不接纳。** 本结论不代替另一个独立Spec轴或下一slice，也不表示薄main/nonGate/正向cold recovery已实现。

候选 `55987b133f71ef9ada8bc5330f6465dfcd492a37`，base `2d2506fb3b355ebd1ad53cc3aea2a64905df23d9`；开始时HEAD匹配、工作区clean。依据AGENTS的范围/Node ESM/最少依赖、原事实源/单主控、fail-closed、可信来源及证据分层规则。检查lib/adapters三文件、新测试、所有已知createRunner/cometLaunchAuthority调用点、REPORT/PORTS/FREEZE-NOTE与原始资料。

## 代码与边界

- **authority覆盖根因修复完整**：createRunner.admit将固定authority放在args展开之后，调用者的同名属性无法替换；新真实HMAC反例验证foreign本来有效也不能获准。Comet wrapper复用原P2_2四个authority函数，collector/collection先拒绝foreignRun；返回对象冻结，原调用签名向后兼容新增可选sourceVerifier。
- **固定代码组成**：createCometExecutor只消费构造时固定native/authority/registration/source CODE端口，复制注册并冻结函数引用；无worker env/path/module loader或qualified开关。注册、动作/argv、角色映射、Docker路径/摘要均校验；execute/observe/stop数据只接受execution。构造器和标签本身不授予source/OS资格。
- **原Run/current Gate**：AsyncLocalStorage只限制原Native调用上下文；签名检查原短锁及已绑定Action。启动重读原Run和gate_dispatches，要求唯一open intent、固定Run、签名和完整当前Action一致，再校 source有效性并构造三项固定输入摘要。跨Run、错role/source/attempt或worker字段不能借这个适配器替代原Native判定。
- **失资格不被context吞掉**：bind投影unqualified/expired事实给原Native，而eligible在签名与启动单独执行。这样原单调失效逻辑能先看见变化；代码没有把提前抛异常当成“旧intent已失效”。恢复原source状态不复活旧intent有原生fixture负例，未增加第二代际账本。
- **结果入口保持严格**：actual I02 client终态与inspect先核，之后才解析精确key JSON和有界canonical base64 bytes；unknown/truncated/signal/错Run/执行/容器状态不能制造packet。readResult再核当前intent，真实collector/Gate/review仍由原Native接纳。源码/组件返回继续managedClosureEligible=false，client exit0不是Gate结论。
- **无第二调度器**：仅volatile createdHere/observed缓存及当前调用快照，未添加持久phase/lease/queue/ledger/retry/controller。重复工作观察原handle；冷进程缺原handle恢复端口时明确拒绝并0重启，不能将这个UNKNOWN负例写成正向恢复通过。

297行内部组合模块重用原schema、collector、Gate、I02三口；没有新依赖、第二状态机或与目标无关的通用回调框架。命名/结构与现有Node ESM相容，错误是固定UNVERIFIED code，未知worker正文不被错误回显。未发现值得本轴强制重构的明确标准违例。

## 实际独立验证与原证据

本轴独立运行5组/20个离线现有断言，**20pass / 0fail / 0skip，exit0**：固定authority覆盖、bound collector跨Run、未登记入口、非法options与15类非法registration。它们不启动Native物理fixture或Docker；断言中的HMAC key是测试生成值，不是真实凭据。

原argv/env/UTC/退出及输入前后摘要：`/private/tmp/P1_3-fixed-host-standards-20261026/receipt.json`，SHA256 `161e2d43ff9946465c84655789fa1cdd74e0244df9329002f14398e52bb4eb91`。
原stdout：`/private/tmp/P1_3-fixed-host-standards-20261026/stdout.txt`，SHA256 `6e432dc8d303279a65f6aaaa65c14f8f9210dfbd74f94f0bfa9a9be274c40f11`。
输入前后相同：`True`。

- 最终manifest SHA精确 `ce44668c966525bfa867e3cdf97a1471479e513ed60bf916afe917cece568f73`：**117/117**content与**203/203**raw逐项匹配。
- candidate-inputs重算sorted compact JSON SHA为 `c3c87e9f96e12f7a117cf7f9177dbdcc5ccb753d120052560d43afe897798f69`，与当前源逐项一致。
- checkpoint-owned **35/35、0fail/skip**，checkpoint-evidence-gate **52/52、0fail/skip**，记录exit0，输入前后等于当前字节。它们保持作者自检等级；另Spec独立运行的35+52不冒充本轴执行。
- runtimeMaterial明确固定6da及aggregate SHA `04795080295d7174af82913757254426b82037ea5028296a3602b86d200559dd`；测试先核实际字节，不以6da冒充Root新3056联合包。
- `git diff --check` 对源/测试范围通过。b028→559只修改freeze/portable metadata报告和最终manifest，lib/test字节相同；早期freeze断言失败后错误提交b028保留，不当成最终已冻结合格。此前setup、fixture proposal/runner不匹配和review byte reader准备问题保留，未改原35/52源码raw或放宽断言转绿。

## 必须保留的未完项

当前没有生产薄main/bootstrap/实际source CODE/secretRef/identity/grant resolver；I01 resolver仍UNRESOLVED。非Gate作者/test-design/test-code/Builder端口与durable原execution/handle绑定、I02下一合法同角色slot、正向cold resolve及真实worker程序均未完成。构造器或sourceQualification字段满足形状、签名和进程fixture都不能证明actor身份、OS隔离、方法应用或Edit/Shell/MCP渠道权限。

REPORT与PORTS已明示这些限制，不能用本checkpoint关闭F05/F07/A09/N01/N03整体required或whole。Native phase仍唯一权威；后续沿原任务与Run补受控端口，保留UNKNOWN现场和原operation，不新增controller或自动重放。

本轴无新增代码修正要求。可将固定authority防覆盖、Gate host代码/负例与精确checkpoint资料作为下一slice输入；生产启用、主锁绑定/联编、全部入口和真实旅程仍归Root独立准入。未执行模型/Docker/API/secret/新包/主配置、锁或计划写入。

输入SHA：

```text
comet-executor 69b7e381b1d028e3529c09faedfcde2a3b2fcc675bac732e47d12bc612f1091a
comet.js       ba6bc78750e230f67a87ce77f517cf5bd6cf6de80d29243a8a0aa8eb19823513
harness.js     e0b01652ae218dc6a869f226e67ada427fced40fcaa934d04763dd6830bb9bd0
new test       389053944465219214fb6402a35b0076dbd7d3ec8eaa52419bf9baa623269856
```

未独立重跑Native物理/冷恢复fixture；主要风险是把已知未实现的source/身份/恢复端口借标签或组件绿色补齐，本结论不包含此类资格提升。
