# Command-first 原计划与交接独立审查

结论：REQUEST_CHANGES。审查基线为 /Users/mac/Code/sdd-harness 当前工作区，2026-10-26；仅审查规划可执行性与一致性，不签产品通过。

## 阻塞项

### P1：最终必需检查仍要求真实 Runner 镜像

文件：execution-contract.json:3924–3926，检查 V_RW_RUNNER_BUILD。

`required:true` 的 expected 仍为“真实镜像包含当前完整有序补丁、入口存在且可运行；digest/fingerprint/Node一致…”。它又被 A09/A19/F01/F02/F05 的 acceptance_aggregation 消费。这使最终129检查仍必须认证旧镜像；与ADR-0021第5/7/8项、HANDOFF第2/3节及I02退休目标冲突。虽然统一revision_precondition声明需要重写oracle，本条具体期望仍要求退休对象，后继实施无法同时满足两个合同。

最小修订：保留 V_RW_RUNNER_BUILD ID，将其命令/expected明确改为当前安装命令/补丁版本与实际宿主Edit/Shell/MCP控制写拒绝、独立执行来源以及默认链零常驻角色服务；仅显式选择临时Docker作业时要求该作业镜像证据。同步实际case由I02/P3_1后继实施，不能本次记通过。相关 observation_scope 中旧 `real managed Runner/services/identity`宜同步为host/resource范围。

### P1：机器交接仍声明立即执行授权且绑定旧root

文件：execution-contract.json:4451、4475–4477。

`handoff.mode=EXECUTION_AUTHORIZED`、recipient=`Claude implementation workers under current single migration planner`，controller_override要求`Current root chat`唯一写者。它与同文件plan_only=true、runtime可移植接手者以及HANDOFF第7节“新接手者收到实施指令后才登记接管/恢复”冲突。接手者只消费机器契约时有两种危险解释：规划读入即恢复Goal/派工，或永久把已离场root当controller。

最小修订：mode明确为规划完成待实施指令；controller/recipient指向“收到明确实施指令后登记的唯一接手控制器”，且明确当前Goal保持暂停、监督只读；历史授权保存在before，不混入当前状态。保持同一DAG和监督复用。

### P2：I01具有文字自前置，基础设施前置仍沿用全组件资格

文件：task-dag.json:648–649（I01），同类前置还出现在I02–I08；tasks.md:364–380及infrastructure-tasks.json I01为仅登记必要资源。

I01的preconditions要求“I01 registry qualification and component image/source digest/owner/secrets readiness verified”，将本任务产出作为开始条件，也保留旧全组件image/secret资格表述。图算法看不到这个文字循环，因此plan_guard有效不能解决其接手含义。

最小修订：I01只要求真实owner和所需操作授权；其余基础设施仅要求本任务实际消费资源已登记、相关授权/版本/持久化与恢复证据，镜像只对实际部署依赖要求。不得把未启用角色服务或未选secret服务重新设为准备前置。

## 已核实成立的部分

- 原plan_guard真实运行返回 `{"valid":true,"handoff_ready":true,"issues":[]}`。
- before-manifest全部69份文件的字节长度及SHA256与before保存一致。
- before/current的39节点集合、每节点工作包清单完全一致，共69工作包；130 check ID及104 scenario身份保留。current_required计算为129，V_F10保留required_in_current_completion=false、明确另期NOT-EXERCISED，无转PASS。
- P3_2的递归祖先没有I01–I08；I02镜像和全部知识平台确已从首个R→V前置解除；P3_4在R→V后，P4_6消费其归档能力。VERIFY仍等待所有原节点（P5_2仅文档处置）。没有依赖环，也没有未排序的完全相同owned路径冲突；serial/max_workers1与共享写入约束一致。
- oracle文本对A19/U07/L09的修改保留实际权限拒绝、独立执行、原Run恢复及告警≠隔离，未发现功能性权限/恢复降格；仅将固定部署方式换为宿主证据的方向正确。
- 详细交接明确保留旧6节点/1164检查的历史范围；记录原check1161/1164三失败、插桩轮不能覆盖原失败、知识run16的2过2失败，不以旧fixture/镜像认证新流程。新checks全部historical_results_may_close=false/current NOT_VERIFIED，并要求实施或核实新oracle后方可计数。
- 保留/退休/返工表、接管→原生硬门→真实R→V→必要知识/平台→完整Kp/归档/Kt→维护恢复→独立Whitebox/Grill/Comet收尾顺序可操作；外发与owner-key许可已消耗、资源端写前授权和删卷权限被明确保留。
- execution-prompt的四个摘要与当前drift-lock/raw文件一致。

## 执行边界与未验证

只运行读取、Python -B静态比对及原plan_guard。没有运行npm/product tests、真实CLI/model/MCP/Docker、访问credential、网络写，未修改项目文件、锁、状态、Goal或资源。报告仅写至 /private/tmp。

未独立重放旧测试/进程/容器事实，历史失败按before/current原始文本一致性审查；没有证明实际宿主来源防伪、权限隔离、命令执行或任何业务终态。上述是后继实施及独立验收义务。
