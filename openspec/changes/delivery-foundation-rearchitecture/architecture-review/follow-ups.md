# Next-step obligations

Every note remains linked to its implementation or verification owner; no runtime qualification is inferred.

## codex-agent:AR-01

Owner: implementation controller / task 4.3 acceptance index.

Finding: The design keeps requirements, architecture, and test-design approval as distinct gates with separate responsibilities and invalidation consequences.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## codex-agent:AR-02

Owner: implementation controller / task 4.3 acceptance index.

Finding: Single-controller ownership is coherent and prevents TeamAI, Gate, planners, or a second runtime from acquiring scheduling authority.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## codex-agent:AR-03

Owner: implementation controller / task 4.3 acceptance index.

Finding: Invalidation, transaction recovery, and post-archive continuation are conservative enough for staged implementation.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## codex-agent:AR-04

Owner: task 4.6.c.

Finding: R10 A retention and post-archive recovery have an explicit authority and cleanup boundary.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## codex-agent:AR-05

Owner: tasks 4.4/4.7/4.8.

Finding: Knowledge publication authorization and G15 A revocation are appropriately fail-closed, but their operational guarantees remain pre-enable evidence obligations.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## codex-agent:AR-06

Owner: tasks 3.1/4.1/4.2.

Finding: Unregistered pilot and platform resources cannot be mistaken for authorization to create real side effects.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-01

Owner: implementation controller / task 4.3 acceptance index.

Finding: The bundle maintains strict scope discipline: it requests only staged implementation authorization and never claims production enablement or runtime acceptance.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-02

Owner: task 1.1 and 1.5.

Finding: OpenSpec 1.3.1 incompatibility with Comet Classic's required artifact dependency closure is a real, currently unresolved blocker for later batches, but it is honestly documented and gated behind an isolated re-probe with a fixed compatible version.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-03

Owner: task 1.1.c before 2.4/4.6.

Finding: The Comet extension delivery location is not yet frozen ('@comet-extension/…' is only logical ownership), so runtime implementation work packages cannot yet be dispatched against a real source tree; the bundle correctly blocks this rather than assuming a plugin API exists.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-04

Owner: task 1.6.

Finding: Legacy vendored planner and Comet Classic 0.4.5 initialization still hard-depend on the user-disabled Superpowers methods, creating a concrete conflict with the confirmed Matt migration until 1.6 lands.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-05

Owner: tasks 4.4/4.7/4.8.

Finding: Knowledge governance parameters remain open by design (admission owner, rework budgets, whether team-knowledge publication is a hard per-delivery prerequisite) and are correctly deferred to frozen policy before the corresponding actions are enabled.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-06

Owner: task 4.8.d.

Finding: The G15 A fault boundary is stated honestly and consistently: 5-minute resource-side isolation with independent read-back is a target under healthy dependencies only; single-Runner or target-API failure provides no hard upper bound, with independent alerting, same-instance restart, compensation, and mandatory exposure-window/violation recording; monitors never become a second controller.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-07

Owner: task 4.6.c.

Finding: R10 A retention (retain the unique run record and workspace until overall completion; alarm on capacity; never auto-clean pending tasks) is defined once and consistently enforced across architecture, scenarios, recovery contract, and task packages.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-08

Owner: task 0.4 evidence references.

Finding: Several evidence artifacts cited by the bundle (compatibility probe JSON, Outline API observation JSON, comet-single-controller-review.md, task-dag.json, validation-report.json) are not part of the 14 frozen documents, so their contents are unverified in this review; however the bundle only makes conservative claims about them and does not use them to assert runtime acceptance.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## claude-code:F-09

Owner: implementation controller / task 4.3 acceptance index.

Finding: Sole Comet Classic authority and separate R/A/T gates are enforced consistently, including across all managed entry points (normal guard, direct transitions, managed writes, next/recovery, archive/completion) with explicit NO-GO stop conditions rather than silent degradation.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## zcode:zc-F1

Owner: task 1.1 and 1.5.

Finding: The current OpenSpec 1.3.1 installation fails the Classic dependency-closure compatibility probe, so the entire Classic single-controller integration is blocked until a fixed compatible version is pinned and re-verified in isolation.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## zcode:zc-F2

Owner: task 1.1.c before 2.4/4.6.

Finding: The load-bearing minimal controlled Runtime extension (X1–X5, work package 2.4) has no resolved code location: '@comet-extension/…' is a logical-ownership placeholder and the Comet extension delivery position is still unknown.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## zcode:zc-F3

Owner: task 4.8.d.

Finding: G15 A deliberately accepts that no hard isolation upper bound exists under fault conditions, and single-Runner permanent host damage or persistent-storage loss depends on backup/migration capabilities that are separately unproven.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## zcode:zc-F4

Owner: task 1.1 and 1.5.

Finding: Upstream dependencies (TeamAI, Comet) were not installed or exercised this round, so all upstream capability claims rest on source/document reading pending Batch 1 re-verification of fixed artifacts.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## zcode:zc-F5

Owner: tasks 4.4/4.7/4.8.

Finding: Knowledge-permission closures (pagination completeness, cross-system principal mapping, Outline inheritance/single-page/public-share stacking) are unvalidated, and the design correctly narrows first-phase auto-publication to registered, verifiably-permissioned source domains and dedicated managed collections.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.

## zcode:zc-F6

Owner: implementation controller / task 4.3 acceptance index.

Finding: The scenario inventory is internally consistent across the bundle: the 92 traceable scenarios claimed in the proposal decompose exactly into the requirement sets present in the spec.

Verification / due condition: Retain the cited invariant and prove the bound implementation before enablement.
