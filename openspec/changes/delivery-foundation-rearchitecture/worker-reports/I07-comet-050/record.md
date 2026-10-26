# I07 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: I07 复用既有调度和外部告警（tasks.md "### Task I07"）。
Scope honored: only Owns files touched —
`infra/delivery/monitor/{monitor-registration.example,health-contract,alert-policy,supervisor-policy,fault-domain-policy}.json`
(monitor-registration.example.json unchanged this revision: no new external-monitor/on-call facts to register),
`tools/infra/monitor.mjs`, `test/infra-monitor.test.js`, plus this report directory.
No commit, no external alert send, no credential access, no resident service started, no CI trigger changed.

## 1. Record (read-only observations, 2026-10-26)

- tasks.md "### Task I07" revision clause: 当前修订 2026-10-26-comet-050-adoption-v1；未执行。RED =
  漏事件/不进水位/离线/隔离失败必须告警并由原Comet补偿；不得起独立controller服务。GREEN =
  已有CI/宿主定时器触发同Comet权限维护；监控只观察水位/期限并告警。Interface 行改为
  **Supervisor.v2** -> existing scheduler invokes original Comet maintenance and recovery after checking
  the old writer, no resident controller requirement; bounded attempts and escalation.
- Amendment `replans/2026-10-26-comet-050-adoption/amendment.json`: waves put I07 after P2_5;
  ADR-0022 gate before activation; this revision is registration + mechanism verification only.
- Architecture basis (docs/architecture/comet-ai-devops-convergence.md:63): 可复用现有CI定时任务/宿主定时器
  触发原命令，触发器不拥有业务状态或重试调度。正常依赖下发现≤3分钟、隔离≤2分钟；故障暴露/告警/隔离
  分别计时，不把告警当隔离。G15 boundary per ADR-0021 (发现3分钟/隔离2分钟目标不变);
  R10 per spec/spec-baseline: 未完成 Run/knowledge 义务保留唯一工作区、R10 阻断未完成清理。
- `git rev-parse HEAD`: 6cbcb59175b7fc4e922ec5921a5006e080f0d4d1, branch master. The shared tree carries
  other workers' uncommitted in-flight changes (docs, lib/adapters, runner, comet tests); I07 owns files
  were clean at start (17/17 baseline green).
- Scheduling surface inventory (local observation, the fact side of the registration):
  - `.github/workflows/delivery-gate.yml`: triggers `pull_request`, `merge_group`, `push` (branches:
    master). **No `on.schedule`.**
  - `.github/workflows/quality-gates.yml`: triggers `pull_request`, `push`. **No `on.schedule`.**
  - Installer surfaces (`tools/`, `hooks/`, `scripts/`): no `crontab|launchd|LaunchAgents|schtasks|systemd`
    registration anywhere. **No host timer is registered by this repository.**
  - Conclusion: both scheduling surfaces have real capability (GitHub Actions schedule trigger; host
    cron/launchd) but **nothing is registered today** — registered honestly as UNREGISTERED.

## 2. Implement (registration + mechanism verification)

### 2.1 Supervisor.v1 -> Supervisor.v2 (`infra/delivery/monitor/supervisor-policy.json`)

- `interface` bumped to `Supervisor.v2`; `scope` renamed to `SCHEDULER_TRIGGERED_ORIGINAL_COMET_ONLY`.
- New `schedulerInvocation` block — the "同 Comet 维护入口" trigger mapping:
  - `surfaces.ciScheduledWorkflow`: capability `github-actions-on-schedule`, status **UNREGISTERED**,
    `committedWorkflowsWithScheduleTrigger: []` (both committed workflows listed with their actual
    triggers as `committedWorkflowsObserved`), `registeredAs: null`.
  - `surfaces.hostTimer`: capability `host-cron-launchd-or-equivalent`, status **UNREGISTERED**,
    `registeredAs: null`.
  - `invocationContract`: `triggersOnlyOriginalCometMaintenance: true`,
    `originalEntry: same-original-comet-maintenance-entry` with `originalEntryStatus: UNVERIFIED`
    (the real maintenance command wiring is P4_8/pilot territory — this mapping declares WHAT a timer
    may invoke, not that a timer is wired), `schedulerOwnsBusinessState: false`,
    `schedulerOwnsRetryScheduling: false`, `checkOldWriterBeforeRecoveryInvocation: true`
    (composes with the existing startGate), `residentControllerService: FORBIDDEN`.
- All six forbiddenActions / restart budget (3 per 300s, STOP_AND_ESCALATE) / startGate /
  authorityBinding / cometSelfRecovery (supervisorBusinessRetry=false) / audit blocks unchanged —
  bounded attempts and escalation stay as previously frozen.

