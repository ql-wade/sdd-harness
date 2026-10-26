---
name: sdd-managed-delivery
description: 启动或恢复已确认的 sdd-managed-delivery 工作流应用。
---

## 在 Agent 中启动和继续

加载本 Skill 后先执行本节，再根据 Runtime 当前步骤使用后面的业务说明。用户始终在 Agent 对话中使用 Skill；Dashboard 自动读取运行记录。

1. 新任务：按业务说明与已声明的输入要求整理真实输入，写入项目的临时 JSON 文件，执行 `node "<本目录>/scripts/comet-run.mjs" start --project-root "<用户项目>" --input-file "<输入JSON文件>"`。入口定义见[流程定义](workflow.json)，可执行脚本见[运行入口](scripts/comet-run.mjs)。存在多个入口时明确 --workflow-id。
   流程需要初始状态时，沿业务说明中的原领域初始化接口取得真实状态，追加 --initial-state-file "<初始状态JSON文件>"；不能把评估样例状态用于真实任务，也不由通用入口猜测 Native/Classic 的状态或批准。
2. 继续已有任务：使用对话中原 Run ID 执行 `node "<本目录>/scripts/comet-run.mjs" resume --project-root "<用户项目>" --run-id "<原Run ID>"`。新会话没有 Run ID 时，执行同一 resume 命令并省略 --run-id；唯一未结束任务会被定位，多项任务需向用户确认后选择。resume 会恢复当前应用归属，保留原领取；只读查看用 inspect。恢复不另建 Run，不重复已完成的工作。
3. 响应的 run.current 列出当前工作，commands 提供完整参数。先沿 next 调度就绪步骤和子流程。由注册执行器完成的工作使用 execute；需要当前 Agent 执行的工作先用 claim，只有响应确认 running 后才执行。capability 仅声明当前宿主实际具备的能力。
4. 读取该 Action 的实际 input、outputSchema、skillWork 和业务说明，执行实际工作。固定 Skill 的加载沿下方 SDK 协议。把真实结果写成 {"status":"succeeded","output":<该步骤实际结果>}，再使用该 Action 的 commands.recordOutcome，仅替换实际结果文件路径。入口会读取已声明产物的真实文件并收集摘要；额外产物在 artifacts 中填写 uri、sha256。失败按实际 status 回报；Schema 或工件检查拒绝后修正同一次尝试。
5. run.current.waits 中的提案与 choices 必须完整展示给用户；在当前 Agent 对话中取得用户决定后，使用对应 commands.waits.resolve，填写实际选择和决定来源。等待用户时停止，后续继续原 Run。
6. 子流程沿 commands.children 查询和执行，子流程结束后继续父 Run 的 next。running/unknown 表示原执行仍需回报或核对，不重新领取。run.status 为 completed 时再交付真实产物；新任务使用新的 Run。

入口保存的 Run、Action 和 Wait 是 Dashboard 的进度来源。业务文字、文件存在或一条完成消息都不能代替步骤回报和实际验收。

## 业务说明

# sdd-managed-delivery


## SDK 执行协议

固定组合：dbcb0eeefd38dcfa8f9107240ebc870f423d78061a6037a7a6d913d27881b44b
Runtime：0.5.0；基础流程：classic-full。

用 comet runtime dispatch --application-file <本目录>/application.json --project-root <项目> --request <临时JSON> 启动下列流程：
- comet-classic-full@1

查询和恢复使用 --application sdd-managed-delivery 与原 Run ID，先 inspect 原 Action；保留 attempt、inputHash 和 claimToken。未知执行先核对结果。审批只沿 Runtime 当前 Wait 提交。

当前 Action 返回 skillWork 或当前 Wait 返回 waitSkillWork 时，逐项读取 skill.files["SKILL.md"] 的真实 name；没有 name 时按该固定目录的宿主命名规则确定，无法确定时阻塞。skill.id 只是逻辑绑定，不能用应用名称或别名代替实际 Skill 名称。

**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。

技能加载后，核对实际加载来源对应当前 skill.root，并核对 SKILL.md、脚本和资源的完整内容摘要与 skill.contentHash 一致；同名不能代替固定版本。宿主无法加载该固定版本时阻塞，保留原 Action。核对通过后，Action 保留 actionId、attempt、inputHash；Wait 保留 waitId、proposalHash，不能把等待点当作 Action 领取。传递当前输入、范围和固定指导，执行工作后提交真实结果；等待点指导不等同用户决定或 machine-check 证据，审批仍只提交当前 Wait 的用户决定。

流程与绑定见 application.json，安装与恢复身份见 installation.json。不能以完成字符串代替实际 Schema、候选或工件检查；检查拒绝后保留现场，修正实际产物后继续原动作。
本包通过组合结构和实际注册实现检查；真实宿主、模型执行与完整业务验收须另行记录。

执行前读取[应用规则](rules/workflow-guard.md)。Rule 与流程和写入声明一起生成；宿主集成通过正式安装预览部署。
