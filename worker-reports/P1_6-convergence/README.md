# P1_6 方法来源、Comet 分发与绑定候选

本候选只承担原 P1_6 建设范围，基于 `7dd64e1`；没有改任务/DAG、进度、正式 upstream.lock、其它基础设施锁或全局技能。主控制器仍是原 root，产品仍只有 Comet 持有 Run、派发、返工、恢复和完成权。唯一可选 profile 是 `comet-managed-v2`，当前 **UNQUALIFIED**。本文不签任何完整业务场景或门禁通过。

## 分发副本与原始字节

本目录中的日志、命令和路径元数据现在是**便携显示副本**，不是逐字节 stdout/stderr。原始工件保留在不可改写的提交 `1da48bee8dd4fcc782a1d0a31015e43a22f82de7`，并逐字节另存于被 Git 忽略的 `.local/method-profile/portability-audit/1da48bee8dd4fcc782a1d0a31015e43a22f82de7/raw/`；该位置相对于原工人工作树。已有 `.local` 构建与原始执行材料没有被修改。

`<worktree>`、`<primary-checkout>`、`<host-home>`、`<temp>`、`<shared-skill-source>` 只用于显示，不能传给工具执行或作为实际加载路径。方法加载仍使用未改的 `snapshot_path`、`files`、`content_sha256`；`source_path` 仅显示来源。规范化只替换机器位置、去除报告行尾空白并澄清本说明，没有重跑测试或改变结果/失败/范围，也没有改变 UNQUALIFIED。

逐文件原始/显示摘要、字节数和规则见 [normalization-record.json](normalization-record.json)，当前分发副本索引见 [evidence-index.json](evidence-index.json)。索引由当前副本重新生成；为避免索引与规范化记录互相哈希形成循环，规范化记录不包含新索引自身摘要，原始索引摘要仍保留。

## 改动与来源

- 原样整份升级两个必要方法源：共识方法19份登记源码、Whitebox139份源码/fixture；[逐文件来源和前后清单](source-upgrades.json) 保留原摘要、受控候选/manifest位置以及当前共享源只读比对。共识候选多出的7份生成字节码明确排除；旧Whitebox14份字节码退出新分发。其它9份方法快照未升级。
- [Git分发核对](distribution-source-index.json) 证明19/139文件完整进入索引，包括被根 `*.log` 忽略的14个上游fixture日志。原8个负例逐字保留，新源共有15负例及3不变量。没有修改上游方法正文来迁就项目。
- `scripts/check.sh` 调用源自己的完整 `tests/run_all.sh`，入口缺失或任一子检查失败都阻断；不再硬编码8个负例，也不放宽旧判断。
- `0001-matt-method-profile.patch` 修改41个真正分发/调用文件：init和update不再选择/调用退役安装器；doctor只报告方法执行未资格，不再建议重装退役方法；原生写入Hook仍拒绝缺计划的写入，恢复指引改为原协议引用；双语Classic资产绑定Matt基础方法及专门方法。新资产只增加普通参考文档，没有阶段Skill壳、命令别名或第二状态机。兼容物理路径与原五phase/Run保留。
- `foundation/profiles/comet-managed.json` 只描述方法/角色/动作/输入/输出/门的数据。R、A、T独立；测试作者、Builder和独立验收分开。P仅允许原 `plan-contract.md` 的 `One root and acceptance source` / `DAG` 两节及纯 `plan_guard.py`；完整planner SKILL、Goal/监督/派发/归档合同及生命周期脚本禁止在产品P加载。
- 受影响原生测试修订保持其它拒绝/装配断言，明确检查不重装旧技能、用户残留文件不删、来源安装不冒充可信执行。

## 真实验证

