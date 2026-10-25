# P1_2 non-command conflict scan rework

原候选 d0b7c0f171dca7c5afb7f57a4db98e2397733745 与全部报告/原始证据保持不变，本小提交仅修同一 P1_2 的独立 Standards P2。

真实根因：mixed 保全后的两个不同 prompt handler 都没有 command，后续重复命令扫描却将它们转换为同一个空命令，导致真实 adapter 装配 exit1。先用公开 adapter/临时 TARGET_ROOT 实际复现这一拒绝，原始 RED 及审查 proof 摘要均保留。

最小源码改动仅两行：重复 event+command 扫描只处理 type=command；非 command 不进入该扫描。原命令识别、handler 过滤、权限/matcher、command 冲突与 ManagedOutputs 写入边界均不变。新增测试用两个不同 prompt（各有内容、timeout 和 metadata）与 owned legacy command 同组，实际安装/重复运行/卸载，检查内容/组 metadata 完整、重复字节一致。Prompt 永远只作 JSON 配置数据，不执行 prompt、模型或真实 Host。

| 实际检查 | 结果 |
| --- | --- |
| 新 non-command 公开装配 RED | exit1，1fail，command='' 被误判重复 |
| 同例安装/重复/卸载 GREEN | exit0，1pass |
| 原18项装配/行为加新增 | exit0，19pass/0fail/0skip |
| 原真实 command/plugin 重复拒绝 | exit0，2pass/0fail/0skip，settings 保持 |

实际 Node24.15.0、既有 Python3.14，外部模型/容器/平台/分发 CLI 拒绝器调用0。所有临时 fixture 在 t.after 清理；没有真实 settings/.mcp、secret、模型/API/Docker 或全局配置操作，HOME 未改绑。句柄2935明确终态exit0，无已知未完成句柄。

原74total/72pass/2fail证据逐字节保留；本轮没有重复未变运输组、不更新共享/Foundation锁、不弱化F04/B09，也不将旧 Run 检查认作过时 oracle。两项 closure/oldRun 仍待 Root 合最终源和 adapter 统一发行后按原语义复验；若仍失败继续处理真实缺陷。当前19与2属于有限回归，不能替代原两项或whole P1_2/实际Host/角色/OS资格。

源码及保护输入 SHA 在 evidence/05-final-inputs.json；raw/display size/SHA 在索引。所有原始字节仍在 ignored .local/P1_2-mixed-hook-preservation/rework-noncommand，旧目录未覆盖。bash -n 与 git diff --check 通过，交 Root 独立双审/串行接纳，业务接受增量0。
