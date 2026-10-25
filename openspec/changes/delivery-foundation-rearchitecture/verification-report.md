# Comet架构端到端核验：未通过

当前集成代码基线为`master@c26d43c`。原39节点、69工作包与唯一DAG继续使用；原92场景加12个贯通场景，共104场景、130项required检查。当前接纳6/39节点，其中4个是文档/设计、2个是基础工具链/共享契约组件；真实业务场景接纳仍0。130项required等待最终候选实跑，旧三项支持命令结果已移为历史。不能用组件通过数关闭整体目标。

## 本轮已完成的限定修复

- `291ccc8`：装配测试全部使用私有目标；真实hook与同次生成的策略一起执行。独立复验源配置缺失/存在/外来策略均8/8、0 skip，源文件摘要不变；故意缺hook时非零且清理fixture。主检出8/8通过。
- `36fcf5c`：三个平台/知识调用配置对齐登记仓库；validate与probe共用完整身份核；两侧缺值、错仓库、错误API fullname、畸形响应和无法启动gh均拒绝。独立复验原3项P1及进程错误P2已闭合；主检出相关77/77、0 skip，平台与LLMWiki validate均exit0。授权状态保持UNVERIFIED，未授予远端写。
- 此前`e0fde44`、`6bb1b4c`分别完成旧入口防再生和GitHub仓库/调用者回读修复。18个旧入口退出项目发现链，17份原始旅程证据保留。Comet内部退役方法仍待清除。
- 验收索引深层残留的旧component ACCEPTED、旧环境缺席判断及118/92旧统计已清理；历史保留在replan-history。当前索引只投影当前证据，旧生成器尚未资格化，不提供其为当前重建命令。

上述是安全子步，未勾选对应完整任务。它们的子集测试与全量回归重叠，不相加为验收分母。

## 历史候选36fcf5c的真实执行结果（不可继承当前PASS）

| 检查 | 当前结果 | 证据 |
| --- | --- | --- |
| `npm test` | 496项：489通过、7失败、0跳过；源活配置摘要不变 | `.local/comet-reset/final-regression/round2/result.json`及同目录npm-test.log |
| `bash scripts/check.sh` | exit1，停于Whitebox GREEN fixture自测 | `.local/comet-reset/final-regression/check.sh.log` |
| `openspec validate delivery-foundation-rearchitecture --strict` | exit0，使用钉定的隔离1.11.0，未改全局工具 | `.local/comet-reset/final-regression/strict-result.json` |
| C08隔离1.11.0正例 | 实际通过，已消除前轮因缺canonical安装而跳过 | `.local/comet-reset/toolchain/canonical-c08-positive.tap.txt` |
| plan_guard / 规则与基础技能检查 | 结构检查通过；不代表业务Run通过 | 当前计划契约及本轮日志 |

七项回归失败仍阻断总验收：四项是共识技能当前源码与方法/分发清单摘要漂移；C08负例和B08保存场景仍与宿主OpenSpec版本/行为冲突；Outline镜像准入测试未接受实际返回的UP_NOT_EXECUTED拒绝分支。未放宽断言、未将这些失败豁免为通过，也不据此声明零新增失败。

Whitebox故障已隔离复现：六份正例日志缺失，补入与旧ledger摘要一致的原始字节后私有副本STRUCTURE_PASS；负例还缺一份日志，共享源文件与旧ledger摘要不同。139文件的完整共享源候选已通过其离线总自测（15负例及3不变量等），项目快照未替换，不能只刷新摘要转绿。安装到`.sdd/tools/openspec-1.11.0`的包来自现有钉定tarball并复核SHA，全局工具未升级。

## 运行现实与未完成主链

Docker可用；Outline容器运行且healthy。六个Runner角色容器均退出；抽查controller与author为CLI entrypoint、无执行命令、exit1，controller日志只有帮助。该状态不能归因为Docker缺席，也不是受控角色执行证明。只读观测见`.local/comet-reset/runtime-readonly/container-state.json`，未启动旧流程。

尚需按原DAG完成：Comet实际action/harness派发与可信结果接纳、清除分发assets中的退役调用、独立R/A/T与真实TDD/Whitebox、平台SHA/digest/目标终态、LLMWiki Kp先于归档、同Run归档后Outline Kt及未知结果恢复、权限事件/全量核验/隔离告警、原生备份恢复与R10，以及最终完整产品Run和关联维护旅程。F10独立范围门与真实授权不能由未启用态拒绝冒充正向验收。

## 历史外发阻断（已解除）

此前自动审批拒绝将本次冻结15份架构/规范/计划发送给配置的Claude Code、ZCode和Codex，理由是此前14份材料的一次性授权已使用，不覆盖新增材料及新一轮披露。摘要`9784847e35f5c1cbfdb154cc22f604035486458181959410420158b0fedbefa4`；用户已明确授权本次一次性审查，冻结包未变，评审现已完成。

三方共识技能要求：“Pass only when every required participant votes `APPROVE`”。规则来源为[multi-agent-consensus-review](../../../.agents/skills/multi-agent-consensus-review/SKILL.md)第14行；未缩减人数或用局部组件审查替代它。新业务profile未启用，整体目标未完成。

架构见`docs/architecture/comet-ai-devops-convergence.md`，执行/恢复见当前`HANDOFF.md`，任务进度仍只由`tasks.md`与同一DAG接纳。完整交付ETA受专项授权和后续真实门禁影响，当前无法可靠估计。

## 当前实施与证据边界

本次15份冻结材料的真实三方共识已完成并finalize，回执architecture-review/comet-convergence-r1/receipt.json；只批准实施。P0_1–P0_4文档/设计、P1_1工具链（c797aa3）与P2_1共享契约（c26d43c）在声明范围接纳，共6/39，104业务场景仍0。P2_1两位独立审查员分别实跑61/61组件及27/27生产AST矩阵；主检出锁定安装后61/61、0跳过。原始日志保留，分发空白规范化有双摘要。不能据此宣称受信身份、Comet业务门禁或真实旅程通过。

P1_6整体方法快照/原生Comet模板与I01登记核验继续。Outline本次固定文集只读核验已获人明确授权，并由root审查脚本及独立8/8离线自测后实际执行一次；owner/team/文集匹配，直接用户成员分页完整，collection.permission=null、sharing=true。组/继承和完整受众仍UNVERIFIED；此结果不授予publisher/isolator/issuer权限。人已恢复原生Goal并读回active，沿唯一DAG继续，整体ETA尚无法可靠估计。新候选130required均待最终复跑；旧36fcf5c回归7失败和Whitebox自测失败仍开放，不以过期结果充抵验收。
