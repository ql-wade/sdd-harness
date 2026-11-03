---
name: comet
description: 查看并继续 Comet 受管交付的当前阶段。
---

# Comet

读取本项目当前 Comet 选择，展示原 Run ID、阶段、当前动作、已记录门证据的核验状态、阻塞与下一步。存在同应用 Run 时，先执行 `node tools/comet/phase-entry.mjs /comet --run-id <原 Run ID> --project-root <项目根>` 展示状态；需要推进时使用同一命令加 `--continue`。选择其他流程或存在不明确运行时停止核对。没有 Run 且用户要求新任务时，使用 `/comet-open` 明确需求并创建；不要自行创建平行 Run。

只按返回的固定应用包及原 Run 使用 `scripts/comet-run.mjs resume` 查看和处理当前动作。明确告诉用户可用 `/comet-open`、`/comet-design`、`/comet-build`、`/comet-verify` 和 `/comet-archive`；阶段入口不能跳过前置门。提示或模型自报不构成门禁通过，也不创建第二个控制器。
