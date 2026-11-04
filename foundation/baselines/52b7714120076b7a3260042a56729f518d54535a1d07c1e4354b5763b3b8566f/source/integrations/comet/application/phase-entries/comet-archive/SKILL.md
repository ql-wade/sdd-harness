---
name: comet-archive
description: 通过 Comet 受管应用继续项目知识、归档与团队知识阶段。
---

# 项目知识、归档与团队知识

先从当前项目的 Comet 选择中读取原 Run ID；选择不属于本应用时停止并核对，不能创建第二个 Run。不要猜测 ID，也不要直接运行内建 Classic 状态迁移命令。

先在项目根运行 `node tools/comet/phase-entry.mjs /comet-archive --run-id <原 Run ID> --project-root <项目根>` 并展示返回状态；需要推进时使用同一命令加 `--continue`。不匹配阶段、运行中动作或未知结果都按返回状态检查，不重复触发。

使用返回的固定应用包内 `scripts/comet-run.mjs resume --project-root <项目根> --run-id <原 Run ID>` 读取当前动作；只执行 Runtime 给出的动作，按它要求的固定 Skill 路径和摘要使用宿主支持的加载方式。展示当前阶段、动作、已记录门证据的核验状态、阻塞原因与下一步。不可将文件存在、作者自报或提示词当作门禁通过。

先通过 LLMWiki 项目知识 Kp 门，再由原 Comet 操作 OpenSpec 唯一归档；之后完成 Outline 团队知识 Kt。发布结果未知时先读回原操作，Kt 未完成不得宣称整体交付完成。
