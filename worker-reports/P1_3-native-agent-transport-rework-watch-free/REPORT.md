# P1_3 watch-free close fixture

Base `62011e03b8702af991d4b1c40eb75801cadfdb96`, same original branch. Only the newly added close-test fixture changes; harness retains exact SHA `6e4439c298e5d269a38bc269140eb4076f2e27ea4c78acc639bed71d83c0b8eb`. Default main, binding fixture, earlier driver tests and all post-barrier behavioral assertions remain byte-identical. No product API or validation changes.

Independent R2 behavior was **SETUP_BLOCKED:0 pass/5 fail**, because ordinary fs.watch also hit EMFILE. Its report/raw hashes are preserved separately; author green never replaces that failed independent attempt. This revision removes both watches without changing any host limit or swallowing/skipping the error.

The peer holds a bounded condition timer, writes readiness only on actual stdin EOF, and exits normally only after the test writes its explicit release marker. The test yields while checking public protocolComplete plus the EOF marker, with closed=false and a deadline. No elapsed duration proves ordering: real observed conditions establish turn/completed -> mutation/exception -> release -> close. Polling merely checks a condition; timeout-restored still waits for the original transport timeout before release. Missing markers fail, and the peer's 10-second safety bound exits91 rather than faking success.

## Author execution

Fixed Node24.15.0, six offline guards calibrated97. New fixture against original e361 in a private mirror gives a meaningful negative control: **5 tests/2 pass/3 fail,exit1**; epoch/throw cases incorrectly return OBSERVED_TERMINAL, while stable/timeout controls pass. No SETUP/EMFILE failure. Current unchanged product plus new fixture: **5/5**, then necessary driver regression **81/81**, both exit0, skip/cancel0, external guard calls0, inputs unchanged. No retry-to-green. Actual source bytes for the negative control are retained; only that own temporary mirror and per-test peers/files are cleaned.

```text
<node24.15> --test --test-reporter=tap '--test-name-pattern=native close rechecks' test/comet-driver.test.js
<node24.15> --test --test-reporter=tap test/comet-driver.test.js
```

UTC/argv/cwd/PATH/input/exit and raw/display hashes are in runs.json and evidence. Raw root `.local/P1_3-native-agent-transport-rework-watch-free/`; display normalization is declared, raw untouched. Original e361/62011, P2 RED, prior75/1 and R2 resource-failure evidence are retained. Related52 was **not rerun**, because its production sources/fixture have unchanged exact62011 bytes; its prior observation stays historical. TestPack validation is structure only.

This author construction candidate still needs independent behavior review and Root replay. No actual CLI/model/auth/MCP/Docker/API/network/download/global access occurred. Protected provider, SourceReader, worker/I02/canonical artifact return, real no-bypass/OS/role chain and whole P1_3 remain UNVERIFIED. Comet remains the sole acceptance authority. No plan, lock, phase, grant or progress writes.
