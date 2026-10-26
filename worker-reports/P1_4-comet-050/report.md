# P1_4 worker report — 原生Classic模式与入口绕行证明（0.5.0 供给重锁版）

- 修订：`2026-10-26-comet-050-adoption-v1`（ADR-0021/0022）
- 钉版环境：node v24.15.0（`~/.nvm/versions/node/v24.15.0/bin`）
- 供给基线：upstream.lock.json = 0.5.0 / commit `aeb1a659…` / **patches=[0005]**（本波次重锁，控制器许可例外）
- RED：`evidence/red-1-delivery-case-1_4.txt`（2 fail / 9 pass 的原始输出）
- GREEN：`evidence/green-1-delivery-case-1_4.txt`（7/7）、`evidence/green-2…1_3`（36/36）、
  `evidence/green-3-adjacent-comet-suites.txt`（171/171）、`evidence/green-4-adjacent-cases-1_6-1_2.txt`（18/18）、
  `evidence/green-5-final-consolidated.txt`（**43/43**：1_4+1_1+1_3+2_4+comet-build）
- 既有失败归属复核：`evidence/attribution-preexisting-failures.txt`（comet-security-backports 的 0.4.5 身份断言
  仍失败且与本波次无关；infra-runner-isolation 当前全绿——先前波次已返工）

## 1. 目标与完成范围

P1_4 在 0.5.0 供给重锁后的三件事，全部以真实命令/真实编译器/真实 CLI 完成：

1. **供给重锁**：0005 进入 `integrations/comet/upstream.lock.json` patches（path+sha256
   `74e6c810…b18d`，与 P2_4 钉的 composition.knowledgeCloseout.patchSha256 逐字节一致），
   `node tools/comet/build.mjs --archive .sdd/cache/runner-build/comet-source-0.5.0.tar.gz` 重建。
2. **官方编译器实测**：用构建包内的 `prepareWorkflowApplicationPlan + compileWorkflowApplication`
   （`@rpamis/comet/applications/compiler` 同源 dist）对 `integrations/comet/application/`
   真实编译（驱动：`mode-probes/compile-probe-050.mjs`）。
3. **受管 init 资格 + 逃生门补证**：一次性 /tmp 探针家隔离（HOME 指向 scratch，PATH 桩
   npm/npx/openspec 见证），驱动：`mode-probes/init-probe-050.mjs`。

## 2. 关键结论

### 2.1 重建指纹（供给重锁）

- 新指纹：**`de39629a80fb32f16f3fa12515523988d775f957a62e16941542438c3b61908a`**
  （= sha256({archive f89d7bf1…, patches=[0005 74e6c810…], toolchain})）。
- 构建 exit 0；built CLI `--version` = 0.5.0；`work/domains/comet-classic/classic-resolver.ts`
  与 `work/dist/…/classic-resolver.js` 均含 `knowledgeCloseoutBlocked`（0005 生效，源+dist 双证）。
- `tools/comet/build.mjs --check-generated --runtime-smoke --json` → **PASS**
  （classic/native/entry 生成一致性 + 4 文件 runtime smoke，177s；证据 `evidence/supply-verify-contract.log`）。
- 重锁前的无补丁构建 `29f2332b…` 原样保留（两 build 并存，未做任何字节改动；
  BUILD_BASELINE_DRIFT 守卫未触发）。证据：`evidence/supply-rebuild.log`。

### 2.2 编译器实测结论（P2_4 遗留关键问题）：**按声明编译=失败，且缺口已完整枚举并证明可修复**

对 `integrations/comet/application/`（P2_4 composition.json + bindings.mjs + P1_6 skills）经官方编译器
（`mode-probes/1_4-compiler-compile.json` 全记录）：

