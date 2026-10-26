# P1_6 worker report — Comet 0.5.0 组合包路线（技能资产打包）

- 修订：`2026-10-26-comet-050-adoption-v1`（未执行 → 本报告为该修订的首次执行）
- 日期：2026-10-26
- 范围：tasks.md `### Task P1_6` Owns 列文件。`.agents/skills` 只读（仅删除了一个非追踪的 `__pycache__` 污染物，见 §5）；`integrations/comet/patches/` 未动（归 I02）；未 commit；未启动任何模型/MCP。

## 1. 目标与完成范围

ADR-0022 路线下 P1_6 从"上游补丁"改为"组合包技能资产打包"（replacements 的供给侧）：

1. 把 method-profile 声明的全部 11 个方法技能快照原样（字节一致、真实目录、零符号链接）打包到 `integrations/comet/application/skills/<name>/`，共 245 个文件。
2. 新写 `integrations/comet/application/manifest.json`：每技能 name + content_sha256（与快照同一 digest 基准）+ source_path/packaged_path + verbatim 标记；绑定 0.5.0 upstream lock（commit `aeb1a659…`，`upstream_patches: []`）；`status: ASSETS_PACKAGED`、`runtime_accepted: false`。
3. `method-profile-manifest.json`：新增 `application_packaging` 视图；`comet_integration` 改写为"补丁链退休 + 0.5.0 原生组合路由"；`controller_basis` 与 `superpowers` 段如实改写（0.5.0 基线 init 会再装 Superpowers——RED 证据在案）；顶层 status 改 `APPLICATION_ASSETS_PACKAGED_RUNTIME_UNQUALIFIED`。
4. `foundation/profiles/comet-managed.json`：qualification 由 `UNQUALIFIED` 改为 `ASSETS_PACKAGED`（附 assetPackaging 指针）；不虚报 QUALIFIED，`runtimeAccepted` 仍为 false，enablementOwners 不变。
5. 两个测试改消费新 manifest：`test/comet-method-binding.test.js`（供应商 pinning 套件扩展：打包正确性正向 + 3 个负向），`test/delivery-cases/1_6.mjs`（锁定构建供给 + 应用 manifest 绑定 + 花名册无 retired 名）。

## 2. RED（钉版 node v24.15.0，命令头与 exit 见 evidence/）

- `red-1-delivery-case-1_6.txt`：`node --test test/delivery-cases/1_6.mjs` → **exit=1，4 pass / 9 fail**。失败即"退位断言"：0.5.0 干净构建里 `comet-design/SKILL.md` 不再含 grill-me 绑定（0001 补丁行为），且 update 场景 install 调用里真实出现 `skills add obra/superpowers -y --skill brainstorming …`——上游基线把 Superpowers 装回来了。这是真实行为 RED，不是缺环境。
- `red-2-method-binding.txt`：`node --test test/comet-method-binding.test.js` → 首跑 exit=1，根因是 `.agents/skills/claude-parallel-tdd-planner/scripts/__pycache__/plan_guard.cpython-314.pyc`（非追踪、gitignored、17:09 早前会话产物）污染快照清单；删除后 **exit=0，5 pass / 0 fail**——供应商 pinning 断言本身仍成立（保留并扩展）。

## 3. GREEN（钉版 node v24.15.0）

- `green-1-method-binding.txt`：`node --test test/comet-method-binding.test.js` → **exit=0，9 pass / 0 fail**
  - 正向：application 打包 pinning（11 技能 × 逐文件 sha × 聚合 digest × 与 method-profile 快照及 profile.methods 三方交叉一致 × 无 retired 名 × 无符号链接）。
  - 负向：缺件（`packaged-source-mismatch` + `packaged-digest-drift`）、哈希漂移（同上）、混入 `superpowers-*` 目录（`retired-method-name` + `skill-set-mismatch`）均被拒绝。
- `green-2-delivery-case-1_6.txt`：`node --test test/delivery-cases/1_6.mjs` → **exit=0，11 pass / 0 fail**（含上表 9 项 + 锁定构建供给 + manifest 绑定两新用例）。
- `green-3-npm-test.txt`：`npm test`（PATH 钉版）→ exit=1。**全部失败与本次改动无关**（见 §4 归因）；我拥有的两套件全绿。
- `verbatim-diff-r.txt`：`diff -r .agents/skills/<name> integrations/comet/application/skills/<name>` → 11/11 IDENTICAL（独立的字节一致证据）。

## 4. npm test 失败归因（换基线对照，非放宽断言）

用 `git stash`（4 个已跟踪改动）+ 移走 `integrations/comet/application` 重跑基线，再恢复：

- 6 个可疑文件（foundation-distribution、comet-security-backports、comet-flow-acceptance、classic-integration、infra-platform、adapter-quoting）：基线 7 个失败 → 带改动同样 7 个，**逐名完全一致**（0.5.0 重锁后 committed foundation lock 仍期望 0.4.5/补丁链镜像等既有漂移）。
- `infra-runner-isolation.test.js`：基线 32 个失败 → 带改动 32 个，**失败集合逐名完全一致**（"seven-patch upstream lock" 镜像类断言在 lock.patches==[] 下必然红，属 I02/基础设施线）。
- 结论：本任务引入的新失败为 0；修复上述漂移不在 P1_6 Owns 内。

## 5. 事实来源与关键改动文件

- 改动：`integrations/comet/application/manifest.json`（新）、`integrations/comet/application/skills/`（新，245 文件）、`openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json`、`foundation/profiles/comet-managed.json`、`test/comet-method-binding.test.js`、`test/delivery-cases/1_6.mjs`。
- 事实来源：`integrations/comet/upstream.lock.json`（0.5.0 / commit aeb1a659 / patches []）、`openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json`（快照清单）、`docs/architecture/adr/0022-comet-0.5.0-native-composition.md`。
- retired 名单口径：`superpowers` / `sdd-` / `trinity` 按大小写不敏感匹配**技能名与打包路径任一分量**（名单回归防线）；快照正文内的 upstream 署名链接（如 whitebox-verify/test-authoring references 里的 `obra/superpowers` GitHub 链接）按 manifest `attribution_links` 决定原样保留——是出处引用不是运行时依赖。若要求正文级禁词，需先按"显式升级纪律"换上游快照，不能在本任务内改正文。

## 6. 未验证项（UNVERIFIED，不在本任务签署）

1. 组合包本体（replacements 接线、stepId/输出契约保持、bindings.mjs 指向 lib/delivery/*）——下游组合任务。
2. 受管 init/update 在真实 CLI 缝口永不选择 Superpowers——下游受管 init 任务；0.5.0 基线会装 Superpowers 的 RED 已存证（`evidence/red-1-delivery-case-1_6.txt`），该义务随组合路由移交。
3. 真实角色执行、Gate/Kp/Kt、完整同 Run 旅程——VERIFY；不由供应商测试启用。
4. `npm test` 中 39 个既有失败（§4）的修复——属 I02 / 基础设施 / 后续任务。

## 7. 风险与人工确认点

- `red-1` 里上游 init 重新安装 Superpowers 是当前基线的真实风险面：在组合/受管 init 落地前，任何"直接跑上游 init"的路径都会引入 Superpowers——需要下游任务尽快闭环（N04）。
- application manifest 的 content_sha256 采用与快照一致的"排序 sha-path 行"基准；快照升级时需重算（测试会强制拦截漂移，不会静默通过）。
- 工作树存在大量其他 worker 的未提交改动（docs/infra/lib 等），本报告的归因对照基于"同一工作树 ± 仅本任务改动"，若其他改动随后演化需以各自任务证据为准。
