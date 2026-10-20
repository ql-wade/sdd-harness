#!/usr/bin/env node
// MonitorInfra.v1 / Health.v1 / AlertPolicy.v1 / Supervisor.v1 / FaultDomain.v1 CLI
//   — validate | health | alert | supervise | probe
//
// 只读既有 Comet 事实 + 决策与准备：不启动任何服务、不发送任何通知、不持有业务阶段/DAG/重试、
// 不写 ACL、不创建 Comet 维护 operation。监督器仅进程级 restart 原实例（probe 内以真实本地进程注入实证）。
// 秘密值永不读写：两个 ref（monitor-health-read / monitor-alert）只引用，解析属 I01 只读门（UNRESOLVED）。
//
// 退出码契约（execution-contract.json V_INFRA_I07.cli_contract）：
//   0 = PASS（validate 通过 / health 健康 / alert 评估完成 / supervise ALLOW / probe VERIFIED）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、未知 probe case）
//   2 = 验证失败（语义违规、health 违约、supervise 拒绝、probe UNVERIFIED/阻断）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 转 PASS。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, scanForForbiddenValues } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const DEFAULT_DIR = path.join(repoRoot, 'infra', 'delivery', 'monitor');

const MONITOR_FILES = [
  'monitor-registration.example.json',
  'health-contract.json',
  'alert-policy.json',
  'supervisor-policy.json',
  'fault-domain-policy.json',
];

// 规格冻结的细分时限（knowledge-revocation-and-restoration.md + infrastructure-plan.md I07）。
const CONTRACT_DEADLINES = {
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
};

const MONITOR_REFS = [
  'secret-ref:sdd-harness-pilot/monitor-health-read',
  'secret-ref:sdd-harness-pilot/monitor-alert',
];
const FORBIDDEN_SUPERVISOR_ACTIONS = [
  'change-phase',
  'create-maintenance-operation',
  'write-outline-acl',
  'copy-state',
  'start-second-owner',
  'business-retry',
];
const ALLOWED_SUPERVISOR_ACTIONS = ['restart'];

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时文件）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

function usage() {
  return [
    'usage:',
    '  monitor.mjs validate  --registry <file> [--refs <file>] [--dir <monitor dir>] [--json]',
    '  monitor.mjs health    --facts <file> [--dir <monitor dir>] [--json]',
    '  monitor.mjs alert     --facts <file> [--timeline <file>] [--dir <monitor dir>] [--json]',
    '  monitor.mjs supervise --request <file> [--dir <monitor dir>] [--json]',
    '  monitor.mjs probe     --case <runner-process-failure|external-host-down|scan-watermark-stall> [--dir <monitor dir>] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (value === undefined) return { command, opts, error: `missing value for ${arg}` };
      opts[arg.slice(2)] = value;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, null, 2) + '\n');
}

function failInput(message) {
  process.stderr.write(`${message}\n${usage()}\n`);
  return EXIT_INPUT;
}

const ageSeconds = (iso, nowMs = Date.now()) => (nowMs - Date.parse(iso)) / 1000;

// 门禁必须 fail-closed：监控域文件缺失/不可解析 = 前置无效，绝不静默降级为空规则。
function loadMonitorDocs(dir) {
  const docs = {};
  const files = {};
  for (const name of MONITOR_FILES) {
    const file = path.join(dir, name);
    try {
      files[name] = fs.readFileSync(file, 'utf8');
      docs[name] = JSON.parse(files[name]);
    } catch (error) {
      return { error: `monitor file unreadable (${displayPath(file)}): ${redactHostPaths(error.message)}` };
    }
  }
  return { docs, files };
}

// 域内引用的全部 secret-ref 位置（与 validate 单一事实源共用）。
function collectRefs(docs) {
  const registration = docs['monitor-registration.example.json'];
  const health = docs['health-contract.json'];
  const alert = docs['alert-policy.json'];
  return [...new Set([
    ...(registration?.credentialRefs ?? []),
    health?.readAuthorizationRef,
    alert?.deliveryAuthorizationRef,
  ])].filter((ref) => typeof ref === 'string' && ref.length > 0);
}

function collectDeadlines(docs) {
  const health = docs['health-contract.json'];
  const alert = docs['alert-policy.json'];
  const supervisor = docs['supervisor-policy.json'];
  return {
    heartbeatIntervalSeconds: health?.heartbeat?.intervalSeconds ?? null,
    monitorCheckIntervalSeconds: health?.monitorCheckIntervalSeconds ?? null,
    heartbeatAlertAfterSeconds: health?.heartbeat?.alertAfterAgeSeconds ?? null,
    scanStallAlertAfterSeconds: health?.completeScanWatermark?.stallAlertAfterSeconds ?? null,
    detectionLatestSeconds: health?.detection?.latestDiscoverySeconds ?? alert?.segments?.detection?.latestDiscoverySeconds ?? null,
    deliveryTargetSeconds: alert?.segments?.delivery?.targetSeconds ?? null,
    escalationAckTimeoutSeconds: alert?.segments?.escalation?.onCallAckTimeoutSeconds ?? null,
    restartWindowSeconds: supervisor?.restartBudget?.windowSeconds ?? null,
    restartMax: supervisor?.restartBudget?.maxRestarts ?? null,
    recoveryTargetSeconds: supervisor?.recoveryTargetSeconds ?? null,
  };
}

