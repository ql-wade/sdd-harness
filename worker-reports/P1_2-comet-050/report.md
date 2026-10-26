# P1_2 worker report — 原生命令分发与旧入口防再生（comet-050）

- 任务：P1_2（tasks.md `### Task P1_2`），修订 `2026-10-26-comet-050-adoption-v1`
- 执行日期：2026-10-26；钉版 Node `v24.15.0`（`~/.nvm/versions/node/v24.15.0/bin`）
- 未 commit（按指令）；所有证据在 `worker-reports/P1_2-comet-050/evidence/`

## 1. 目标与完成范围

1. **I04 hook gap 修复（hooks.yaml，本任务所有）**：`kb-write-protection` 的编译路径
   `'llmwiki/wiki/'` 为子串匹配，不覆盖注册 canonical 落点
   `.sdd/wiki/<slug>/wiki/`（`$SDD_HOME/wiki/<slug>` 推导，见
   `hooks/_resolve-project-dir.sh` / `tools/mcp/llmwiki.sh`）。修复 = target 列表新增
   `".sdd/wiki/"` 前缀并保留旧子串；deny / fail-closed 语义不变，只收紧。
   ledger 事件：`I04_EVIDENCE_RECORDED_HOOK_GAP_ROUTED`（路由给 P1_2 的部分完成；
   mcp-capabilities.yaml 注记仍归 P1_3，本任务未触碰该文件）。
2. **分发面（amendment task_disposition_delta.P1_2）**：
   - exporter 纳入组合包资产：`integrations/comet/application/**`（P1_6 产出、P2_4
     并行扩充中）整体进入 exportDigest 载荷（`composition` 键，目录存在才绑定，
     旧基线字节稳定）、sealed baseline（pureAssets）与发布视图
     （`release/comet-application/**`），verify 双向检出漂移；resolveBaseline 的
     git 历史路径按同一存在性规则枚举。
   - bootstrap 目标模式新增「目标项目 MCP 注册」步骤（2/3）：以源仓库 `.mcp.json`
     （能力清单的生成注册产物）为源做合并——分发名为受管键、目标内其余条目保留、
     包装器型条目仅在目标内文件存在时注册（不悬空）；幂等（无字节变化不写）。
     顺序在 foundation pull 之前，保证 repeat pull 的 lock 字节稳定。
   - 防再生断言保持：legacy workflow 全部用例（retired 命名 fail-closed、
     无前缀删除、卸载只清自有）在绿套件中原样通过，未放宽。
3. **0.5.0 适配**：`checkRun` 的 native Run 识别补上 0.5.0 单状态文件
   `<change>/comet-state.yaml`（旧 `.comet.yaml`/`.comet/run-state.json` 判据保留）；
   对应行为测试改用钉版 0.5.0 build 的真实布局实证。
4. **foundation/ 再分发**：hooks.yaml 变更 + 0.5.0 re-lock + P1_6 manifest 更新后，
   committed foundation 工件已漂移（RED 证据）；按当前源重建（`export
   --freeze-baseline`，新基线 `8c66…` 起始的当前 digest 见 evidence），I04 遗留在
   release 视图里的 enforcement 注记 hunk 随再分发清除（视图=源，注记由 P1_3 波次
   在源侧重做后再同步）。

## 2. 改动文件（均为 Owns 清单内）

| 文件 | 改动 |
| --- | --- |
| `hooks.yaml` | kb-write-protection target 新增 `.sdd/wiki/`（保留 `llmwiki/wiki/`），注释记录 I04 缺口与修复归属 |
| `tools/foundation-export.mjs` | 组合包枚举/digest 绑定/发布视图/sealed cache/verify 漂移检出/git 历史解析；checkRun native 识别 0.5.0 `comet-state.yaml` |
| `tools/bootstrap.sh` | 目标模式 3 步：adapter → 目标 MCP 注册（python3 合并，诚实注册+幂等）→ foundation pull |
| `test/foundation-distribution.test.js` | 新增：I04 hook gap 行为+装配断言×2、组合包分发/封存/漂移×2、目标 MCP 注册×1；重写 native-run 用例到 0.5.0 布局（含 guard 写状态后快照） |
| `foundation/**` | 再分发产物（lock/视图/新 sealed 基线/comet-application 视图） |

未改动：`tools/adapters/claude-code.sh`、`test/delivery-cases/1_2.mjs`、
`test/legacy-workflow-routing.test.js`（既有覆盖已足够）；`mcp-capabilities.yaml`
（P1_3 所有，禁碰）。

## 3. RED → GREEN（真实命令与数字）

命令形态（钉版）：`PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" node --test
test/foundation-distribution.test.js test/delivery-cases/1_2.mjs
test/legacy-workflow-routing.test.js`

- RED 基线（修复前）：`tests 71 / pass 68 / fail 3`（drift gate、F04 old-run、
  native-run 0.5.0 布局），见 `evidence/red-baseline-owned-suites.txt`。