### 2.2 G15 + R10 registration (`infra/delivery/monitor/health-contract.json`)

- `g15`: `discoveryTargetSeconds: 180` (≤3 min), `isolationTargetSeconds: 120` (≤2 min),
  `segmentsTimedSeparately: [fault_exposure, alert_delivery, isolation]`,
  `alertIsNeverIsolation: true`, `operationalEvidence: UNVERIFIED` (targets registered; production
  timing evidence from a real deployment not claimed).
- `r10`: `soleWorkspaceRetentionForUnresolvedObligations: true`, `cleanupRequires:
  [verified-completed, separately-approved-migration-and-restore-proof]`, `monitorRole:
  observe-and-alert-only`, `monitorNeverCleansUp: true` (cleanup eligibility evidence belongs to I08;
  the monitor only observes and alerts).
- Frozen contract deadlines (30/30/90/120/120/30/300/3-per-300/600) untouched — G15 targets are
  registered alongside, not replacing, the finer revocation/monitor contract.

### 2.3 Negative red lines (`alert-policy.json`, `fault-domain-policy.json`)

- `alert-policy.json#negativeRedLines`: `missedAlertIsFailure: true` (漏报=失败),
  `alertIsNeverIsolation: true` (告警≠隔离 — isolation executes and reads back only through the
  original Comet maintenance entry), `offlineMustBeDetectable: true`, `compensationOwner:
  original-comet` (补偿归原 Comet，绝不归监控/调度器), `requiredAlertEvents: [missed-event,
  watermark-stall, offline, isolation-failure]`.
- `fault-domain-policy.json#offlineDetectability`: `runnerOfflineRequiresExternalMonitor: true`,
  `monitorSelfOfflineDiscoveredBy: existing-platform-monitor` (离线可检测只能来自故障域外部).

### 2.4 Gates + receipts (`tools/infra/monitor.mjs`)

New fail-closed validate gates, each flip-guarded by a test:
`RESIDENT_CONTROLLER_FORBIDDEN` (residentControllerService != FORBIDDEN),
`SCHEDULER_MAPPING_INVALID` (any invocationContract weakening),
`SCHEDULER_SURFACE_REGISTRATION_INCOMPLETE` (status REGISTERED without a non-empty `registeredAs`, or a
missing/invalid status — silently flipping a surface to REGISTERED is a fabricated registration),
`G15_TARGETS_INVALID`, `R10_RETENTION_INVALID`, `MISSED_ALERT_RED_LINE_REQUIRED`,
`ALERT_IS_NOT_ISOLATION_REQUIRED`, `OFFLINE_DETECTABILITY_REQUIRED`. The validate receipt now surfaces
`schedulerInvocation`, `g15`, `r10`, `negativeRedLines` summaries; supervise receipts report
`Supervisor.v2`.

### 2.5 Tests (`test/infra-monitor.test.js`, 17 -> 22)

- Interface expectation updated to Supervisor.v2 (committed shape test).
- New: registration-surfaced test (asserts the full mapping/G15/R10/red-line receipt);
  scheduling-surface-inventory honesty test (reads `.github/workflows/*` asserting no `schedule:`
  trigger, walks `tools/ hooks/ scripts/` asserting no host-timer registration, and pins the committed
  UNREGISTERED statuses — if a scheduled workflow or host timer is ever added, the registration must be
  updated in the same change); scheduler-mapping flip gates; G15/R10 flip gates; negative-red-line flip
  gates.

## 3. Verify (pinned runs; raw outputs under `evidence/`)

- RED first: `node --test test/infra-monitor.test.js` before implementation -> exit 1, **22 tests,
  6 fail / 16 pass** (`evidence/red-new-tests.txt`: the five new tests + the Supervisor.v2 interface
  assertion failed — fields/gates did not exist yet).
- Own suite GREEN: `node --test test/infra-monitor.test.js` -> exit 0, **22/22 pass**
  (`evidence/green-own-test.txt`).
- Pinned probes (infrastructure-tasks.json I07.probes):
  - `validate --registry infra/delivery/registry.json --json` -> exit 0, ok, violations [], catalogGaps []
    (`evidence/green-validate.json`).
  - `probe --case runner-process-failure` -> exit 0 VERIFIED at PROCESS_LEVEL (real spawn/SIGKILL/
    stale-heartbeat detection/old-writer-gone confirmation/same-authority restart; scaled timescales)
    (`evidence/green-probe-runner-process-failure.json`).
  - `probe --case external-host-down` -> exit 2 structured UNVERIFIED, faultDomainSatisfied=false,
    mustNotPass=true (`evidence/green-probe-external-host-down.json`).
  - `probe --case scan-watermark-stall` -> exit 0 VERIFIED, heartbeatIndependent=true
    (`evidence/green-probe-scan-watermark-stall.json`).
