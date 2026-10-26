import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I07 — I07 独立监控、告警与原 Runner 进程监督 的契约检查。
// 规格：infrastructure-tasks.json 的 I07 条目 + infrastructure-plan.md I07 小节
// + knowledge-revocation-and-restoration.md（30s 心跳/30s 检查、>90s 心跳或 >2min 完整扫描无进展告警、
//   最迟 2 分钟发现、另 30 秒投递、建议主值班 5 分钟未确认升级、5 分钟最多 3 次重启）。
//
//   Health.v1      只读探针：heartbeat_age / receive_cursor / complete_scan_watermark /
//                  unresolved_isolation+deadlines / authority identity，只读既有 Comet 事实。
//   Monitor.v1     外部故障域登记 + 告警投递/确认/升级三段计时（检测/投递/升级分别计时，
//                  绝不合并成"总送达"预算）；未经投递授权只 prepare 不发送。
//   Supervisor.v2  既有调度面（CI 定时 workflow / 宿主定时器）只触发"同 Comet 维护入口"的原命令，
//                  触发器不拥有业务状态/重试调度；旧写者核验后才可调恢复；禁止常驻 controller 服务
//                  （修订 2026-10-26-comet-050-adoption-v1；basis comet-ai-devops-convergence.md）。
//
// CLI 退出码契约（execution-contract.json V_INFRA_I07.cli_contract）：
//   0=PASS，1=输入/前置无效（文件缺失/不可解析/参数错误/未知 probe case），2=验证失败（语义违规、探测拒绝、UNVERIFIED）。
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 或 mock 转绿。
//
// 负例 fixture 全部在 os.tmpdir() 生成，不向活配置写入任何状态；零新 npm 依赖。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const monitorDir = path.join(repoRoot, 'infra', 'delivery', 'monitor');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const refsPath = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const cliPath = path.join(repoRoot, 'tools', 'infra', 'monitor.mjs');
const secretRefsModuleUrl = new URL('../tools/infra/secret-refs.mjs', import.meta.url);

const RUN_TIMEOUT_MS = 60_000;
const MONITOR_FILES = [
  'monitor-registration.example.json',
  'health-contract.json',
  'alert-policy.json',
  'supervisor-policy.json',
  'fault-domain-policy.json',
];
// 规格冻结的细分时限（knowledge-revocation-and-restoration.md 表格 + infrastructure-plan.md I07）。
const CONTRACT = {
  heartbeatIntervalSeconds: 30,
  monitorCheckIntervalSeconds: 30,
  heartbeatAlertAfterSeconds: 90,
  scanStallAlertAfterSeconds: 120,
  detectionLatestSeconds: 120,
  deliveryTargetSeconds: 30,
  escalationAckTimeoutSeconds: 300,
  restartWindowSeconds: 300,
  restartMax: 3,
  recoveryTargetSeconds: 600,
  // 修订 2026-10-26-comet-050-adoption-v1：G15 正常依赖下发现≤3分钟 / 隔离≤2分钟
  // （ADR-0021；comet-ai-devops-convergence.md："故障暴露/告警/隔离分别计时，不把告警当隔离"）。
  g15DiscoveryTargetSeconds: 180,
  g15IsolationTargetSeconds: 120,
  g15SegmentsTimedSeparately: ['fault_exposure', 'alert_delivery', 'isolation'],
};
const MONITOR_REFS = [
  'secret-ref:sdd-harness-pilot/monitor-health-read',
  'secret-ref:sdd-harness-pilot/monitor-alert',
];
const HOST_PATH_OUTPUT_RE = /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;
const FORBIDDEN_SUPERVISOR_ACTIONS = [
  'change-phase',
  'create-maintenance-operation',
  'write-outline-acl',
  'copy-state',
  'start-second-owner',
  'business-retry',
];

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
}

function parseJsonOut(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError(`${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

function readMonitorJson(name) {
  return JSON.parse(fs.readFileSync(path.join(monitorDir, name), 'utf8'));
}

// 把已提交的 monitor 域整体拷到 tmp fixture，应用 mutate 后返回 fixture 目录（不触碰活配置）。
function makeFixtureDir(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i07-'));
  for (const name of MONITOR_FILES) {
    fs.copyFileSync(path.join(monitorDir, name), path.join(dir, name));
  }
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const json = (name) => JSON.parse(read(name));
  const writeJson = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
  mutate({ dir, read, write, json, writeJson });
  return dir;
}

function codes(report) {
  return (report.violations ?? []).map((v) => v.code);
}

function tmpFile(name, value) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i07-io-')), name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  return file;
}

// 时间戳 helper：相对当前真实时钟的 ISO 偏移（health/alert 全部用真实时钟差计算）。
const agoIso = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const inIso = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();

function healthyFacts() {
  return {
    authorityId: 'comet-authority-probe',
    heartbeatAt: agoIso(5),
    receiveCursorAt: agoIso(5),
    lastCompleteScanAt: agoIso(60),
    unresolvedIsolations: [],
  };
}

test('V_INFRA_I07 contract: committed monitor domain validates clean with honest gaps and spec-frozen deadlines', () => {
  const validate = runCli(['validate', '--registry', registryPath, '--json']);
  assert.equal(validate.status, 0, `validate must PASS on committed files: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.interface, 'MonitorInfra.v1');
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  // 结构化回执绝不回显宿主绝对路径。
  assert.doesNotMatch(validate.stdout, HOST_PATH_OUTPUT_RE, 'validate output must not carry host absolute paths');

  // 五个公共接口文件全部呈现在回执里。
  for (const name of MONITOR_FILES) {
    assert.ok(report.files?.[name], `validate receipt must include ${name}`);
  }

  // 规格细分时限必须在 committed 契约中如实冻结（30s/30s/90s/120s/120s/30s/300s/3-per-300s/600s）。
  assert.equal(report.deadlines.heartbeatIntervalSeconds, CONTRACT.heartbeatIntervalSeconds);
  assert.equal(report.deadlines.monitorCheckIntervalSeconds, CONTRACT.monitorCheckIntervalSeconds);
  assert.equal(report.deadlines.heartbeatAlertAfterSeconds, CONTRACT.heartbeatAlertAfterSeconds);
  assert.equal(report.deadlines.scanStallAlertAfterSeconds, CONTRACT.scanStallAlertAfterSeconds);
  assert.equal(report.deadlines.detectionLatestSeconds, CONTRACT.detectionLatestSeconds);
  assert.equal(report.deadlines.deliveryTargetSeconds, CONTRACT.deliveryTargetSeconds);
  assert.equal(report.deadlines.escalationAckTimeoutSeconds, CONTRACT.escalationAckTimeoutSeconds);
  assert.equal(report.deadlines.restartWindowSeconds, CONTRACT.restartWindowSeconds);
  assert.equal(report.deadlines.restartMax, CONTRACT.restartMax);
  assert.equal(report.deadlines.recoveryTargetSeconds, CONTRACT.recoveryTargetSeconds);

  // I01 目录缺口如实上报（缺口是 readiness 证据，不是结构违规——沿 I02/I03/I06 先例）。
  // I01 修正案 5（master 964df4e）已登记全部两个 monitor ref（目录 24 refs）：
  // committed 域 validate 必须干净且不再报任何 monitor ref 缺口（正向断言，防回归）。
  for (const ref of MONITOR_REFS) {
    assert.ok(!(report.catalogGaps ?? []).includes(ref), `${ref} is registered in the I01 catalog and must not be reported as a gap`);
  }
  assert.deepEqual(report.catalogGaps, [], 'no catalog gaps remain after I01 amendment 5');

  // 无人值守发布 pre-enable 门：当前登记为空 → 结构上必须保持阻断（fail-closed）。
  assert.equal(report.preEnableGate.enabled, false);
  assert.equal(report.preEnableGate.allowed, false);
  assert.ok(report.preEnableGate.missing.length > 0, 'pre-enable gate must enumerate what is unregistered');

  // 交付授权：本任务不隐含通知发送授权 → 必须 false 且不得声称已授权。
  assert.equal(report.deliveryAuthorization.authorized, false);

  // 故障域：同宿主监控不得声称主机宕机发现能力。
  assert.equal(report.faultDomain.coHostedMonitorCannotClaimHostFailure, true);
});

