# Completion history and current integrity — authorized oracle correction

The frozen specification's L05 and the approved convergence architecture preserve original delivery history when later permission/integrity maintenance is needed. The native engine treats non-running RunStatus (including completed) as terminal for action dispatch. The original trajectory records completion with state_transitioned/toStep=completed; there is no separate completedAt field.

The first complete owned run (raw147) used an incorrect supplemental assertion that every post-completion bad receipt must rewrite Run.status to waiting. It observed 32 passes / 1 failure / 0 skips of33. The foreign receipt exception retained the prior completed lifecycle while refusing the query. The controller corrected the supplemental oracle using the already-frozen specification; the observation and failed bytes remain intact. Raw149 then demonstrated that the provisional demotion on unverifiable delivery destroyed the lifecycle distinction. Neither result is erased or relabeled as runtime acceptance.

The corrected boundaries are:

- Before the FIRST legitimate completion, missing/foreign/unknown delivery or gate evidence prevents completed. A current Kt cannot waive independent delivery (raw130 RED, raw133 GREEN). A real crash after a Kt commit while still waiting can recover the same persisted Run to its first legitimate completed state (raw135 SIGKILL proof).
- After legitimate completion, Run.status/currentStep and original completion events are retained. Current source/authorization/receipt/bridge faults produce structured RECOVERY_REQUIRED with currentIntegrity.UNVERIFIED, no current done/continuation, and blocked maintenance. No product requirement is reopened, no maintenance job is invented, and no new Run/controller/store is created.
- Owner checks append a binding-deduplicated eval_completed using the original scope/results fields plus the original completion reference and current fault facts. Read-only validation does not write this audit. The original Run authority/lock still governs owner mutations.
- New product gate dispatch/accept after completed is refused. Actual maintenance execution and resource isolation remain unimplemented/unqualified under their original owners; a current fault is not a claim that published knowledge is physically isolated.

The corrected post-completion assertions stay in the same original component cases; their safety obligations are retained. The before-first-completion waiting assertions remain unchanged. This is not an amendment to the canonical DAG, scenario IDs, check totals or acceptance counts, and does not authorize actual knowledge/permission operations.
