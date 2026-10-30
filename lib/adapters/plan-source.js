import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Parser } from 'commonmark';
import { parseContract } from '../../contracts/delivery/index.js';
import { taskDefinitionDigest } from '../delivery/baseline.js';

const CHANGE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const refuse = (reason) => ({ ok:false, reason, scope:'local-plan-readback', managedClosureEligible:false });

function readFileInside(root, relative) {
  const absolute = path.resolve(root, relative);
  const parent = path.dirname(absolute);
  if (fs.realpathSync(parent) !== parent || !parent.startsWith(`${root}${path.sep}`)) throw new Error('unsafe plan directory');
  if (typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('no-follow read unavailable');
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('plan source is not a file');
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function planDeclarations(text) {
  const tasks=[]; const walker=new Parser().parse(text).walker(); let event; let current=null;
  while ((event=walker.next())) {
    const node=event.node;
    if (!event.entering) continue;
    if (node.type==='heading' && node.level===3 && node.parent?.type==='document') {
      let title=''; for (let child=node.firstChild;child;child=child.next) if (child.type==='text' || child.type==='code') title+=child.literal;
      const match=/^Task ([A-Za-z0-9_-]+):/.exec(title);
      if (match) { current={id:match[1],dependencies:[]}; tasks.push(current); }
    }
    if (!current || node.type!=='strong' || node.parent?.type!=='paragraph' || node.parent.parent?.type!=='document'
      || node.firstChild?.type!=='text' || node.firstChild.literal!=='Dependencies:' || node.firstChild.next) continue;
    let value='';
    for (let child=node.next;child && child.type!=='softbreak' && child.type!=='linebreak';child=child.next) {
      if (!['text','code'].includes(child.type)) throw new Error('invalid dependency declaration');
      value+=child.literal;
    }
    value=value.trim();
    const deps=value==='none' ? [] : value.split(',').map((part)=>part.trim());
    if (deps.some((item)=>!/^[A-Za-z0-9_-]+$/.test(item)) || new Set(deps).size!==deps.length) throw new Error('invalid dependency declaration');
    current.dependencies.push(deps.sort());
  }
  return tasks;
}

function planReadDirectory(root, dir, change, run) {
  const archiveRoot=`${path.posix.dirname(dir)}/archive`;
  const matches=(name)=>name===change || (/^\d{4}-\d{2}-\d{2}-/.test(name) && name.slice(11)===change);
  const archiveAction=Array.isArray(run.actions) ? [...run.actions].reverse().find((item)=>item?.ref==='classic-archive' && ['running','succeeded'].includes(item.status)) : null;
  if (archiveAction?.status==='succeeded') {
    const recorded=archiveAction.outcome?.output?.archiveDirectory;
    if (typeof recorded!=='string' || path.posix.dirname(recorded)!==archiveRoot || !matches(path.posix.basename(recorded))) throw new Error('invalid archived plan location');
    return recorded;
  }
  if (fs.existsSync(path.join(root,dir))) return dir;
  if (!archiveAction) throw new Error('active plan is missing');
  const archivePath=path.join(root,archiveRoot);
  if (fs.realpathSync(archivePath)!==archivePath) throw new Error('unsafe archive directory');
  const names=fs.readdirSync(archivePath,{withFileTypes:true})
    .filter((item)=>item.isDirectory() && matches(item.name)).map((item)=>item.name);
  if (names.length!==1) throw new Error('archive location is ambiguous');
  return `${archiveRoot}/${names[0]}`;
}

export function readPlanSource({ projectRoot, run, planBundle } = {}) {
  const change=run?.input?.change; const dir=run?.input?.changeDir;
  if (typeof run?.runId!=='string' || !run.runId.trim() || typeof change!=='string' || !CHANGE.test(change)
    || ![`openspec/changes/${change}`,`docs/openspec/changes/${change}`].includes(dir)) return refuse('invalid current Run or Change');
  const parsed=parseContract('SDD.Delivery.PlanBundle',planBundle);
  if (!parsed.ok || planBundle.change!==change || planBundle.schedulerOwner!=='comet-classic') return refuse('plan bundle does not belong to the current Change and controller');
  try {
    const root=fs.realpathSync(projectRoot);
    const tasksRef=`${dir}/tasks.md`; const dagRef=`${dir}/task-dag.json`;
    const sourceDir=planReadDirectory(root,dir,change,run);
    const taskBytes=readFileInside(root,`${sourceDir}/tasks.md`); const dagBytes=readFileInside(root,`${sourceDir}/task-dag.json`);
    const taskText=new TextDecoder('utf-8',{fatal:true}).decode(taskBytes);
    const dag=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(dagBytes));
    if (dag?.plan_path!=='tasks.md' || !Array.isArray(dag.tasks)) return refuse('DAG does not bind tasks.md');
    const declarations=planDeclarations(taskText);
    const byId=new Map();
    for (const task of dag.tasks) {
      if (!task || typeof task.id!=='string' || byId.has(task.id) || !Array.isArray(task.depends_on)
        || task.depends_on.some((item)=>typeof item!=='string') || new Set(task.depends_on).size!==task.depends_on.length) return refuse('invalid DAG task definitions');
      byId.set(task.id,[...task.depends_on].sort());
    }
    const planned=new Set();
    for (const task of planBundle.tasks) {
      if (planned.has(task.id) || !byId.has(task.id)) return refuse('plan tasks differ from DAG');
      const deps=task.dependsOn ?? [];
      if (new Set(deps).size!==deps.length || JSON.stringify([...deps].sort())!==JSON.stringify(byId.get(task.id))) return refuse('plan dependencies differ from DAG');
      planned.add(task.id);
    }
    if (planned.size!==byId.size || declarations.length!==byId.size || new Set(declarations.map((task)=>task.id)).size!==declarations.length
      || declarations.some((task)=>!byId.has(task.id))) return refuse('tasks.md and DAG task identities differ');
    if (declarations.some((task)=>task.dependencies.length!==1
      || JSON.stringify(task.dependencies[0])!==JSON.stringify(byId.get(task.id)))) return refuse('tasks.md dependencies differ from DAG');
    return { ok:true, scope:'local-plan-readback', managedClosureEligible:false, runId:run.runId, change,
      planSources:{ tasks:{ref:tasksRef,digest:taskDefinitionDigest(taskText)},
        dag:{ref:dagRef,digest:crypto.createHash('sha256').update(dagBytes).digest('hex')} } };
  } catch { return refuse('plan source is missing, invalid, or outside the project'); }
}

export function verifyPlanSource({ projectRoot, run, inputs } = {}) {
  const observed=readPlanSource({projectRoot,run,planBundle:inputs?.planBundle});
  if (!observed.ok) return false;
  return ['tasks','dag'].every((name)=>inputs?.planSources?.[name]?.ref===observed.planSources[name].ref
    && inputs.planSources[name].digest===observed.planSources[name].digest);
}
