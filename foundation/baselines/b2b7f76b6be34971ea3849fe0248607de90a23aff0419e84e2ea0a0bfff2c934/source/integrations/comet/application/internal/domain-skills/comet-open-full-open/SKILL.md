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
- The R gate follows native Open confirmation and `full.open.revalidate`. A and T follow
  `full.design.evidence`, P follows `full.build.plan.evidence`, and V and Kp
  follow `full.verify.check.evidence`. This skill performs the open work R judges.

## Output contract

After the current open work is actually complete, report a succeeded SDK
outcome whose output contains `{"event":"open-complete"}` and any genuine
results of that action. Comet then requests Open evidence; this event is not
R-gate acceptance or user approval. If a needed decision is unresolved, keep
the action blocked and request that decision instead of reporting completion.