// 无人值守发布 pre-enable 门：enabled=true 时逐项核对登记（fail-closed；complete fixture 需全部登记 + 授权记录）。
function evaluatePreEnableGate(registration) {
  const requiresAll = registration?.unattendedRelease?.requiresAll ?? [];
  const deliveryClaimed = registration?.deliveryAuthorization?.alertDeliveryAuthorized === true;
  const deliveryRecorded = typeof registration?.deliveryAuthorization?.authorizationRecord === 'string'
    && registration.deliveryAuthorization.authorizationRecord.length > 0;
  const state = {
    'external-monitor-registered': registration?.externalMonitor?.status === 'REGISTERED',
    'oncall-platform-primary': typeof registration?.onCall?.platform?.primary === 'string' && registration.onCall.platform.primary.startsWith('REGISTERED:'),
    'oncall-platform-backup': typeof registration?.onCall?.platform?.backup === 'string' && registration.onCall.platform.backup.startsWith('REGISTERED:'),
    'channel-primary': typeof registration?.channels?.primary === 'string' && registration.channels.primary.startsWith('REGISTERED:'),
    'channel-backup': typeof registration?.channels?.backup === 'string' && registration.channels.backup.startsWith('REGISTERED:'),
    'delivery-authorized': deliveryClaimed && deliveryRecorded,
    'isolation-operation-authorized': registration?.isolationOperationAuthorization?.registered === true,
  };
  const missing = requiresAll.filter((requirement) => !state[requirement]);
  const enabled = registration?.unattendedRelease?.enabled === true;
  return {
    enabled,
    allowed: enabled && missing.length === 0,
    missing,
    state,
  };
}

function validateMonitor({ docs, registry, refsDoc, dir }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const projectId = registry?.project?.id;

  const registration = docs['monitor-registration.example.json'];
  const health = docs['health-contract.json'];
  const alert = docs['alert-policy.json'];
  const supervisor = docs['supervisor-policy.json'];
  const faultDomain = docs['fault-domain-policy.json'];

  // 接口与项目绑定。
  const interfaces = [
    ['monitor-registration.example.json', registration, 'MonitorRegistration.v1'],
    ['health-contract.json', health, 'Health.v1'],
    ['alert-policy.json', alert, 'AlertPolicy.v1'],
    ['supervisor-policy.json', supervisor, 'Supervisor.v1'],
    ['fault-domain-policy.json', faultDomain, 'FaultDomain.v1'],
  ];
  for (const [name, doc, expected] of interfaces) {
    if (doc?.interface !== expected) add('MONITOR_INTERFACE_INVALID', name, { expected, observed: doc?.interface ?? null });
    if (doc?.project?.id !== projectId) add('PROJECT_MISMATCH', name, { project: doc?.project?.id ?? null, registry: projectId });
  }
  if (registration?.example !== true) add('EXAMPLE_DECLARATION_REQUIRED', 'monitor-registration.example.json');

  // 规格细分时限冻结（30s/30s/90s/120s/120s/30s/300s/3-per-300s/600s）。
  const deadlines = collectDeadlines(docs);
  for (const [field, expected] of Object.entries(CONTRACT_DEADLINES)) {
    if (deadlines[field] !== expected) add('DEADLINE_CONTRACT_INVALID', field, { expected, observed: deadlines[field] ?? null });
  }

  // 无人值守发布 pre-enable 门。
  const preEnableGate = evaluatePreEnableGate(registration);
  if (preEnableGate.enabled && !preEnableGate.allowed) {
    add('PRE_ENABLE_REGISTRATION_INCOMPLETE', 'monitor-registration.example.json:unattendedRelease', { missing: preEnableGate.missing });
  }

  // 投递授权声明守卫：本任务不隐含通知发送授权；声称已授权必须携带独立授权记录。
  if (registration?.deliveryAuthorization?.alertDeliveryAuthorized === true
    && !(typeof registration?.deliveryAuthorization?.authorizationRecord === 'string'
      && registration.deliveryAuthorization.authorizationRecord.length > 0)) {
    add('DELIVERY_AUTHORIZATION_CLAIM_FORBIDDEN', 'monitor-registration.example.json:deliveryAuthorization', {
      reason: 'no notification-send authorization exists in this task; an authorization claim requires a separately recorded owner approval',
    });
  }

  // 告警三段必须分开计时：detection/delivery/escalation 各自存在，合并"总送达"预算字段禁止。
  for (const segment of ['detection', 'delivery', 'escalation']) {
    if (!alert?.segments?.[segment] || typeof alert.segments[segment] !== 'object') {
      add('SEGMENTS_NOT_SEPARATE', `alert-policy.json:segments.${segment}`, { reason: 'detection/delivery/escalation must each be declared with their own timing' });
    }
  }
  for (const field of alert?.forbiddenCombinedBudgetFields ?? ['totalDeliverySeconds', 'endToEndSeconds', 'totalAlertSeconds']) {
    if (alert?.[field] !== undefined) add('SEGMENTS_NOT_SEPARATE', `alert-policy.json:${field}`, { reason: 'a combined total-delivery budget is forbidden; segments are timed separately' });
  }
  if (alert?.rules?.undeliveredIsNeverAcknowledged !== true) {
    add('UNDELIVERED_ACK_RULE_REQUIRED', 'alert-policy.json:rules', { reason: 'an undelivered alert must never be recorded as acknowledged' });
  }
  const noBusinessWrites = alert?.noBusinessWrites ?? [];
  for (const required of ['phase', 'business-retry', 'acl', 'agent-dispatch']) {
    if (!noBusinessWrites.includes(required)) {
      add('NO_BUSINESS_WRITES_INCOMPLETE', 'alert-policy.json:noBusinessWrites', { missing: required });
    }
  }

  // 监督器结构门：六类越权动作、重启预算、双启门、authority 绑定。
  const forbiddenActions = supervisor?.forbiddenActions ?? [];
  for (const required of FORBIDDEN_SUPERVISOR_ACTIONS) {
    if (!forbiddenActions.includes(required)) add('SUPERVISOR_ACTIONS_INCOMPLETE', 'supervisor-policy.json:forbiddenActions', { missing: required });
  }
  const budget = supervisor?.restartBudget ?? {};
  if (budget.windowSeconds !== CONTRACT_DEADLINES.restartWindowSeconds
    || budget.maxRestarts !== CONTRACT_DEADLINES.restartMax
    || budget.onExceeded !== 'STOP_AND_ESCALATE') {
    add('RESTART_BUDGET_INVALID', 'supervisor-policy.json:restartBudget', {
      expected: { windowSeconds: CONTRACT_DEADLINES.restartWindowSeconds, maxRestarts: CONTRACT_DEADLINES.restartMax, onExceeded: 'STOP_AND_ESCALATE' },
      observed: budget,
    });
  }
  if (supervisor?.startGate?.refuseWhileOldWriterAlive !== 'REFUSE'
    || supervisor?.startGate?.storageOwnershipUnknown !== 'REFUSE'
    || supervisor?.startGate?.oldWriterMustBeConfirmedGone !== true) {
    add('START_GATE_REFUSE_REQUIRED', 'supervisor-policy.json:startGate', {
      reason: 'dual start must stay REFUSED while the old writer is unconfirmed-terminated or storage ownership is unknown',
    });
  }
  if (supervisor?.authorityBinding?.stateCopy !== 'FORBIDDEN' || supervisor?.authorityBinding?.secondBusinessOwner !== 'FORBIDDEN'
    || supervisor?.authorityBinding?.mode !== 'SAME_FIXED_AUTHORITY_ONLY') {
    add('SUPERVISOR_AUTHORITY_BINDING_INVALID', 'supervisor-policy.json:authorityBinding', {
      reason: 'restart binds to the same fixed authority only; state copy and a second business owner are forbidden',
    });
  }
  if (supervisor?.cometSelfRecovery?.supervisorBusinessRetry !== false) {
    add('SUPERVISOR_BUSINESS_RETRY_FORBIDDEN', 'supervisor-policy.json:cometSelfRecovery', {
      reason: 'Comet recovers its own transactions/compensation/retries; the supervisor keeps no second retry loop',
    });
  }

  // 故障域：同宿主监控不得声称主机宕机发现能力。
  if (faultDomain?.domains?.runnerHostFailure?.requiresExternalMonitor !== true
    || faultDomain?.domains?.runnerHostFailure?.coHostedMonitorInsufficient !== true
    || faultDomain?.rules?.coHostedMonitorMustNotPassHostFailure !== true) {
    add('COHOSTED_CLAIM_FORBIDDEN', 'fault-domain-policy.json', {
      reason: 'a co-hosted monitor dies with the host; host-failure detection requires a registered external monitor and must never PASS from a co-hosted claim',
    });
  }

  // Health.v1 只读与事实源。
  if (health?.readOnly !== true || health?.sourceOfTruth !== 'existing-comet-facts') {
    add('HEALTH_READ_ONLY_REQUIRED', 'health-contract.json', {
      reason: 'Health.v1 is a read-only probe over existing Comet facts; it never becomes a second control plane',
    });
  }

  // secret-ref 结构 + 项目命名空间；目录成员缺口如实上报（I01 所有；沿 I02/I03/I06 先例，validate 保持 exit 0）。
  const catalogGaps = [];
  for (const ref of collectRefs(docs)) {
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) {
      add(parsed.code, 'credentialRefs', { ref, reason: parsed.error });
      continue;
    }
    if (projectId && parsed.project !== projectId) {
      add('CROSS_PROJECT_REF', 'credentialRefs', { ref, project: parsed.project });
      continue;
    }
    if (refsDoc && !(refsDoc.refs ?? []).some((item) => item.ref === ref)) catalogGaps.push(ref);
  }

  for (const [name, doc] of Object.entries(docs)) {
    for (const finding of scanForForbiddenValues(doc)) {
      add(finding.code, name, { key: finding.key, reason: finding.reason });
    }
  }

  return {
    violations,
    catalogGaps: [...catalogGaps].sort(),
    deadlines,
    preEnableGate,
    deliveryAuthorization: {
      authorized: registration?.deliveryAuthorization?.alertDeliveryAuthorized === true,
      record: registration?.deliveryAuthorization?.authorizationRecord ?? null,
    },
    faultDomain: {
      coHostedMonitorCannotClaimHostFailure: faultDomain?.rules?.coHostedMonitorMustNotPassHostFailure === true,
      hostFailureRequiresExternalMonitor: faultDomain?.domains?.runnerHostFailure?.requiresExternalMonitor === true,
    },
    dir: displayPath(dir),
  };
}

