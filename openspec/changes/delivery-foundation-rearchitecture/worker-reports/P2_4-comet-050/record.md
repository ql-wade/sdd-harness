# P2_4 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: P2_4 原Comet共同硬门（comet-050 组合应用路线，本计划最核心任务）。ADR-0022 Accepted、Kt=B1。
Scope honored: only Owns files touched —

- `integrations/comet/application/composition.json`（新建）
- `integrations/comet/application/bindings.mjs`（新建）
- `integrations/comet/application/extensions/`（新建：schema.json + 6 个声明）
- `integrations/comet/patches/0005-comet-050-kt-closeout.patch`（新建）
- `test/delivery-cases/2_4.mjs`（重写断言）
- 本报告目录 `worker-reports/P2_4-comet-050/`

No commit；未改 pristine/vendor、未改 upstream.lock.json（0005 只写 patch 文件，应用属供给步骤）、未改 lib/delivery 与 contracts（零改动消费）。

## 1. Record（读侧事实，全部源码级核对）

- 官方组合 API（pristine `domains/comet-classic/classic-application.ts`）：`createClassicApplication(context, options)`；检查点白名单（profile=full 解析后）＝ `full.open.evidence / full.open.revalidate / full.design.evidence / full.build.plan.evidence / full.build.check.evidence / full.verify.check.evidence`；扩展 id 规则 `^[a-z][a-z\d]*(?:-[a-z\d]+)*$`；artifactRef 必须相对路径且无 `..`；同点多扩展按 order 排序、**全部必需逐个通过**（AND 非 OR）；归档期 `validateOutcome` 在归档目录复验扩展工件哈希（Kp 依赖此机制）。
- 编译器 plan 形状（pristine `domains/workflow-generation/compiler.ts` planSchema）：composition 段 `{kind:'classic', profile, replacements:[{stepId,skillId}], extensions:[{id,skillId,artifactRefs,validator{id,version},afterStep}], order}`；classic 组合必须带 `bindings.mjs` 模块，产物 `createBindings(context)` 只能返回 `{validators, executors}`，未注册 validator ref 的组合**拒绝编译**。composition.json 内嵌该形状 verbatim，manifest/modules/workflows 由编译波次产出（未宣称）。
- Kt 无挂点证据（pristine `domains/comet-classic/classic-resolver.ts` L79-82）：`if (classic.archived) return 'completed';` 无条件；检查点白名单无 archive 位置 → Kt 只能走最小补丁（B1）。
- 可替换步骤清单（pristine `classic-sdk-application.ts` full profile，invoke_skill 且 ref 为 comet-design/comet-build 者恰为 5 个）：`full.design.handoff`、`full.design.document`（comet-design）；`full.build.configure`、`full.build.plan`、`full.build.execute`（comet-build）。`full.open/full.verify.run/full.archive.prepare/full.archive.deliver` 未替换（domain-owned）。
- 技能映射事实源：`foundation/profiles/comet-managed.json` actions（R→grill-me；A→grill-me、A.review→multi-agent-consensus-review；T→test-authoring；P→claude-parallel-tdd-planner；build→tdd/diagnosing-bugs、code.review→code-review；V→whitebox-verify；Kp/Kt methods=[]）；`methodDefaults.ponytail="full"`；`knowledge: {Kp: required before every archive entry, Kt: may resume after archive in same Run; required before completed}`。
- P1_6 资产：`integrations/comet/application/manifest.json` 11 技能（runtime_accepted=false），retired tokens = superpowers/sdd-/trinity。
- 关键设计决定（本 worker 裁量，均已在 composition.json 声明出处）：
  - 替换映射：design 两步→`grill-me`；`full.build.configure`→`ponytail`（process-weight 联合决策映射 process-weight 方法，build_mode 语义仍归 Classic）；`full.build.plan`→`claude-parallel-tdd-planner`（references-only 契约）；`full.build.execute`→`tdd`。可替换性实测在编译波次（UNVERIFIED 已声明）。
  - 扩展执行技能：R→grill-me、A→multi-agent-consensus-review、T→test-authoring（独立性由 validator 回执判定，不靠技能身份）、P→claude-parallel-tdd-planner、V→whitebox-verify、Kp→openspec-lifecycle-guard（Kp 无打包方法技能；validator 承载语义判定，理由已写入声明）。
  - 扩展工件路径（deep-dive 遗留的"P2_4 必须明确写哪些文件"）：`.sdd/delivery/gates/<gate>/receipt-bundle.json` —— 在 `.comet/` 之外（宿主可写、不被 hook guard 拒绝）、在 change 目录之外（artifactRef 是静态字符串，且归档复验时按原路径重哈希，跨归档移动仍钉住）。

## 2. Implement

