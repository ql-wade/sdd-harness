# P4_1 — comet-050 修订执行记录（受保护CI硬门：真实平台读回与登记）

- 任务: P4_1 受保护CI硬门（tasks.md "### Task P4_1"）
- 修订: 2026-10-26-comet-050-adoption-v1
- 运行身份: 实施worker（无 commit / 无 push / 无 GitHub 写操作）
- 工作区: /Users/mac/Code/sdd-harness @ master 305e1727d7db5ea89c7fc3b21767f01c67bed125（运行起点）
- 工具链: node v24.15.0（钉版 ~/.nvm/versions/node/v24.15.0/bin）；gh CLI 已认证账号 ql-wade（token scopes: gist, read:org, repo, workflow——本次仅只读使用）

## 1. 目标与完成范围

I06 已把 required-check 候选集（delivery-gate/checks，sourceKind=committed-workflow-files）登记为
UNSELECTED，并把 repository-registration.json#branchProtection.remoteEnforcement 挂为
UNVERIFIED / pendingOwner=P4_1。本修订 = 该 pending 项的真实只读读回与如实登记：

1. 真实平台读回（gh api 只读，未做任何写操作、未开/改分支保护）。
2. 把读回事实登记进 infra/delivery/platform/ci-policy.json（note 字段——platform.mjs 闭集
   schema 不允许新增顶层字段；repository-registration.json 的 remoteEnforcement.status 按
   其自身 no-claim 规则只能保持 UNVERIFIED，该文件本次未动）。
3. 评估器红线零改动：tools/ci/verify-delivery.mjs 的四码 floor
   （MISSING/SKIPPED/TIMED_OUT/STALE_EVIDENCE）与 I06 的 CHECK_QUEUED/ARTIFACT_EXPIRED
   （tools/infra/platform.mjs）逐字保留；.github/workflows/delivery-gate.yml 未改。
4. 新增回归测试钉住登记诚实性（见 §4）。

## 2. 真实读回结论（证据: evidence/，全部 2026-10-26 只读）

| 读回项 | 命令 | 结果 |
| --- | --- | --- |
| 分支保护（classic） | `gh api repos/ql-wade/sdd-harness/branches/master/protection` | **HTTP 404 "Branch not protected"** |
| 分支保护（rulesets） | `gh api repos/ql-wade/sdd-harness/rulesets` | `[]`（空） |
| 分支保护标志 | `gh api repos/ql-wade/sdd-harness/branches/master` | `protected:false`；head=cd64618563d6e08c5c2f35b1bdf92d37e58a9d7d（2026-07-12 "feat: harden workflow control plane and e2e gates"） |
| 平台已知 workflow | `gh api repos/ql-wade/sdd-harness/actions/workflows` | 仅 2 个：live-integration.yml（"SDD live integration"，active）与 quality-gates.yml（"SDD quality gates"，active）。**delivery-gate workflow 不在平台上** |
| 近期运行 | `gh api repos/ql-wade/sdd-harness/actions/runs?per_page=10` | 全部为 live-integration 定时运行（1 queued + 9 cancelled），无 delivery-gate / quality-gates 运行 |
| 远端 head 的 check-runs | `gh api repos/ql-wade/sdd-harness/commits/cd64618…/check-runs` | 54 条全部名为 live-integration（1 queued，53 cancelled）。**无 checks、无 delivery-gate、无 core-e2e 证据** |
| 本地工作 HEAD 的 check-runs | `gh api repos/ql-wade/sdd-harness/commits/305e1727…/check-runs` | **HTTP 422 "No commit found"**——本地 HEAD（领先远端 717 commits）不在平台上，无任何 CI 状态 |

### 结论判定

- **remoteEnforcement 实测 = UNPROTECTED_READ_BACK**：平台对 master 不强制任何 required
  status check（classic 404 + rulesets 空 + protected:false 三口径一致），required-context
  清单为空。因此"required 名单 vs declaredCandidateChecks"的一致性核对不适用——不存在
  required 名单，MISMATCH 与一致都不成立，已在 ci-policy note 如实写明（两个方向都不可声称）。
- **两个候选检查（delivery-gate / checks）的平台侧证据为零**：delivery-gate workflow 文件
  未上平台；平台上的 quality-gates.yml 是 2026-07-12 的旧变体（workflow 名 "SDD quality
  gates"、job core-e2e、push 仅 main），与本仓库提交版（scaffold quality gates / job checks /
  push master+main）已漂移——旧变体的 job 名与候选名 "checks" 也不同。
- **registrationStatus 保持 UNSELECTED、names 保持 []**：未保护的平台不能支撑任何登记，
  不虚报。登记是用户授权的 admin 写操作，保持待办（见 §5）。
- 远端 master 落后本地 717 commits 且平台侧从未运行过 delivery-gate：在授权注册 +
  push 之前，delivery-gate 检查名在任何 SHA 上都不会有平台证据。