| 变体 | 结果 | 首个真实拒绝 |
| --- | --- | --- |
| a 按声明（bindings.mjs 逐字嵌入） | **REFUSED_AT_PREPARE** | `应用模块依赖缺失或越过包目录：bindings.mjs -> ../../../lib/delivery/gate.js`（模块扫描拒绝逃出包目录的相对导入） |
| b 导入重定位(hostContract)+逐步骤 id+审批锚 | **REFUSED_AT_PREPARE** | `Skill 缺少可路由且具备所需能力的执行端口`（createBindings 只回 validators、无 executors；每个 invoke_skill 步骤都要可路由宿主执行端口） |
| c = b + createSkillExecutor 宿主桩（authorize:false，诊断专用） | **COMPILED** | —（完整包 application.json/workflow.json/installation.json/application.mjs/bindings.mjs/skills/rules/scripts 产出于 /tmp） |

由此钉出六项修复清单（mode-qualification.json `compilerQualification.repairList` R1–R6）：

- R1 bindings.mjs 必须把纯 lib/delivery 图捆绑进包并重写导入（hostContract 职责）。
- R2 createBindings 必须返回 executors（`context.createSkillExecutor`，能力覆盖全部绑定技能）。
- R3 **组合形态约束（最重要）**：每个 invoke_skill 步骤必须替换成**逐步骤唯一 skill id**，其 adapter
  outputSchema 与该步骤 ORIGINAL schema 哈希相等。P2_4 把 grill-me 同时映射到两个 schema 不同的
  design 步骤；且领域自身把 comet-archive 共用于 prepare/deliver 两个 schema 不同步骤——**未替换的
  领域步骤（full.open、full.verify.run、full.archive.prepare/deliver）也必须由受管方提供逐步骤
  domain-work 技能**，义务大于 P2_4 声明面。这与上游官方示例（examples.ts 全部逐步骤替换）一致。
- R4 写副作用 action 绑定需 `authorizationFrom: classic.composition.confirm`（上游工作审批锚；
  只读判定型扩展技能可豁免）。
- R5 P1_6 打包的 ponytail 技能**不可嵌入**（README 链接指向快照中不存在的
  benchmarks/examples/INSTALL → `Skill 引用资源缺失`）——打包必须链接完备。
- R6 上游 pristine `assets/skills/*` 一律不可嵌入（其 markdown 链接逃出依赖根 →
  `Skill 引用越过依赖目录`）——domain-work 技能必须是自包含受管目录。

**交付状态**：`integrations/comet/application/application.json` **未产出**（按声明编译失败，如实不造包）；
P1_3 executor 的 `APPLICATION_PACKAGE_REQUIRED` 边界由本次实测反证为正确。诊断变体 c 的包在
/tmp，不是交付物，不主张任何 runtime 接纳。

### 2.3 受管 init 资格结论（Superpowers 排除）：**0.5.0 无排除开关，缺口+缓解均已实证**

（`mode-probes/1_4-managed-init-escape.json`，一次性探针家 + PATH 桩见证；真实家/仓库零污染）

- 干净宿主 `comet init --workflow classic --platform claude --yes` exit 0，但真实尝试：
  `npx skills add obra/superpowers -y --skill brainstorming …（13 个技能）--agent claude-code`
  与 `npm install -g @fission-ai/openspec@latest`；项目内建 `docs/superpowers`；HOME 写 `~/.comet`。
- **无任何 init 旗标可排除 Superpowers**（`--help` 全量核对 + 源事实：spAction 仅在非 classic 或
  平台不在 skills-cli 映射时 skip；selectNpmDeps --yes 自动选中未装项）。
- 预置 `.claude/skills/superpowers` **不能**抑制安装尝试（hasSkills 判定路径不同——实测仍尝试）。
- `--workflow native` 对照组：**0 次** superpowers/skills-cli 调用（唯一上游原生免疫路径）。
- **B6 缓解实证**：PATH 上放兼容钉版 openspec（桩答 1.11.0）后，浮动全局升级尝试**消失**
  （superpowers 尝试仍在）——受管供给把 `.sdd/tools/openspec-1.11.0` 暴露到 PATH 即为已证抑制。
