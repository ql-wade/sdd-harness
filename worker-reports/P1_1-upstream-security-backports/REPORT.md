# P1_1 upstream security backports — scoped construction candidate

Status: **candidate for independent review**, not whole P1_1, production/host/role/OS or business acceptance. Accepted business scenarios: **0**. Original 39 nodes/69 packages/130 checks/104 scenarios and current129/103/F10 disposition are unchanged. Root owns final shared lock, joint assembly and acceptance.

## Delivered changes

- New standalone `0004-upstream-security-backports.patch`, based on original c90/0.4.5 plus the exact original six patches. No 0.5 Runtime/application or wholesale 0.5 lock is copied; methods0001 and business0002/0003 remain unchanged.
- Hook command strings use the upstream encoded argv constructor and exact managed-command recognition. Public regressions run two real harmless programs at literal/expanded existing paths and verify literal argv, then actual temporary install/update/uninstall, mixed user handlers/metadata/events and appended-user-command refusal. Existing99 inspection/projection obligations remain; fixture mutations decode/re-encode only so their original negative assertions actually mutate encoded arguments.
- Eval ports the upstream regular-file/workspace descriptor reader, POSIX no-follow and Windows reparse backend, plus collection/save/preflight/error propagation and pure security tests. Missing safe backend stops before workload/judge/report overwrite; temporary ordinary external markers are not collected or saved. Model/container execution is blocked by test tripwires. Existing hidden-file policy is retained; no unrelated 0.5 conftest changes.
- Vite pin is exactly8.2.4; Comet remains0.4.5. The pnpm lock differs only by Vite references and SRI. Original dependency versions are unchanged.
- Root separately authorized a real verifier defect found during this run: `tools/comet/build.mjs --json` formerly returned process0 even when its verification JSON said FAIL. A real assertion-failure CLI RED proves it; minimal mapping now preserves JSON and returns PASS0 / invalid input1 / verificationFAIL2. This repository-helper fix is separate from the upstream0004 payload.

## Exact candidate

Patch SHA: `2b2b390de4cf0e1c0b53ff78d108ee28c6c270e3d5fe23cf06da60bb89a5c493`.

Actual fresh seven-patch fingerprint: `62859be026bda18f3ea059c77f671192276bb731e210246f50b7e6cbc8089ec7`, **reused:false**, actual CLI0.4.5. `candidate-upstream.lock.json` is the tested private lock copy, NOT the production/shared lock. The main shared lock remains SHA `a893be958b3efe8625f8be34a3f7959d4a1ce603ae960dd5604e60f45c68679c`.

This is original six-patch base+0004. It does **not** claim Root's independently reviewed private5ec0002 has been jointly built here. That combination must be assembled/rebuilt/tested by Root before official pin or acceptance.

## Real verification

| Check | Actual result |
| --- | --- |
| Initial public behavior RED | Hook wrong literal binding despite successful real program exit; Eval collector external marker; report-save external link — three genuine failures, not missing tools |
| Hook narrow GREEN | 1/1 after private TypeScript compile |
| Exact fresh distribution/security Node | 7/7, zero outer skipped tests; verifyCometDistribution actually validates current seven-patch build |
| Independent source-preparation/CLI/security | 19/19, zero outer skipped tests |
| Fresh installed Hook inspection/projection | 99/99 across2 files |
| Eval pure applicable tests | 33passed;16native Windows NOT-EXERCISED, never claimed as49passed |
| Generated consistency | classic/native/entry allPASS |
| Unchanged upstream runtime-smoke | 4files,257passed/0failed/2original platform skips; JSON PASS and process0 |
| CLI exit contract | actual failing assertions→JSON FAIL/exit2; actual passing assertions→PASS/0; invalid args→coded error/1 |

Node24.15.0/pnpm10.18.3 and existing Python3.14 were used. Installs were frozen/offline/ignore-scripts. Only Vite8.2.4 was approved/fetched:576154compressed bytes,2348384unpacked bytes,36regular archive members, exact upstream/registry SRI. All36 installed files match the approved tar; registry cache delta contains only that one package. Final install reused427packages and downloaded0 (the other426 were existing cache). No install lifecycle or global upgrade occurred.

## Retained failures and environment boundaries

Raw logs/UTC/exit/hash receipts remain under ignored `.local/P1_1-security-backports`; displays and original hashes are indexed here.

- HEAD omitted Content-Length; the first setup script failed before tgz body download. The bounded approved fetch then succeeded. Store-add `--offline` is unsupported; actual config/help were inspected, and the package-manager registry identity was imported only after separate Root approval. No cache-index/SRI editing.
- An initial lock edit missed four nested Vite references, then strict offline import lacked registry cache identity. Both SETUP failures remain. Neither counts as vulnerability RED.
- A clean PATH selected the old system Python. That caused missing pytest/min-version failures and source-prepare fallback executable-mode comparison failure. Existing pristine/provenance and archive bytes were independently unchanged; no cache/provenance/mode was rewritten. Selecting the already-observed qualified Python solved setup. Source helper not enforcing pythonMinimum before this diagnostic remains a separate follow-up, not silently expanded here.
- Original runtime-smoke first yielded251pass/6fail/2skip because npm rejects user/global config both pointing at `/dev/null`. JSON FAIL/process0 was retained as failure and led to the separate helper fix. Root approved two different empty configurations; full unchanged smoke then passed. Only the newly created empty npmrc was removed in finally. pnpm calls retained the original two/dev/null settings. No guard escape or upstream test removal was used.

Our parent HOME was preserved. Unmodified upstream smoke creates its own temporary child homes as explicitly authorized; that is not actual-host qualification. User configuration size/mtime/inode metadata before/after is unchanged; contents/credentials were not read or copied. No Docker, model CLI, devserver, real API/platform/knowledge action or live configuration mutation occurred. The only network operation was the specifically approved fixed Vite registry fetch/import.

## Remaining acceptance

Actual Windows/WSL security behavior and Linux Runner container/OS isolation are NOT-EXERCISED here. Native-platform skips remain visible. No 0.5 migration, new controller/Goal/DAG, business retry store or privilege is added. Full repository/platform checks are not relabelled green: this slice ran matching source/CLI/security, installation, generated and native suites; Root's joint current source/image/profile checks and independent reviews remain required.

Submit only the four authorized code paths and this report directory. Shared upstream lock, existing0001/0002/0003, method snapshots, plan/progress and main configuration are unchanged. Source/pristine cache history and every setup/behavior failure are preserved.