## 3. 改动文件（全部在授权边界内）

| 文件 | 改动 |
| --- | --- |
| `infra/delivery/platform/ci-policy.json` | 仅 note 登记：provider.note 与 requiredChecks.declaredCandidateChecks.note 追加 2026-10-26 只读读回事实（UNPROTECTED_READ_BACK、无 required contexts、零候选证据、delivery-gate 不在平台、远端 head 落后 717 commits、queued≠成功证据、开启保护=待授权 admin 写）。schema 字段集零变化，platform.mjs validate 依旧 ok |
| `test/ci-delivery-gate.test.js` | +2 测试：钉住"UNPROTECTED_READ_BACK ⇒ registrationStatus=UNSELECTED + names=[]"、note 必须保留观测标记/日期/命令、五码阻断语义（四码 floor + QUEUED）与 failClosed 在活基线完整、remotePolicyWriteAuthorized=false；候选声明 note 必须携带平台侧对应观测 |
| `test/delivery-cases/4_1.mjs` | +1 case：同一诚实性契约（UNSELECTED/空名/note 含 UNPROTECTED_READ_BACK 与端点/五码齐全） |
| `.github/workflows/delivery-gate.yml` | 未改（红线保持） |
| `tools/ci/verify-delivery.mjs` | 未改（四码 floor + 精确 SHA 语义逐字保持） |

## 4. RED → GREEN（全部钉版 node v24.15.0，真实行为 RED，非环境缺项）

- RED（登记前，新测试因 ci-policy note 缺读回记录而失败，既有测试全绿）:
  - `node --test test/ci-delivery-gate.test.js` → exit 1，新增 2 例失败（evidence/red-ci-delivery-gate.txt）
  - `node --test test/delivery-cases/4_1.mjs` → exit 1，新增 1 例失败（evidence/red-delivery-case-4_1.txt）
- GREEN（登记后）:
  - `node tools/infra/platform.mjs validate --json` → ok:true，violations 0，exit 0
  - `node --test test/ci-delivery-gate.test.js` → **tests 22 / pass 22 / fail 0 / skip 0**，exit 0（green-ci-delivery-gate.txt）
  - `node --test test/delivery-cases/4_1.mjs` → **tests 7 / pass 7 / fail 0 / skip 0**，exit 0（green-delivery-case-4_1.txt）
  - `node --test test/infra-platform.test.js`（I06 回归）→ **tests 49 / pass 49 / fail 0 / skip 0**，exit 0（green-infra-platform.txt）
  - `node --test test/delivery-cases/4_2.mjs`（下游消费 ci-policy 的 P4_2 case，防污染）→ **tests 6 / pass 6 / fail 0 / skip 0**，exit 0（green-delivery-case-4_2-downstream.txt）
  - `PATH=$HOME/.nvm/versions/node/v24.15.0/bin:$PATH npm test`（全量回归）→ **tests 1134 / pass 1134 / fail 0 / skip 0**，exit 0（green-npm-test.txt）

## 5. 等人工项（不阻塞本登记，阻塞真实保护门）

1. **开启分支保护并注册 required checks**（需用户授权的 GitHub 写操作，本 worker 拒绝执行）：
   以 admin 身份对 ql-wade/sdd-harness master 启用保护，required status checks 至少含
   `delivery-gate` 与 `checks`（名字以 workflow job 为准）。注册后需按 ci-policy note 的
   规则重新读回保护与 check 证据，并把 registrationStatus 走 admin 登记流程升级。
2. **push 使 delivery-gate.yml 上平台并产生真实检查运行**：本地领先 717 commits 未推送
   （本 worker 禁止 push）；平台上没有 delivery-gate workflow，候选检查永远不会有平台证据。
3. **配置仓库 secret `SDD_DELIVERY_LAUNCH_AUTHORITY`**：delivery-gate job 的启动授权凭据
   （前置 P4_1 首轮已列为平台准入项，本次读回未观察到它存在的证据，仍待人工）。
4. repository-registration.json#branchProtection.remoteEnforcement 保持
   UNVERIFIED/pendingOwner=P4_1 是该文件 schema 的 no-claim 规则所致（status 只允许
   UNVERIFIED）；本次观测已完整登记在 ci-policy note 与本记录，若控制器要把
   UNPROTECTED_READ_BACK 状态写进 repository-registration 需要 I06 owner 扩展其 schema。

## 6. 未验证项

- 真实平台侧 required-check 强制与合并拒绝：未保护状态下不存在，且开启保护是需授权的写操作（§5.1）。
- delivery-gate workflow 在真实 GitHub runner 上的端到端执行：workflow 未上平台（§5.2）。
- 本任务不关闭 tasks.md P4_1 的步骤勾选（步骤结构归唯一控制器集成；本记录只交事实与证据）。
