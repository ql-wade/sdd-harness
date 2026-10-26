# P2_4-r2 返工报告 — R1–R6 编译器返工（修订 2026-10-26-comet-050-adoption-v1）

任务：P2_4 REOPENED（R1–R6）。目标：把声明式组合包修到**官方编译器真实编译通过**，
`application.json` 产物落在 `integrations/comet/application/` 下成为交付物。
仓库 /Users/mac/Code/sdd-harness，未 commit，未真实宿主执行。

## 结论

官方编译器（锁定构建 de39629a80fb32f16f3fa12515523988d775f957a62e16941542438c3b61908a 的
`prepareWorkflowApplicationPlan` + `compileWorkflowApplication`）对返工后的组合
**prepare PASS + compile PASS**，产物写入 `integrations/comet/application/package/`
（242 文件、15 技能、14 个 vendored 模块），且逐字节可复现（两次 `--rebuild`
contentHash 全等）。

- RED（返工前实测复跑）：`evidence/red-1-as-declared-compile.txt`
  - R1 拒绝：`INVALID_WORKFLOW: 应用模块依赖缺失或越过包目录：bindings.mjs -> ../../../lib/delivery/gate.js`
  - R5 供给缺口：`Skill 引用资源缺失：README.md -> benchmarks/results/2026-10-07-agentic.md`（ponytail）
- GREEN 编译：`evidence/green-1-official-compile.txt`（命令头 + exit 0）

## 产物指纹

- applicationFile：`integrations/comet/application/package/application.json`
- compositionHash：`dbcb0eeefd38dcfa8f9107240ebc870f423d78061a6037a7a6d913d27881b44b`
- contentHash：`f76778251fe6415ad946c26633ecfd293fc75bf11473d9e6df460fa572c50766`
- workflowHashes：`comet-classic-full@1: c6ace184530e3b3eeaf1502293938bdc3297f5903a100dce125e018837bbde9d`
- 构建入口：`integrations/comet/application/internal/build-application.mjs [--rebuild]`（node v24.15.0）
- 溯源/指纹清单：`integrations/comet/application/internal/compile-manifest.json`

## R1–R6 逐项落法

| 项 | 落法 |
| --- | --- |
| R1 导入逃包 | 构建脚本把 `lib/delivery/gate.js` 判定闭包（lib/delivery 3 + contracts/delivery 11，共 14 模块）以**字节逐字 + 仅相对说明符改写**生成包内 `sdd/*.mjs`，嵌入的 bindings.mjs 的 `'../../../lib/delivery/gate.js'` 机械改基为 `'./sdd/lib-delivery-gate.mjs'`（恰一次出现，脚本断言）。判定逻辑单源于 lib/delivery：compile-manifest 记录每个模块 sourcePath/sourceSha256/moduleSha256；2_4.mjs 用同一映射**从仓库源重推出包内字节并逐字比对**（单源证明）。 |
| R2 executor 层 | `bindings.mjs` 的 `createBindings` 在工厂上下文可用时返回 `executors:[context.createSkillExecutor({id:'sdd-managed-skill-host', capabilities:['skill-host'], authorize, invokeSkill})]`。authorize 只认加载 manifest 声明且钉定到同一应用的绑定；invokeSkill **一律拒绝自动执行**（真宿主按公共 SDK 领取/回报协议加载钉定 SKILL.md）——端口是宿主契约，不是执行实现。无工厂上下文的仓内调用（comet-executor.js）仍只回 validators，不伪造端口。 |
| R3 逐步骤唯一 id | 组合 replacements 覆盖 classic-full **全部 9 个 invoke_skill 步骤**，id = `<base>-<step-slug>` 全局唯一，adapter outputSchema 由官方工厂在编译时对 ORIGINAL schema 做 hash 等值校验（已编译通过）。方法步骤用 P1_6 打包技能的逐字副本 + 仅 frontmatter name 改写（grill-me×2、claude-parallel-tdd-planner、tdd，构建期生成）；未替换领域步骤（full.open、full.build.configure（R5 后）、full.verify.run、full.archive.prepare/deliver）用受管领域技能 `internal/domain-skills/<id>`（自包含、契约块钉定原 schema，构建期与工厂 schema 比对）。 |
| R4 审批锚 | 9 条 write 型 work binding 全带 `authorizationFrom:'classic.composition.confirm'` + `authorizationChoices:['approved']`；编译产物 workflow 入口变为 `classic.composition.prepare`，`classic.composition.confirm`（ask_user）在 full.open 之前把关；6 条只读 gate extension binding 无锚。 |
| R5 ponytail | 从 replacements 移除（`composition.json#removedReplacements` 记录边界：P1_6 快照 README 链接缺失资源不可嵌入；实测拒绝证据 red-1 + P1_4 探针 supplyGaps）。full.build.configure 改由受管领域技能承担；P1_6 打包资产原样保留但不再被组合绑定。负向断言：ponytail 重入 replacements 会被 2_4.mjs 拒绝。 |
| R6 资产自包含 | 不嵌入任何上游 pristine assets/skills（其链接逃逸依赖根）。包内技能 = 自包含受管目录；编译期官方 `inspectApplicationSkill` 逐技能复检（链接完备、无符号链接、非空 SKILL.md），2_4.mjs 再次复检并比对 contentHash。 |