| 范围/命令 | 结果 | 分发显示记录 |
| --- | --- | --- |
| `node --test test/comet-method-binding.test.js` | 5通过：完整源自测、缺入口拒绝、损坏fixture拒绝、11源清单、只读计划校验正反例 | green-method-supplier.txt |
| `bash .agents/skills/whitebox-verify/tests/run_all.sh` | 15负例、3不变量、lint/render自检及预算闸门通过；只签源供应 | whitebox-source-selftest.txt |
| `python3 -m unittest discover -s .agents/skills/multi-agent-consensus-review/scripts -p 'test_*.py'` | 50通过，离线fixture/边界mock；日志中的清理拒绝是假进程负例，没有真实provider调用 | consensus-source-selftest.txt |
| `bash .agents/skills/claude-parallel-tdd-planner/tests/run_all.sh` | 67通过，含保留的计划/生命周期工具负例；未激活controller | planner-source-selftest.txt |
| `bash scripts/agent-skill-check.sh` | 通过 | skill-check.txt |
| Node24、pnpm10.18.3、固定archive、完整六补丁新指纹构建 | 0.4.5，`reused=false`；三个生成一致性检查通过 | build-provenance.json / build-output.txt |
| `P16_COMET_LOCK=.local/method-profile/validation.lock.json node --test test/delivery-cases/1_6.mjs` | **8/8通过**：真实CLI、全新隔离HOME/项目、双语安装字节、doctor未资格诊断、update保留残留用户方法且不重装 | final-classic-installed-assets.txt |
| 原生init/update/doctor/Hook/公共安装seam五文件全量回归 | **354通过、1失败、3上游条件跳过**；未称整套通过 | final-upstream-regressions.txt |
| 同一构建完整字节检查、`--check-generated --runtime-smoke` | 三个生成族通过；smoke **255通过、2上游条件跳过** | final-native-verification.json / final-native-verification-output.txt |
| 最终索引上的 `bash scripts/check.sh`（Node24.15.0） | **501项：487通过、14失败、0跳过**；总检查失败，不覆盖交付门 | final-repository-check.txt / repository-unresolved.json |

以上命令均设置 `PYTHONDONTWRITEBYTECODE=1`，防止向原样技能目录写入临时字节码。实际锁定构建的source/patch/Node/pnpm、manifest摘要及指纹见 build-provenance.json；精确锁交接见 patch-lock-handoff.json。临时验证锁不表示正式锁已集成，root仍须独立审查后在主检出更新并重新资格化。

## RED与纠错记录

- `red-check-caller.txt` 是旧源缺fixture的真实失败；整份新源就位后，`red-check-caller-complete-source.txt` 才精确命中旧caller固定8与实际15的矛盾。新caller同时证明缺入口和真实fixture损坏都拒绝。
- `red-classic-installed-assets.txt` 的EN/CN真实CLI安装完成后仍要求旧架构技能；其中一次update probe停在原生交互提示，明确不算重装行为RED。
- `red-source-install-and-update.txt` 在未改源码的原六补丁构建上真实执行4条新断言：双语方法分发与Claude/dsh两条self-update重装路径均失败。外部安装API由原生测试在系统边界mock，未执行全局安装。
- `red-recovery-and-doctor.txt` 的4条失败来自原生缺计划写入拒绝后的旧恢复指引，以及doctor将退役插件存在误当就绪。修订后相同入口在完整358项组件回归内通过。
- `not-exercised-initial-source-probe.txt` 保留早期Git嵌套路径导致测试未实际套用的零执行记录，未算RED或PASS；后续设置Git ceiling并断言测试文件真正到达私有源码树。一次TypeScript不可达旧失败分支导致的构建失败也未算行为RED；已移除根因后重新从新指纹构建。

## 尚未关闭的失败与边界

1. 唯一原生组件失败是 `does not treat a non-Windows case variant as an exact recorded artifact path`：`Docs/...`路径在本机返回允许，合同要求拒绝。未改的原六补丁基线同一测试也失败，见 baseline-case-variant-failure.txt。它不是本包提示/分发修改引入，但仍是未关闭的路径拒绝问题，不能豁免或据此启用profile；应由原P2_4控制平面owner处置。
2. 14项仓库失败逐条保存在 repository-unresolved.json：未集成正式源/Runner/镜像锁，旧Foundation发布视图及旧Run基线解析，P1_5旧方法分发摘要，宿主OpenSpec旧版本/归档断言，以及Node24自动测试输出的TAP调用前置。未改其它owner文件或刷新产物凑绿。root已在其它原任务继续推进，主检出最终结果必须重新运行，不能继承本树数字。
3. 方法存在、摘要匹配、源自测、CLI安装均不证明真实方法被正确应用。本包没有provider三方评审、受保护launcher身份、实际R/A/T/P/Builder/Reviewer/V角色链、OS权限、可信回执、业务硬门或新宿主会话验收。缺能力仍UNQUALIFIED，没有降级执行器。
4. 真实知识检索、LLMWiki Kp、OpenSpec唯一归档、Outline Kt、平台交付、权限维护与同Run恢复均未在此执行；没有发布、ACL/平台写、生产副作用或第二Goal/监督者。所有完整required/Journey仍由原下游任务和VERIFY实际闭合。

## root串行集成

先独立审核本候选与原样来源清单，再由原owner更新官方upstream两项patch摘要、派生Runner指纹/发布视图及实际分发登记。重新构建和验证当前正式候选；不要复制旧构建、旧review票或本供应层结果签业务门。当前生产profile保持未启用，原tasks/DAG和控制器不变。