test('RED pre-enable gate: unattended release enabled without registered external monitor/on-call/backup channel is blocked', () => {
  const enabled = makeFixtureDir(({ json, writeJson }) => {
    const registration = json('monitor-registration.example.json');
    registration.unattendedRelease.enabled = true;
    writeJson('monitor-registration.example.json', registration);
  });
  const run = runCli(['validate', '--registry', registryPath, '--dir', enabled, '--json']);
  assert.equal(run.status, 2, 'flipping unattendedRelease.enabled without registrations must be rejected');
  const report = parseJsonOut(run, 'validate pre-enable');
  assert.ok(
    codes(report).includes('PRE_ENABLE_REGISTRATION_INCOMPLETE'),
    JSON.stringify(report.violations),
  );
  const violation = report.violations.find((v) => v.code === 'PRE_ENABLE_REGISTRATION_INCOMPLETE');
  assert.ok(Array.isArray(violation.missing) && violation.missing.length > 0, 'gate must list the unregistered prerequisites');

  // 全部前置登记后（fixture 中显式 REGISTERED + 授权记录）结构门才放行——
  // complete fixture 同时携带独立授权记录，满足授权声明守卫。
  const complete = makeFixtureDir(({ json, writeJson }) => {
    const registration = json('monitor-registration.example.json');
    registration.unattendedRelease.enabled = true;
    registration.externalMonitor = { ...registration.externalMonitor, status: 'REGISTERED' };
    registration.onCall.platform.primary = 'REGISTERED:platform-primary';
    registration.onCall.platform.backup = 'REGISTERED:platform-backup';
    registration.channels.primary = 'REGISTERED:primary-channel';
    registration.channels.backup = 'REGISTERED:backup-channel';
    registration.channels.registered = ['primary-channel', 'backup-channel'];
    registration.deliveryAuthorization = {
      alertDeliveryAuthorized: true,
      authorizationRecord: 'owner-approval-record-1',
      basis: 'delivery authorization granted by a separately recorded owner approval',
    };
    registration.isolationOperationAuthorization.registered = true;
    writeJson('monitor-registration.example.json', registration);
  });
  const completeRun = runCli(['validate', '--registry', registryPath, '--dir', complete, '--json']);
  assert.equal(completeRun.status, 0, `a fully registered unattended-release declaration passes the structural gate: ${completeRun.stderr || completeRun.stdout}`);
  const completeReport = parseJsonOut(completeRun, 'validate pre-enable complete');
  assert.equal(completeReport.preEnableGate.allowed, true);
  assert.deepEqual(completeReport.preEnableGate.missing, []);
});

test('RED delivery authorization claim guard: no notification-send authorization exists in this task', () => {
  // committed 文件必须如实声明未授权。
  const registration = readMonitorJson('monitor-registration.example.json');
  assert.equal(registration.deliveryAuthorization.alertDeliveryAuthorized, false);

  // 声称已授权而无授权记录 = 结构违规（I06 PLATFORM_PROTECTION_CLAIM_FORBIDDEN 同型守卫）。
  const claimed = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('monitor-registration.example.json');
    doc.deliveryAuthorization.alertDeliveryAuthorized = true;
    writeJson('monitor-registration.example.json', doc);
  });
  const claimedRun = runCli(['validate', '--registry', registryPath, '--dir', claimed, '--json']);
  assert.equal(claimedRun.status, 2, 'a delivery-authorization claim without a recorded approval must be rejected');
  assert.ok(codes(parseJsonOut(claimedRun, 'validate claim')).includes('DELIVERY_AUTHORIZATION_CLAIM_FORBIDDEN'));
});

test('RED deadline freeze: tampering with the contract timings is rejected (30s/30s/90s/120s/120s/30s)', () => {
  const heartbeat = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('health-contract.json');
    doc.heartbeat.alertAfterAgeSeconds = 300;
    writeJson('health-contract.json', doc);
  });
  const heartbeatRun = runCli(['validate', '--registry', registryPath, '--dir', heartbeat, '--json']);
  assert.equal(heartbeatRun.status, 2, 'heartbeat alert threshold must stay frozen at the contract value (>90s)');
  assert.ok(codes(parseJsonOut(heartbeatRun, 'validate heartbeat')).includes('DEADLINE_CONTRACT_INVALID'));

  const detection = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('health-contract.json');
    doc.detection.latestDiscoverySeconds = 600;
    writeJson('health-contract.json', doc);
  });
  const detectionRun = runCli(['validate', '--registry', registryPath, '--dir', detection, '--json']);
  assert.equal(detectionRun.status, 2, 'the 2-minute latest-discovery deadline must stay frozen');
  assert.ok(codes(parseJsonOut(detectionRun, 'validate detection')).includes('DEADLINE_CONTRACT_INVALID'));

  const delivery = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('alert-policy.json');
    doc.segments.delivery.targetSeconds = 120;
    writeJson('alert-policy.json', doc);
  });
  const deliveryRun = runCli(['validate', '--registry', registryPath, '--dir', delivery, '--json']);
  assert.equal(deliveryRun.status, 2, 'the 30-second delivery target must stay frozen');
  assert.ok(codes(parseJsonOut(deliveryRun, 'validate delivery')).includes('DEADLINE_CONTRACT_INVALID'));
});

test('RED segment separation: a combined "total delivery" budget is rejected; three segments must stay separately timed', () => {
  // 三个分段必须各自存在。
  for (const segment of ['detection', 'delivery', 'escalation']) {
    const missing = makeFixtureDir(({ json, writeJson }) => {
      const doc = json('alert-policy.json');
      delete doc.segments[segment];
      writeJson('alert-policy.json', doc);
    });
    const run = runCli(['validate', '--registry', registryPath, '--dir', missing, '--json']);
    assert.equal(run.status, 2, `dropping the ${segment} segment must be rejected`);
    assert.ok(codes(parseJsonOut(run, `validate ${segment}`)).includes('SEGMENTS_NOT_SEPARATE'));
  }

  // 把检测+投递合并成单一"总送达"预算字段 = 规格明令禁止的写法。
  const combined = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('alert-policy.json');
    doc.totalDeliverySeconds = 150;
    writeJson('alert-policy.json', doc);
  });
  const combinedRun = runCli(['validate', '--registry', registryPath, '--dir', combined, '--json']);
  assert.equal(combinedRun.status, 2, 'a combined total-delivery budget must be rejected');
  assert.ok(codes(parseJsonOut(combinedRun, 'validate combined')).includes('SEGMENTS_NOT_SEPARATE'));

  // undelivered-is-never-acknowledged 规则不可关闭。
  const ack = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('alert-policy.json');
    doc.rules.undeliveredIsNeverAcknowledged = false;
    writeJson('alert-policy.json', doc);
  });
  const ackRun = runCli(['validate', '--registry', registryPath, '--dir', ack, '--json']);
  assert.equal(ackRun.status, 2);
  assert.ok(codes(parseJsonOut(ackRun, 'validate ack rule')).includes('UNDELIVERED_ACK_RULE_REQUIRED'));
});

