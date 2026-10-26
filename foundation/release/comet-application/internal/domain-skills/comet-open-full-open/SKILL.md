---
name: comet-open-full-open
description: Managed domain-work skill for the classic-full full.open step (opening requirements for the delivery change). Self-contained per-step replacement for the upstream comet-open execution skill.
---

# comet-open-full-open (managed domain work)

Execute the domain work of the classic-full `full.open` step for THIS managed
composition: open the delivery change, confirm the goal, scope, non-goals and
acceptance criteria against the current change material, and report the real
opened-requirements result of the current action through the public SDK
claim/report protocol.

## Managed boundary

- This skill serves exactly one workflow step: `comet-classic-full/full.open`.
  Its id is per-step unique and is never shared with another step.
- It is authored content of this repository (P2_4-r2, repair R3/R6), not an
  upstream asset copy: the pristine upstream `comet-open` skill assets link
  outside their dependency root and cannot be embedded in a compiled package.
- Machine checks, user approvals and archive steps stay owned by the upstream
  classic domain. This skill never approves, archives, or bypasses a
  checkpoint, and it never acts as a second controller.
- The managed gates R/A/T/P/V/Kp run as composition extensions after
  `full.open.evidence`; this skill performs the open work those gates judge.

## Output contract

`full.open` carries NO preset output schema upstream: the adapter schema of
this skill (`{"type":"object"}`) is adopted by the workflow as the step
output contract. Report the genuine open-phase result of the current action;
never fabricate or forward a stale result.