// Health.v1 评估：只读既有事实，两个告警信号（心跳年龄/扫描水位）独立评估，另含隔离截止与身份。
function evaluateHealth(facts, health, nowMs = Date.now()) {
  const breaches = [];
  const observed = {
    authorityId: facts?.authorityId ?? null,
    heartbeatAgeSeconds: facts?.heartbeatAt ? Math.round(ageSeconds(facts.heartbeatAt, nowMs) * 1000) / 1000 : null,
    receiveCursorAgeSeconds: facts?.receiveCursorAt ? Math.round(ageSeconds(facts.receiveCursorAt, nowMs) * 1000) / 1000 : null,
    scanWatermarkAgeSeconds: facts?.lastCompleteScanAt ? Math.round(ageSeconds(facts.lastCompleteScanAt, nowMs) * 1000) / 1000 : null,
    unresolvedIsolations: Array.isArray(facts?.unresolvedIsolations) ? facts.unresolvedIsolations.length : null,
  };
  const heartbeatAlertAfter = health?.heartbeat?.alertAfterAgeSeconds ?? CONTRACT_DEADLINES.heartbeatAlertAfterSeconds;
  const scanStallAfter = health?.completeScanWatermark?.stallAlertAfterSeconds ?? CONTRACT_DEADLINES.scanStallAlertAfterSeconds;

  if (!facts?.authorityId) breaches.push({ code: 'AUTHORITY_IDENTITY_MISSING', reason: 'health facts carry no fixed Comet authority identity' });
  if (observed.heartbeatAgeSeconds === null) breaches.push({ code: 'HEARTBEAT_FACT_MISSING', reason: 'facts carry no heartbeatAt' });
  else if (observed.heartbeatAgeSeconds > heartbeatAlertAfter) {
    breaches.push({ code: 'HEARTBEAT_AGE_ALERT', heartbeatAgeSeconds: observed.heartbeatAgeSeconds, alertAfterSeconds: heartbeatAlertAfter });
  }
  if (observed.scanWatermarkAgeSeconds === null) breaches.push({ code: 'SCAN_WATERMARK_FACT_MISSING', reason: 'facts carry no lastCompleteScanAt' });
  else if (observed.scanWatermarkAgeSeconds > scanStallAfter) {
    breaches.push({
      code: 'SCAN_WATERMARK_STALL',
      scanWatermarkAgeSeconds: observed.scanWatermarkAgeSeconds,
      stallAlertAfterSeconds: scanStallAfter,
      heartbeatIndependent: true,
    });
  }
  for (const [index, isolation] of (Array.isArray(facts?.unresolvedIsolations) ? facts.unresolvedIsolations : []).entries()) {
    if (isolation?.deadlineAt && ageSeconds(isolation.deadlineAt, nowMs) > 0) {
      breaches.push({ code: 'ISOLATION_DEADLINE_BREACH', at: `unresolvedIsolations[${index}]`, isolationId: isolation.isolationId ?? null });
    }
  }
  return { observed, breaches, healthy: breaches.length === 0 };
}