test('RED supervisor gate: forbidden actions, restart budget and start gate are structurally enforced in the policy', () => {
  // forbiddenActions 必须完整覆盖六类越权动作。
  for (const action of FORBIDDEN_SUPERVISOR_ACTIONS) {
    const stripped = makeFixtureDir(({ json, writeJson }) => {
      const doc = json('supervisor-policy.json');
      doc.forbiddenActions = doc.forbiddenActions.filter((item) => item !== action);
      writeJson('supervisor-policy.json', doc);
    });
    const run = runCli(['validate', '--registry', registryPath, '--dir', stripped, '--json']);
    assert.equal(run.status, 2, `removing ${action} from forbiddenActions must be rejected`);
    assert.ok(codes(parseJsonOut(run, `validate ${action}`)).includes('SUPERVISOR_ACTIONS_INCOMPLETE'));
  }

  // 重启预算（5 分钟最多 3 次，超限停止+升级）不可放松。
  const budget = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('supervisor-policy.json');
    doc.restartBudget.maxRestarts = 10;
    writeJson('supervisor-policy.json', doc);
  });
  const budgetRun = runCli(['validate', '--registry', registryPath, '--dir', budget, '--json']);
  assert.equal(budgetRun.status, 2, 'loosening the restart budget must be rejected');
  assert.ok(codes(parseJsonOut(budgetRun, 'validate budget')).includes('RESTART_BUDGET_INVALID'));

  const exceeded = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('supervisor-policy.json');
    doc.restartBudget.onExceeded = 'CONTINUE_RESTARTING';
    writeJson('supervisor-policy.json', doc);
  });
  const exceededRun = runCli(['validate', '--registry', registryPath, '--dir', exceeded, '--json']);
  assert.equal(exceededRun.status, 2, 'onExceeded must stay STOP_AND_ESCALATE');
  assert.ok(codes(parseJsonOut(exceededRun, 'validate onExceeded')).includes('RESTART_BUDGET_INVALID'));

  // 双启门：旧写者未确认终止 / 存储归属不明必须 REFUSE。
  const startGate = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('supervisor-policy.json');
    doc.startGate.refuseWhileOldWriterAlive = 'ALLOW';
    writeJson('supervisor-policy.json', doc);
  });
  const startGateRun = runCli(['validate', '--registry', registryPath, '--dir', startGate, '--json']);
  assert.equal(startGateRun.status, 2, 'the dual-start refusal must stay REFUSE');
  assert.ok(codes(parseJsonOut(startGateRun, 'validate startGate')).includes('START_GATE_REFUSE_REQUIRED'));
});

test('RED fault-domain gate: a co-hosted monitor can never be declared sufficient for host-failure detection', () => {
  const committed = readMonitorJson('fault-domain-policy.json');
  assert.equal(committed.domains.runnerHostFailure.requiresExternalMonitor, true);
  assert.equal(committed.domains.runnerHostFailure.coHostedMonitorInsufficient, true);
  assert.equal(committed.rules.coHostedMonitorMustNotPassHostFailure, true);

  const flipped = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('fault-domain-policy.json');
    doc.rules.coHostedMonitorMustNotPassHostFailure = false;
    writeJson('fault-domain-policy.json', doc);
  });
  const flippedRun = runCli(['validate', '--registry', registryPath, '--dir', flipped, '--json']);
  assert.equal(flippedRun.status, 2, 'allowing a co-hosted monitor to pass host-failure claims must be rejected');
  assert.ok(codes(parseJsonOut(flippedRun, 'validate fault domain')).includes('COHOSTED_CLAIM_FORBIDDEN'));
});

test('RED structural negatives: interface tag, project binding, example declaration, read-only health, authority binding, business-retry split and noBusinessWrites are each enforced', () => {
  // 接口标签被替换 → MONITOR_INTERFACE_INVALID。
  const iface = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('alert-policy.json');
    doc.interface = 'AlertPolicy.v2';
    writeJson('alert-policy.json', doc);
  });
  const ifaceRun = runCli(['validate', '--registry', registryPath, '--dir', iface, '--json']);
  assert.equal(ifaceRun.status, 2, 'replacing a frozen interface tag must be rejected');
  assert.ok(codes(parseJsonOut(ifaceRun, 'validate interface')).includes('MONITOR_INTERFACE_INVALID'));

  // 项目绑定被篡改 → PROJECT_MISMATCH。
  const project = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('health-contract.json');
    doc.project.id = 'another-project';
    writeJson('health-contract.json', doc);
  });
  const projectRun = runCli(['validate', '--registry', registryPath, '--dir', project, '--json']);
  assert.equal(projectRun.status, 2, 'rebinding a monitor doc to another project must be rejected');
  assert.ok(codes(parseJsonOut(projectRun, 'validate project')).includes('PROJECT_MISMATCH'));

  // example 声明被摘除 → EXAMPLE_DECLARATION_REQUIRED。
  const example = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('monitor-registration.example.json');
    delete doc.example;
    writeJson('monitor-registration.example.json', doc);
  });
  const exampleRun = runCli(['validate', '--registry', registryPath, '--dir', example, '--json']);
  assert.equal(exampleRun.status, 2, 'the example declaration must stay present');
  assert.ok(codes(parseJsonOut(exampleRun, 'validate example')).includes('EXAMPLE_DECLARATION_REQUIRED'));

  // Health.v1 只读声明被翻转 → HEALTH_READ_ONLY_REQUIRED。
  const readOnly = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('health-contract.json');
    doc.readOnly = false;
    writeJson('health-contract.json', doc);
  });
  const readOnlyRun = runCli(['validate', '--registry', registryPath, '--dir', readOnly, '--json']);
  assert.equal(readOnlyRun.status, 2, 'Health.v1 must stay a read-only probe over existing Comet facts');
  assert.ok(codes(parseJsonOut(readOnlyRun, 'validate read-only')).includes('HEALTH_READ_ONLY_REQUIRED'));

  // authority 绑定被放松（允许状态复制/第二业务 owner） → SUPERVISOR_AUTHORITY_BINDING_INVALID。
  const authority = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('supervisor-policy.json');
    doc.authorityBinding.stateCopy = 'ALLOWED';
    writeJson('supervisor-policy.json', doc);
  });
  const authorityRun = runCli(['validate', '--registry', registryPath, '--dir', authority, '--json']);
  assert.equal(authorityRun.status, 2, 'state copy must stay forbidden for the supervisor');
  assert.ok(codes(parseJsonOut(authorityRun, 'validate authority')).includes('SUPERVISOR_AUTHORITY_BINDING_INVALID'));

  // Comet 自恢复被改写成 supervisor 业务重试 → SUPERVISOR_BUSINESS_RETRY_FORBIDDEN。
  const businessRetry = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('supervisor-policy.json');
    doc.cometSelfRecovery.supervisorBusinessRetry = true;
    writeJson('supervisor-policy.json', doc);
  });
  const businessRetryRun = runCli(['validate', '--registry', registryPath, '--dir', businessRetry, '--json']);
  assert.equal(businessRetryRun.status, 2, 'the supervisor must never keep a second business retry loop');
  assert.ok(codes(parseJsonOut(businessRetryRun, 'validate business retry')).includes('SUPERVISOR_BUSINESS_RETRY_FORBIDDEN'));

  // noBusinessWrites 缺项（告警重投与业务重试分离的守卫） → NO_BUSINESS_WRITES_INCOMPLETE。
  const noBusiness = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('alert-policy.json');
    doc.noBusinessWrites = doc.noBusinessWrites.filter((item) => item !== 'business-retry');
    writeJson('alert-policy.json', doc);
  });
  const noBusinessRun = runCli(['validate', '--registry', registryPath, '--dir', noBusiness, '--json']);
  assert.equal(noBusinessRun.status, 2, 'dropping business-retry from noBusinessWrites must be rejected');
  assert.ok(codes(parseJsonOut(noBusinessRun, 'validate noBusinessWrites')).includes('NO_BUSINESS_WRITES_INCOMPLETE'));
});

