# I02 / 原Native execution 衔接：有限实证缺口

本观察不修改I02/SDK，也不新建任务或账本；仍由Root沿原DAG协调。实际用原I02 createCliJobDriver +受限Node可执行fixture，非真实Docker/OS资格。

## 同role的下一合法execution尚不能启动

同一原Native Run先真实dispatch R、Node观察、strict collection/Gate接纳；修改proposal后原Runtime又派新的合法R execution。在同一Host会话对新execution执行，实际PHYSICAL_START_UNVERIFIED；旧物理记录仍是前一execution，start总数保持1。不是模型/凭据/环境缺席。

根因触点 tools/infra/runner.mjs：authorize返回name=namespace+'-'+role.id；find只按固定name找容器；inspect要求value.execution/run严格等于新grant。此前同role已退出容器仍占该name，stop不remove，于是合法下一job必被PROCESS_SCOPE_MISMATCH防线拒绝。该拒绝防线应保留，不能放宽旧execution比对。

建议原I02受控改动：由原Runtime签发的execution决定确定性slot（固定namespace/role+execution digest，绝不能来自worker自由名字），或添加仅对原owner/原handle/已确认terminal的明确释放操作。前者不需要第二phase/lease/队列；并发/重放仍由原Run及原签名约束。实际已存在/未知结果不能因timeout当不存在重建。Root需选最小方案并补“同role两个合法job、原job幂等观察、错execution绝不接管”的真实组件序列，再做实际OS资格。P1_3不越界改I02或自动清理资源。

## 原进程恢复/worker entry仍须闭合

- 当前SDK没有受控持久化原launch-start/handle的端口；P1_3只留volatile观测，不写第二Action/lease文件。冷进程重读同Run和open intent后保持UNVERIFIED且0重启，是安全拒绝，不能称已实现正向恢复。源级建议已在NATIVE-ACTION-PORT-PROPOSAL.md交P2_4，复用原pending/gate record及事务。
- I02固定physical入口是/opt/sdd/runner-host.mjs，当前Dockerfile没有交付该文件；真实image未构建/未资格。P1_3的Node worker fixture是可执行机械证明，不是该受管生产entry或真实Matt方法/模型已接通。需与实际角色程序、方法allowlist/版本、受保护注册及stdout/三原字节协议一起交付固定bootstrap，绑定image/bootstrap digest后才可启用。不能把fixture代码复制成生产qualified标记。

实际记录（相对repo）：.local/P1_3-fixed-host-executor/i02-role-slot-probe/{stdout.raw.txt,stderr.raw.txt,metadata.raw.json}。stdout SHA256: 7be5f4478adba1eadcc2124da3e83497bb8183fa780a2538a88b4866af49b567。探针exit0只表示观察完成，观察到的下一合法job结果是UNVERIFIED；原始输入/前后SHA保留。whole I02/P1_3、真实角色/OS与全Journey继续未验。
