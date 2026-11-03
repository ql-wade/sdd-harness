---
name: comet-open
description: 在 Comet 受管交付应用中开始或恢复需求澄清阶段。
---

# Comet Open

使用当前项目的 `sdd-managed-delivery` 应用和 Comet 0.5.1。先核对用户目标、已有选择和原 Run；将需求澄清、范围确认与架构设计分开。

1. 如果当前选择指向本应用，使用其原 Run ID；如果选择属于其他流程，先核对归属。没有选择时，仅在确认是新任务后，按项目 OpenSpec 约定准备该 change，使用其规范名称作为 Run ID。
2. 新任务在项目根执行 `node tools/comet/phase-entry.mjs /comet-open --run-id <Run ID> --project-root <项目根> --start` 创建；已有 Run 先用同一命令去掉 `--start` 读取并展示状态，需要推进时再使用 `--continue`。遇到已有 Run、未知结果、在途动作或阶段不匹配时，按返回信息检查原 Run，不重复创建或执行。
3. 按返回的固定应用包和原 Run，使用包内 `scripts/comet-run.mjs resume --project-root <项目根> --run-id <Run ID>` 读取当前动作及其命令。仅执行 Runtime 返回的当前动作；需要 Skill 时核对固定路径和内容摘要，再使用宿主支持的加载方式执行。
4. 使用 grill-me 澄清目标、范围、验收标准和非目标；将实际产物和有权确认结果提交给当前 Run。R 门未通过时保留当前状态并处理缺口；不得将提示、文件存在或作者自报当作门禁通过。
5. 返回 `confirmationPrompt` 时，向用户原样呈现其问题和选项，并关联该原生 wait。只有真实宿主来源和当前 Run 的确认身份均可核验后才能提交决定；来源不明时保留原 wait 并报告阻塞，不能由 Agent 自己构造“已批准”。

本入口不持有阶段状态，不调度第二个工作流。后续阶段和恢复继续使用同一应用与 Run。
