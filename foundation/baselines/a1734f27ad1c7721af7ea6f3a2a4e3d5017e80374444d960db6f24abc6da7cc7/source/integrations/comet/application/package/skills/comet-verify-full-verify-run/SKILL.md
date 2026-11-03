---
name: comet-verify-full-verify-run
description: Managed domain-work skill for the classic-full full.verify.run step (running verification). Self-contained per-step replacement for the upstream comet-verify execution skill.
---

# comet-verify-full-verify-run (managed domain work)

Execute the domain work of the classic-full `full.verify.run` step for THIS
managed composition: run the verification of the current candidate and report
the genuine verification outcome (ready, or fail with the reason and the
verification report) through the public SDK claim/report protocol.

## Managed boundary

- This skill serves exactly one workflow step:
  `comet-classic-full/full.verify.run`. Its id is per-step unique and is
  never shared with another step.
- It is authored content of this repository (P2_4-r2, repair R3/R6), not an
  upstream asset copy: the pristine upstream `comet-verify` skill assets link
  outside their dependency root and cannot be embedded in a compiled package.
- Machine checks, user approvals and archive steps stay owned by the upstream
  classic domain; this skill never approves, archives, or bypasses a
  checkpoint, and it never substitutes itself for the whitebox/closeout gates
  (those run as composition extensions after `full.verify.check.evidence`).

## Output contract (the ORIGINAL full.verify.run schema, unchanged)

```json
{"type":"object","required":["event"],"properties":{"event":{"enum":["verification-ready","verify-fail"]},"verificationReport":{"type":"string","minLength":1},"reason":{"type":"string","minLength":1}},"additionalProperties":false}
```

Report the real verification result of the current action; never fabricate,
reuse, or forward a stale result.
