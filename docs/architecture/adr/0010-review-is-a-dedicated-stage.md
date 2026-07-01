# Review is a dedicated stage, not embedded in code or verify

review 是位于 code 与 verify 之间的一等 stage（`/sdd:review`），而非任何一方的子步骤。review 审视代码 diff 本身：Superpowers code-reviewer 检查架构与对 OpenSpec spec/design 的符合度，随后 open-code-review 做行级扫描。verify 验证整体交付：测试通过率、spec 覆盖、evidence 完整性。两者正交 —— review = 代码质量，verify = 交付完整性 —— 因此各有自己的 artifact（`review-notes.md`）与 gate。顺序是先 Superpowers（架构，会话内可串联）后 open-code-review（行级，确定性 gate），因为架构问题修复成本高，应先于行级打磨暴露。这刻意偏离了 cc-sdd 的 per-task 嵌入式 review：SDD 要求 review 产出有自己的 artifact ownership 与 gate，而非散落在 coding 迭代里。
