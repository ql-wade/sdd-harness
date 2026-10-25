# P1_5 两项 test/probe 修复：独立 Standards 轴

**结论：PASS，0项具体阻断、0项必改；仅限两项 test/probe 维修。** 不接纳 whole P1_5、真实角色、OS/权限、实际方法执行或 C01–C08 业务旅程。另一个 Spec reviewer 的24/24不是本轴的独立执行结果。

候选：`aad310f1122c0edf5408b5e524a7155b5850fbb0`；base：`2d2506fb3b355ebd1ad53cc3aea2a64905df23d9`。worktree HEAD匹配，开始及审查后干净。Standards依据为AGENTS的直接相关范围、Node ESM/最少依赖、信任边界关闭式失败、测试污染/历史保全与证据分层规则。

## 范围与源码

变更只触及原 `test/classic-integration.test.js`、两份原probe及独立报告/取证资料；方法正文、共享锁、adapters/lib、profile、任务/DAG/执行合同未变。测试使用已有Node test/assert/fs，无新依赖或控制框架。内部 `assertApprovedMethodPins` 复用于正例/漂移负例，未新增产品API或测试专用产品后门。

**C08** 正确拆成历史捕获、当前host与隔离候选：历史1.3.1不再由当前PATH冒名执行，而读取原538字节捕获并核原SHA，用固定Core6da真实closure重放拒绝。当前1.14.3与隔离1.11.0各实际核version/status、requires和闭包，缺实际CLI/构建明确失败，移除了原skip路径；缺requires/null/string/非字符串数组、未知依赖、循环与缺applyRequires仍由真实谓词拒绝。没有为迁就宿主漂移降低closure判定，也没有改产品解析器/工具链pin。

**方法源pin** 来自已批准P1_6完整源，不是只核三个SKILL.md或允许自改后重hash。当前MF逐字节等于 `git show 3f69f9c5c3c49f0146974fb28c90c1ed8f403496:<MF>`；其SHA为8030…e46d2e。source-upgrades为f0da…41be4，sealed2aba清单为93bb…3cbff。独立核11方法245文件（含dotfile/fixture.log）当前字节、MF逐文件SHA、sealed实际字节与完整文件集合一致；三项pin为planner16、test-authoring17、Whitebox139。

算法与P1_6/Foundation一致：完整 `<fileSHA>  <method-name>/<relative-file>` 行按字典序排序、LF连接、无末尾LF后SHA256；不是旧仅相对路径/不同排序算法。三个新/维修负例在私有源副本修改dotfile并重算声称digest、移除dotfile、加入extra时仍拒绝，恢复后再次接受。受信MF/升级清单/sealed字节是独立批准输入；该准备测试不是抵抗同时篡改整个受信Git/审批根的OS安全边界，SOURCE_PIN_ONLY也不授予角色权限。

原C01–C07相关fixture及C08之前的断言源码对base逐字节相同；没有改弱业务断言。真正Native生命周期/bypass的1_5.mjs未改，本修复不消费其实际资格。planner只登记计划协议/纯validator范围，未调用完整planner/Goal/监督/归档。

## 原始资料与本轴执行

- evidence-index SHA精确为 `6f95e8b375bf78a615a3f992fa0ba257984e6d7ce9e191d3de0d4c30b655001b`。
- **31组** raw/display 的bytes和SHA逐项匹配；历史三文件分别对base Git blob完全相同，`.js.txt` 后缀避免旧测试自动发现；没有重写历史原件。
- 作者全套24/24、0fail/skip，原始日志/command索引一致，9项inputs_before/after相同且匹配当前字节。两项旧失败和复制/Core清单类型误判、zsh过滤器零执行等setup错误保留，不混入有效RED。
- 本轴独立执行 **3个离线现有测试，3/3、0fail、0skip，exit0**：历史真实1.3.1捕获重放、批准245文件源、私改重hash/缺dotfile/extra拒绝。没有调用当前host或隔离OpenSpec CLI，没有重跑整套24项来冒充另一轴。
- `git diff --check 2d2506f...aad310f1` 通过。所有新增负例只写可清理scratch，t.after负责回收；无活配置残留。

独立命令与环境/UTC/退出/日志SHA：`/private/tmp/P1_5-probe-standards-20261026/receipt.json`。
原stdout：`/private/tmp/P1_5-probe-standards-20261026/selected.stdout.txt`，SHA256 `c1deebadc155be531828dd5e6bcab5cce4ac99de188f03c30d3421ea0f00acf9`。

```bash
/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap --test-name-pattern='C08 negative: the captured historical|P1_5 method dispatch content is pinned to|P1_5 source drift is refused' test/classic-integration.test.js
```

实际运行使用最小PATH、CI/禁telemetry/update、无Git系统/global配置；未运行Docker、模型、API、下载或读取真实秘密，未改全局配置/主计划。取证辅助脚本的CLI写入只用scratch HOME，输出采用exclusive写避免覆盖；本轴仅阅读它，未运行它。

## 接纳与限制

无本轴必须追加的修改。可串行接纳这两项测试/探针维修及精简证据；源供应与CLI兼容准备不等于方法已应用、独立身份/实际R/A/T/P/V/K已通过。原Core6da复制/清单一致也不等于新构建/发行或真实Runner资格。whole、实际角色/OS/知识权限/业务旅程均保持原未验状态。

输入SHA：

```text
test source   d833b54c830f0b037cf9bfe37161ad4f846c687aa5934ec5beac081cc16db8ed
compat probe  a47f72d9dba1c0244423e0fd0ba2f0055d4fdbb0e849cff4139fb1baf5a06512
method probe  4f7791a90d070c37178a9a7f4f78977ebb3f01df04e330158118e54ac973be0a
index         6f95e8b375bf78a615a3f992fa0ba257984e6d7ce9e191d3de0d4c30b655001b
```

未做实时CLI或真实角色复验；剩余风险是把准备/完整字节一致性解释成运行或业务接受，本结论不包含这种提升。