test('RED I01 isolation: cross-project refs are structural violations; unregistered ref stays an explicit gap and resolver refuses', async () => {
  const crossProject = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('monitor-registration.example.json');
    doc.credentialRefs = ['secret-ref:pav-legacy/monitor-alert'];
    writeJson('monitor-registration.example.json', doc);
  });
  const crossRun = runCli(['validate', '--registry', registryPath, '--dir', crossProject, '--json']);
  assert.equal(crossRun.status, 2, 'a cross-project credential ref must be rejected');
  assert.ok(codes(parseJsonOut(crossRun, 'validate cross-project')).includes('CROSS_PROJECT_REF'));

  // I01 修正案 5 后两个 monitor ref 均已登记：monitor 主体解析走只读 UNRESOLVED 语义
  // （ref 已登记但 NOT_PROVISIONED——解析器永不产生值，I01 无运行时 secret store 授权）。
  const secretRefs = await import(secretRefsModuleUrl);
  const refsDoc = JSON.parse(fs.readFileSync(refsPath, 'utf8'));
  for (const ref of MONITOR_REFS) {
    const resolved = secretRefs.resolveSecretRef({
      ref,
      principalId: 'svc:sdd-harness-pilot/monitor',
      role: 'monitor',
      refsDoc,
      project: 'sdd-harness-pilot',
    });
    assert.equal(resolved.status, 'UNRESOLVED', `${ref} resolves read-only UNRESOLVED — never a value`);
    assert.equal(resolved.resolved, false);
    assert.equal(resolved.boundRole, 'monitor');
  }

  // 缺口上报行为改由合成 fixture 覆盖（I02 先例）：从目录副本删一个已知已登记 ref，
  // validate 仍显式上报缺口且保持 exit 0（缺口是 readiness 证据，不是结构违规）。
  const trimmed = JSON.parse(JSON.stringify(refsDoc));
  trimmed.refs = trimmed.refs.filter((entry) => entry.ref !== 'secret-ref:sdd-harness-pilot/monitor-alert');
  const refsFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i07-refs-')), 'refs.json');
  fs.writeFileSync(refsFixture, JSON.stringify(trimmed, null, 2) + '\n');
  const gapRun = runCli(['validate', '--registry', registryPath, '--refs', refsFixture, '--json']);
  assert.equal(gapRun.status, 0, 'a catalog gap is readiness evidence, not a structural violation');
  const gapReport = parseJsonOut(gapRun, 'validate synthetic gap');
  assert.ok(
    (gapReport.catalogGaps ?? []).includes('secret-ref:sdd-harness-pilot/monitor-alert'),
    'validate must explicitly report the missing ref as a catalogGap instead of passing silently',
  );
  assert.doesNotMatch(gapRun.stdout, HOST_PATH_OUTPUT_RE);
});

test('Health.v1: read-only evaluation of heartbeat age, scan watermark, isolation deadlines and authority identity', () => {
  // 健康事实 → exit 0，五个读模型字段齐备，只读声明在位。
  const healthy = runCli(['health', '--facts', tmpFile('facts.json', healthyFacts()), '--json']);
  assert.equal(healthy.status, 0, `healthy facts must pass: ${healthy.stderr || healthy.stdout}`);
  const healthyReport = parseJsonOut(healthy, 'health healthy');
  assert.equal(healthyReport.interface, 'Health.v1');
  assert.equal(healthyReport.readOnly, true);
  assert.equal(healthyReport.healthy, true);
  assert.deepEqual(healthyReport.breaches, []);
  assert.ok(healthyReport.observed.heartbeatAgeSeconds < CONTRACT.heartbeatAlertAfterSeconds);
  assert.ok(healthyReport.observed.scanWatermarkAgeSeconds < CONTRACT.scanStallAlertAfterSeconds);
  assert.equal(healthyReport.observed.authorityId, 'comet-authority-probe');
  assert.ok(Array.isArray(healthyReport.readModel) && healthyReport.readModel.includes('heartbeat_age'));
  assert.ok(healthyReport.readModel.includes('complete_scan_watermark') && healthyReport.readModel.includes('unresolved_isolation'));
  assert.ok(healthyReport.readModel.includes('authority_identity'));
  assert.doesNotMatch(healthy.stdout, HOST_PATH_OUTPUT_RE);

  // 心跳年龄 >90s → HEARTBEAT_AGE_ALERT（即使扫描水位新鲜）。
  const staleHeartbeat = runCli(['health', '--facts', tmpFile('facts.json', {
    ...healthyFacts(),
    heartbeatAt: agoIso(100),
  }), '--json']);
  assert.equal(staleHeartbeat.status, 2, 'heartbeat age over the deadline must exit 2');
  const staleReport = parseJsonOut(staleHeartbeat, 'health stale heartbeat');
  assert.ok(staleReport.breaches.some((b) => b.code === 'HEARTBEAT_AGE_ALERT'), JSON.stringify(staleReport.breaches));

  // 心跳正常但完整扫描 >2 分钟无进展 → SCAN_WATERMARK_STALL（两信号独立评估的关键负例）。
  const stalled = runCli(['health', '--facts', tmpFile('facts.json', {
    ...healthyFacts(),
    lastCompleteScanAt: agoIso(150),
  }), '--json']);
  assert.equal(stalled.status, 2, 'a stalled scan watermark must exit 2 even with a fresh heartbeat');
  const stalledReport = parseJsonOut(stalled, 'health stalled scan');
  assert.ok(stalledReport.breaches.some((b) => b.code === 'SCAN_WATERMARK_STALL'), JSON.stringify(stalledReport.breaches));
  assert.ok(!stalledReport.breaches.some((b) => b.code === 'HEARTBEAT_AGE_ALERT'),
    'the fresh heartbeat must not fire a heartbeat alert in this scenario');
  const stallBreach = stalledReport.breaches.find((b) => b.code === 'SCAN_WATERMARK_STALL');
  assert.equal(stallBreach.heartbeatIndependent, true, 'the stall verdict must record its independence from the heartbeat');

  // 未完成隔离超过截止时间 → ISOLATION_DEADLINE_BREACH。
  const overdue = runCli(['health', '--facts', tmpFile('facts.json', {
    ...healthyFacts(),
    unresolvedIsolations: [{ isolationId: 'iso-1', deadlineAt: agoIso(10) }],
  }), '--json']);
  assert.equal(overdue.status, 2);
  const overdueReport = parseJsonOut(overdue, 'health overdue isolation');
  assert.ok(overdueReport.breaches.some((b) => b.code === 'ISOLATION_DEADLINE_BREACH'));

  // authority identity 缺失 → AUTHORITY_IDENTITY_MISSING（监督器与对账都依赖固定身份）。
  const noAuthority = runCli(['health', '--facts', tmpFile('facts.json', {
    ...healthyFacts(),
    authorityId: null,
  }), '--json']);
  assert.equal(noAuthority.status, 2);
  const noAuthorityReport = parseJsonOut(noAuthority, 'health no authority');
  assert.ok(noAuthorityReport.breaches.some((b) => b.code === 'AUTHORITY_IDENTITY_MISSING'));

  // facts 缺失/不可解析 = 前置无效 → exit 1（不是静默降级，也不是 UNVERIFIED 冒充）。
  assert.equal(runCli(['health', '--json']).status, 1);
  assert.equal(runCli(['health', '--facts', path.join(os.tmpdir(), 'infra-i07-does-not-exist.json'), '--json']).status, 1);
  assert.equal(runCli(['health', '--facts', tmpFile('facts.json', '{not json'), '--json']).status, 1);
});