- Consumer regressions (`evidence/green-consumer-regressions.txt`): knowledge-revocation +
  infra-registry 61/61 pass; delivery-cases/4_8 7/7 pass. delivery-cases/3_3 5 pass / 3 fail —
  re-run with the I07 owns files stashed gives the identical 5/3 (`comet state init` usage failures in
  the shared-tree Comet CLI slice): **pre-existing, not I07-attributable**.
- Full suite `npm test`: with my files **1181 tests / 1139 pass / 42 fail**; baseline with my files
  stashed **1176 / 1136 / 40**. Failing-name diff (`evidence/fullsuite-fail-names-*.txt`): the only
  two with-run extras are `buildGateReceiptBundle ...` in `test/architecture-review-adapter.test.js` —
  a file that is another worker's uncommitted in-flight edit (`M` in git status), does not reference any
  monitor file, and passes 59/59 in isolation twice with my files in place
  (`evidence/concurrent-tree-noise-attribution.txt`) — mid-run concurrent edits, not I07. All other
  failures (Runner, RW_RUNNER_BUILD, comet adapters, P1_5, C08, I02) are identical on baseline.
  **Zero failures in the I07 slice.**
- `bash scripts/check.sh` not run to green here: it includes the full regression suite which is red for
  the pre-existing/concurrent failures above; the I07-relevant slice is fully green. Left to the
  integrating controller with a coherent tree (same posture as I06-comet-050).

## 4. UNVERIFIED list (honest gaps; none may be read as done)

1. **同 Comet 维护入口的实际接线**（`originalEntryStatus: UNVERIFIED`）：真实维护命令（知识撤权维护
   operation、权限维护）属 P4_8/pilot；本登记只声明定时器"只可触发什么"，不声明已接线。
2. **CI 定时 workflow / 宿主定时器的登记**：两个调度面均 UNREGISTERED（committed workflows 无
   on.schedule；仓库安装面无 host timer）。登记一个定时器是仓库/宿主变更，须与本登记同步更新
   （inventory honesty test 会强制）。
3. **G15 生产计时证据**（`operationalEvidence: UNVERIFIED`）：180s/120s 目标与分别计时规则已登记；
   真实部署的分段外部时间戳证据未取得。既有 30s/90s/120s 等冻结时限的容量/故障实证沿用上一修订的
   UNVERIFIED 状态。
4. **外部监控实例 / on-call / 渠道 / 投递授权**：全部 UNREGISTERED，无人值守发布 pre-enable 门保持
   阻断；真实告警投递/确认/升级仍是 PREPARE_ONLY（本任务不隐含通知发送授权）。
5. **主机宕机 2 分钟发现（G14 侧）与离线检测实战**：external-host-down probe 维持结构化 UNVERIFIED
   （同宿主监控死于主机，永远不可 PASS）；离线可检测作为红线登记，实战证据需注册后的外部监控。
6. **监督器重启真实 Comet 服务**：进程级机制已由 probe 实证（缩放时间尺度）；真实 runner 运行时
   的重启维持 UNVERIFIED（I02 up 仍受门控）。
7. **escalation ack 300s / recovery 600s 建议值的 owner 冻结**：维持 UNVERIFIED_RECOMMENDED。

## 5. Risks / handoff

- `schedulerInvocation.originalEntry` 是字符串占位（`same-original-comet-maintenance-entry`）；
  P4_8 接线真实维护命令时应把它替换/锚定为真实入口并翻转 `originalEntryStatus`——这是一个有意的
  后继义务，不是遗漏。
- Inventory honesty test 钉住"仓库当前无任何 schedule 触发器/宿主定时器"：任何 worker 添加 CI 定时
  workflow 或 host timer 而不同步更新 supervisor-policy 登记都会红——这是设计意图（登记与事实同变）。
- Supervisor.v2 是接口标签升级：supervise 决策语义（仅 restart、旧写者门、预算、升级）未变；消费方
  （4_8）回归绿。若有外部消费者钉住 Supervisor.v1 字符串需同步（仓库内未发现）。
- 共享工作树含其他 worker 的未提交改动且在会话期间持续变化；全量红/基线对比已按失败名归因，
  但集成控制器应在一致树上重跑 `npm test` 后再收口。
- No commit was made (boundary); the integrating controller commits the six changed Owns files plus
  this report.