- 行为 RED（修复前，隔离装配真 hooks.yaml）：合成 Write
  `.sdd/wiki/sdd-harness/wiki/curated/x.md` → **exit 0（放行，即 I04 缺口）**；
  旧路径 `llmwiki/wiki/…` → exit 2。见 `evidence/red-hook-gap-probe.txt`。
- GREEN（修复后）：`tests 76 / pass 76 / fail 0 / skipped 0`，随后 exporter
  verify exit 0。见 `evidence/green-owned-suites.txt`。
- Hook 修复后双探针（`evidence/green-hook-probes.txt`）：canonical 落点 **exit 2**
  （修复前 0）、旧子串路径仍 exit 2；附加：非 wiki 的 `.sdd/run-state.json`
  exit 0（未过宽）、`git push --force` exit 2（blocklist 回归）。
- 装配级验证（AGENTS 红线，脚本行为+装配产物双侧）：`bash
  tools/adapters/claude-code.sh` exit 0，`hooks/.compiled.env`
  `KB_PROTECT_PATHS='.sdd/wiki/:llmwiki/wiki/'`，settings PreToolUse matcher
  `Write|Edit|MultiEdit|NotebookEdit|Bash`（deny 并集完整）。见
  `evidence/assembly-verification.txt`。
- 相关消费方（非本任务文件）：`test/adapter-quoting.test.js` 13/13 pass
  （旧 kb-write-protection 用例不回归）。

## 4. 全套件（scripts/check.sh → npm test）诚实拆分

`bash scripts/check.sh` exit 1：`tests 1174 / pass 1137 / fail 37`。
37 个失败全部位于 `test/infra-runner-isolation.test.js`(17)、
`test/classic-integration.test.js`(3)、`test/comet-flow-acceptance.test.js`、
`test/comet-security-backports.test.js` —— 均非本任务文件。对照实验：在
`HEAD`（e48fe10）干净 worktree 上运行同四个文件得 40 个失败，与本树失败集合
**归一化后完全一致（current 新增失败 = 0）**；本树反而比 HEAD 少 3 个失败
（infra worker 未提交改动修复了 C08 三例）。结论：37 个失败是既有跨波次状态
（infra worker 进行中改动、P1_5 probe pin 停在 P1_6 manifest 更新之前、
0.5.0 re-lock 的波次间过渡），非本任务引入，本任务零新增失败。
见 `evidence/full-check-preexisting-failures.txt`。

## 5. 未验证项 / 风险 / 需人工确认

1. **并行写者竞态（最重要）**：P2_4 与本任务同树并行，验证期间两次向
   `integrations/comet/application/` 写入新文件（`bindings.mjs`、`extensions/`、
   `composition.json`，文件数 245→254→255），导致 foundation 需要两次重导出。
   最终 GREEN 与事后 verify 均在 255 文件状态捕获且干净；但若 P2_4（或任何
   Owns 源的人）在集成提交前再写入，committed foundation 会再次漂移——按既有
   规则（drift gate fail-closed），**最后落盘的波次必须重跑
   `node tools/foundation-export.mjs export --root . --out foundation
   --release-commit <HEAD> --freeze-baseline`**。
2. **hooks/pre-tool-gate.sh 内置回退默认值未更新**（该文件不在本任务 Owns 清单，
   未触碰）：`.compiled.env` 缺失时的 fallback 仍是 `KB_PROTECT_PATHS="llmwiki/wiki/"`。
   所有已装配宿主都读编译产物（已含 `.sdd/wiki/`），但裸脚本无编译产物运行时
   canonical 落点不在回退覆盖内。建议拥有者跟进同步该默认值。
3. **mcp-capabilities.yaml enforcement 注记**：I04 在 release 视图的残留 hunk 已随
   再分发清除；源侧注记（`enforcement: hook:kb-write-protection`）按路由归 P1_3
   在其波次重做——本任务已把 hook 侧修好，注记所需的共存条件现在成立。
4. 目标 MCP 注册的「分发名覆盖同名目标条目」语义：等同 hooks 受管键升级语义；
   若成员工作区同名自配需要优先，需人工裁决（当前无此场景）。
5. 0.5.0 native 布局判据（`comet-state.yaml`）来自钉版 build 实证（隔离 fixture
   `state init` 产物）；未覆盖未来 0.6 布局变化——届时该测试会 RED，属预期防线。

## 6. 事故记录（透明披露）

清理导出过程产生的未跟踪 transient 基线缓存时，脚本误判把 7 个 **git 已提交**的
历史基线（`foundation/baselines/{017a,2a2b,2aba,3ab1,d6ea,e4e3,f708}…`）一并删除。
1 分钟内发现，`git checkout -- foundation/baselines/` 从 git 逐字节恢复；恢复后
`git diff --stat foundation/baselines/` 为空、`git status` 无 M/D，exporter verify
exit 0、owned 套件 76/76 重新跑绿（evidence/green-owned-suites.txt 为恢复后捕获）。
最终状态 = 7 个已提交历史基线 + 1 个未跟踪新基线（90ffe99f…，被当前 lock 引用，
255 文件组合包状态）。教训已内化：删除动作前先区分 tracked/untracked。
