# Architecture Intake

## Evidence Registry
Record `fact`, `source_path`, `source_line_or_section`, and `confidence`.

## Discovery Order
Read user paths, AGENTS.md/CLAUDE.md, architecture/design/spec/ADR documents,
manifests and test configuration, then code only to confirm interfaces.

For an OpenSpec-enabled repository, read the selected change's
`proposal.md`, `specs/**/*.md`, `design.md`, and `tasks.md` before inspecting
implementation files. Treat those artifacts as the requested scope and
acceptance contract. If code facts contradict them, halt and report the
conflict; do not silently rewrite the change while planning.

## Assumption Registry
Record `id`, `assumption`, `impact`, `verification_step`, and `owner`.
Ask one blocking question only when a missing fact changes architecture,
public interfaces, data safety, or acceptance criteria.

## Freeze
Concatenate the normalized architecture evidence and compute SHA-256.
Write the digest to drift-lock.json. Never update it during execution.
Any mismatch requires halt-and-replan.
