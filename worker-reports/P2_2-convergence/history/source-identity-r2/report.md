# P2_2 protected source identity correction

Construction-only correction after review of `5fdfe7a2d26dbb37378e488c1019f85ea0f7b8af`; neither this component nor its protocol fixtures establish actual Runner/OS/key qualification or whole-task acceptance.

The new behavioral RED uses two actual independent Node22 assertion subprocesses with distinct execution/launch/collection/envelope identities. Their recorder emits deterministic JSON summaries parsed from each native TAP run and deterministic exit-code/summary results; full native TAP remains bound into each method trace. Report/result bytes are equal without random data or process IDs added to their content. The old Gate incorrectly reported DUPLICATE_EXECUTION_EVIDENCE and declared2/observed1. Final logs record real PIDs85977/85993 and equal report/result digests.

The minimal production correction removes raw report/result digests as standalone execution identities. Gate deduplicates authenticated execution and launch identity scoped to registered source/Runner/Run, plus exact collection and envelope identities. Content equality does not establish execution equality. Existing sourceVerifier, raw-byte hashes, HMAC binding, current admission and exact accepted-entry readback remain unchanged; authenticating an old report rewrapped under a fabricated launch belongs to the protected source. Gate adds no dispatcher, state or side effect.

The prior hostile fixture had a source port deliberately authenticate an old report under a fresh execution, then expected Gate to diagnose this from equal report bytes. That incorrect expectation and replayReport fixture injection were removed. Tests still reject one entry repeated five times and separate collections claiming one execution. Prior 1/4/5, missing-case, wrong-command and repeated-coverage denominator regressions stay. New valid multi-case/multi-check entries with equal content pass, while coverage declarations still do not multiply measured executions.

Actual commands use Node22.13.1 and explicit --test --test-reporter=tap. Final P2_2 evidence/Gate/original2_2:60/60 exit0. Full P2_1 baseline/TestContract/original2_1:61/61 exit0. Process command, cwd placeholder, timestamps, return codes and original/normalized SHA256 are in attached records. No unrelated whole-repository rerun. No original case2_2, schemas, adapter, locks, Comet, F10 scope contract, root progress or main checkout modifications.

Original643 report tree, original53 manifest, denominator-r1 history13 manifest and all previous raw logs remain unchanged. CURRENT.json alone advances the review pointer; this independent history has its own input/ownership/evidence manifests. Root retains independent review/acceptance and Comet retains sole runtime control. P2_2 overall remains unverified pending real I02/P1_3 qualification.

Root整合仅规范化分发副本的行尾空白/多余末尾空行；原始worker b69aa69提交及ignored审计字节不变。分发副本不冒称raw stdout，双摘要/规则见root-whitespace-normalization.json；代码、测试输入和行为结果未改。
