# P3_1验收器组件返工

状态：代码及作者自检完成，待root独立Spec/Standards审查；没有受管业务场景、权限资格或整体Journey接纳。仅在专属工作树修改已授权5个源/测试文件及本报告目录，没有改主检出、唯一tasks/DAG/contract/锁/台账或方法正文。

## 修复及实际范围

公开CLI已留下真实RED/GREEN：不支持的expect/action组合误收、显式定义替换场景或删冻结复合分母、TODO当执行、旧profile自供登记复活、弱化/遗漏/重复/改值的typed读回、无实际source的正式A01假绿、较低组件层冒充platform、畸形注册崩溃、截断TAP残行误收、复制native dispatch symlink、原始终态bytes未绑定、外部旧文件/目录冒充当次证据，以及入口preflight未做就执行声明命令。注册recipe固定SHA与动态原生绑定有正反接口自检。

复用既有schema validator、P2_1 ActionBinding/parseContract、computeFullInputBaseline、执行分类/TAP summary与原admission对象；没有自建主控、阶段状态、授权信封、签发服务或重试循环。唯一当前profile为comet-managed-v2。精确冻结test名可以映射原场景，通用测试不必为ID重命名；无冻结映射仍不能用无关绿套件替代目标。

旧3_1 caller对齐当前profile及公开AST任务摘要；组件正例显式私有登记并保持component范围；缺recipe负例使用真实不存在的隔离路径；stale domain数据在独立输入文件中，输出目录保留不可覆写。临时根仅清理本次创建者。原言明的失败/拒绝语义保留，未用计数或局部绿关闭完整旅程。

## 实际验证

- Node25.2.1：两份owned套件46/46，0skip（26-final-owned-node25.tap）。
- Node22.13.1：同两份owned套件46/46，0skip（27-final-owned-node22.tap）。
- 实际`npm test -- --test-reporter=tap`，Node22.13.1：537项，529pass/7fail/1skip。七项失败与c26的P2_1历史树集合一致：C08/B08宿主OpenSpec语义、四项方法/分发摘要漂移、Outline image admission。没有修或豁免其它owner。
- `bash scripts/check.sh` exit1，规则/五项基础技能检查通过，止于原Whitebox GREEN fixture。完整总检查没有通过。
- 四个源配置前后摘要一致；三个.claude配置均不存在，.mcp.json保持原摘要。准确记录见final-verification.json。

这些结果属于本树c26基点加input-manifest列出的源内容快照，不能冒称main的回归。测试后仅新增/格式化报告与证据分发投影，源/测试字节未变。历史RED时并未伪称存在后来生成的最终输入清单；原始日志、错误准备尝试和首次修复仍失败记录均保留。

准备错误另记：测试caller字符串误改一次、一次准备脚本引号/一次preflight fixture定位失败、映射生成器遇到main计划文件不存在；这些是无效准备/提取尝试，不算目标行为RED。14-proof-layer-green首次修复仍失败，final-green才通过。未删除原失败或改oracle凑绿。

## 原始证据与独立交接

原始bytes保留在本树ignored .local/P3_1-convergence/raw-evidence及raw-reports；分发只做机器路径、行尾空白/末尾空行规范化，normalization-record记录双摘要。分发投影不冒充原始stdout。独立评审必须重新跑真实公开CLI、核原始bytes/源哈希和不匹配反例，不能仅看本报告的pass。

## 104映射建议与实际缺口

case-binding-proposal.json逐项保留原oracle、原check/任务/命令、具体required proof层/typed终态字段、真实literal test名与assert位置、两边源SHA及缺口；未改canonical。参考main固定f49795b，case-plan fe3e8e…8952、contract75099c…2185；75099c来自P1_6建设工件边，非F10。源码比较7项SOURCE_REVISION_CHANGED，其中本P3源尚待合入，其余由原owner刷新。literal提取不能证明语义充分或实际运行；动态/无场景名测试需独立映射，禁止为映射方便加入无关绿点。

F10人类已选择首版仅CLI+固定Runner，跨机器正向另期。这里保留104记录、原F10 oracle和UNVERIFIED；技术单条处置由root受控落地，本报告不删除、不计PASS或新增任意豁免。

真实observeProtectedSource、Authority登记与实际source资格、角色/进程/方法轨迹、资源权限、完整Comet/Kp/archive/Kt/平台/维护恢复仍需原I02/P1_3/P2_2等及VERIFY接线。preflight仅原Comet入口调用资格，文件/sha/ready不能自证；post候选端口未部署认证。正式缺该接缝继续UNVERIFIED/2，没有“先放行以后补证据”。具体边界见host-port-contract.md。