// Monitor.v1 评估：三段（检测/投递/升级）从真实时间戳分别计算，绝不合并。
function evaluateTimeline(timeline, alert, nowMs = Date.now()) {
  const violations = [];
  const deliveryTarget = alert?.segments?.delivery?.targetSeconds ?? CONTRACT_DEADLINES.deliveryTargetSeconds;
  const detectionLatest = alert?.segments?.detection?.latestDiscoverySeconds ?? CONTRACT_DEADLINES.detectionLatestSeconds;
  const ackTimeout = alert?.segments?.escalation?.onCallAckTimeoutSeconds ?? CONTRACT_DEADLINES.escalationAckTimeoutSeconds;

  const attempts = Array.isArray(timeline?.attempts) ? timeline.attempts : [];
  const delivered = attempts.filter((attempt) => attempt?.outcome === 'delivered');
  const verdictMs = Date.parse(timeline?.monitorVerdictAt ?? '');
  const onsetMs = Date.parse(timeline?.failureOnset ?? '');

  // 检测段。
  const detectionSeconds = Number.isFinite(verdictMs) && Number.isFinite(onsetMs)
    ? Math.round(((verdictMs - onsetMs) / 1000) * 1000) / 1000
    : null;
  if (detectionSeconds === null) violations.push({ code: 'TIMELINE_INVALID', at: 'failureOnset/monitorVerdictAt', reason: 'both timestamps are required ISO strings' });
  else if (detectionSeconds > detectionLatest) violations.push({ code: 'DETECTION_DEADLINE_BREACH', detectionSeconds, latestDiscoverySeconds: detectionLatest });

  // 投递段：以"存在 delivered 尝试"为准，未送达绝不能记已确认。
  const firstDelivered = delivered[0] ?? null;
  const deliverySeconds = firstDelivered && Number.isFinite(verdictMs)
    ? Math.round(((Date.parse(firstDelivered.at) - verdictMs) / 1000) * 1000) / 1000
    : null;
  const failover = {
    used: (attempts.some((attempt) => attempt?.channel === 'primary' && attempt?.outcome !== 'delivered')
      && delivered.some((attempt) => attempt?.channel === 'backup')) ?? false,
  };
  if (!firstDelivered) {
    violations.push({ code: 'ALERT_UNDELIVERED', reason: 'no attempt records outcome=delivered; an undelivered alert must not be recorded as acknowledged' });
    if (timeline?.delivered === true) violations.push({ code: 'UNDELIVERED_MARKED_DELIVERED', reason: 'timeline claims delivered=true without a delivered attempt' });
    if (timeline?.ackedAt) violations.push({ code: 'UNDELIVERED_MARKED_ACKED', reason: 'an undelivered alert must never be recorded as acknowledged' });
  } else if (deliverySeconds > deliveryTarget) {
    violations.push({ code: 'DELIVERY_TARGET_BREACH', deliverySeconds, targetSeconds: deliveryTarget });
  }

  // 升级段。
  let escalationSeconds = null;
  if (!timeline?.ackedAt) {
    if (!timeline?.escalatedAt) {
      violations.push({ code: 'ESCALATION_MISSING', reason: 'an unacknowledged alert must escalate to the backup on-call' });
    } else {
      escalationSeconds = firstDelivered
        ? Math.round(((Date.parse(timeline.escalatedAt) - Date.parse(firstDelivered.at)) / 1000) * 1000) / 1000
        : null;
    }
  } else if (timeline?.escalatedAt) {
    violations.push({ code: 'ESCALATION_WITH_ACK', reason: 'the alert was acknowledged; a recorded escalation after the ack needs an explicit explanation' });
  }

  // 未授权发送守卫：本任务从未持有通知发送授权。
  const authorized = alert?.deliveryAuthorizationRef === 'secret-ref:sdd-harness-pilot/monitor-alert'
    && timeline?.deliveryAuthorizedByRecord === true;
  if (timeline?.sentByThisTool === true && !authorized) {
    violations.push({ code: 'SEND_WITHOUT_AUTHORIZATION', reason: 'without delivery authorization this tool only prepares alerts and never sends' });
  }

  return {
    segments: {
      detectionSeconds,
      deliverySeconds,
      escalationSeconds,
    },
    failover,
    violations,
  };
}

function readInputJson(file, label) {
  if (!file) return { error: `${label} file is required` };
  try {
    return { value: readJson(file) };
  } catch (err) {
    return { error: `${label} unreadable (${displayPath(file)}): ${redactHostPaths(err.message)}` };
  }
}

