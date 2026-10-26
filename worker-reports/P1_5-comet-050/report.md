# P1_5 — R/A/T/P与测试实现步骤装配（2026-10-26-comet-050-adoption-v1）

- run：revision 2026-10-26-comet-050-adoption-v1；任务节 tasks.md "### Task P1_5"
- 工作目录 /Users/mac/Code/sdd-harness（共享工作树，未 commit、未 push）
- 本轮语义：**装配断言重建**——把 0.4.5 时代的 classic-integration 断言重建到「编译产物（integrations/comet/application/package）+ P1_3 0.5.0 适配器 + 扩展声明」的组合行为上；不改 lib/、不改 package、不改 lock
- 证据：本目录 `evidence/`（命令头 + exit）；`diff.txt`（全部改动，含新增 assembly-probes.json）

## 1. 完成范围（改动文件，全部在 P1_5 Owns 清单内）

| 文件 | 改动 |
| --- | --- |
| `test/classic-integration.test.js` | 重建为双层：judgment 层（C01–C05/C06 lib/delivery 面，沿用并通过）+ **assembly 层**（新）：包身份 pin（compositionHash dbcb0eee… / contentHash f7677825… 与 internal/compile-manifest.json 一致）、A/T 分立、跨门重放拒绝、P 单一计划面、无第二调度面、审批锚先于 full.open、九步骤映射、4 个负向 mutant、comet-executor 六门零兜底回归、Kt 0005 谓词真值表、C08 重定位到 0.5.0+0005 构建（predicateSha256 205cf16f…）、探针登记一致性、method-dispatch v3 包 pin |
| `test/delivery-cases/1_5.mjs` | 重写为 **hooks 缺席探针**：/tmp 一次性家 + 钉版 CLI（de39629a…），把 `.claude/settings.local.json` 整体移开后 CLI 侧共同门仍拒绝跳门（guard/guard --apply/transition/manual record-check/archive/`state set phase` 直写/伪造 phase 文件/两个 runtime dispatch 拒绝：错误入口名 exit 65 INVALID_WORKFLOW、缺包 exit 70 RUNTIME_ERROR ENOENT）；finally 恢复 hook 注册并断言 |
| `classic-integration-probes/assembly-probes.json` | 新增：a)–d) + executor 零兜底 + Kt 谓词共 11 条登记 |
| `classic-integration-probes/gate-matrix.json` | 头部重登记为 050 修订（记录集不变，judgment 层逐条重跑一致） |
| `classic-integration-probes/knowledge-closeout.json` | 重登记：Kp 三负一正 + 新增 forged-seal-refused、kt-0005-fail-open-default、kt-0005-required-unmet-parks-same-run |
| `classic-integration-probes/entrances-c07.json` | 重登记为 0.5.0 CLI 侧 hooks 缺席七入口（guard-preview/guard-apply/transition-manual-declaration/next-continuation/archive-outside-phase/dispatch-entry-name/dispatch-missing-package） |
| `classic-integration-probes/bypass-recovery.json` | 重登记为 0.5.0 变异族（direct-phase-write/tampered-phase-file/manual-record-check） |
| `classic-integration-probes/openspec-compat.json` | v3：钉新构建指纹与谓词 sha；1.3.1 历史重放不变；currentHost 如实登记 1.15.0 观察值 + 漂移策略说明（一致性 oracle=闭包谓词而非环境版本串） |
| `classic-integration-probes/method-dispatch-content.json` | v3：退役 comet-managed-v2/245 文件全源 pin，改为编译包 15 技能 pin（4 method-variant / 5 domain-work / 6 extension-skill，digest=application.json contentHash） |

## 2. 装配断言清单（a–f）