test('Monitor.v1: alerts are prepared only (never sent without authorization) and prepared from the exact breaches', () => {
  // 触发场景：隔离首次失败 → 即时事件 + 心跳陈旧，全部只 prepare。
  const run = runCli(['alert', '--facts', tmpFile('facts.json', {
    ...healthyFacts(),
    heartbeatAt: agoIso(100),
    unresolvedIsolations: [{ isolationId: 'iso-1', firstFailureAt: agoIso(20), deadlineAt: inIso(100) }],
  }), '--json']);
  assert.equal(run.status, 0, `preparing alerts is the correct behavior and must succeed: ${run.stderr || run.stdout}`);
  const report = parseJsonOut(run, 'alert prepare');
  assert.equal(report.interface, 'AlertPolicy.v1');
  assert.equal(report.delivery.mode, 'PREPARE_ONLY');
  assert.equal(report.delivery.sentByThisTool, false, 'without delivery authorization the tool must never claim a send');
  assert.equal(report.delivery.authorized, false);
  const kinds = report.prepared.map((alert) => alert.kind);
  assert.ok(kinds.includes('ISOLATION_FAILURE_IMMEDIATE'), 'first isolation failure must raise the immediate event');
  assert.ok(kinds.includes('HEARTBEAT_AGE_ALERT'), 'the stale heartbeat must raise the heartbeat alert');
  for (const alert of report.prepared) {
    assert.ok(alert.detectedAt, 'every prepared alert records its own detection timestamp');
  }
  assert.doesNotMatch(run.stdout, HOST_PATH_OUTPUT_RE);

  // 健康事实 → 不准备任何告警。
  const quiet = runCli(['alert', '--facts', tmpFile('facts.json', healthyFacts()), '--json']);
  assert.equal(quiet.status, 0);
  assert.deepEqual(parseJsonOut(quiet, 'alert quiet').prepared, []);
});

test('Monitor.v1 three-segment timing: detection/delivery/escalation are computed separately from real timestamps', () => {
  // 绿例：检测 60s → 主渠道失败 → 备用渠道 25s 内送达 → 未确认 → 300s 后升级。三段分别计时。
  const green = runCli(['alert', '--facts', tmpFile('facts.json', healthyFacts()), '--timeline', tmpFile('timeline.json', {
    kind: 'HEARTBEAT_AGE',
    failureOnset: agoIso(60 + 25 + 310),
    monitorVerdictAt: agoIso(25 + 310),
    attempts: [
      { at: agoIso(25 + 10), channel: 'primary', outcome: 'unreachable' },
      { at: agoIso(310), channel: 'backup', outcome: 'delivered' },
    ],
    ackedAt: null,
    escalatedAt: agoIso(5),
    sentByThisTool: false,
  }), '--json']);
  assert.equal(green.status, 0, `green timeline must pass: ${green.stderr || green.stdout}`);
  const greenReport = parseJsonOut(green, 'alert green timeline');
  assert.equal(greenReport.interface, 'AlertPolicy.v1');
  // 三段分开的字段，而不是一个"总送达"数。
  assert.ok(typeof greenReport.segments.detectionSeconds === 'number');
  assert.ok(typeof greenReport.segments.deliverySeconds === 'number');
  assert.ok(typeof greenReport.segments.escalationSeconds === 'number');
  assert.ok(greenReport.segments.detectionSeconds <= CONTRACT.detectionLatestSeconds, 'detection within 2 minutes');
  assert.ok(greenReport.segments.deliverySeconds <= CONTRACT.deliveryTargetSeconds, 'delivery within the 30s target');
  assert.ok(greenReport.segments.escalationSeconds >= CONTRACT.escalationAckTimeoutSeconds,
    'escalation happened only after the primary on-call stayed unacknowledged');
  assert.equal(greenReport.failover.used, true, 'primary unreachable -> backup delivery must be recorded as failover');
  assert.ok(!('totalDeliverySeconds' in greenReport.segments), 'no combined total-delivery field may appear');

  // 检测超 2 分钟 → DETECTION_DEADLINE_BREACH。
  const lateDetect = runCli(['alert', '--facts', tmpFile('facts.json', healthyFacts()), '--timeline', tmpFile('timeline.json', {
    kind: 'HEARTBEAT_AGE',
    failureOnset: agoIso(200),
    monitorVerdictAt: agoIso(10),
    attempts: [{ at: agoIso(5), channel: 'primary', outcome: 'delivered' }],
    ackedAt: agoIso(2),
    escalatedAt: null,
    sentByThisTool: false,
  }), '--json']);
  assert.equal(lateDetect.status, 2, 'detection beyond the 2-minute deadline must fail the evaluation');
  assert.ok(codes(parseJsonOut(lateDetect, 'alert late detect')).includes('DETECTION_DEADLINE_BREACH'));

  // 投递超 30 秒目标 → DELIVERY_TARGET_BREACH（如实记违约）。
  const lateDelivery = runCli(['alert', '--facts', tmpFile('facts.json', healthyFacts()), '--timeline', tmpFile('timeline.json', {
    kind: 'HEARTBEAT_AGE',
    failureOnset: agoIso(100),
    monitorVerdictAt: agoIso(50),
    attempts: [{ at: agoIso(5), channel: 'primary', outcome: 'delivered' }],
    ackedAt: agoIso(2),
    escalatedAt: null,
    sentByThisTool: false,
  }), '--json']);
  assert.equal(lateDelivery.status, 2, 'delivery beyond the 30s target must fail the evaluation');
  const lateDeliveryReport = parseJsonOut(lateDelivery, 'alert late delivery');
  assert.ok(codes(lateDeliveryReport).includes('DELIVERY_TARGET_BREACH'));
  assert.ok(lateDeliveryReport.segments.detectionSeconds <= CONTRACT.detectionLatestSeconds,
    'the detection segment was within budget — the breach is delivery-only, proving the segments are judged separately');

  // 未送达却记已确认 → UNDELIVERED_MARKED_ACKED（告警未送达不能记已响应）。
  const fakeAck = runCli(['alert', '--facts', tmpFile('facts.json', healthyFacts()), '--timeline', tmpFile('timeline.json', {
    kind: 'HEARTBEAT_AGE',
    failureOnset: agoIso(40),
    monitorVerdictAt: agoIso(20),
    attempts: [{ at: agoIso(15), channel: 'primary', outcome: 'unreachable' }],
    delivered: true,
    ackedAt: agoIso(2),
    escalatedAt: null,
    sentByThisTool: false,
  }), '--json']);
  assert.equal(fakeAck.status, 2, 'recording an ack without any delivered attempt must be rejected');
  assert.ok(codes(parseJsonOut(fakeAck, 'alert fake ack')).includes('UNDELIVERED_MARKED_ACKED'));

  // 未确认且未升级 → ESCALATION_MISSING。
  const noEscalation = runCli(['alert', '--facts', tmpFile('facts.json', healthyFacts()), '--timeline', tmpFile('timeline.json', {
    kind: 'HEARTBEAT_AGE',
    failureOnset: agoIso(500),
    monitorVerdictAt: agoIso(400),
    attempts: [{ at: agoIso(395), channel: 'primary', outcome: 'delivered' }],
    ackedAt: null,
    escalatedAt: null,
    sentByThisTool: false,
  }), '--json']);
  assert.equal(noEscalation.status, 2, 'an unacknowledged alert without escalation must fail');
  assert.ok(codes(parseJsonOut(noEscalation, 'alert no escalation')).includes('ESCALATION_MISSING'));

  // 未经授权声称本工具已发送 → SEND_WITHOUT_AUTHORIZATION（未经授权仅 prepare 不发送）。
  const unauthorizedSend = runCli(['alert', '--facts', tmpFile('facts.json', healthyFacts()), '--timeline', tmpFile('timeline.json', {
    kind: 'HEARTBEAT_AGE',
    failureOnset: agoIso(40),
    monitorVerdictAt: agoIso(20),
    attempts: [{ at: agoIso(15), channel: 'primary', outcome: 'delivered' }],
    ackedAt: agoIso(2),
    escalatedAt: null,
    sentByThisTool: true,
  }), '--json']);
  assert.equal(unauthorizedSend.status, 2, 'a send claim without delivery authorization must be rejected');
  assert.ok(codes(parseJsonOut(unauthorizedSend, 'alert unauthorized send')).includes('SEND_WITHOUT_AUTHORIZATION'));

  // timeline 缺失/不可解析 = 输入错误 → exit 1。
  assert.equal(runCli(['alert', '--facts', tmpFile('facts.json', healthyFacts()), '--timeline', path.join(os.tmpdir(), 'infra-i07-nope.json'), '--json']).status, 1);
});

