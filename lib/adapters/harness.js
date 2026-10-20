// Managed driver layering for host adapters (task P1_3, work package 1.3.a;
// F05 plus the Runner.Dispatch.v1 binding). A driver is either
// 'managed-write' — a verified executor that performs real writes through its
// host's managed surfaces — or 'read-only' — an observer limited to status
// reads, artifact reads and probes. The frozen kind marker is the machine
// boundary: a read-only driver physically carries no execute surface, and
// requireWriteDriver refuses observers for product or test writes instead of
// letting a prompt driver stand in for the verified managed write executor.
//
// The runner composes a driver with the P2_2 trusted launcher
// (lib/delivery/evidence.js createLaunchAuthority, the local
// Runner.Dispatch.v1): dispatch binds run/gate/input/policy/attempt/epoch/
// execution under an HMAC integrity digest, admission reuses admitEvidence,
// and the runner interface has no phase write surface at all — it stores no
// phase, refuses phase fields in dispatch bindings, and never writes control
// state (Comet.Run.managedDelivery.v1: no second currentPhase; the phase
// belongs to the single Runtime state).
import { admitEvidence } from '../delivery/evidence.js';

export const DRIVER_KINDS = ['managed-write', 'read-only'];

const PHASE_FIELDS = ['phase', 'currentPhase', 'current_phase'];

export class HarnessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}

export function defineDriver({ id, kind, observe, execute }) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new HarnessError('DRIVER_ID_INVALID', 'defineDriver requires a non-empty driver id');
  }
  if (!DRIVER_KINDS.includes(kind)) {
    throw new HarnessError('DRIVER_KIND_INVALID', `driver ${id}: kind must be one of ${DRIVER_KINDS.join(', ')}; observed ${String(kind)}`);
  }
  if (kind === 'read-only') {
    if (execute !== undefined) {
      throw new HarnessError('DRIVER_SURFACE_REFUSED', `read-only driver ${id} cannot carry an execute surface; writes belong to the verified managed write executor (F05)`);
    }
    return Object.freeze({ id, kind, observe: observe ?? null, execute: undefined });
  }
  if (typeof execute !== 'function') {
    throw new HarnessError('DRIVER_SURFACE_REQUIRED', `managed-write driver ${id} must provide its managed execute surface; an unverified writer must not be registered as managed`);
  }
  return Object.freeze({ id, kind, observe: observe ?? null, execute });
}

export function requireWriteDriver(driver, purpose) {
  if (!driver || driver.kind !== 'managed-write') {
    throw new HarnessError(
      'DRIVER_WRITE_REFUSED',
      `driver ${driver?.id ?? '<none>'} is a ${driver?.kind ?? 'driverless'} observer; ${purpose ?? 'this write'} requires the verified managed write executor (F05)`,
    );
  }
  return driver;
}

export function createRunner({ authority, driver }) {
  requireWriteDriver(driver, 'a dispatching runner');
  if (!authority || typeof authority.issueDispatch !== 'function' || typeof authority.verifyDispatch !== 'function') {
    throw new HarnessError('RUNNER_AUTHORITY_INVALID', 'createRunner requires a trusted launch authority that issues and verifies dispatch records (Runner.Dispatch.v1)');
  }
  return Object.freeze({
    dispatch(binding) {
      if (binding && typeof binding === 'object') {
        for (const field of PHASE_FIELDS) {
          if (binding[field] !== undefined) {
            throw new HarnessError('RUNNER_PHASE_FIELD_REFUSED', `dispatch binding carries ${field}; the runner stores no phase and control state belongs to the single Runtime — there is no phase write surface on the runner`);
          }
        }
      }
      return authority.issueDispatch(binding);
    },
    verify(record) {
      return authority.verifyDispatch(record);
    },
    admit(args) {
      // The runner's own launch authority is the only registered source;
      // callers cannot substitute another authority (or none) at admission.
      return admitEvidence({ authority, ...args });
    },
  });
}
