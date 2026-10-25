# Bounded replay

Use actual pinned Node24.15.0 first in PATH, pnpm10.18.3 and qualified existing Python>=3.12 (observed3.14). Preserve HOME. pnpm uses offline/ignore-scripts; no new downloads or lifecycle scripts. For npm use two distinct credential-free empty config paths and remove only the own temporary file in finally.

Select this private lock, never edit the shared lock:

```sh
node tools/comet/build.mjs --project . --lock worker-reports/P1_1-upstream-security-backports/rework-posix-backend/candidate-upstream.lock.json --archive .sdd/cache/runner-build/comet-source.tar.gz --json
COMET_SECURITY_LOCK=worker-reports/P1_1-upstream-security-backports/rework-posix-backend/candidate-upstream.lock.json node --test --test-reporter=tap test/comet-source-preparation.test.js test/comet-build.test.js test/comet-security-backports.test.js
node tools/comet/build.mjs --project . --lock worker-reports/P1_1-upstream-security-backports/rework-posix-backend/candidate-upstream.lock.json --check-generated --runtime-smoke --json
```

COMET_SECURITY_PYTHON may select the actually qualified existing Python; COMET_SECURITY_SOURCE must be unset for formal distribution checks. Python runtime errno tests run as part of the existing public Node test, exercising the current distribution, and can also run via pytest of the two exact scaffold test files under its work/eval directory. They use ordinary local fixtures and a recording local judge stub; no actual model/container execution is necessary or permitted for this replay.

Old aa RED and old build evidence are history, not this fingerprint's acceptance. Additional fixtures do not qualify Windows or actual Linux Runner protection.