test('Supervisor.v1: out-of-scope actions are refused; the supervisor is process-level restart only', () => {
  // 越权动作逐个拒绝：改 phase / 创建 Comet 维护 operation / 直写 Outline ACL / 复制状态 / 第二业务 owner / 业务重试。
  for (const action of FORBIDDEN_SUPERVISOR_ACTIONS) {
    const run = runCli(['supervise', '--request', tmpFile('request.json', {
      action,
      authorityId: 'comet-authority-probe',
      oldWriterAlive: false,
      storageOwnershipKnown: true,
      restarts: [],
    }), '--json']);
    assert.equal(run.status, 2, `supervisor action ${action} must be refused`);
    const report = parseJsonOut(run, `supervise ${action}`);
    assert.ok(codes(report).includes('FORBIDDEN_ACTION_REFUSED'), JSON.stringify(report.violations ?? report));
    assert.equal(report.decision, 'REFUSED');
  }
});

test('Supervisor.v1: dual start with a live old writer is refused; unknown storage ownership is refused', () => {
  const dualStart = runCli(['supervise', '--request', tmpFile('request.json', {
    action: 'restart',
    authorityId: 'comet-authority-probe',
    oldWriterAlive: true,
    storageOwnershipKnown: true,
    restarts: [],
  }), '--json']);
  assert.equal(dualStart.status, 2, 'restart while the old writer is unconfirmed-terminated must be refused');
  const dualStartReport = parseJsonOut(dualStart, 'supervise dual start');
  assert.ok(codes(dualStartReport).includes('OLD_WRITER_ALIVE_REFUSED'));
  assert.equal(dualStartReport.decision, 'REFUSED');

  const unknownStorage = runCli(['supervise', '--request', tmpFile('request.json', {
    action: 'restart',
    authorityId: 'comet-authority-probe',
    oldWriterAlive: false,
    storageOwnershipKnown: false,
    restarts: [],
  }), '--json']);
  assert.equal(unknownStorage.status, 2, 'restart with unknown storage ownership must be refused');
  assert.ok(codes(parseJsonOut(unknownStorage, 'supervise unknown storage')).includes('STORAGE_OWNERSHIP_UNKNOWN_REFUSED'));

  // 合法 restart 请求 → 决策 ALLOW（决策回执；真实进程重启由 probe 实证）。
  const allowed = runCli(['supervise', '--request', tmpFile('request.json', {
    action: 'restart',
    authorityId: 'comet-authority-probe',
    oldWriterAlive: false,
    storageOwnershipKnown: true,
    restarts: [],
  }), '--json']);
  assert.equal(allowed.status, 0, `a clean restart decision must be allowed: ${allowed.stderr || allowed.stdout}`);
  const allowedReport = parseJsonOut(allowed, 'supervise allow');
  assert.equal(allowedReport.decision, 'ALLOW');
  assert.equal(allowedReport.executed, false, 'the decision receipt is not a process restart');
  assert.equal(allowedReport.authorityIdentity.mode, 'SAME_FIXED_AUTHORITY_ONLY');
  assert.equal(allowedReport.restartBudget.withinBudget, true);
  assert.equal(allowedReport.cometSelfRecovery.supervisorBusinessRetry, false,
    'the supervisor performs no business retry — Comet recovers its own transactions/compensation/retries');
  assert.doesNotMatch(allowed.stdout, HOST_PATH_OUTPUT_RE);
});

test('Supervisor.v1: exceeding 3 restarts within 5 minutes stops and escalates', () => {
  const fourRestarts = runCli(['supervise', '--request', tmpFile('request.json', {
    action: 'restart',
    authorityId: 'comet-authority-probe',
    oldWriterAlive: false,
    storageOwnershipKnown: true,
    restarts: [agoIso(240), agoIso(180), agoIso(120)],
  }), '--json']);
  assert.equal(fourRestarts.status, 2, 'a 4th restart inside the 5-minute window must be refused');
  const report = parseJsonOut(fourRestarts, 'supervise budget exceeded');
  assert.ok(codes(report).includes('RESTART_BUDGET_EXCEEDED'));
  assert.equal(report.decision, 'STOP_AND_ESCALATE');
  assert.ok(report.escalation, 'the refusal must carry a prepared escalation');
  assert.equal(report.escalation.mode, 'PREPARE_ONLY', 'escalation delivery stays prepare-only without authorization');

  // 窗口外的旧重启不计数：3 次都在 5 分钟窗口之外 → 允许。
  const oldRestarts = runCli(['supervise', '--request', tmpFile('request.json', {
    action: 'restart',
    authorityId: 'comet-authority-probe',
    oldWriterAlive: false,
    storageOwnershipKnown: true,
    restarts: [agoIso(400), agoIso(500), agoIso(600)],
  }), '--json']);
  assert.equal(oldRestarts.status, 0, `restarts outside the window must not count: ${oldRestarts.stderr || oldRestarts.stdout}`);
  assert.equal(parseJsonOut(oldRestarts, 'supervise old restarts').restartBudget.withinBudget, true);
});

test('probes are real subcommands: runner-process-failure is provable at process level; external-host-down stays UNVERIFIED; scan-watermark-stall is locally provable', () => {
  // 1) runner-process-failure：真实进程注入（spawn -> SIGKILL -> 检测 -> 原实例身份重启）。
  const processFailure = runCli(['probe', '--case', 'runner-process-failure', '--json']);
  assert.equal(processFailure.status, 0, `process-level injection must be provable: ${processFailure.stderr || processFailure.stdout}`);
  const processReport = parseJsonOut(processFailure, 'probe runner-process-failure');
  assert.equal(processReport.interface, 'MonitorInfra.v1');
  assert.equal(processReport.case, 'runner-process-failure');
  assert.equal(processReport.executed, true);
  assert.equal(processReport.status, 'VERIFIED');
  assert.equal(processReport.capabilityScope, 'PROCESS_LEVEL');
  assert.equal(processReport.hostFailureCapabilityClaimed, false,
    'the process probe must never be smuggled as a host-failure capability');
  const detectStep = processReport.observedSteps.find((step) => step.step === 'detect-heartbeat-stale');
  assert.ok(detectStep, 'the stale-heartbeat detection step must be recorded');
  assert.equal(detectStep.status, 'VERIFIED');
  const restartStep = processReport.observedSteps.find((step) => step.step === 'supervised-restart');
  assert.ok(restartStep && restartStep.status === 'VERIFIED', 'the supervised restart step must be recorded');
  assert.equal(restartStep.sameAuthorityId, true, 'the restart keeps the same fixed authority identity');
  assert.equal(restartStep.oldWriterConfirmedGone, true, 'the restart happened only after the old writer was confirmed gone');
  assert.equal(restartStep.singleLiveInstance, true, 'exactly one live instance after the restart');
  assert.ok(restartStep.restartsUsed <= CONTRACT.restartMax, 'restart count stays inside the 5-minute budget');
  assert.doesNotMatch(processFailure.stdout, HOST_PATH_OUTPUT_RE);

  // 2) external-host-down：无真实外部监控 → 结构化 UNVERIFIED，故障域必须 FAIL 不能 PASS。
  const hostDown = runCli(['probe', '--case', 'external-host-down', '--json']);
  assert.equal(hostDown.status, 2, 'host-down detection without a registered external monitor must stay nonzero');
  const hostReport = parseJsonOut(hostDown, 'probe external-host-down');
  assert.equal(hostReport.case, 'external-host-down');
  assert.equal(hostReport.status, 'UNVERIFIED');
  assert.equal(hostReport.faultDomainSatisfied, false, 'the fault domain must be marked NOT satisfied');
  assert.equal(hostReport.mustNotPass, true, 'a co-hosted monitor must be marked as unable to pass this case');
  assert.ok(hostReport.reason.length > 0);
  assert.ok(Array.isArray(hostReport.requiredInputs) && hostReport.requiredInputs.length > 0);
  assert.doesNotMatch(hostDown.stdout, /"skip"\s*:\s*true/, 'probes must not skip');
  assert.doesNotMatch(hostDown.stdout, HOST_PATH_OUTPUT_RE);

  // 3) scan-watermark-stall：心跳正常、扫描水位停滞 → 本地可证（事实 fixture + 真实时钟差）。
  const stall = runCli(['probe', '--case', 'scan-watermark-stall', '--json']);
  assert.equal(stall.status, 0, `the scan-stall detection mechanism must be provable: ${stall.stderr || stall.stdout}`);
  const stallReport = parseJsonOut(stall, 'probe scan-watermark-stall');
  assert.equal(stallReport.executed, true);
  assert.equal(stallReport.status, 'VERIFIED');
  assert.equal(stallReport.detection.code, 'SCAN_WATERMARK_STALL');
  assert.equal(stallReport.detection.heartbeatIndependent, true);
  assert.equal(stallReport.delivery.mode, 'PREPARE_ONLY', 'the alert stays prepared-only without authorization');
  assert.equal(stallReport.realCometReadback.status, 'UNVERIFIED',
    'the fixture-based detection must not claim a real Comet facts readback');
  assert.doesNotMatch(stall.stdout, HOST_PATH_OUTPUT_RE);

  // 未知 case / 缺参 → exit 1。
  assert.equal(runCli(['probe', '--case', 'not-a-case', '--json']).status, 1);
  assert.equal(runCli(['probe', '--json']).status, 1);
});

