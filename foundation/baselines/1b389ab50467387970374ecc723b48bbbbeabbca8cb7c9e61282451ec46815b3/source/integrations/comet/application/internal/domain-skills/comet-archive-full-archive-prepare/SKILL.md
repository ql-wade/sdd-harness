---
name: comet-archive-full-archive-prepare
description: Managed domain-work skill for the classic-full full.archive.prepare step (archive preparation). Self-contained per-step replacement for the upstream comet-archive prepare work.
---

# comet-archive-full-archive-prepare (managed domain work)

Execute the domain work of the classic-full `full.archive.prepare` step for
THIS managed composition: prepare the archive of the finished change (target
branch, optional remote/PR base, and the delivery summary) and report the
real preparation result through the public SDK claim/report protocol.

## Managed boundary

- This skill serves exactly one workflow step:
  `comet-classic-full/full.archive.prepare`. Its id is per-step unique and is
  never shared with another step; the sibling deliver step runs on its own
  per-step skill (`comet-archive-full-archive-deliver`).
- It is authored content of this repository (P2_4-r2, repair R3/R6), not an
  upstream asset copy: the pristine upstream `comet-archive` skill assets link
  outside their dependency root and cannot be embedded in a compiled package,
  and the upstream ref is shared across the schema-different prepare and
  deliver steps, which can never compile as one skill id.
- This skill PREPARES only. The archive confirmation and delivery stay owned
  by the upstream classic domain (`full.archive.confirm`, `full.archive.deliver`,
  `full.archive.execute`); this skill never approves, executes the archive
  move, or bypasses a checkpoint.

## Output contract (the ORIGINAL full.archive.prepare schema, unchanged)

```json
{"type":"object","required":["targetBranch","summary"],"properties":{"targetBranch":{"type":"string","minLength":1},"remote":{"type":"string","minLength":1},"prBaseBranch":{"type":"string","minLength":1},"summary":{"type":"string","minLength":1}},"additionalProperties":false}
```

Report the real preparation result of the current action; never fabricate or
forward a stale preparation.
