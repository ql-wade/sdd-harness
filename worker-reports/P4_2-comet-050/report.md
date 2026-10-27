# P4_2 worker report — 同 digest 构建、部署与回滚（comet-050 修订）

- 任务：P4_2（tasks.md `### Task P4_2`），修订 `2026-10-26-comet-050-adoption-v1`
- 执行日期：2026-10-26/27；钉版 Node `v24.15.0`（`~/.nvm/versions/node/v24.15.0/bin`）
- 未 commit、未 push（按指令）；证据在本目录 `evidence/` 与 Owns 内的 `release-journey/`
- 部署语义按本修订：本仓库是 scaffold（分发生产者），部署 = foundation-export
  分发包的构建/发布/回滚；**没有也不做任何真实远端部署**（见 UNVERIFIED 清单）

## 1. 目标与完成范围（链条覆盖）

在既有 ReleaseProtocol.v1 CLI（`tools/ci/release.mjs`，隔离 Registry/环境面
promote/reconcile/rollback 原样保留）上新增 **foundation 分发面**三个子命令，
复用 exporter 原生模块接口（`import { buildLock, resolveBaseline } from
'../foundation-export.mjs'`）：

| 链条环节 | 实现 | 红线（负例） |
| --- | --- | --- |
| 构建产物 digest 锁定 | `foundation-promote` 以钉版 releaseCommit 调真实 `buildLock(root)` 重算 live exportDigest，必须 == 已提交 `foundation/foundation-lock.json` 的 exportDigest；同时绑定供应侧 build fingerprint（镜像 `tools/comet/build.mjs fingerprintOf` 公式：sha256(JSON{archive,patches,toolchain}) of `integrations/comet/upstream.lock.json`），runner 版本必须与 lock 的 toolchain.runner.version 一致，`.sdd/vendor/comet/<commit>/builds/<fp>/distribution.json` 存在时实测比对 | BUILD_DIGEST_DRIFT、SUPPLY_RUNNER_MISMATCH、SUPPLY_BUILD_DRIFT、SEALED_BASELINE_UNRESOLVABLE（发布前置：被发布物必须内容可恢复） |
| 发布协议登记 | 新增 `release-journey/release-protocols.json`（ReleaseProtocols.v1）：git 分发 = LOCAL_VERIFIED（committed foundation 树 + sealed baselines，bootstrap 目标模式消费）；**npm publish 与 GitHub release = UNVERIFIED**（本任务无凭据/授权；`.github/workflows` 仅有只读门 delivery-gate.yml + quality-gates.yml，无发布流水线——原指令中的 release-protocol* workflow 不存在）。promote 时登记文件必须已注册并把 registrationDigest 记入发布回执 | RELEASE_PROTOCOLS_UNREGISTERED、DISTRIBUTION_LEDGER_REQUIRED、DISTRIBUTION_PROJECT_MISMATCH（计划字段永不替代登记） |
| 部署（本地语义） | 发布 = 本地分发账本绑定：tag ref → exportDigest → active 发布 → 独立分发读回（business state），发布记录（FoundationReleaseReceipt.v1）绑定 exportDigest+供应指纹+releaseCommit 于同一 correlationId；同 digest 重复发布幂等（返回原回执，不再发布）；顺序发布自身移动 tag 并保留上一已批准 exportDigest 为唯一回滚目标 | TAG_DIGEST_DRIFT（带外改指 tag：拒绝并记录 tagResolvedDigest/expectedDigest/builtDigest 三方身份）；RECEIPT_CORRELATION_MISSING |
| 未知部署结果 | `foundation-reconcile --correlation-id`：先查询原操作；未知 ID 如实 READBACK_UNCONFIRMED，绝不二次发布；已知 ID 绑定原 requestedAt 原回执 | READBACK_UNCONFIRMED、READBACK_CORRELATION_MISMATCH |
| 回滚验证 | `foundation-rollback`：批准门（RollbackApproval.v1，digest+distribution 匹配）→ 仅允许回退到保留的**前一已批准 exportDigest** → 该 digest 的 sealed baseline 必须从 `foundation/baselines/<digest>` 多版本保留**逐字节可解析**（真实 `resolveBaseline`）→ 生效后独立读回 digest+distribution+服务终态 | ROLLBACK_NOT_APPROVED、ROLLBACK_DIGEST_MISMATCH、ROLLBACK_RETENTION_MISSING、ROLLBACK_BASELINE_UNRESOLVABLE、ROLLBACK_TERMINAL_STATE_UNCONFIRMED |