test('committed contract shape: interfaces, example declaration, read-only health and no secret values', async () => {
  const secretRefs = await import(secretRefsModuleUrl);
  for (const name of MONITOR_FILES) {
    const doc = readMonitorJson(name);
    const violations = secretRefs.scanForForbiddenValues(doc);
    assert.deepEqual(violations, [], `${name} must contain no secret-shaped values or host paths`);
  }

  assert.equal(readMonitorJson('monitor-registration.example.json').interface, 'MonitorRegistration.v1');
  assert.equal(readMonitorJson('monitor-registration.example.json').example, true, 'the registration must declare itself an example');
  assert.equal(readMonitorJson('health-contract.json').interface, 'Health.v1');
  assert.equal(readMonitorJson('health-contract.json').readOnly, true, 'Health.v1 is read-only over existing Comet facts');
  assert.equal(readMonitorJson('alert-policy.json').interface, 'AlertPolicy.v1');
  assert.equal(readMonitorJson('supervisor-policy.json').interface, 'Supervisor.v2');
  assert.equal(readMonitorJson('fault-domain-policy.json').interface, 'FaultDomain.v1');

  // 两个计划 secret-ref 全部被域文件引用；只引用不存值。
  const referenced = JSON.stringify(MONITOR_FILES.map((name) => readMonitorJson(name)));
  for (const ref of MONITOR_REFS) {
    assert.ok(referenced.includes(ref), `monitor domain files must reference ${ref}`);
  }

  // Health.v1 读既有 Comet 事实：读模型含接收游标，且声明 sourceOfTruth=Comet。
  const health = readMonitorJson('health-contract.json');
  for (const field of ['heartbeat_age', 'receive_cursor', 'complete_scan_watermark', 'unresolved_isolation', 'authority_identity']) {
    assert.ok(health.readModel.includes(field), `health read model must include ${field}`);
  }
  assert.equal(health.sourceOfTruth, 'existing-comet-facts');

  // 监督器声明：同 authority 恢复后仍只有一个业务 owner；无第二控制面。
  const supervisor = readMonitorJson('supervisor-policy.json');
  assert.equal(supervisor.authorityBinding.stateCopy, 'FORBIDDEN');
  assert.equal(supervisor.authorityBinding.secondBusinessOwner, 'FORBIDDEN');
  // 重启原实例与停止旧写者分别审计（行为锚点：probe observedSteps 的 inject-process-death
  // 与 supervised-restart 是两个独立步骤；此处钉住策略声明不被摘除）。
  assert.equal(supervisor.audit.restartAuditRequired, true);
  assert.equal(supervisor.audit.oldWriterStopSeparatelyAudited, true);
});

// ---------------------------------------------------------------------------
// 修订 2026-10-26-comet-050-adoption-v1（复用既有调度和外部告警）：
//   登记"同 Comet 维护入口"的触发映射 + G15/R10 登记字段 + 负向红线
//   （漏报=失败、告警≠隔离、离线可检测、补偿归原 Comet、不得起独立 controller 服务）。
// ---------------------------------------------------------------------------

