---
name: comet-archive-full-archive-deliver
description: Managed domain-work skill for the classic-full full.archive.deliver step (archive delivery action). Self-contained per-step replacement for the upstream comet-archive deliver work.
---

# comet-archive-full-archive-deliver (managed domain work)

Execute the domain work of the classic-full `full.archive.deliver` step for
THIS managed composition: perform the confirmed archive delivery action
(local, push, or PR) with the real commit identity and report the genuine
delivery outcome through the public SDK claim/report protocol.

## Managed boundary

- This skill serves exactly one workflow step:
  `comet-classic-full/full.archive.deliver`. Its id is per-step unique and is
  never shared with another step; the sibling prepare step runs on its own
  per-step skill (`comet-archive-full-archive-prepare`).
- It is authored content of this repository (P2_4-r2, repair R3/R6), not an
  upstream asset copy: the pristine upstream `comet-archive` skill assets link
  outside their dependency root and cannot be embedded in a compiled package,
  and the upstream ref is shared across the schema-different prepare and
  deliver steps, which can never compile as one skill id.
- This skill delivers what the upstream archive confirmation already
  approved. It never acts before `full.archive.confirm`, never chooses a
  different action or branch than the approved proposal, and never bypasses
  a checkpoint.

## Output contract (the ORIGINAL full.archive.deliver schema, unchanged)

```json
{"type":"object","required":["action","targetBranch","commit"],"properties":{"action":{"enum":["local","push","pr"]},"targetBranch":{"type":"string","minLength":1},"commit":{"type":"string","pattern":"^[0-9a-f]{40}(?:[0-9a-f]{24})?$"},"remote":{"type":"string","minLength":1},"prUrl":{"type":"string","minLength":1}},"additionalProperties":false}
```

Report the real delivery result of the current action, with the actual commit
hash; never fabricate or forward a stale delivery.
