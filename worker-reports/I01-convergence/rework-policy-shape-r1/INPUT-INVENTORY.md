# I01 外部输入盘点（修改前）

盘点基线为 `0d4615a9a93557af41c99a5243aff1121f3a124c`。本文件先于产品修复保存；本轮只使用私有 fixture、假 CLI 或空 PATH。最小反馈环已实际复现：roles 对象在 validate/status/qualify/up 均导致 `roles.includes` TypeError、exit 1、stdout 为空。

## 公开入口和文件

| 输入 | 当前消费链 | 本轮统一边界 |
| --- | --- | --- |
| command / CLI options | parseArgs → main；目前任意 `--name` 被接收，未知参数或位置参数可被忽略 | 已知命令及其被消费的选项、非空单值、缺失值/重复/未知项先拒绝；输入错误保持 exit 1 |
| `--registry` JSON | registered identity；resources/delegates → Set/map/find；resource image；runtimeRequirement.node → split/some | 保留既有对象/数组/元素准入；补齐 optional image/runtimeRequirement 的声明类型，避免外部 CLI 之后才在 range.split 崩溃 |
| `--refs` JSON | validateRefsCatalog → Map/循环；registry 建 Set；resolver find；allowedPrincipals.includes | 先验目录/元素/角色/主体数组；数组元素必须是声明类型。SecretRef.v1 最小 API 在现有 platform fixture 中不带 schemaVersion/project，保留此既有形式；若显式提供 schemaVersion 则只接受 1 |
| `--policy` JSON | registry → shared catalog options.roles.includes；image RegExp；qualifier categories.map / fromEntries；upGate 文本 | 完整 Qualification.v1 对象/版本/字段校验必须在以上读取前；不通过 try/catch 吞掉消费错误 |
| `--archive` | hash/stat → tar listing | 缺失/不可读/非文件先报输入无效，不启动外部 CLI；存在但摘要不匹配保持 qualification MISMATCH / exit 2 |
| `--npm-metadata` JSON | hash/read → version/integrity/license 与 lock 比较 | 文件和 JSON 对象/已提供字段类型先验；合法但证据不齐/不匹配仍为 UNVERIFIED，不把缺证据当行为 RED |
| resource.lockRef JSON | containment → readLock catch；source/package 字段使用类型检查/optional chaining | 缺锁/缺 pin 为已有 qualification UNVERIFIED；不增加启动能力或把声明当实测。锁路径包含边界保持原逻辑 |
| `readback --kind github` | 只消费 kind/registry，已登记 GitHub 输入先验，再调用 gh | 本轮不访问新 API；不消费的 policy/refs 等选项不能被默默忽略后触发 gh。既有 repo/caller 响应形状拒绝保留 |

## Qualification.v1 所有字段

| 字段 | 当前操作 | 校验要求 |
| --- | --- | --- |
| policy 本体、schemaVersion、interface | 读取缺省后继续执行 | 非数组对象；必需版本 1 和 Qualification.v1；缺失/未知版本拒绝 |
| roles | shared `.includes` | 非空、无重复的合法角色名字符串数组；缺失、null、对象、元素 null/对象等拒绝 |
| evidenceCategories | `.map` / Object.fromEntries / 逐项状态 | 非空、无重复的已实现类别字符串数组；八个必需类别不可缺失，未知类别不能冒充实现 |
| imageReference | 读取 flags；`new RegExp(digestFormat)` | 对象；必需布尔字段；固定 SHA256 契约格式字符串，畸形/可放宽 digest 的表达式拒绝 |
| upGate | refusalReason 输出；资格拒绝仍由实现执行 | 对象；requireAllCategoriesVerified/enabled 为布尔；refusalReason 非空字符串；这些字段不构成授权 |
| secretValueKeyNames | 当前仅声明；实际扫描规则编译在 secret-refs | 必需非空、无重复字符串数组；不由该声明替代编译安全不变量 |
| forbiddenHostPathPrefixes | 当前仅声明；实际扫描规则编译在 secret-refs | 必需非空、无重复路径前缀字符串数组；不由该声明替代编译安全不变量 |
| note 等未消费说明字段 | 不执行/不做 gate 决策 | 保留兼容，不新增授权语义 |

## 共享 validator / resolver 调用方

- `validateRefsCatalog` 当前生产调用方只有 registry 和 resolveSecretRef。第三个公开参数由 destructuring 取得 roles，尚未验证 options 或 roles 类型；本轮在共享层统一验证。可选 Qualification policy 也走同一共享 validator，不能由直接 API 静默忽略。
- `resolveSecretRef` 的生产调用方是 knowledge-authz 和 platform；二者当前不传 Qualification policy。保留不带该可选参数的既有 API；显式给出畸形 policy 必须 coded refusal。整个 options 为 null/数组等不能因参数解构产生 TypeError。所有拒绝 message 继续常量，code 保留。
- 数组操作相关数据完整列表：policy.roles、policy.evidenceCategories、refsDoc.refs、entry.allowedPrincipals、registry.project.delegates、registry.resources；静态规则数组和已验证内部状态数组不来自外部输入。
- platform 自有的 refs `.some` / `.find` 先行访问仍属 P4_1 owner，已单独移交；其其它平台策略和 knowledge preauthorization policy 都不是 Qualification.v1，不在本节点改写。

本轮不修改官方锁、主检出、任务/DAG、权限或历史原始证据；不重跑已执行的一次性 Outline 核验。以上盘点和后续负例共同供独立审查，未作为 I01/profile ready 证据。