- **a) A/T 分立**：A（architecture-consensus）与 T（test-design-review）同为 `afterStep: full.design.evidence` 的独立扩展——各自的 artifactRefs（`.sdd/delivery/gates/{a,t}/receipt-bundle.json`）与 validator（`comet.{a,t}` 扩展 result validator + `sdd.delivery.gate.{a,t}`）互不替代；AND 链 `design.evidence→A→T→build.configure` 在 transitions 断言；打包 bindings validator 拒绝跨门重放（A payload 在 T validator 与反向均 `accepted:false`，reason "cannot be replayed across extensions"）。
- **b) P 只产计划**：唯一产 plan 的步骤 `full.build.plan`（ref=claude-parallel-tdd-planner-full-build-plan），唯一 `kind: classic-build-plan` 的 await_evidence，唯一 P 扩展（build-plan-unique，artifactRef `.sdd/delivery/gates/p/receipt-bundle.json`，validator `sdd.delivery.gate.p`，afterStep=plan.evidence）；stateSchema 仅一个 plan 字段；适配器 runtimeDispatchArgv 只构造 `--application-file` 面（`--application/--workflow` 选择器拒绝，DISPATCH_OPTIONS_INVALID）——装配层无第二调度面。
- **c) 审批锚装配**：entry=classic.composition.prepare；prepare 只到 ask_user confirm；confirm approved→full.open、rejected→confirm 回环；**不存在任何 prepare→full.open 直接边**；full.open binding 带 `authorizationFrom: classic.composition.confirm` + choices `[approved]`；9 个写副作用 work binding 全带锚、6 个只读门扩展全无锚；4 个 mutant（剥锚/偷渡直接边/第二计划步/第二 plan 字段）全部被检出。
- **d) 九步骤映射**：9 个 replacement、id 唯一；4 个 method-variant（grill-me×2、planner、tdd——方法技能=执行技能，测试自动化步 full.build.execute 在 tdd 变体上、P 步在 planner 变体上）+ 5 个 domain-work（internal/domain-skills 受管域技能）；15 包内技能 id 两两唯一；ponytail 未回流；6 门面为打包 P1_6 资产。
- **e) hook 缺席不可绕共同门**：1_5.mjs 真实 CLI 只读/拒绝路径（如上表）；适配器层 comet-executor 六门零兜底回归：真 A pass 仅经打包 validator `sdd.delivery.gate.a` 接受；跨门/无 payload/blocked coverage 拒绝；Kt、X 未注册门 ACTION_NOT_REGISTERED；repair 声称 EXTENSION_OUTCOME_INVALID；ambient 签名 ORIGINAL_NATIVE_CALL_REQUIRED。
- **f) probes/**：7 个文件全部为 0.5.0 探针产物，登记 id 与测试重跑逐条一致（登记一致性测试强制 revision=2026-10-26-comet-050-adoption-v1）。

## 3. RED / GREEN（全部钉版 ~/.nvm/versions/node/v24.15.0/bin）

- **RED**（改动前）：`classic-integration.test.js` 24 tests / **fail 5**（exit 1：C08 旧构建指纹、C08 current-host 版本钉、probe 登记旧 id、P1_6 245 文件 pin 漂移 ×2）；`1_5.mjs` 6 tests / **fail 1 + skip 1**（exit 1：setup 期待已退役六补丁栈，后续 skipIfNoBuild——环境 skip，不作行为 RED）。
- **GREEN**：`classic-integration.test.js` + `1_5.mjs` 三文件同跑 **37 pass / 0 fail / 0 skip（exit 0）**；相邻回归 `2_4.mjs` + `1_3.mjs` + `comet-driver.test.js` **152 pass / 0 fail（exit 0）**。
- 全量 `node --test test/*.test.js`：**1127 tests / 1124 pass / 3 fail**——3 个失败全部不在本任务车道（`test/comet-flow-acceptance.test.js` 两个 P31 场景与 `test/comet-security-backports.test.js`，文件未被本 worker 触碰，失败源于共享树上已提交的 freeze-baseline seal 6bab6ca 与这些套件的既有冲突；grep 确认全仓只有本任务两文件引用 classic-integration-probes）。不以局部绿关闭父义务，归控制器集成与 VERIFY。

## 4. 真实执行的验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `~/.nvm/versions/node/v24.15.0/bin/node --test test/classic-integration.test.js`（改前 RED / 改后 GREEN） | exit 1（24/19/5）→ **exit 0（33/33/0）** |
| `~/.nvm/versions/node/v24.15.0/bin/node --test test/delivery-cases/1_5.mjs`（改前 RED / 改后 GREEN） | exit 1（6/4/1, skip 1）→ **exit 0（4/4/0）** |
| `… --test test/classic-integration.test.js test/delivery-cases/1_5.mjs` | **exit 0，37 pass / 0 fail / 0 skip** |
| `… --test test/delivery-cases/2_4.mjs test/delivery-cases/1_3.mjs test/comet-driver.test.js` | **exit 0，152 pass / 0 fail** |
| `… --test test/*.test.js` | exit 1，1124/1127（3 个非本车道失败，见上） |
| 探针会话（/tmp 一次性家，真实 CLI 只读/拒绝路径） | guard/guard --apply exit 1 blocked；transition exit 1（Manual declarations never satisfy the guard）；archive exit 1 FATAL phase；`state set phase` exit 1（not allowed…bypasses state machine evidence checks）；伪造 phase 后 `state check archive` exit 1 blocked（verify_result）；dispatch 错误入口名 exit 65 INVALID_WORKFLOW；dispatch 缺包 exit 70 RUNTIME_ERROR ENOENT；`state next` exit 0 kind=plan |

## 5. UNVERIFIED（如实）

1. **真实宿主组合 Run**（application install 到活项目 + runtime dispatch 起步/推进/claim/report）——P1_4/P3_2/VERIFY；本轮只做拒绝路径（错误入口名、缺包），未安装、未在活 Run 内 dispatch。
2. **canonical 根 application.json**：comet-executor 注册钉的 `integrations/comet/application/application.json` 当前不存在（编译产物在 `package/` 下）——registration 只钉位置，install/dispatch 调用时 fail closed；该文件落位属宿主波次，非本任务 Owns。
3. **Kt 写路径**（knowledgeCloseout 字段写入/wire keys/受管接纳）——supply/admission 波，executor.ktCloseout 如实报 UNVERIFIED。
4. **宿主全局 OpenSpec 版本漂移**：baseline 记 1.14.3、本轮观察 1.15.0——环境事实，已按 upgrade_policy（禁全局升级）如实登记；oracle 钉在闭包谓词而非版本串。
5. 全量套件 3 个非本车道失败（freeze-baseline × P31/security-backports）未修——非 Owns，移交控制器。

## 6. 边界遵守

- 未 commit / 未 push；未改 lib/、package/、lock、tasks.md；全部改动落在 Owns 三处 + worker-reports/P1_5-comet-050/。
- 所有真实 CLI 交互在 /tmp 一次性家（HOME/COMET_PROJECT_ROOT 指向 scratch），无模型调用、无真实宿主执行；探针后 hook 注册恢复并断言；仓库与真实家无污染（探索会话 /tmp/p15-explore、/tmp/p15-os 已留作一次性产物，不在仓库内）。
