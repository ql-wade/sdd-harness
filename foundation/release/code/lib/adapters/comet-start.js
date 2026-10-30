import path from 'node:path';

const CHANGE_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// The managed canonical initialState of a classic-full composition Run
// (P2_4-r3 blocker B-①). Upstream contract, verified from the pristine
// 0.5.0 source: the run state schema REQUIRES every field below, and
// full.build.configure is UNPASSABLE while state.isolation is null
// (buildConfigurationValidator refuses a null-workspace proposal, the step
// output schema forbids null isolation, the confirm transition throws on
// null, and the classic factory workflow carries no definition-side
// initialState through the official compile seam). Every managed run must
// therefore START with isolation set — the managed default is 'current'
// (same workspace), mirroring the upstream 0.5.0 pristine tests. The field
// set matches the live pilot runs (r2/r3) that reached configure/confirm
// once isolation was supplied.
export const MANAGED_COMPOSITION_INITIAL_STATE = Object.freeze({
  workflow: 'full',
  language: 'en',
  phase: 'open',
  contextCompression: 'off',
  buildMode: null,
  buildPause: null,
  subagentDispatch: null,
  tddMode: null,
  reviewMode: 'standard',
  isolation: 'current',
  boundBranch: null,
  verifyMode: null,
  autoTransition: true,
  baseRef: null,
  designDoc: null,
  plan: null,
  verifyResult: 'pending',
  verifyFailures: 0,
  checkEpoch: 0,
  verificationReport: null,
  branchStatus: 'pending',
  createdAt: null,
  verifiedAt: null,
  archiveConfirmation: null,
  archived: false,
  directOverride: null,
  handoffContext: null,
  handoffHash: null,
  classicProfile: 'full',
  classicMigration: 1,
});

// The start request for a classic composition Run (assertBuiltInChangeInput):
// runId MUST equal the change name, changeDir is project-relative POSIX whose
// basename is the change, and input.change must match when present.
//
// B-① (P2_4-r3): the initialState is CONSTRUCTED here — never caller
// supplied. Callers may refine artifact language and the nullable provenance
// fields (baseRef: a 40-64 hex commit; createdAt: YYYY-MM-DD).
export function classicCompositionStartRequest({
  change, changeDir, workflowId, workflowVersion, baseRef, createdAt, language, initialState,
}) {
  if (typeof change !== 'string' || !CHANGE_NAME_RE.test(change)) {
    const error = new Error('classicCompositionStartRequest: a canonical kebab-case change name is required');
    error.code = 'REQUEST_CHANGE_INVALID';
    throw error;
  }
  if (typeof changeDir !== 'string' || changeDir.startsWith('/') || changeDir.split('/').includes('..')
    || path.posix.basename(changeDir.replaceAll('\\', '/')) !== change
    || (changeDir !== `openspec/changes/${change}` && changeDir !== `docs/openspec/changes/${change}`)) {
    const error = new Error(`classicCompositionStartRequest: changeDir must be the change's own directory under openspec/changes or docs/openspec/changes (got ${String(changeDir)})`);
    error.code = 'REQUEST_CHANGE_DIR_INVALID';
    throw error;
  }
  if (typeof workflowId !== 'string' || workflowId !== 'comet-classic-full'
    || typeof workflowVersion !== 'string' || !workflowVersion.trim()) {
    const error = new Error('classicCompositionStartRequest: the classic-full composition workflow { id, version } is required (the pristine workflows declare version "1")');
    error.code = 'REQUEST_WORKFLOW_INVALID';
    throw error;
  }
  if (initialState !== undefined) {
    // Fail closed: the managed start state is derived, not negotiated — a
    // caller-supplied state (e.g. isolation:null) reproduces blocker B-①.
    const error = new Error('classicCompositionStartRequest: the initialState is constructed by this builder (isolation must be current); caller-supplied start state is refused');
    error.code = 'START_STATE_CONSTRUCTED';
    throw error;
  }
  const refinedBaseRef = baseRef === undefined || baseRef === null ? null : baseRef;
  const refinedCreatedAt = createdAt === undefined || createdAt === null ? null : createdAt;
  const refinedLanguage = language === undefined ? 'en' : language;
  if (!['en','zh-CN'].includes(refinedLanguage)) {
    const error = new Error('classicCompositionStartRequest: unsupported artifact language');
    error.code = 'REQUEST_LANGUAGE_INVALID';
    throw error;
  }
  if (refinedBaseRef !== null && (typeof refinedBaseRef !== 'string' || !/^[0-9a-f]{40,64}$/u.test(refinedBaseRef))) {
    const error = new Error('classicCompositionStartRequest: baseRef must be a 40-64 hex commit digest or null');
    error.code = 'REQUEST_STATE_FIELD_INVALID';
    throw error;
  }
  if (refinedCreatedAt !== null && (typeof refinedCreatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(refinedCreatedAt))) {
    const error = new Error('classicCompositionStartRequest: createdAt must be YYYY-MM-DD or null');
    error.code = 'REQUEST_STATE_FIELD_INVALID';
    throw error;
  }
  const managedInitialState = Object.freeze({
    ...structuredClone(MANAGED_COMPOSITION_INITIAL_STATE),
    language: refinedLanguage,
    baseRef: refinedBaseRef,
    createdAt: refinedCreatedAt,
  });
  return Object.freeze({
    operation: 'start',
    runId: change,
    workflow: Object.freeze({ id: workflowId, version: workflowVersion }),
    input: Object.freeze({ change, changeDir }),
    initialState: managedInitialState,
  });
}
