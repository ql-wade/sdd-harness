import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { invokeWorkflowApplicationSkill } from '@rpamis/comet/applications';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'project-root': { type: 'string' }, 'run-id': { type: 'string' },
    'input-file': { type: 'string' }, 'result-file': { type: 'string' },
    'initial-state-file': { type: 'string' },
    'workflow-id': { type: 'string' }, 'action-id': { type: 'string' },
    'session-id': { type: 'string' }, 'executor-id': { type: 'string' },
    capability: { type: 'string', multiple: true }, receipt: { type: 'string' },
    choice: { type: 'string' }, 'decision-id': { type: 'string' }
  } });
  const operation = positionals[0];
  const required = key => { if (!values[key]) throw new Error('缺少 --'+key); return values[key]; };
  const jsonFile = async key => JSON.parse(await readFile(required(key), 'utf8'));
  const receipt = () => JSON.parse(Buffer.from(required('receipt'), 'base64url').toString('utf8'));
  let request;
  if (operation === 'start') request = { operation, input: await jsonFile('input-file'), ...(values['run-id'] ? {runId:values['run-id']} : {}), ...(values['workflow-id'] ? {workflowId:values['workflow-id']} : {}), ...(values['initial-state-file'] ? {initialState:await jsonFile('initial-state-file')} : {}) };
  else if (['inspect', 'resume'].includes(operation)) request = { operation, ...(values['run-id'] ? {runId:values['run-id']} : {}) };
  else if (operation === 'next') request = { operation, runId: required('run-id') };
  else if (operation === 'claim') request = { operation, runId: required('run-id'), actionId: required('action-id'), executorId: values['executor-id'], sessionId: values['session-id'], capabilities: values.capability ?? [] };
  else if (operation === 'execute') request = { operation, runId: required('run-id'), actionId: required('action-id'), executorId: required('executor-id') };
  else if (operation === 'record-outcome') request = { operation, receipt: receipt(), result: await jsonFile('result-file') };
  else if (operation === 'resolve-wait') request = { operation, receipt: receipt(), choice: required('choice'), decisionId: required('decision-id') };
  else throw new Error('操作为 start、resume、inspect、next、claim、execute、record-outcome 或 resolve-wait');
  const result = await invokeWorkflowApplicationSkill({ file: fileURLToPath(new URL('../application.json', import.meta.url)), projectRoot: values['project-root'] ?? process.cwd(), request, context: { environment: Object.fromEntries(Object.entries(process.env).filter(([,value])=>typeof value==='string')) } });
  const script = fileURLToPath(import.meta.url);
  const base = [process.execPath, script, '--project-root', result.run.projectRoot];
  result.commands = {
    inspect: [...base, 'inspect', '--run-id', result.run.runId],
    resume: [...base, 'resume', '--run-id', result.run.runId],
    next: [...base, 'next', '--run-id', result.run.runId],
    actions: result.run.current.actions.map(action => ({
      actionId: action.id,
      ...(action.status === 'pending' && action.claimRequest ? { claim: [...base, 'claim', '--run-id', result.run.runId, '--action-id', action.id, '--executor-id', action.claimRequest.executorId, ...action.requiredCapabilities.flatMap(value => ['--capability',value])] } : {}),
      execute: (action.executeRequests ?? []).map(request => [...base, 'execute', '--run-id', result.run.runId, '--action-id', action.id, '--executor-id', request.executorId]),
      ...(result.receipts.actions.find(value => JSON.parse(Buffer.from(value,'base64url').toString('utf8')).actionId === action.id) ? { recordOutcome: [...base, 'record-outcome', '--receipt', result.receipts.actions.find(value => JSON.parse(Buffer.from(value,'base64url').toString('utf8')).actionId === action.id), '--result-file', '<实际结果JSON文件>'] } : {})
    })),
    waits: result.receipts.waits.map(value => ({ receipt: value, resolve: [...base, 'resolve-wait', '--receipt', value, '--choice', '<用户本次选择>', '--decision-id', '<用户决定来源>'] })),
    children: result.run.current.children.map(child => [...base, 'inspect', '--run-id', child.runId])
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log(JSON.stringify({ status: 'failed', error: { code: error.code ?? 'INVALID_REQUEST', message: error.message } }));
  process.exitCode = 1;
}