function validateFactsShape(facts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return 'facts must be a JSON object';
  for (const field of ['authorityId', 'heartbeatAt', 'lastCompleteScanAt']) {
    if (!(field in facts)) return `facts must carry ${field}`;
  }
  if (facts.heartbeatAt !== null && Number.isNaN(Date.parse(facts.heartbeatAt))) return 'heartbeatAt must be an ISO timestamp or null';
  if (facts.lastCompleteScanAt !== null && Number.isNaN(Date.parse(facts.lastCompleteScanAt))) return 'lastCompleteScanAt must be an ISO timestamp or null';
  if (!Array.isArray(facts.unresolvedIsolations ?? [])) return 'unresolvedIsolations must be an array';
  return null;
}

// probe runner-process-failure：真实本地进程注入（spawn -> 心跳 -> SIGKILL -> 检测 -> 确认旧写者终止 -> 原实例身份重启）。
// 注入使用缩放时间尺度（毫秒级心跳/陈旧阈值）；生产契约时限照录并保持容量/故障实证 UNVERIFIED，绝不偷换。
const PROBE_HEARTBEAT_INTERVAL_MS = 50;
const PROBE_STALE_AFTER_MS = 400;
const PROBE_AUTHORITY_ID = 'monitor-probe-comet-authority-local';

function spawnHeartbeatChild(heartbeatFile) {
  const script = `
    const fs = require('node:fs');
    const write = () => { try { fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, at: Date.now(), authorityId: process.env.PROBE_AUTHORITY_ID })); } catch {} };
    write();
    const timer = setInterval(write, ${PROBE_HEARTBEAT_INTERVAL_MS});
    setTimeout(() => { clearInterval(timer); process.exit(0); }, 15000);
  `;
  const child = spawn(process.execPath, ['-e', script, heartbeatFile], {
    env: { ...process.env, PROBE_AUTHORITY_ID: PROBE_AUTHORITY_ID },
    stdio: 'ignore',
  });
  return child;
}