- `COMET_OPENSPEC` 只被 classic openspec adapter 认（classic-openspec-command.ts:122,148），
  不影响 init 决策——env 卫生不能只靠它。
- **受管结论（B8 登记）**：受管项目不得经裸 `comet init` 获取方法面；方法供给=打包应用技能
  （P1_6→B7 修复后）；init 引导只能在 launch authority 用 PATH 桩，或手动装配 `.comet/config.yaml`。
- init 装的方法是**上游 comet-\*** 技能而非 Matt 方法（P1_6 RED 证据复核，M01 保持）。

### 2.4 逃生门补证（0.5.0+0005 树上 live）

- `COMET_SKIP_BUILD=1` 单变量作废全链：build-complete→verify-pass（verify_result 盖 pass）→
  archive-confirm→archive 7/7 成功，**归档变更目录 0 条 check log**（B4 原样持续）。
- `state set phase` 默认拒绝并点名 `COMET_FORCE_PHASE`；`=1` 直写成功（读回 archive）；
  伪造态 archive 下游仍拒（`verify_result is 'pending', expected 'pass'`）。
- 0005 读侧 live 尝试：手工在已归档 `.comet.yaml` 写 `knowledgeCloseout` 后 `state next` 不受影响
  ——compat 面忽略该字段（解析器收集为 unknownKeys，resolver 只读 SDK 内存态）；**写路径仍属接纳波次**，
  如实登记（B5）。

## 3. 改动文件

Owns（tasks.md P1_4）：

- `openspec/changes/delivery-foundation-rearchitecture/mode-qualification.json`（重写为 v2；0.4.5 全文
  保全于 `history045`，含其六补丁指纹 d4370930… 与 B1–B6）
- `openspec/changes/delivery-foundation-rearchitecture/mode-probes/{1_4-compiler-compile.json,
  1_4-managed-init-escape.json,compile-probe-050.mjs,init-probe-050.mjs}`（新）
- `test/delivery-cases/1_4.mjs`（重写：setup 绑定 0005 指纹；1.4.a 注册+历史+B1–B8；
  1.4.b 编译记录一致性与"无 application.json"；1.4.c init/逃生记录 + 两段 live 复证）
- `worker-reports/P1_4-comet-050/`（本报告与证据）

例外/被迫改动（控制器许可或供给重锁的机械后果，**单列**）：

| 文件 | 性质 | 内容 |
| --- | --- | --- |
| `integrations/comet/upstream.lock.json` | **控制器明示例外** | patches `[]` → `[{0005, sha256 74e6c810…}]`（P2_4 钉字节） |
| `test/delivery-cases/2_4.mjs`（1 行块） | 供给重锁机械更新 | 陈旧占位 `patches.length===0`（其消息自述"0005 is applied by the supply wave"）→ 深比较 `[0005==composition.patchSha256]`（等强度后置态钉定，无放宽） |
| `test/delivery-cases/1_3.mjs`（setup 块） | 同上 | 同类占位 → 深比较 `[0005 path+sha]`（注释注明供给波已落地） |
| `test/delivery-cases/1_6.mjs`（2 处） | 同上 | "patch-free"占位 ×2 → 钉 `[0005]`；manifest basis 与 lock 镜像断言 |
| `integrations/comet/application/manifest.json`（basis 段） | 同上 | `basis.upstream_patches` 重钉为 lock 同形 patch 身份 + `repin_note`（注明 0005 只改 resolver、不触方法资产；`comet-method-binding.test.js` 漂移守卫由此保持原强度通过） |

未 commit；未触碰 pristine/vendor 既有字节；探针世界全在 /tmp（OS 临时目录），仓库与真实 HOME 零残留
（复核：无 `.comet`、integrations 下无 node_modules、无 application.json）。

