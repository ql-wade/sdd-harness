Use actual pinned Node24.15.0 and existing Python3.14, with external model/container/platform CLI tripwires first in PATH; preserve HOME. All writes are disposable TARGET_ROOT fixtures; no resource credentials or new dependency is required.

```sh
node --test --test-reporter=tap test/adapter-quoting.test.js test/delivery-hook-assembly.test.js
node --test --test-reporter=tap --test-name-pattern='same event/command duplicate|duplicate user entries' test/foundation-distribution.test.js
```

Current results19/19 and2/2. The original two closure/oldRun failures remain unresolved for Root's final source/release regeneration and F04/B09 readback. Do not skip them or regenerate a shared lock from this worker.
