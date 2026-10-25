# P2_5 fixed A/T consumer seam

Scope: reviewed construction candidate only. Existing Native `readResult`/`verifyReview`, P2_2 authority/admission/Gate remain unchanged. No loader, new scheduler, ledger, retry loop or public signing endpoint.

## Long original-source readback

Call existing `consumeArchitectureGate({package,runRoot,round,questions,authority,managed})` or `consumeTestDesignReview({authority,managed})` in the fixed host's original `readResult`, outside the Native short lock. `managed` is protected CODE-selected context; JSON flags and worker role labels never select this consumer or qualify its sources.

Common context: current `actionBinding`, full protected `policy`, target `testContract`, optional distinct `gateTestContract` for Native command coverage, original `packet`, `admissionOptions`, and original job identity (`jobKey`; if the upstream field is absent, use its original immutable execution identity, not a new registry). `admissionOptions` is the existing SDK context: actual current source qualification, environment, builder/author execution+principal exclusions, protected now and owning-Run replay sets. Target TestContract is command-bound. T ActionBinding inputs include `test-contract` with its canonical content digest.

Packet is the ORIGINAL SDK `{dispatch,envelope,launchRecord,reportBytes,resultBytes,methodTraceBytes,collection}`. If an original source has no collection yet, the protected collector may collect that same registered launch via existing `authority.collectResult`; this never starts a review. Native still independently collects/revalidates its original result after long IO. A changed collection must be reconciled, not silently rebound.

Trace data: `{schemaVersion:1,run,execution,actionDigest,methods:[{name,version,ref,digest,status:"completed"}]}`. Actual trace provenance and real method execution require I02/P1_3 qualification; this shape/digest is no substitute.

T result: schema 1, candidateDigest, contractDigest, sufficient boolean, oracleStrength, written summary, exact required caseReviews `{caseId,checkIds,oracle,sufficient,rationale}`, environmentReview `{digest,sufficient,rationale}`, cleanupReview `{environment,data,sufficient,rationale}`, findings `{id,blocking,rationale}`. Only a real independent collected semantic reviewer can supply that conclusion. Weak/insufficient/blocking conclusions remain observable with `sufficient=false` for the original Native rework path.

A adds `grill:{packet}`, `reviewers:[{participant,packet}]` and protected `sourceBindings:[{actionBinding,sourceQualification}]`. The exact three participants, 8/7 thresholds, five criteria and three-round bound remain fixed protected code. Grill role is architect, independent ballot roles reviewer; all original sources bind the same Native Run/revision/attempt/epoch/policy/environment/work-package. Reviewer candidate inputs equal the primary current inputs. Different executions and principals are required among reviewers, excluding the grill author and existing builder/author exclusions; no separate OS UID rule is introduced.

The frozen JSON package contains actual `requirementsDigest`, `designDigest`, `grillDigest`; current primary inputs bind `requirements`, `design`, `architecture-package`, `grill-closure`. Grill result schema 1 binds those requirement/design digests and nonempty explicit closed questions/resolutions. The original grill source precedes consensus; pass its closed questions to `initConsensusRun` before submitting. Original ballot bytes equal the real mechanical files. Primary A result binds schema 1/reviewId/artifactSha256/revision/round/manifestDigest/tallyDigest/finalReportDigest/grillDigest. Its passing raw report is the exact real finalize output. A completed authenticated dissent can be prepared as insufficient; missing or invalid sources remain UNVERIFIED.

## Pure current query

Preparation yields `{ok:true,prepared:true,consumed:false,verifyReview}`. Install a fixed wrapper such as `verifyReview(request) { return preparedForOriginalExecution.verifyReview(request, currentProtectedReviewContext); }`. That second argument is already-read current DATA from the original protected registry, not a new callback or worker payload. No context, changed action/Run/attempt/epoch/revision/policy/input/method/source qualification, expiry or raw binding returns a passing query. Child reviewer qualification revocation also invalidates A.

The query is synchronous and does no filesystem/subprocess/model work. It binds exact gate contract, action, original envelope/collection/report/result/trace and independent principal. It returns the existing SDK fields ok/sufficient/evidenceDigest/envelopeDigest/reportDigest/actionDigest/execution/principal. Native still owns consumption, replay, current action checks, invalidation, retry/repair and transaction. Rebuild preparation from the SAME original registered sources after process recovery; never persist a derived pass or relaunch an unknown job.

The old bare dispatch/seat paths are compatibility component observations only (`managedClosureEligible=false`) and return no Native review query. Never synthesize a passing Native record from those paths.
