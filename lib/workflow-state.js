import fs from 'fs-extra';

function yamlScalar(value) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return /^[a-zA-Z0-9._/-]+$/.test(text) ? text : JSON.stringify(text);
}

function currentStage(workflow) {
  return workflow.match(/^\s*current:\s*([a-zA-Z0-9_-]+)\s*$/m)?.[1];
}

export async function createWorkflowState({
  workflowPath,
  runId,
  stage,
  goal = '',
  requiredArtifacts = [],
}) {
  const workflow = [
    `run_id: ${yamlScalar(runId)}`,
    'run_status: active',
    'stage:',
    `  current: ${yamlScalar(stage)}`,
    '  history: []',
    `goal: ${yamlScalar(goal)}`,
    'artifacts:',
    `  required: ${JSON.stringify(requiredArtifacts)}`,
    '  produced: []',
    'gates:',
    '  status: pending',
    '',
  ].join('\n');
  await fs.writeFile(workflowPath, workflow);
}

export async function readWorkflowStage(workflowPath) {
  const workflow = await fs.readFile(workflowPath, 'utf8');
  return currentStage(workflow);
}

export async function setWorkflowGateStatus({ workflowPath, status }) {
  if (!['pending', 'passed', 'failed'].includes(status)) {
    throw new Error(`invalid workflow gate status: ${status}`);
  }
  let workflow = await fs.readFile(workflowPath, 'utf8');
  if (!/^\s*status:\s*\w+\s*$/m.test(workflow)) {
    throw new Error('workflow-frame.yaml has no gate status');
  }
  workflow = workflow.replace(/^(\s*status:)\s*\w+\s*$/m, `$1 ${status}`);
  await fs.writeFile(workflowPath, workflow);
}

export async function setWorkflowDeploymentMode({ workflowPath, mode }) {
  if (!['manual', 'automated', 'skip'].includes(mode)) {
    throw new Error(`invalid deployment mode: ${mode}`);
  }
  let workflow = await fs.readFile(workflowPath, 'utf8');
  if (/^deploy_mode:\s*\w+\s*$/m.test(workflow)) {
    workflow = workflow.replace(/^deploy_mode:\s*\w+\s*$/m, `deploy_mode: ${mode}`);
  } else if (/^run_status:.*$/m.test(workflow)) {
    workflow = workflow.replace(/^(run_status:.*)$/m, `$1\ndeploy_mode: ${mode}`);
  } else {
    workflow = `deploy_mode: ${mode}\n${workflow}`;
  }
  await fs.writeFile(workflowPath, workflow);
}

export async function completeWorkflowState({ workflowPath, stage = 'archive' }) {
  let workflow = await fs.readFile(workflowPath, 'utf8');
  const actual = currentStage(workflow);
  if (actual !== stage) {
    throw new Error(`cannot complete workflow at ${actual || 'unknown'}; expected ${stage}`);
  }
  if (/^run_status:\s*\w+\s*$/m.test(workflow)) {
    workflow = workflow.replace(/^run_status:\s*\w+\s*$/m, 'run_status: completed');
  } else {
    workflow = workflow.replace(/^(run_id:.*)$/m, '$1\nrun_status: completed');
  }
  workflow = workflow.replace(/^(\s*status:)\s*\w+\s*$/m, '$1 passed');
  await fs.writeFile(workflowPath, workflow);
}

function appendHistory(workflow, entryLines) {
  if (/^\s*history:\s*\[\]\s*$/m.test(workflow)) {
    return workflow.replace(
      /^\s*history:\s*\[\]\s*$/m,
      ['  history:', ...entryLines].join('\n'),
    );
  }

  const lines = workflow.split('\n');
  const historyIndex = lines.findIndex((line) => /^\s*history:\s*$/.test(line));
  if (historyIndex === -1) throw new Error('workflow-frame.yaml has no stage history');

  let insertAt = historyIndex + 1;
  while (insertAt < lines.length) {
    const line = lines[insertAt];
    if (line.trim() !== '' && !/^\s{4,}/.test(line)) break;
    insertAt++;
  }
  lines.splice(insertAt, 0, ...entryLines);
  return lines.join('\n');
}

/**
 * Advance the workflow state through the CLI control plane.
 * Callers must provide the stage they observed; stale writers are rejected.
 */
export async function advanceWorkflowState({
  workflowPath,
  from,
  to,
  reason = 'gate-passed',
  at = new Date().toISOString(),
  gateStatus = 'passed',
}) {
  let workflow = await fs.readFile(workflowPath, 'utf8');
  const actual = currentStage(workflow);
  if (actual !== from) {
    throw new Error(`workflow stage changed: expected ${from}, got ${actual || 'unknown'}`);
  }

  workflow = workflow.replace(
    /^(\s*current:)\s*[a-zA-Z0-9_-]+\s*$/m,
    `$1 ${to}`,
  );
  workflow = appendHistory(workflow, [
    `    - from: ${yamlScalar(from)}`,
    `      to: ${yamlScalar(to)}`,
    `      at: ${yamlScalar(at)}`,
    `      reason: ${yamlScalar(reason)}`,
  ]);
  workflow = workflow.replace(/^(\s*status:)\s*\w+\s*$/m, `$1 ${gateStatus}`);

  await fs.writeFile(workflowPath, workflow);
}

export async function rollbackWorkflowState({
  workflowPath,
  to,
  reason,
  stageOrder,
}) {
  const from = await readWorkflowStage(workflowPath);
  const fromIndex = stageOrder.indexOf(from);
  const toIndex = stageOrder.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) {
    throw new Error(`unknown rollback stage: ${from || 'unknown'} -> ${to}`);
  }
  if (toIndex >= fromIndex) {
    throw new Error(`rollback target must precede current stage: ${from} -> ${to}`);
  }
  await advanceWorkflowState({
    workflowPath,
    from,
    to,
    reason,
    gateStatus: 'pending',
  });
  return { from, to };
}
