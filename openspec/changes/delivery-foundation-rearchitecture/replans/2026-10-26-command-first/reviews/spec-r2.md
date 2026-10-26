# Command-first 文档复审 R2

结论：REQUEST_CHANGES，仅剩1项P2元数据矛盾。R1的三项原问题已实质关闭；未发现新增功能削弱或运行通过伪声明。原R1报告保持不变。

## R1修订回读

1. `execution-contract.json` 的 `V_RW_RUNNER_BUILD` 保留ID/required/AC，当前command改为已有delivery-journey的F05入口；expected明确验证实际安装Comet/方法身份、宿主真实来源、权限拒绝与零常驻角色。镜像只对明确选用临时作业附加，缺Docker不阻普通命令。原P1关闭。
2. `handoff.mode`已改为`PLAN_ONLY_EXECUTION_PREPARED`，portable接手者在明确实施指令后才接管。controller_override不绑定Root/Claude工人。execution-prompt前置条款优先于模板，当前不恢复Goal/监督、不派工、不实施；helper不得实际finalize归档。原P2关闭。
3. I01不再以自身资格完成为前置；其余Infra只要求相应域的登记/授权和必要组件证明，不要求全量镜像或新keys。原P2关闭。

## P2 — V_COMET_NATIVE仍留下无条件重建的旧metadata

位置：`openspec/changes/delivery-foundation-rearchitecture/execution-contract.json`，checks中`V_COMET_NATIVE.availability`与`.note`。

实际值：availability仍为`EXISTS_REQUIRES_CURRENT_VERIFIED_BUILD_AND_PINNED_NODE`；note仍称“现有CLI已支持这两个选项；必须先重建/校验当前完整manifest，不能继承漂移缓存。”但该检查的command已变为delivery-journey C07，已没有原来“两选项”的含义；同一expected明确仅本次确有源码补丁变化时额外验证构建/生成物，不强制完整重建。

影响：接手者根据availability/note仍可能先进入旧完整重建路径，和本检查新expected的条件边界不一致。它不是已发生的产品错误，也不恢复原镜像P1，但冻结机器合同不应对同一检查给出两套前提。

最小修订：删除失效“两选项”说明；availability改为当前宿主安装身份/命令能力待实证，note写明安装身份、漂移缓存不可复用和仅补丁变化时验证适用构建。按同一修订同步相关摘要即可，不要求产品执行。

## 本轮确认的范围与证明边界

- `V_COMET_NATIVE.expected`和`V_I02_METHOD_STATE_SCOPE.expected`保留共同门、真实权限、独立会话及非fixture接纳要求。I02方法检查移除了不合适Node参数；其单元命令仅证明机制，真实宿主仍另需同候选证据，没有将单元绿提升为业务通过。
- R/A/T/P、测试自动化、实现/代码审查/V、Kp/唯一归档/Kt边界仍清楚；原Run恢复、权限来源/受众/版本、G15/R10及平台义务未见削弱。
- 130检查记录保留；本期129检查/F10另期的明确scope disposition仍在。检查元数据的原required身份保留不等于把F10计为PASS。
- 只读计算当前contract、DAG、architecture、spec-baseline四个SHA256，均匹配同ID amendment中的new_*摘要。没有运行plan_guard或任何产品CLI，未复述其通过为本轮实测。

未检查：未运行产品测试、CLI/模型/MCP/Docker、真实宿主权限或外部知识流程；没有修改仓库/计划/锁/状态。文档批准只能准许一致交接，不能证明129/103实际通过。