test('comet-050 revision registration: scheduler mapping, G15/R10 targets and negative red lines are registered and surfaced by validate', () => {
  const validate = runCli(['validate', '--registry', registryPath, '--json']);
  assert.equal(validate.status, 0, `validate must PASS with the new registration: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate comet-050');

  // 触发映射：定时器只触发原命令入口，不拥有业务状态/重试调度；禁止常驻 controller。
  const mapping = report.schedulerInvocation;
  assert.ok(mapping, 'validate receipt must surface the scheduler invocation mapping');
  assert.equal(mapping.triggersOnlyOriginalCometMaintenance, true);
  assert.equal(mapping.originalEntry, 'same-original-comet-maintenance-entry');
  assert.equal(mapping.originalEntryStatus, 'UNVERIFIED', 'the real maintenance command wiring is P4_8/pilot territory and stays UNVERIFIED here');
  assert.equal(mapping.residentControllerService, 'FORBIDDEN');
  assert.equal(mapping.schedulerOwnsBusinessState, false);
  assert.equal(mapping.schedulerOwnsRetryScheduling, false);
  assert.equal(mapping.checkOldWriterBeforeRecoveryInvocation, true);
  assert.equal(mapping.surfaces.ciScheduledWorkflow.status, 'UNREGISTERED');
  assert.equal(mapping.surfaces.hostTimer.status, 'UNREGISTERED');

  // G15：发现≤3min / 隔离≤2min；故障暴露/告警/隔离分别计时；告警不是隔离。
  const g15 = report.g15;
  assert.ok(g15, 'validate receipt must surface the G15 target registration');
  assert.equal(g15.discoveryTargetSeconds, CONTRACT.g15DiscoveryTargetSeconds);
  assert.equal(g15.isolationTargetSeconds, CONTRACT.g15IsolationTargetSeconds);
  for (const segment of CONTRACT.g15SegmentsTimedSeparately) {
    assert.ok(g15.segmentsTimedSeparately.includes(segment), `G15 segment ${segment} must be registered as separately timed`);
  }
  assert.equal(g15.alertIsNeverIsolation, true);
  assert.equal(g15.operationalEvidence, 'UNVERIFIED', 'production timing evidence is not claimed by this registration');

  // R10：未完成义务保留唯一工作区；监控只观察并告警，绝不清理。
  const r10 = report.r10;
  assert.ok(r10, 'validate receipt must surface the R10 registration');
  assert.equal(r10.soleWorkspaceRetentionForUnresolvedObligations, true);
  assert.equal(r10.monitorRole, 'observe-and-alert-only');
  assert.equal(r10.monitorNeverCleansUp, true);
  assert.ok(r10.cleanupRequires.includes('verified-completed'));
  assert.ok(r10.cleanupRequires.includes('separately-approved-migration-and-restore-proof'));

  // 负向红线：漏报=失败、告警≠隔离、离线可检测、补偿归原 Comet。
  const redLines = report.negativeRedLines;
  assert.ok(redLines, 'validate receipt must surface the negative red lines');
  assert.equal(redLines.missedAlertIsFailure, true);
  assert.equal(redLines.alertIsNeverIsolation, true);
  assert.equal(redLines.offlineMustBeDetectable, true);
  assert.equal(redLines.compensationOwner, 'original-comet');
  for (const event of ['missed-event', 'watermark-stall', 'offline', 'isolation-failure']) {
    assert.ok(redLines.requiredAlertEvents.includes(event), `negative event ${event} must be registered as required-alerting`);
  }
});

test('scheduling surface inventory stays honest: no committed CI schedule trigger and no repo-registered host timer', () => {
  // 事实侧：两个 committed workflow（delivery-gate / quality-gates）今天都没有 on.schedule 触发器。
  const workflowsDir = path.join(repoRoot, '.github', 'workflows');
  const workflowFiles = fs.readdirSync(workflowsDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  assert.ok(workflowFiles.length > 0, 'the repo must still carry its CI workflows for this inventory to be meaningful');
  const withSchedule = [];
  for (const name of workflowFiles) {
    const text = fs.readFileSync(path.join(workflowsDir, name), 'utf8');
    if (/^\s*schedule\s*:/m.test(text)) withSchedule.push(name);
  }
  assert.deepEqual(withSchedule, [], 'if a scheduled workflow is ever committed, the registration must be updated in the same change');

  // 事实侧：仓库的安装面（tools/hooks/scripts）没有登记任何宿主定时器。
  const timerPattern = /crontab|launchd|LaunchAgents|schtasks|systemd/;
  const roots = [path.join(repoRoot, 'tools'), path.join(repoRoot, 'hooks'), path.join(repoRoot, 'scripts')];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(sh|mjs|js|ya?ml)$/.test(entry.name)) {
        if (timerPattern.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  for (const root of roots) if (fs.existsSync(root)) walk(root);
  assert.deepEqual(offenders, [], 'if a host timer is ever registered by this repo, the registration must be updated in the same change');

  // 登记侧：两个调度面的状态必须与事实一致（都未登记）。
  const supervisor = readMonitorJson('supervisor-policy.json');
  const surfaces = supervisor.schedulerInvocation.surfaces;
  assert.equal(surfaces.ciScheduledWorkflow.status, 'UNREGISTERED');
  assert.deepEqual(surfaces.ciScheduledWorkflow.committedWorkflowsWithScheduleTrigger, []);
  assert.equal(surfaces.hostTimer.status, 'UNREGISTERED');
});

test('RED scheduler mapping gates: timers only trigger the original Comet entry; a resident controller service is forbidden', () => {
  // 不得起独立 controller 服务（负向红线单独码）。
  const resident = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('supervisor-policy.json');
    doc.schedulerInvocation.invocationContract.residentControllerService = 'ALLOWED';
    writeJson('supervisor-policy.json', doc);
  });
  const residentRun = runCli(['validate', '--registry', registryPath, '--dir', resident, '--json']);
  assert.equal(residentRun.status, 2, 'allowing a resident controller service must be rejected');
  assert.ok(codes(parseJsonOut(residentRun, 'validate resident')).includes('RESIDENT_CONTROLLER_FORBIDDEN'));

  // 定时器只触发原命令：翻掉任何一个映射约束 → SCHEDULER_MAPPING_INVALID。
  const flips = [
    (contract) => { contract.triggersOnlyOriginalCometMaintenance = false; },
    (contract) => { contract.schedulerOwnsBusinessState = true; },
    (contract) => { contract.schedulerOwnsRetryScheduling = true; },
    (contract) => { contract.checkOldWriterBeforeRecoveryInvocation = false; },
  ];
  for (const flip of flips) {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      const doc = json('supervisor-policy.json');
      flip(doc.schedulerInvocation.invocationContract);
      writeJson('supervisor-policy.json', doc);
    });
    const run = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
    assert.equal(run.status, 2, `weakening the scheduler invocation contract must be rejected: ${run.stdout}`);
    assert.ok(codes(parseJsonOut(run, 'validate mapping')).includes('SCHEDULER_MAPPING_INVALID'));
  }

  // 调度面声称 REGISTERED 却不给出登记标识 → SCHEDULER_SURFACE_REGISTRATION_INCOMPLETE（诚实登记守卫）。
  for (const surface of ['ciScheduledWorkflow', 'hostTimer']) {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      const doc = json('supervisor-policy.json');
      doc.schedulerInvocation.surfaces[surface].status = 'REGISTERED';
      writeJson('supervisor-policy.json', doc);
    });
    const run = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
    assert.equal(run.status, 2, `flipping ${surface} to REGISTERED without naming what got registered must be rejected`);
    assert.ok(codes(parseJsonOut(run, `validate ${surface}`)).includes('SCHEDULER_SURFACE_REGISTRATION_INCOMPLETE'));
  }
});

test('RED G15/R10 registration gates: 3-minute discovery / 2-minute isolation targets and R10 sole-workspace retention are flip-guarded', () => {
  const healthFlips = [
    (g15) => { g15.discoveryTargetSeconds = 600; },
    (g15) => { g15.isolationTargetSeconds = 600; },
    (g15) => { g15.segmentsTimedSeparately = g15.segmentsTimedSeparately.filter((s) => s !== 'isolation'); },
    (g15) => { g15.alertIsNeverIsolation = false; },
  ];
  for (const flip of healthFlips) {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      const doc = json('health-contract.json');
      flip(doc.g15);
      writeJson('health-contract.json', doc);
    });
    const run = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
    assert.equal(run.status, 2, `tampering with the G15 target registration must be rejected: ${run.stdout}`);
    assert.ok(codes(parseJsonOut(run, 'validate g15')).includes('G15_TARGETS_INVALID'));
  }

  const r10Flips = [
    (r10) => { r10.soleWorkspaceRetentionForUnresolvedObligations = false; },
    (r10) => { r10.monitorNeverCleansUp = false; },
    (r10) => { r10.monitorRole = 'observe-alert-and-cleanup'; },
  ];
  for (const flip of r10Flips) {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      const doc = json('health-contract.json');
      flip(doc.r10);
      writeJson('health-contract.json', doc);
    });
    const run = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
    assert.equal(run.status, 2, `weakening the R10 retention registration must be rejected: ${run.stdout}`);
    assert.ok(codes(parseJsonOut(run, 'validate r10')).includes('R10_RETENTION_INVALID'));
  }
});

test('RED negative red lines: missed alert is failure, alert never substitutes isolation, offline detectable, compensation owned by original Comet', () => {
  const alertFlips = [
    (lines) => { lines.missedAlertIsFailure = false; },
    (lines) => { lines.requiredAlertEvents = lines.requiredAlertEvents.filter((e) => e !== 'offline'); },
    (lines) => { lines.compensationOwner = 'monitor'; },
  ];
  for (const flip of alertFlips) {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      const doc = json('alert-policy.json');
      flip(doc.negativeRedLines);
      writeJson('alert-policy.json', doc);
    });
    const run = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
    assert.equal(run.status, 2, `dropping a negative red line must be rejected: ${run.stdout}`);
    assert.ok(codes(parseJsonOut(run, 'validate red lines')).includes('MISSED_ALERT_RED_LINE_REQUIRED'));
  }

  // 告警≠隔离：单独码钉住（告警送达绝不充当隔离执行/读回）。
  const alertNotIso = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('alert-policy.json');
    doc.negativeRedLines.alertIsNeverIsolation = false;
    writeJson('alert-policy.json', doc);
  });
  const alertNotIsoRun = runCli(['validate', '--registry', registryPath, '--dir', alertNotIso, '--json']);
  assert.equal(alertNotIsoRun.status, 2, 'claiming an alert can substitute isolation must be rejected');
  assert.ok(codes(parseJsonOut(alertNotIsoRun, 'validate alert!=isolation')).includes('ALERT_IS_NOT_ISOLATION_REQUIRED'));

  // 离线可检测：只能由故障域外部证明（同 fault-domain 的 co-host 守卫同源）。
  const offline = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('fault-domain-policy.json');
    doc.offlineDetectability.runnerOfflineRequiresExternalMonitor = false;
    writeJson('fault-domain-policy.json', doc);
  });
  const offlineRun = runCli(['validate', '--registry', registryPath, '--dir', offline, '--json']);
  assert.equal(offlineRun.status, 2, 'weakening offline detectability to an in-domain claim must be rejected');
  assert.ok(codes(parseJsonOut(offlineRun, 'validate offline')).includes('OFFLINE_DETECTABILITY_REQUIRED'));
});