1. **composition.json**（schema `sdd.comet.classic-application.composition.v1`）：base=classic-full；内嵌 compiler-shaped composition verbatim（5 replacements + 6 extensions + order）；replacementContracts 逐步骤钉 pristine 输出契约（required/properties + 出处）；knowledgeCloseout 段钉 0005 patch 路径 + **sha256=74e6c810…b18d 字节钉**，并如实声明 writePath=NOT IN THIS REVISION、lockIntegration=NOT APPLIED YET；unverified 三项（编译、真实 Run 行为、Kt 写路径）。
2. **extensions/**：`schema.json`（JSON-Schema 数据，含 upstream artifactRef/id/gate 约束）+ 6 个声明（id/gate/afterStep/skillId/类型化 artifactRefs/validator/verdictProtocol/semantics/judgment，judgment 全部指向 lib/delivery/gate.js evaluate）。
3. **bindings.mjs**：`createBindings(context)` 返回 6 个 validator（id=`sdd.delivery.gate.{r,a,t,p,v,kp}`@1）；判定零本地逻辑——仅校验 payload 门身份后整体委托 `evaluate(inputs, receipts, policy, options)`；pass 仅当纯组件 verdict=pass；缺 payload/跨门重放/拒判（throw）全部 fail-closed。
4. **0005-comet-050-kt-closeout.patch**：仅改 `classic-resolver.ts`；archived→completed 前加 `knowledgeCloseoutBlocked(classic)`（读可选 `knowledgeCloseout={required?,completed?}`，缺省/null → 放行旧行为；仅 `required===true && completed!==true` 阻断）；阻断时返回既有步骤 `` `${profile}.archive.execute` ``（同 Run 停在归档点，Kt 完成后才 completed）；patch 头声明用途/谓词语义/显式边界（写路径不在此补丁、应用属供给步骤）。git blob index 头 + 邮件式说明头，`git apply` 兼容。
5. **2_4.mjs 重写**（14 用例）：上游事实从 pristine 现场解析（检查点白名单、扩展 id 正则、步骤块/invoke_skill/ref/输出契约 required）；组合检查器单一实现覆盖正向与全部 mutant；bindings 行为级验证（真 admitEvidence 回执 + 真 evaluate 委托：pass 6 门、MISSING_OBSERVATION/TAMPERED_RECEIPT/跨门重放/无 payload/拒判全部拒绝）；0005 用 tmpdir `git apply --check`+apply+谓词真值表（从补丁后源码剥类型注解后原样求值）；负向含 patch 破坏→拒绝且 pristine 原样。

## 3. Verify（真实命令与结果）

| 命令 | 结果 |
| --- | --- |
| `node --test test/delivery-cases/2_4.mjs`（重写后首次 RED：断言失败于 bindings/白名单解析中间态） | 最终 **14/14 pass, 0 fail**（evidence/green-1） |
| `node --test test/delivery-gate.test.js test/delivery-evidence.test.js test/delivery-baseline.test.js test/delivery-test-contract.test.js test/knowledge-closeout.test.js` | **126/126 pass, 0 fail**（evidence/green-2） |
| RED 记录：旧 0.4.5 断言对 0.5.0 锁 | **44/44 fail**（evidence/red-1，Node 24.15.0 钉定断言与六补丁场景均失效，如实记录非行为 RED 借口） |
| 0005 可应用性（tmpdir `git apply --check` + apply + 结果 diff） | CHECK-OK / APPLY-OK / RESULT-IDENTICAL（对 pristine 逐字节等价） |
| 全量 `npm test` | 22-37 fail（flaky 于重型 runner 测试）——**全部先于本任务存在且在 P2_4 面之外**：stash 掉 P2_4 文件后 `infra-runner-isolation` 仍 32 fail（runner image lock 仍钉七补丁 0.4.5 链 vs 0.5.0 锁，重锁善后属 runner/供给波次）、`comet-flow-acceptance` 仍 1 fail（frozen-baseline 消息漂移，P3_1 在途）。证据：evidence/full-npm-test-preexisting-failures.txt |
| Node | v22.13.1（本案例纯组件级，不运行上游构建，无需钉 24.15.0） |

## 4. Review 边界与 UNVERIFIED（如实声明）

- **组合包经官方编译器实测＝P1_3/P1_4 波次**：compileWorkflowApplication（manifest contentHash、嵌入 bindings.mjs、确定性字节摘要）与 comet-design/comet-build 可替换性未验证；本轮验证到"声明与上游约束/纯组件行为一致"层级。
- **扩展在真实 Run 内的行为**（阻断/repair 路由/归档期复验）与 0005 在重建上游树内的效果：P1_5/P3_2/VERIFY。
- **Kt 写路径**：0005 只钉读侧谓词（缺省放行）；`knowledgeCloseout` 状态字段的写入（wire keys/受管接纳）属供给/接纳波次，patch 头与 composition 均显式声明。
- **上游锁不变**：`upstream.lock.json` 仍 patches==[]；供给波次需把 0005（path+sha256 已钉）加入 lock.patches 并重建。
- 测试污染：tmpdir 全部在 after() 清理；未向 .claude/settings.json 等活配置写入。
- 我未执行 Step 4 独立 Spec/质量审查（review 归独立评审人）；Whitebox 签名不在本 worker。

## 5. 交接

- 改动文件（全部绝对路径）：见文首 Owns 清单；另新增本报告与 4 份证据文件。
- 后续波次消费点：P1_3（适配器/供给：lock.patches+0005、bindings 嵌入时的 host import 重定位——见 composition.bindings.hostContract）；P1_4（模式资格）；P1_5（R/A/T/P 装配）；VERIFY（129/103 分母不继承，按原 oracle 重跑）。