## 2. 改动文件（全部在 Owns 清单内）

| 文件 | 改动 |
| --- | --- |
| `tools/ci/release.mjs` | 头部声明双面契约与供应指纹层级；新增 foundation-promote/reconcile/rollback；CLI 变 async（原三命令行为不变）；错误处理器加 SDD_RELEASE_DEBUG 栈开关 |
| `test/release-protocol.test.js` | 17 → 30 例：新增 foundation 面 13 例（正向/幂等/digest 漂移/供应不匹配/tag 漂移/顺序发布+保留/回滚负正×4/未知关联查询/登记前置/committed 登记诚实性/输入契约） |
| `test/delivery-cases/4_2.mjs` | 6 → 7 例：新增 4.2.c foundation 旅程（真实 exporter 冻结 → promote → tag 漂移拒绝 → v2 → 批准回滚 → LOCAL_ONLY 边界） |
| `release-journey/release-protocols.json` | 新增：发布协议如实登记（git 分发 LOCAL_VERIFIED；npm publish / GitHub release UNVERIFIED） |
| `release-journey/evidence/foundation-*.json` + `foundation-run-manifest.txt` | 真实仓库双 digest 旅程 6 步回执（见 §4） |
| `release-journey/README.md` | 增补 foundation 链章节与两套证据表 |

未改动：`tools/ci/verify-delivery.mjs`（P4_1 所有）、`.github/workflows/*`、
`tools/foundation-export.mjs`（P1_2 所有，仅 import 消费）、`tools/infra/platform.mjs`。

## 3. RED → GREEN（真实命令与数字，evidence/）

- 命令形态：`PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" node --test
  test/release-protocol.test.js test/delivery-cases/4_2.mjs`
- **RED**（实现前，01-red-new-tests.txt）：`tests 37 / pass 23 / fail 14` —
  14 个新用例全部因 `unknown command: foundation-promote`（工具无该面）失败；
  既有 23 例照常通过（RED 不伤旧功能）。
- **GREEN**（实现后，11-green-owned-suites.txt）：`tests 37 / pass 37 / fail 0 /
  skipped 0`。
- 相邻套件（10-green-adjacent-suites.txt + 13-green-final-owned-adjacent.txt）：
  `test/foundation-distribution.test.js` + `test/ci-delivery-gate.test.js` +
  `test/delivery-cases/1_2.mjs` + `test/delivery-cases/4_1.mjs` 合计
  **134/134 pass 0 skip**（含 P1_2 分发面与 P4_1 CI 门回归）。
- 实现期修过一个真实缺陷：`buildLock` 必须以钉版 releaseCommit 重算（与
  exporter 自身 verify 语义一致），否则非 git fixture 直接抛错。
- 全量 `npm test` 诚实拆分见 14-full-npm-test.txt（完成后回填本报告 §6）。

## 4. 真实仓库旅程（release-journey/evidence/，零仓库写入，账本在 $TMPDIR）

用两个**真实自洽提交**驱动完整双 digest 链（旧提交 60a75c53 其
verify 在自身提交上通过；当前 HEAD 分发 bd4fe3be）：

