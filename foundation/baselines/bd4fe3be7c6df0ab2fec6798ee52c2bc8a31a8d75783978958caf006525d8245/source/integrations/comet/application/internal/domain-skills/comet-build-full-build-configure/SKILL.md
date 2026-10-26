---
name: comet-build-full-build-configure
description: Managed domain-work skill for the classic-full full.build.configure step (build mode joint decision). Self-contained per-step replacement for the upstream comet-build configure work.
---

# comet-build-full-build-configure (managed domain work)

Execute the domain work of the classic-full `full.build.configure` step for
THIS managed composition: perform the build-mode joint decision (build mode,
TDD mode, review mode, working isolation and the optional branch binding)
for the current change and report the real decision through the public SDK
claim/report protocol.

## Managed boundary

- This skill serves exactly one workflow step:
  `comet-classic-full/full.build.configure`. Its id is per-step unique and is
  never shared with another step.
- It is authored content of this repository (P2_4-r2, repair R3/R6). The
  upstream `comet-build` assets are shared across schema-different build
  steps and are not embeddable, so this step runs on a managed per-step
  domain-work skill.
- Boundary decision (repair R5): the packaged `ponytail` process-weight
  method is NOT bound to this step anymore. The P1_6 snapshot of that skill
  links to benchmark/example/INSTALL files that are absent from the snapshot,
  so it cannot be embedded in a compiled package; removing it does not weaken
  the six managed gates (R/A/T/P/V/Kp stay composition extensions). The
  build-configure semantics revert to the domain contract below.
- Machine checks, user approvals and archive steps stay owned by the upstream
  classic domain; this skill never approves, archives, or bypasses a
  checkpoint.

## Output contract (the ORIGINAL full.build.configure schema, unchanged)

```json
{"type":"object","required":["buildMode","tddMode","reviewMode","isolation"],"properties":{"buildMode":{"enum":["subagent-driven-development","executing-plans","direct","autonomous"]},"tddMode":{"enum":["tdd","direct"]},"reviewMode":{"enum":["off","standard","thorough"]},"isolation":{"enum":["current","branch","worktree"]},"boundBranch":{"type":["string","null"]},"subagentDispatch":{"enum":["confirmed",null]},"directOverride":{"type":"boolean"}},"additionalProperties":false}
```

Report the real joint decision of the current action; never fabricate or
forward a stale decision.
