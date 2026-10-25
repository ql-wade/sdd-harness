# P1_2 mixed hook 保全：限定源码候选

基点 a497b7b885984fa70cc3220173d47cc30da86a5e，分支 codex/comet-mixed-hook-preservation。原 aad/8220 分支与全部 ignored 证据保留。仅修改 tools/adapters/claude-code.sh、test/adapter-quoting.test.js 与本报告目录；不签 whole P1_2、实际 Host、角色/方法/OS 或业务资格。

依据原 P1_2 Step3“脚本行为和 settings matcher 同测，用户条目不丢”，及本次独立 Spec/Standards 记录的 mixed group 缺口。本轮采用既有 TDD/diagnosing-bugs 循环，不启动其它控制器或工人。

## 根因与最小修复

安装 upsert_hook_array 原以任一 handler 命中就移除整组；卸载同样可能删掉用户，或因组内有插件而留下项目 handler。现在均只移除有确切所有权的 handler，保留其余用户/plugin/非 command 内容、原 matcher、顺序、超时及 entry 元数据，随后在独立组添加当前项目命令及正确 matcher。

两处既有来源分类现在完整匹配本 adapter 的当前 Bash 与旧直接调用形式，而非搜索路径片段；bare hooks/<owned>.sh、项目变量根的旧直接调用及当前 Bash 形式仍清理。仅路径文字、附加参数/用户命令、备份后缀、其它项目路径或非 command handler 不授予所有权。插件标记仍优先；原重复注册冲突检查不放宽。未引入新 Hook 框架、phase、调度或权限来源。

## 真实 RED 与 GREEN

| 记录 | 实际终态 |
| --- | --- |
| 01 → 02：mixed install 保全用户/plugin/metadata | 真 RED1fail → GREEN1pass |
| 03 → 04：路径文字或附加用户命令不能被删 | 真 RED1fail → GREEN1pass |
| 05 → 06：mixed uninstall 保全用户/plugin、移除自有项 | 真 RED1fail → GREEN1pass |
| 07：原 adapter 加前三项回归 | 11/11、0skip |
| 08：bootstrap fixture 缺公共工具锁 | SETUP FAIL，绝不算行为 RED |
| 09：补齐临时 fixture 公共锁后，真实 bootstrap 重复/卸载 | 1/1、0skip |
| 10：adapter + 原运输/发布 + 原 Hook 装配 | 74total/72pass/2fail/0skip |
| 11：最终 adapter + Hook 装配，两层验证 | 18/18、0skip |

18项与前述74有重叠，不累计为新业务分母。新 bootstrap fixture 仅复制已有批准 tdd 方法原字节，并用原 MF 的同一 snapshot 条目固定该源；临时元数据不宣称完整 managed profile/角色资格。所有工程均为私有临时 TARGET_ROOT，测试结束（含失败）finally 清理。原脚本 deny/allow、env 安全引用、matcher、legacy 清理、防再生、plugin 冲突、packet 字节运输等原义务未删。

## 两项仍未闭合

10中的两失败分别是 committed Foundation artifacts 的完整 exportDigest/code closure drift，以及 old-run check 返回 silent-rebaseline-blocked 而该检查期望成功。原 sealed baseline 实际仍 ok:true/resolvable:true。源码变动与原已提交发行闭包不一致的证据原样保存；本轮不修改或重算任何共享/已提交 Foundation 锁，不放宽旧 active-run 断言，也不提前认定 oracle 过时或这必然是可接受行为。Root 合最终源与 adapter 统一重建发行后，必须按原 F04/B09（旧 Run 保持其固定资产与明确迁移边界）重新判断；仍失败则依原语义处理真实缺陷。本候选不以72绿色冲抵它们。

## 执行、边界与交接

实际 Node24.15.0、Python3.14.7。原始 argv/cwd/UTC/退出码/输入与 stdout/stderr SHA 见 raw-display-index.json；原字节保留 ignored .local/P1_2-mixed-hook-preservation。记录的三个公开测试进程句柄均已终态，knownOpenHandles=[]。bash -n 与 git diff --check 均通过。

所有测试 PATH 带外部模型 CLI、容器、远端平台/分发 CLI 拒绝器，实际调用0；没有模型、Docker、API、secret、新依赖或全局配置操作。HOME 保持原值；未写主检出、真实 settings/.mcp、方法正文、锁、DAG/进度/业务 phase。旧 P1_1 新安全、OS 与实际 Host 资格均未消费为通过。

Root 独立双审、串行接纳和统一发行/旧 Run 语义复验仍前置。业务接受增量0。
