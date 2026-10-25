# P1_2 当前建设候选

本次基点为 f49795b，分支 codex/comet-distribution-cleanup；仅通过原任务 P1_2←P1_6 已独立审查的 construction 工件边实施。Root仍是唯一控制器。未改 tasks/DAG/契约/进度、Comet补丁及正式锁、MCP能力源/注册器、原样方法或受保护 profile 数据。Root后续主检出版本和129/103本期范围由Root维护，本树不重新冻结或继承其结果。

本目录日志/路径元数据是**便携显示副本**，不冒充逐字节 stdout/stderr。原件和每条命令的UTC、cwd、argv、退出码、日志摘要保存在被忽略的 `.local/distribution-current/raw/`；准确 intake 与5项配置原始摘要在同目录父级 intake.json。原P1_6的.local材料原样保留。`<worktree>`、`<host-home>`、`<temp>` 等仅是显示标记，不能执行。commands.json/observations.json 保存原始与显示摘要和输入指纹。探针源码 cold-native-probe.py 可从当前库根重放，不启动模型回合。

## 实施

- 修复非Git包枚举跳过dotfile、UTF8转换二进制、分发缺件/增件/整目录丢失仍验证成功的根因；完整正文消费者使用 `verify --require-bodies`，分发数据不能自行降级其要求。
- 从MF登记选择11方法；当前ID固定comet-managed-v2。MF和profile原字节随release/profile分发，binding与FoundationLock精确绑定；重建过期的当前发布视图，不刷新任一旧Run锁。
- adapter只链接选定方法。退役source/旧command迁移输入、用户同名目录、外部输出链接均保留并拒绝；坏settings与插件冲突在生成产物前拒绝。保留e0fde44精确受管归属/只读退休检查和291ccc8私有配置纪律。策略仍唯hooks.yaml，未复制Ponytail插件职责或手改compiled env。
- 为无资产仓库Git历史的成员目录按exportDigest原子封存纯资产。源码清单只包含245方法文件、6个明确运行脚本、策略、MCP/能力注册、package/工具锁、MF/profile和FoundationLock。每项字节和整体摘要重算；旧缓存不覆盖，缺件/篡改/额外文件/符号链接逃逸拒绝。不是Node/Comet完整运行环境备份，不含业务Run、用户本地设置、真实知识或凭据。实现说明见foundation/README.md。
- 原生Comet Run通过固定b11真实CLI创建并观察。资产helper对原生Run只读，拒绝 acquire/migrate；缺旧材料保持STATE_SYNC_REQUIRED。legacy owner/status只保留旧资产元数据组件兼容，不能认证角色或成为主控。

## 有效RED和验证

有效RED分别由实际export/verify、adapter和真实内核Run触发，详见red-cold-copy、red-profile-binding、red-discovery、red-native-authority、red-copy-set、red-transport-baseline。缺依赖/脚本语法错误/首次私有host启动失败均未算行为RED或PASS。普通旧漂移正例夹具改用真实Git历史，保留拒绝oracle。

最终本包三个测试模块：53通过、0失败、0跳过；显式Node TAP输出。源文件和profile_data原字节另有独立读回检查。

真实私有链按最终源输入哈希执行：bootstrap → 原生Comet init → bootstrap → Comet update → repeat pull → 两方uninstall → Comet reinit → bootstrap。用户设置保留、锁字节稳定、无退役安装调用。最终由真实内核产生Run，资产readback在无Git工作区成功，原生Run字节不变。固定b11是已有供应构建，未伪称新Root发行构建。

独立新宿主实际调用initialize/initialized/skills/list，11个声明项目路径及245文件匹配，没有sdd/source-command-sdd/trinity/superpowers入口；没有thread/start或turn/start。返回列表还含原生Comet、系统/上游Ponytail子技能及重复同名Ponytail项，绑定以准确路径区分，未宣称独占11名称或方法应用通过。原生警告显示项目未trusted、项目配置/hooks/exec policies禁用而skills仍加载；**原生hook enforcement未验**，装配/脚本验证不代替它。参考的公开协议：[OpenAI App Server](https://learn.chatgpt.com/docs/app-server#skills)。私有host已finally wait清理并记录结果。

本树总检查为533项522通过/11失败/0跳过，总入口仍失败。剩余TAP旧调用、OpenSpec/旧P1_5摘要、I02镜像/Runner、Outline等逐项留在repository-final显示日志，保持原owner。它既不是Main最新数字，也不是zero-newfail或整体验收结论。

## 未验

真实角色与方法应用、配额/权限、原生受信任宿主hook执行、TeamAI服务端推送、平台/部署/知识Kp/唯一归档/Kt/撤权恢复，以及完整同Run旅程均未签验。profile仍UNQUALIFIED。原生父角色、可信回执与业务门仍由原下游任务和VERIFY证明；本包不关闭这些义务。
