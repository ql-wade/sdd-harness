import fs from 'fs-extra';
import path from 'node:path';
import { evaluateStageAdvanceGate } from './stage-gates.js';

export async function auditWorkflowRun({ projectDir, run }) {
  if (!projectDir) throw new Error('projectDir is required');
  if (!run) throw new Error('run is required');

  const runsDir = path.join(projectDir, '.sdd', 'runs', run);
  const workflowPath = path.join(runsDir, 'workflow-frame.yaml');
  if (!await fs.pathExists(workflowPath)) {
    throw new Error(`workflow-frame.yaml is missing for run ${run}`);
  }

  const workflow = await fs.readFile(workflowPath, 'utf8');
  const stage = workflow.match(/^\s*current:\s*(\w+)\s*$/m)?.[1];
  const declaredGateStatus = workflow.match(/^\s*status:\s*(\w+)\s*$/m)?.[1];
  if (!stage) throw new Error('workflow-frame.yaml has no current stage');

  const gate = await evaluateStageAdvanceGate({ stage, runsDir });
  return {
    schemaVersion: 1,
    projectDir,
    run,
    workflowPath,
    stage,
    declaredGateStatus: declaredGateStatus ?? null,
    pass: gate.pass,
    issues: gate.failures,
  };
}
