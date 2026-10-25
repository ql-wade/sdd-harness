# Foundation 分发资产

基础 scaffold 继续提供方法、hooks、MCP与验证工具。唯一可选受管 profile 是 `comet-managed-v2`；源数据在 `profiles/comet-managed.json`，当前仍为 UNQUALIFIED。分发、缓存或技能发现不授予业务执行、角色或发布权限。

`tools/foundation-export.mjs export` 从 `.agents/skills`、hooks.yaml、能力/注册产物和当前方法/profile源生成发布视图。原文只在唯一源维护；`release/` 与 `foundation-lock.json` 是生成物。当前 profile 只选择 MF 登记的方法，source_path 只是来源显示。`release/profile/binding.json` 保存 MF 与 profile 数据的准确源路径/字节摘要；FoundationLock.methodProfile.digest 是该绑定的 canonical JSON 摘要。完整 exportDigest 还固定方法、策略、MCP、能力源、工具版本及23个明确项目代码文件和3份依赖元数据的字节摘要。

```bash
node tools/foundation-export.mjs export --root . --out foundation
node tools/foundation-export.mjs verify --root . --lock foundation/foundation-lock.json
node tools/foundation-export.mjs export --root . --out <private-package> --skills-copy
node tools/foundation-export.mjs verify --root . --lock <private-package>/foundation-lock.json --require-bodies
```

普通发布视图可以仅含方法清单；需要完整正文的消费者必须显式要求 `--require-bodies`，分发视图不能通过修改 bodyCopies 标记豁免缺件。完整包包含 dotfile/fixture/binary 原字节，少件、增件或源漂移均拒绝。当前profile的 `release/code/` 保存明确项目调用闭包及原始 package/package-lock/Comet pin 元数据；MANIFEST固定全部字节，缺件、增件或改件均拒绝。项目闭包包含exporter的契约模块、bootstrap实际调用脚本、MCP launcher、三个hook共享resolver和adapter的managed_io；不递归打包整仓。未登记/退役工作流不能由 exporter 或 adapter 重新暴露。用户同名目录、外部链接、旧 command 输入和不可解析配置只会被保留并阻断安装，不按前缀删除。adapter安装和卸载共用基于目录句柄的no-follow检查，覆盖settings、compiled文件及其受管祖先；非普通文件、多重硬链接和非本工具生成的compiled内容均保留并拒绝。文件先校验和暂存再原子替换，settings用户字段与原mode保留，技能链接仍按准确目标判定归属。

目标模式的 bootstrap 在安装时使用 `--freeze-baseline`，按 exportDigest 在 `baselines/` 原子封存不可变纯资产。缓存只含明列的源方法、23个项目代码文件、3份依赖元数据、策略、能力/注册产物、版本/profile/MF和锁；没有 Run、phase、用户本地配置、凭据或真实知识。重读核对每项字节和完整 exportDigest；重复拉取不覆盖旧缓存。缺件、篡改、额外文件或symlink逃逸返回 STATE_SYNC_REQUIRED，保留旧锁/缓存，不退回任意Git头。它证明资产可解析，不是完整Node/Comet运行环境备份，运行恢复仍需原任务资格化。

`check-run` 对原生 `.comet/run-state.json` 只读。原 `--acquire/--migrate` 只保留有限 legacy 资产元数据兼容，不能获取或改变原生 Comet Run，也不是角色认证或第二控制器。实际派发、phase、重试、恢复、归档和完成仍由原 Comet 内核负责。

缓存提供可核验的项目源字节，不携带外部Node/Python/Bash、npm模块或LLMWiki venv。Node/Comet精确版本来自原upstream lock；npm精确依赖来自原package-lock，运行时缺失不能作为已安装或已资格化。adapter明确要求Python3及POSIX no-follow/dir_fd支持，缺失即失败；本次实测宿主版本与必要调用依赖盘点见P1_2 `rework/CURRENT.md`。旧6脚本缓存逐字节保留，它缺少本次明确闭包，不能通过新规则冒充完整可重放材料；原锁未刷新，无法证明时保持STATE_SYNC_REQUIRED。

export/verify共用分发路径检查，目录根、每级祖先和最终文件都拒绝用户符号链接及不安全类型。export先收齐全部输出并预检已有release树，再创建缓存/写入视图；写入普通文件采用no-follow读取与原子替换，多重硬链接拒绝。verify在读取锁与视图前检查包根和release树；完整正文比较也检查方法目录根，链接到另一checkout不能充当可分发正文。Darwin的/var、/tmp、/etc仅在准确解析到对应/private系统目录时作为OS命名空间处理，用户路径别名始终拒绝。