## 验证（命令 + exit 见 evidence/）

- `~/.nvm/.../v24.15.0/bin/node --test test/delivery-cases/2_4.mjs` → **21/21 pass，exit 0**（green-2）
- `node --test test/delivery-cases/2_4.mjs`（默认 v22.13.1）→ **21/21 pass**（green-2b，dist 导入双版本兼容）
- `~/.nvm/.../v24.15.0/bin/node --test test/delivery-cases/1_3.mjs` 全文件 → **10/10 pass，exit 0**（green-3）
- `npm test` → 1108 pass / 10 fail，其中 **9 个为返工前已存在**（stash 我的改动后同集合仍失败：foundation-distribution×2、classic-integration×5、comet-flow-acceptance×1、comet-security-backports（0.4.5 陈旧断言）×1），**1 个为本交付物待控制器重钉**（见下）（green-4，含 baseline 对照方法）
- 确定性：连续两次 `--rebuild` contentHash 相同（构建期依赖根用确定性相对根 `skills/<id>`+`dependencyRoot`，包内不含机器/临时路径，installation.json 与 compile-manifest 的 compositionHash 相等）

## 2_4.mjs 断言升级（六门/检查点/负向全保持）

保留并适配：六门扩展位置对 pristine 白名单交叉核验、A/T 与 V/Kp 同检查点 AND、
扩展声明 schema 与组合一致性、bindings 纯委托 lib/delivery 的正/负例（无载荷、跨门重放、
阻断覆盖、篡改回执、拒绝判定）、0005 补丁应用/真值表/损坏拒绝、诚实性边界。
新增：编译产物存在性与关键内容钉定（contentHash 漂移检测 = 官方 `applicationFilesHash`
对包重算比对；application.json 身份/15 技能 contentHash/9+1 锚与能力审查一致；
workflow.json 入口锚与逐步骤 ORIGINAL schema 等值；R1 单源重推逐字比对；R6 官方复检；
方法变体逐字性；R5 边界；负向新增——id 跨步共用、领域步骤漏替换、ponytail 重入、
不可替换步骤被替换）。

## 需控制器/后续波次处理（本 worker 未动，均在我边界外）

1. **foundation 重钉（唯一由本交付物引入的红）**：foundation 锁冻结
   `integrations/comet/application` 全部字节，本交付物（package/ 242 文件 + internal/ +
   修复后的 composition.json/bindings.mjs）使 `foundation-distribution` 的 repo 级
   drift gate 失败。既有机制 = 接纳提交时重跑导出重钉
   `foundation/foundation-lock.json` + `foundation/release/comet-application/`
   （先例 commit 14dd516）。只读重算：exportDigest
   `c98b6f82…aed512b2` → `19df85e09c1773dcc0041acb43bdc5bbe4f90a0f213f7060fc259d2f86f6e0e1`
   （同 releaseCommit 0ed3b60b）。若不希望编译产物进冻结集，则需 exporter 属主（P1_2 面）决策排除生成物——二选一，均为控制器动作。
2. **comet-executor 注册缝隙**：`lib/adapters/comet-executor.js` 钉定注册路径为
   `integrations/comet/application/application.json`（application/ 根下）；编译器只能产出自包含包目录，产物在 `package/application.json`。该缝隙未动（非我边界），安装/派发旅程仍拒绝——与"编译≠运行时接纳"一致，归 P1_4/P3_2。
3. mode-qualification.json / tasks.md 等验收工件由控制器按本报告更新。

## 未验证项（如实）

- 真实宿主 install/dispatch、Run 内扩展行为、0005 在真实派发 Run 中的行为（composition.json#unverified 保持声明；本波禁止真实宿主执行）。
- 编译产物在 Linux/其他机器的逐字节可复现性（macOS 本机两次 --rebuild 全等；包内无机器路径，理论可移植，未实测）。
- 9 个预存失败与 1 个安全回测陈旧断言的根因不在本任务范围。
