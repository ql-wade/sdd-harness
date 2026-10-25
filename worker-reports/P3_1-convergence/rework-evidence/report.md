# P3_1 Spec 返工交接

状态：construction artifact 候选，待两项独立评审和 root 在精确 main 上集成复验。P3_1 整体仍未验收。

本轮基于 `22641f327483ad91bece092accc9c0b1685742e0`；底层仍为 `c26d43c`，未 rebase。旧报告、原 59 项分发 manifest 和本地原始输出均保持原字节。当前返工入口见 `CURRENT`；旧 104 场景映射仍为历史候选。

## 缺陷与修复

独立 Spec 的两个假绿均经真实公开 CLI 复现：目录 `stat.size=64` 被 `nonEmptyFile` 判 PASS/0；声明 exit 7 的可执行文件没有生成 marker、未执行，却被 `commandSucceeds` 判 PASS/0。`01-two-inspect-red` 是 2/2 行为失败；导入、依赖和用例匹配均正常。

`inspect` 文件观察现在要求 regular file；`nonEmptyFile` 还要求实际大小大于零。裸文件 path 不支持 `commandSucceeds`。执行探针使用已有 `command` 字段，读取真实退出码和 stdout，并记录实际 argv。命令探针不能用 `nonEmptyFile` 声称文件事实。

Schema 与运行时按文件/命令分型。不允许 spawn 同时含 path，不允许 readState 含 command，inspect 的 path/command 必须二选一。空、全空白或缺失 selector，以及未知/缺失 typed requirement 均在执行前拒绝。新增 Boolean JSON Schema 的 false 分支只用于明确禁止这些已有字段组合。

现存含空白的文件名优先作为文件读取。历史带空白 `inspect.path` 探针仅在原有 component scope 内兼容转换，回执明确列 `component/legacy-compatibility` 和动作索引，不能成为正式来源。正式代码不按 path 是否含空格执行命令。自动合成动作及本 worker 的四个旧 fixture 改为显式 command；三份冻结旅程 recipe 未越权改写，逐项交接原 owner，见 `integration-handoff.json`。没有新增模式开关或 shell parser。

## 组合盘点

| 操作 | 输入 | 支持的 typed expectation | 事实来源 |
| --- | --- | --- | --- |
| spawn | command | exitCode、commandSucceeds、tapRequiredAssertions | 实际子进程；测试动作仍须完整 TAP/非空有效执行 |
| readState | path | equals、nonEmptyFile、jsonFields | 实际 regular file 字节 |
| inspect 文件 | path | equals、nonEmptyFile、jsonFields | 实际 regular file 字节 |
| inspect 命令 | command | commandSucceeds、equals、jsonFields | 实际退出码、stdout；equals 比较 trimmed 输出 |

交叉类型不执行。目录、缺失文件和空文件不能满足文件 typed 要求；成功命令可以没有 stdout，但空输出不能满足已冻结的 equals/jsonFields。optional 观察仍记录实际失败；optional 不允许未知 kind 或无效 selector。文件存在、两个相同 JSON、组件回执依然不认证来源或授权。

## 实际验证

| 记录 | 命令与范围 | 结果 |
| --- | --- | --- |
| 01 | 两个原假绿公开 CLI 反例 | 2 fail，有效 RED |
| 02 | 最小文件/命令分型修复 | 2 pass |
| 03 | 显式命令及三种混合字段反例 | 4 fail，有效 RED |
| 04 | 同源组合修复 | 6 pass |
| 05 | typed 矩阵、空/目录/缺失/空格文件名、命令输出、legacy scope | 18 pass |
| 06 | Node 25.2.1：原 46 + 新 18 | 64/64；0 fail/skip |
| 07 | Node 22.13.1：同一套原 46 + 新 18 | 64/64；0 fail/skip |
| 08 | 正式 A01，无 CLI override / callback | NOT-EXERCISED、UNVERIFIED/2，0 个动作 |

窄回归原命令为 `node --test --test-reporter=tap test/delivery-cases/3_1.mjs test/comet-flow-acceptance.test.js`。没有重跑与本修复无关的全量；之前 537 项结果仍只属于旧源码快照，不继承到当前 main。

每次实际执行的 UTC、cwd、argv、退出码、输入源码摘要及 raw/display SHA 见 `runs.jsonl`。精确未脱敏 argv/原始输出在本目录 ignored `raw/*.log`；可分发输出见 `display/`，不能冒充 raw。`capture.py` 返回采集器自己的退出码，业务测试退出码以每条记录的 `exit_code` 为准。新证据不覆盖旧运行。

本次前后 118 份旧报告/raw 内容摘要无变化；旧 manifest 的 59 项仍全部匹配。三个活 Claude 配置文件仍不存在，`.mcp.json` SHA 保持原值。`before.json`、`after.json` 保存逐文件核验；最终源码与 06/07/08 实际执行时的输入摘要一致。

## 仍需原 owner 完成

本 worker 没有实际 protected adapter/source/OS 隔离/身份资格证据，也没有实际平台、Kp→归档→Kt 或同一 Run 端到端事实。正式入口仍拒绝；自供 callback、CLI 覆盖和兼容路径仍只是 component。未调用 provider、key、服务或业务动作，未修改 phase/ACL/grant、canonical contract/DAG/Scope/台账。

对照只读 main `2a45bb4`：contract `4414780dde6a9a48375409e46125c6f7f09f46a224be7a9ad1d0beef4b290bd4`，case-plan `56e3967c0cfd1212831d1fe24d1e55e2ad7e2cc71c52e318948309f756eb18a2`。该 main 已正式保留 130/104 总记录、采用 129/103 当前 required；F10 仍未验，不把未启用拒绝当 API 正向成功。本树未改范围。

原 7 个 source change 与 19 个 literal 未定位合并 21 项；main 又有 A05/A06/A18/A19/B03/B06/B07 的导入源影响。剩余 76 项也只是静态锚点。19 并非 19 个功能缺失；全部 104 项 typed 读回仍缺实际命令/路径/冻结值，不能整表采纳。`main-drift.json` 保留源文件差异和各类缺口，原候选不重写。

仅条件提议 P2_4 ← P3_1 与 I02 ← P3_1 两条建设工件边；必须本修复双审通过、root 精确集成及 main 复验后，才由 root 评审并写入唯一计划。它们不代表 P3_1 整体或任何业务门禁已接纳。