## 4. 真实执行的验证命令与结果（钉版 node v24.15.0）

| 命令 | 结果 |
| --- | --- |
| `node --test test/delivery-cases/1_4.mjs`（改写前 RED） | 11 tests：2 fail（六补丁身份、d4370930 指纹绑定）/ 9 pass（0.5.0 compat 面上旧生命周期断言仍真） |
| `node tools/comet/build.mjs --archive .sdd/cache/runner-build/comet-source-0.5.0.tar.gz --json` | exit 0，`fingerprint de39629a…`，reused:false |
| `node tools/comet/build.mjs --check-generated --runtime-smoke --json` | **PASS**（4 步全 PASS） |
| `node …/mode-probes/compile-probe-050.mjs` | a REFUSED（导入逃逸）→ b REFUSED（无执行端口）→ c COMPILED（诊断） |
| `node …/mode-probes/init-probe-050.mjs` | 5 次 init + 逃生链全部落探针记录（§2.3/2.4） |
| `node --test test/delivery-cases/1_4.mjs` | **7/7 pass, exit 0** |
| `node --test 1_1.mjs 2_4.mjs comet-build.test.js`（重锁直后） | 26 tests 25 pass 1 fail（仅 2_4 陈旧占位）→ 占位更新后全绿 |
| `node --test 1_1.mjs 2_4.mjs comet-build.test.js 1_3.mjs` | **36/36 pass, exit 0**（1_3 dispatch 探针在重建供给上成立） |
| `node --test comet-method-binding comet-driver comet-execution-binding knowledge-closeout` | **171/171 pass**（manifest 重钉后） |
| `node --test 1_6.mjs 1_2.mjs` | **18/18 pass**（占位更新后） |
| `node --test comet-security-backports infra-runner-isolation` | 76 tests 75 pass 1 fail=**既有**（security-backports 的 0.4.5 身份断言，P1_3 已归属，本波次无增） |
| `node --test 1_4 1_1 1_3 2_4 comet-build`（合并终跑） | **43/43 pass, exit 0** |

## 5. UNVERIFIED（如实，归后续波次）

1. **B7 修复与真包编译/安装**：R1–R6 落地后以真实方法技能+受审 adapter 编译
   `integrations/comet/application/application.json` 并 `comet application install` —— 供给/接纳波次
   （诊断变体 c 只证明修复清单穷尽，不构成交付）。
2. **真实 Run 内 runtime dispatch**（扩展阻断、repair 路由、归档期 validateOutcome 复验 Kp）
   与 **0005 SDK 面生效**（knowledgeCloseout 写路径 wire keys + 受管接纳）→ P1_5/P3_2/P3_4/P4_6。
3. **组合 Run 上基础 state 命令的 live 拒绝**（仍被编译包缺失阻塞）→ B7 落地后。
4. 全量 `bash scripts/check.sh` 未整跑（既有失败归属沿用 P1_3 记录并抽样复核，见 §4 末两行）；
   全量跨边界旅程（V_C07/V_F06 等）归 VERIFY。
5. 真实宿主执行/模型调用/MCP 启动：本波次零次发生。

## 6. 需人工/控制器确认

- 五处例外/被迫文件改动（§3 单列表）超出 P1_4 Owns 清单，均为供给重锁的机械一致性更新且等强度
  （无断言放宽）；请控制器接纳或指示回退方案（回退 lock 即整体回退）。
- `toolchain-baseline.json` 的 `extension_delivery.built_entrypoint` 仍指旧 build 29f2332b…（1_1 依赖
  其存在性而非唯一性，测试通过）；是否把 baseline 观测面刷新到 de39629a… 属 P1_1 所有者裁量。
- B3（comet-archive 共用于两个 schema 不同步骤）意味着"不替换领域步骤"的经典组合根本不可编译——
  与 P2_4 声明面的差异需要 P2_4/后续波在 composition.json 里显式重声明（每步一技能）。