| 步骤 | 结果 |
| --- | --- |
| promote 旧分发（60a75c53：exportDigest 3ab11336…，runner 0.4.5，供应指纹 30562925…） | exit 0 VERIFIED；sealed baseline 逐字节解析 |
| promote 当前分发（bd4fe3be…，runner 0.5.0，供应指纹 **de39629a…** 与本机 `.sdd` vendored build 的 distribution.json 实测一致） | exit 0 VERIFIED；tag 自身移动；保留 3ab1… 为回滚目标 |
| 未批准回滚 | exit 2 ROLLBACK_NOT_APPROVED，零状态变更 |
| 批准回滚到 3ab1… | exit 0 VERIFIED；目标 baseline 从**当前仓库** foundation/baselines/ 多版本保留解析（source=sealed-assets）；active/tag/服务终态全部= 回滚 digest |
| 未知关联 ID reconcile | exit 2 READBACK_UNCONFIRMED，found=false |
| （负样本）历史提交 0e0d8341（lock 19df85e0…）在自身提交上 live 重算即漂移（并行波次冻结竞态，P1_2 报告已记录的已知现象） | exit 2 BLOCKED [BUILD_DIGEST_DRIFT, SEALED_BASELINE_UNRESOLVABLE]（committed 19df85e0… vs built d34809dd…），零发布 — digest 锁红线的真实拦截 |

## 5. UNVERIFIED 清单（真实远端部署/平台 artifact 读回归 VERIFY）

1. **npm publish**：未执行（无 registry 凭据/授权）；已登记为 UNVERIFIED 协议。
2. **GitHub release / 平台 tag**：未创建（无仓库 release 权限）；UNVERIFIED。
3. **真实目标环境部署与其平台读回**：本仓库无目标产品环境；隔离环境面的
   真生产提升/部署仍按原注记归环境 owner + 运行时准入（LOCAL_ONLY 注记保留）。
4. **CI 上 foundation 面回归**：workflow 未改（不在我 Owns 内）；CI 侧
   `.sdd` 双构建由 ci-parity-050 已装配，foundation-promote 的
   verify-if-present 供应腿在 CI 会走真实 build；未在远端实际跑（归控制器/VERIFY）。
5. 全量跨边界旅程（129/103）归 VERIFY，不以本局部绿关闭父义务。

## 6. 全量 npm test 诚实拆分（evidence/14-full-npm-test.txt）

`npm test`（钉版 Node 24.15.0，本任务改动在树状态下）：**tests 1157 /
pass 1156 / fail 1 / skipped 0**，exit 1。唯一失败是
`test/knowledge-closeout.test.js` D06（"MCP protocol layer reports a real
launcher refusal structurally"，stderr 尾部为 `lib/adapters/llmwiki.js`
invokeMcpPublish EPIPE）——该测试文件与 `lib/adapters/llmwiki.js` 当前都
带有**另一并行 worker 的未提交修改**（git status 可证），与 P4_2 文件无任何
import 交集，非本任务引入。

另：`test/delivery-cases/5_3.mjs`（相邻观察，evidence/12）16 例 13 过 3 失败：
J4 runbook 两例在干净 HEAD worktree 上同样失败（既有跨波次状态）；J2 drill-3
仅在本机存在 `.sdd` build 时实际运行、失败于 P5_3 lease 机械（run-drills.mjs
不消费 release.mjs；5_3 中消费 release.mjs 的 J3 version-rollback 用例通过）。
归 P5_3/控制器跟进，非本任务引入。

## 7. 风险 / 需人工确认

1. 发布协议登记是**清单不是授权**：remote 腿在有权操作者执行并平台读回前
   恒为 UNVERIFIED；不得用本登记推导任何发布权限。
2. 供应指纹公式为镜像声明（build.mjs 不可 import 且 fingerprintOf 未导出）；
   已双保险：测试独立复算 + `.sdd` build 存在时实测比对。若上游改公式，
   SUPPLY_BUILD_DRIFT 会先拦。
3. `release-protocols.json`/账本登记的 project 字段当前绑定 sdd-harness-pilot；
   若 pilot 合同变更需同步（登记校验是硬门）。
4. 历史提交 0e0d8341 的自身漂移样本再次实证并行波次冻结竞态（P1_2 §5.1）：
   控制器集成时最后落盘波次必须重跑 export 再封存。