const exited = (child) => new Promise((resolve) => child.once('exit', resolve));

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, timeoutMs, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(intervalMs);
  }
  return condition();
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readHeartbeat(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function probeRunnerProcessFailure({ health, supervisor }) {
  const observation = {
    interface: 'MonitorInfra.v1',
    command: 'probe',
    case: 'runner-process-failure',
    executed: false,
    status: 'UNVERIFIED',
    capabilityScope: 'PROCESS_LEVEL',
    hostFailureCapabilityClaimed: false,
    injectionParameters: {
      heartbeatIntervalMs: PROBE_HEARTBEAT_INTERVAL_MS,
      staleAfterMs: PROBE_STALE_AFTER_MS,
      authorityId: PROBE_AUTHORITY_ID,
      note: 'scaled local timescales prove the mechanism; the production contract deadlines below stay frozen and their capacity/failure evidence remains UNVERIFIED',
    },
    contractDeadlines: {
      heartbeatIntervalSeconds: health?.heartbeat?.intervalSeconds ?? CONTRACT_DEADLINES.heartbeatIntervalSeconds,
      heartbeatAlertAfterSeconds: health?.heartbeat?.alertAfterAgeSeconds ?? CONTRACT_DEADLINES.heartbeatAlertAfterSeconds,
      detectionLatestSeconds: health?.detection?.latestDiscoverySeconds ?? CONTRACT_DEADLINES.detectionLatestSeconds,
    },
    observedSteps: [],
  };
  const step = (payload) => observation.observedSteps.push(payload);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i07-probe-'));
  const heartbeatFile = path.join(workDir, 'heartbeat.json');

  // 1) 原实例：真实子进程 + 心跳。
  const original = spawnHeartbeatChild(heartbeatFile);
  const heartbeatAppeared = await waitFor(() => readHeartbeat(heartbeatFile) !== null, 5000);
  if (!heartbeatAppeared) {
    original.kill('SIGKILL');
    step({ step: 'spawn-runner-instance', status: 'UNVERIFIED', error: 'heartbeat file never appeared' });
    observation.reason = 'the probe child never wrote a heartbeat; local injection could not start';
    print(observation);
    return EXIT_VERIFY;
  }
  const originalHeartbeat = readHeartbeat(heartbeatFile);
  step({
    step: 'spawn-runner-instance',
    status: 'VERIFIED',
    pid: original.pid,
    authorityId: originalHeartbeat.authorityId,
  });

  // 注入前健康读：心跳新鲜。
  const fresh = readHeartbeat(heartbeatFile);
  const freshAgeMs = Date.now() - fresh.at;
  step({ step: 'health-read-before-failure', status: freshAgeMs < PROBE_STALE_AFTER_MS ? 'VERIFIED' : 'UNVERIFIED', heartbeatAgeMs: freshAgeMs });

  // 2) 注入进程死亡（SIGKILL），等待终止确认（旧写者必须确认终止，才允许重启）。
  original.kill('SIGKILL');
  await exited(original);
  const oldWriterGone = await waitFor(() => !isAlive(original.pid), 5000);
  step({
    step: 'inject-process-death',
    status: oldWriterGone ? 'VERIFIED' : 'UNVERIFIED',
    method: 'SIGKILL',
    pid: original.pid,
    oldWriterConfirmedGone: oldWriterGone,
  });
  if (!oldWriterGone) {
    observation.reason = 'the injected process could not be confirmed terminated; the supervisor must not restart';
    print(observation);
    return EXIT_VERIFY;
  }

  // 3) 检测：心跳陈旧超阈值（缩放时间尺度下的 HEARTBEAT_AGE 机制）。
  const staleDetected = await waitFor(() => {
    const heartbeat = readHeartbeat(heartbeatFile);
    return heartbeat !== null && Date.now() - heartbeat.at > PROBE_STALE_AFTER_MS;
  }, 5000);
  const staleHeartbeat = readHeartbeat(heartbeatFile);
  const staleAgeMs = Date.now() - staleHeartbeat.at;
  step({
    step: 'detect-heartbeat-stale',
    status: staleDetected ? 'VERIFIED' : 'UNVERIFIED',
    heartbeatAgeMs: staleAgeMs,
    staleAfterMs: PROBE_STALE_AFTER_MS,
    code: 'HEARTBEAT_AGE_ALERT',
  });

  // 4) 监督决策：旧写者已确认终止 + 预算内 → 允许重启。
  const budget = supervisor?.restartBudget ?? {};
  const restartsUsed = 1;
  const withinBudget = restartsUsed <= (budget.maxRestarts ?? CONTRACT_DEADLINES.restartMax);

  // 5) 原实例身份重启：同一固定 authority，新进程；旧写者已终止 → 单一存活实例。
  const replacement = spawnHeartbeatChild(heartbeatFile);
  const replacementHeartbeat = await waitFor(() => {
    const heartbeat = readHeartbeat(heartbeatFile);
    return heartbeat !== null && heartbeat.pid === replacement.pid;
  }, 5000) ? readHeartbeat(heartbeatFile) : null;
  const singleLiveInstance = replacementHeartbeat !== null && !isAlive(original.pid) && isAlive(replacement.pid);
  const sameAuthorityId = replacementHeartbeat?.authorityId === originalHeartbeat.authorityId;
  step({
    step: 'supervised-restart',
    status: replacementHeartbeat && sameAuthorityId && singleLiveInstance ? 'VERIFIED' : 'UNVERIFIED',
    newPid: replacement.pid,
    oldPid: original.pid,
    sameAuthorityId,
    oldWriterConfirmedGone: true,
    singleLiveInstance,
    restartsUsed,
    restartBudget: { windowSeconds: budget.windowSeconds ?? CONTRACT_DEADLINES.restartWindowSeconds, maxRestarts: budget.maxRestarts ?? CONTRACT_DEADLINES.restartMax },
    withinBudget,
    businessRetryBySupervisor: false,
  });

  // 6) 清理：探针进程必须不留残留。
  replacement.kill('SIGKILL');
  await exited(replacement);
  fs.rmSync(workDir, { recursive: true, force: true });

  const stepsOk = observation.observedSteps.every((entry) => entry.status === 'VERIFIED');
  observation.executed = true;
  observation.status = stepsOk && withinBudget ? 'VERIFIED' : 'UNVERIFIED';
  observation.reason = stepsOk && withinBudget
    ? 'process-level fault injection verified: real child process, real SIGKILL, stale-heartbeat detection, old writer confirmed gone, same-authority restart, exactly one live instance'
    : 'one or more observed steps did not verify; see observedSteps';
  print(observation);
  return observation.status === 'VERIFIED' ? EXIT_PASS : EXIT_VERIFY;
}

function probeExternalHostDown({ docs, registry }) {
  const registration = docs['monitor-registration.example.json'];
  const faultDomain = docs['fault-domain-policy.json'];
  const registered = registration?.externalMonitor?.status === 'REGISTERED';
  print({
    interface: 'MonitorInfra.v1',
    command: 'probe',
    case: 'external-host-down',
    executed: false,
    status: 'UNVERIFIED',
    faultDomainSatisfied: false,
    mustNotPass: true,
    externalMonitorRegistered: registered,
    coHostedMonitorCannotClaimHostFailure: faultDomain?.rules?.coHostedMonitorMustNotPassHostFailure === true,
    reason: registered
      ? 'an external monitor is registered, but host-down injection and the 2-minute discovery evidence can only come from that external instance; a same-host probe can never produce it, so this stays UNVERIFIED'
      : 'no monitoring instance outside the Runner fault domain is registered (monitor-registration is an example with status UNREGISTERED); a co-hosted monitor dies with the host and must be marked fault-domain-NOT-satisfied — never PASS',
    requiredInputs: [
      'a monitoring instance outside the Runner fault domain, registered with instance/owner/network/persistence (monitor-registration)',
      'delivery authorization for the alert channels (monitor-alert ref; current task holds none)',
      'real external timestamps + loss onset + monitor verdict + delivery/escalation receipts, timed as separate segments',
    ],
    plannedSteps: [
      'stop the Runner host (not just the process) under change control',
      'the external monitor detects host loss within 2 minutes and alerts through the registered channels',
      'record detection and delivery as separate segments with external timestamps',
      'a co-hosted monitor result must be recorded as faultDomainSatisfied=false, never PASS',
    ],
    registry: displayPath(registry?.__file ?? 'infra/delivery/registry.json'),
  });
  return EXIT_VERIFY;
}

function probeScanWatermarkStall({ health, alert }) {
  const nowMs = Date.now();
  const facts = {
    authorityId: 'monitor-probe-comet-authority-scan',
    heartbeatAt: new Date(nowMs - 10_000).toISOString(),
    receiveCursorAt: new Date(nowMs - 10_000).toISOString(),
    lastCompleteScanAt: new Date(nowMs - 150_000).toISOString(),
    unresolvedIsolations: [],
  };
  const evaluation = evaluateHealth(facts, health, nowMs);
  const stall = evaluation.breaches.find((breach) => breach.code === 'SCAN_WATERMARK_STALL');
  const heartbeatAlert = evaluation.breaches.find((breach) => breach.code === 'HEARTBEAT_AGE_ALERT');
  const delivery = {
    mode: alert?.unauthorizedMode ?? 'PREPARE_ONLY',
    sentByThisTool: false,
    authorized: false,
    reason: 'no notification-send authorization exists in this task; the alert is prepared only and the independent alert system delivers it once authorized',
  };
  print({
    interface: 'MonitorInfra.v1',
    command: 'probe',
    case: 'scan-watermark-stall',
    executed: true,
    status: stall && !heartbeatAlert ? 'VERIFIED' : 'UNVERIFIED',
    scope: 'FACTS_FIXTURE_LOCAL',
    injection: 'facts fixture with a fresh heartbeat and a 150s-stale complete-scan watermark evaluated against the real clock',
    detection: stall
      ? { code: stall.code, scanWatermarkAgeSeconds: stall.scanWatermarkAgeSeconds, stallAlertAfterSeconds: stall.stallAlertAfterSeconds, heartbeatIndependent: true }
      : { code: 'NOT_DETECTED', breaches: evaluation.breaches },
    heartbeatSignal: heartbeatAlert ? { code: heartbeatAlert.code } : { code: 'OK', note: 'the fresh heartbeat correctly fired no heartbeat alert — the two signals are evaluated independently' },
    delivery,
    realCometReadback: {
      status: 'UNVERIFIED',
      reason: 'this probe evaluates a declared facts fixture; reading real Comet facts requires the registered external monitor and the monitor-health-read ref, which is not in the I01 catalog yet',
    },
    observed: evaluation.observed,
  });
  return stall && !heartbeatAlert ? EXIT_PASS : EXIT_VERIFY;
}

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');

  if (command === 'probe') {
    if (!opts.case) return failInput('probe requires --case');
    if (!['runner-process-failure', 'external-host-down', 'scan-watermark-stall'].includes(opts.case)) {
      return failInput(`unknown probe case: ${opts.case}`);
    }
    const dir = opts.dir ?? DEFAULT_DIR;
    const loaded = loadMonitorDocs(dir);
    if (loaded.error) return failInput(loaded.error);
    if (opts.case === 'runner-process-failure') return probeRunnerProcessFailure({ health: loaded.docs['health-contract.json'], supervisor: loaded.docs['supervisor-policy.json'] });
    if (opts.case === 'external-host-down') return probeExternalHostDown({ docs: loaded.docs, registryFile: opts.registry ?? DEFAULT_REGISTRY });
    return probeScanWatermarkStall({ health: loaded.docs['health-contract.json'], alert: loaded.docs['alert-policy.json'] });
  }

  // validate/health/alert/supervise：registry 与 refs 目录必须先可读（fail-closed）。
  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  const refsFile = opts.refs ?? DEFAULT_REFS;
  let registry;
  let refsDoc;
  try {
    registry = readJson(registryFile);
  } catch (err) {
    return failInput(`registry unreadable (${displayPath(registryFile)}): ${redactHostPaths(err.message)}`);
  }
  try {
    refsDoc = readJson(refsFile);
  } catch (err) {
    return failInput(`refs catalog unreadable (${displayPath(refsFile)}): ${redactHostPaths(err.message)}`);
  }
  const dir = opts.dir ?? DEFAULT_DIR;
  const loaded = loadMonitorDocs(dir);
  if (loaded.error) return failInput(loaded.error);
  const docs = loaded.docs;

  if (command === 'validate') {
    const outcome = validateMonitor({ docs, registry, refsDoc, dir });
    print({
      interface: 'MonitorInfra.v1',
      command: 'validate',
      registry: displayPath(registryFile),
      refs: displayPath(refsFile),
      dir: outcome.dir,
      ok: outcome.violations.length === 0,
      violations: outcome.violations,
      catalogGaps: outcome.catalogGaps,
      files: Object.fromEntries(MONITOR_FILES.map((name) => [name, { interface: docs[name]?.interface ?? null }])),
      deadlines: outcome.deadlines,
      preEnableGate: outcome.preEnableGate,
      deliveryAuthorization: outcome.deliveryAuthorization,
      faultDomain: outcome.faultDomain,
    });
    return outcome.violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  const health = docs['health-contract.json'];
  const alert = docs['alert-policy.json'];
  const supervisor = docs['supervisor-policy.json'];

  if (command === 'health') {
    const factsInput = readInputJson(opts.facts, 'facts');
    if (factsInput.error) return failInput(factsInput.error);
    const shapeError = validateFactsShape(factsInput.value);
    if (shapeError) return failInput(`invalid facts fixture: ${shapeError}`);
    const evaluation = evaluateHealth(factsInput.value, health);
    print({
      interface: 'Health.v1',
      command: 'health',
      readOnly: true,
      sourceOfTruth: 'existing-comet-facts',
      readModel: health?.readModel ?? [],
      healthy: evaluation.healthy,
      breaches: evaluation.breaches,
      observed: evaluation.observed,
      factsSource: displayPath(opts.facts),
      realCometReadback: {
        status: 'UNVERIFIED',
        reason: 'the facts file is a declared input; reading real Comet facts requires the registered external monitor and the monitor-health-read ref, which is not in the I01 catalog yet',
      },
    });
    return evaluation.healthy ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'alert') {
    const factsInput = readInputJson(opts.facts, 'facts');
    if (factsInput.error) return failInput(factsInput.error);
    const shapeError = validateFactsShape(factsInput.value);
    if (shapeError) return failInput(`invalid facts fixture: ${shapeError}`);
    const evaluation = evaluateHealth(factsInput.value, health);
    const nowMs = Date.now();

    if (opts.timeline) {
      const timelineInput = readInputJson(opts.timeline, 'timeline');
      if (timelineInput.error) return failInput(timelineInput.error);
      const timeline = timelineInput.value;
      const outcome = evaluateTimeline(timeline, alert);
      print({
        interface: 'AlertPolicy.v1',
        command: 'alert',
        mode: 'TIMELINE_EVALUATION',
        kind: timeline?.kind ?? null,
        segments: outcome.segments,
        failover: outcome.failover,
        violations: outcome.violations,
        delivery: {
          mode: alert?.unauthorizedMode ?? 'PREPARE_ONLY',
          authorized: timeline?.deliveryAuthorizedByRecord === true,
          sentByThisTool: timeline?.sentByThisTool === true,
        },
        escalationFreezeStatus: alert?.segments?.escalation?.freezeStatus ?? 'UNVERIFIED',
      });
      return outcome.violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
    }

    // 无 timeline：按事实准备告警（只 prepare，不发送）。
    const prepared = evaluation.breaches
      .filter((breach) => ['HEARTBEAT_AGE_ALERT', 'SCAN_WATERMARK_STALL'].includes(breach.code))
      .map((breach) => ({ kind: breach.code, detectedAt: new Date(nowMs).toISOString(), breach }));
    for (const isolation of factsInput.value.unresolvedIsolations ?? []) {
      if (isolation?.firstFailureAt) {
        prepared.push({ kind: 'ISOLATION_FAILURE_IMMEDIATE', isolationId: isolation.isolationId ?? null, detectedAt: new Date(nowMs).toISOString(), failureAt: isolation.firstFailureAt });
      }
    }
    const registration = docs['monitor-registration.example.json'];
    print({
      interface: 'AlertPolicy.v1',
      command: 'alert',
      mode: 'PREPARE',
      prepared,
      delivery: {
        mode: registration?.deliveryAuthorization?.alertDeliveryAuthorized === true ? 'AUTHORIZED_BY_RECORD' : (alert?.unauthorizedMode ?? 'PREPARE_ONLY'),
        authorized: registration?.deliveryAuthorization?.alertDeliveryAuthorized === true,
        sentByThisTool: false,
        reason: registration?.deliveryAuthorization?.basis ?? 'no delivery authorization recorded',
      },
      healthBreaches: evaluation.breaches,
    });
    return EXIT_PASS;
  }

  if (command === 'supervise') {
    const requestInput = readInputJson(opts.request, 'request');
    if (requestInput.error) return failInput(requestInput.error);
    const request = requestInput.value;
    if (typeof request?.action !== 'string') return failInput('request must carry an action string');
    const nowMs = Date.now();
    const budget = supervisor?.restartBudget ?? {};
    const windowSeconds = budget.windowSeconds ?? CONTRACT_DEADLINES.restartWindowSeconds;
    const maxRestarts = budget.maxRestarts ?? CONTRACT_DEADLINES.restartMax;

    if (!ALLOWED_SUPERVISOR_ACTIONS.includes(request.action)) {
      print({
        interface: 'Supervisor.v1',
        command: 'supervise',
        action: request.action,
        decision: 'REFUSED',
        executed: false,
        violations: [{
          code: 'FORBIDDEN_ACTION_REFUSED',
          action: request.action,
          reason: 'the supervisor is process-level restart of the original instance only; it never changes phases, creates Comet maintenance operations or writes Outline ACLs',
          forbiddenActions: supervisor?.forbiddenActions ?? FORBIDDEN_SUPERVISOR_ACTIONS,
        }],
      });
      return EXIT_VERIFY;
    }

    if (request.oldWriterAlive === true) {
      print({
        interface: 'Supervisor.v1',
        command: 'supervise',
        action: request.action,
        decision: 'REFUSED',
        executed: false,
        violations: [{
          code: 'OLD_WRITER_ALIVE_REFUSED',
          reason: 'no concurrent recovery writes while the old writer is unconfirmed-terminated; dual start is refused',
        }],
      });
      return EXIT_VERIFY;
    }
    if (request.storageOwnershipKnown === false) {
      print({
        interface: 'Supervisor.v1',
        command: 'supervise',
        action: request.action,
        decision: 'REFUSED',
        executed: false,
        violations: [{
          code: 'STORAGE_OWNERSHIP_UNKNOWN_REFUSED',
          reason: 'storage ownership is unknown; the supervisor must not start a second writer against unowned state',
        }],
      });
      return EXIT_VERIFY;
    }

    const restarts = (Array.isArray(request.restarts) ? request.restarts : [])
      .map((iso) => Date.parse(iso))
      .filter((ms) => Number.isFinite(ms));
    const windowRestarts = restarts.filter((ms) => nowMs - ms <= windowSeconds * 1000);
    const withinBudget = windowRestarts.length < maxRestarts;
    if (!withinBudget) {
      print({
        interface: 'Supervisor.v1',
        command: 'supervise',
        action: request.action,
        decision: 'STOP_AND_ESCALATE',
        executed: false,
        violations: [{
          code: 'RESTART_BUDGET_EXCEEDED',
          windowRestarts: windowRestarts.length,
          maxRestarts,
          windowSeconds,
          reason: 'the restart budget is exhausted; the supervisor stops restarting and escalates to the platform on-call',
        }],
        escalation: {
          mode: 'PREPARE_ONLY',
          sentByThisTool: false,
          target: 'platform-oncall',
          reason: 'escalation delivery stays prepared-only without notification-send authorization',
        },
        restartBudget: { windowSeconds, maxRestarts, withinBudget },
      });
      return EXIT_VERIFY;
    }

    print({
      interface: 'Supervisor.v1',
      command: 'supervise',
      action: request.action,
      decision: 'ALLOW',
      executed: false,
      reason: 'restart decision granted: the old writer is confirmed gone, storage ownership is known and the restart budget is not exhausted; the actual process restart belongs to the runtime context (probe runner-process-failure proves it at process level)',
      authorityIdentity: {
        mode: supervisor?.authorityBinding?.mode ?? 'SAME_FIXED_AUTHORITY_ONLY',
        authorityId: request.authorityId ?? null,
        stateCopy: 'FORBIDDEN',
        secondBusinessOwner: 'FORBIDDEN',
      },
      restartBudget: { windowSeconds, maxRestarts, withinBudget, windowRestarts: windowRestarts.length },
      cometSelfRecovery: {
        transactions: supervisor?.cometSelfRecovery?.transactions === true,
        compensation: supervisor?.cometSelfRecovery?.compensation === true,
        retry: supervisor?.cometSelfRecovery?.retry === true,
        supervisorBusinessRetry: false,
      },
      recoveryTargetSeconds: supervisor?.recoveryTargetSeconds ?? CONTRACT_DEADLINES.recoveryTargetSeconds,
      recoveryFreezeStatus: supervisor?.recoveryFreezeStatus ?? 'UNVERIFIED',
    });
    return EXIT_PASS;
  }

  return failInput(`unknown command: ${command}`);
}

process.exit(await main(process.argv.slice(2)));
