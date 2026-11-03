# Property-based authoring adapter

Reuse installed Hypothesis/fast-check/proptest/jqwik or the project's equivalent. If no library exists, explain the specific property and dependency decision; don't install one for a few examples without approval. Small deterministic domain enumeration can be sufficient when the finite domain is truly bounded and its scope is explicit.

Find an actual invariant, roundtrip, idempotence, monotonicity, ordering or independent reference oracle. Pure input/output rules without useful properties get ordinary examples; PBT is not mandatory.

Avoid tautology: asserting output equals a recomputation with the same algorithm can share the bug. Avoid vacuity: filters/assumptions rejecting nearly all inputs or contradictory assumptions can execute no meaningful case. Put constraints in generators, inspect run/discard counts, use strongest meaningful property and retain shrunk counterexamples with seed/repro command.

For encode/decode JSON, account for the actual supported type/domain (e.g. no nonfinite numbers if spec disallows them), nested/empty/boundary inputs, and equality semantics. A failing property can mean wrong test, generator problem or product defect; investigate against source requirement before changing implementation or weakening the property.

PBT is not UI E2E, load testing or coverage-guided binary fuzzing. Relevant concurrency/recovery/version constraints need explicit corresponding test seams and fault models.
