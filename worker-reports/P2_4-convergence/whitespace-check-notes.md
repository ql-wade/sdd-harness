# Patch-file whitespace checks

Actual private Native source/test diffs pass git diff --check. The owned public case and ordinary report text are checked separately. A Git diff of a tracked unified-patch file reports its single-space blank context markers as trailing whitespace; those markers are patch DATA, not whitespace introduced into the target TypeScript. They are retained so the exact applied and tested six-patch bytes/hash/fingerprint remain unchanged. The corresponding private companion patch copies retain their original bytes for review/replay.

Sanitized display logs have line-end/EOF whitespace normalized, and evidence-manifest.json records their own updated display hashes. Original logs are unchanged under ignored local audit, with original hashes preserved. Display normalization does not re-sign evidence or alter a product input.
