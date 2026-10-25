# Scoped replay

Use exact Node24.15.0, pnpm10.18.3 and qualified existing Python>=3.12 (this run used3.14). Keep HOME unchanged. Set user/global npm configs to credential-free empty sources; npm needs two distinct paths, while pnpm accepts both/dev/null. No actual model/Docker/service execution is required.

The private lock is copied as `candidate-upstream.lock.json`, byte-identical to the actual tested lock. It appends only0004 to the original six patches. It is NOT a production pin or joint5ec artifact.

From the repository root:

```bash
node tools/comet/build.mjs --project . --lock worker-reports/P1_1-upstream-security-backports/candidate-upstream.lock.json --archive .sdd/cache/runner-build/comet-source.tar.gz --json
COMET_SECURITY_LOCK=worker-reports/P1_1-upstream-security-backports/candidate-upstream.lock.json node --test --test-reporter=tap test/comet-source-preparation.test.js test/comet-build.test.js test/comet-security-backports.test.js
node tools/comet/build.mjs --project . --lock worker-reports/P1_1-upstream-security-backports/candidate-upstream.lock.json --check-generated --runtime-smoke --json
```

The commands require the exact offline cache/approved Vite tar/package identity. They must not fetch other packages or run install lifecycle. `COMET_SECURITY_PYTHON` may select the actually qualified Python executable; never substitute a version string. `COMET_SECURITY_SOURCE` is only the private pre-build RED mechanism seam and was **unset** for formal distribution tests. No source override qualifies a production distribution.

The two original Hook-related suites run unchanged in count, using the actual built work directory:

```bash
node node_modules/vitest/vitest.mjs run test/domains/skill/platform-inspect.test.ts test/domains/skill/project-hook-projection.test.ts
```

Exact actual argv/cwd/UTC/exit/SHA receipts and all original stdout/stderr are referenced by `raw-display-index.json`. This is an author handoff; actual role/method/OS/platform/knowledge qualification and Root's final current fingerprint/lock assembly are separate.
