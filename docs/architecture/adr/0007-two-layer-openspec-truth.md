# Use two layers of OpenSpec truth

SDD Harness distinguishes active change truth from accepted specification truth. Active work lives in `openspec/changes/<change-id>/` as proposal, delta specs, design, tasks, and Trinity tracking state, while accepted behavior is archived into `openspec/specs/<domain>/` as long-lived domain specifications. This preserves OpenSpec as the canonical spec engine without confusing temporary change artifacts with durable domain knowledge.
