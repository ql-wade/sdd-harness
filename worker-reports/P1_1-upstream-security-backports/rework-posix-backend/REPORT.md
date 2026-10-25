# P1_1 POSIX backend error rework

Candidate parent aa170bedf6db4b1bce4dd380b1c3f6e5887f5d2f remains immutable history and is NOT accepted. Its report, 84-entry manifest, original failures and build remain unchanged. This independent rework supersedes the earlier current-PASS claim only for the candidate construction scope; whole task/business acceptance remains 0.

Spec P1 confirmed a real boundary defect: advertised dir_fd/O_NOFOLLOW support remained present but an actual workspace open returned ENOTSUP; broad OSError handling returned empty collection, allowed the local judge observer and completed empty report persistence. Prior independent report/proof hashes are preserved in evidence/07-boundaries.json. No actual model/Docker/API was invoked.

## Minimal change

Only revised0004 differs in product code: workspace_artifacts.py and its existing pure Python regression file. Existing collector, judge, rubric, preflight and save propagation interfaces are retained. The helper now treats ENOENT/ENOTDIR/ELOOP/EACCES/EPERM as the existing ordinary-file skip policy; other runtime capability or I/O failures raise WorkspaceArtifactError with errno, without including artifact content or arbitrary paths. The same classifier handles safe open/read, directory lstat and walk errors, so enumeration cannot silently convert a backend failure to an empty successful collection.

Runtime ENOTSUP (EOPNOTSUPP is the same errno on this observed platform), ENOSYS, EINVAL and EIO are tested through real collector/judge/save functions, keeping the advertised capability registration. Local judge observer calls stay zero, no score is produced, existing report text is unchanged, no nested artifact is saved. Normal missing/link/unreadable skips remain accepted. Existing missing-API preflight tests still fail before workloads; that advertised-capability check is not claimed to qualify every workspace filesystem before an actual operation.

This necessarily adds a local security correction on top of the exact upstream0.5 reader/test, instead of claiming those two files remain byte-identical upstream. Hook, Vite, CLI exit mapping and all other patch bytes are unchanged from aa. No Runtime/application upgrade or new consumer/state/controller is introduced.

## Actual checks

| Check | Terminal result |
| --- | --- |
| New public collector ENOTSUP RED | exit1, 1failed/44deselected; DID NOT RAISE WorkspaceArtifactError |
| Runtime failure consumer matrix | exit0,12passed/33deselected |
| Existing + new Python artifact suites | exit0,52passed/16nativeWindows skipped |
| Exact fresh seven-patch build | exit0,reused:false; Comet0.4.5 |
| Original source/build/security Node suite | exit0,19passed/0skip, including actual Python52/16 |
| Original generated checks | all3 PASS |
| Original native smoke | exit0,257passed/2original platform skipped,259total |

These are current-source results, not inherited aa successes. Full raw argv/cwd/UTC/exit/input and output digests are in raw-display-index.json and evidence/. Raw exact bytes stay ignored. New build uses Node24.15.0/pnpm10.18.3, existing Python3.14, original fixed archive and strict offline cache with ignore-scripts. No package downloads. HOME was unchanged; only unchanged upstream tests create their original tmp child fixtures. npm receives distinct own-empty/dev-null config sources and the own file is removed in finally. No user configuration contents were read; stat metadata still matches prior observations.

The exact new fingerprint and hashes are in candidate-inputs.json and evidence/08-final-artifact.json. This is original six patches plus revised0004, NOT Root's private5ec joint build. Shared upstream.lock, original six patches, model methods and plans/progress stay unchanged. Native Windows/WSL, Linux Runner/OS, actual models/roles/permissions/knowledge and whole129/103 remain NOT_EXERCISED/UNVERIFIED. Root independent dual review and final joint build are still required.
