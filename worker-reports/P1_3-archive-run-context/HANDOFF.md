# P1_3 / P3_4：归档后原 Run 上下文候选

状态：实现与作者组件检查完成；冻结等待独立 Spec / Standards 审查及 Root 集成，不签业务验收。

本子步沿原 P1_3 / P3_4、现有 public SpecAdapter / Host seam 和唯一 DAG；Root 仍是唯一迁移控制器和台账写者。未改 tasks、DAG、contract、plan 锁、0002/0003 patch、原 Native aggregate 或旧分支。旧 D/E 证据目录未清理、重写或借作新候选资格。

## 行为与最小修复

Host 原先把 changeDir 固定为 `openspec/changes/<change>`。真实原 Native Run 移到唯一 archive 目录后，公开 `describeCurrent()` 仍在旧路径 lstat，出现 ENOENT。01 保存最初 RED；12 用最终测试夹具和基线 6f1fda0 Host 再校准，同样 1 fail / 0 skip，证明不是工具缺失、超时或空匹配。

- `lib/adapters/spec.js`：新增内部固定 CODE `readRunContext({change,expectedRunId})`。使用已有唯一 private `location()`，先确认原 Run 文件与 ID；之后仅调用原 `ensureClassicRuntimeRun` 解析，再重核同目录（含 inode/device）、同 Run。返回原 Native context、实际目录及同步 `assertCurrent()` 闭包。闭包固定捕获标量，不受返回视图或请求后改影响；不存在第二导出 resolver 或位置账本。
- `lib/adapters/comet-executor.js`：invoke/currentIntent/describeCurrent 全部消费这个 reader。原 Native 同步签发先调用闭包，再检查该准确目录中的原 Native 锁；缺上下文、完成态、位置改变、串 Run、缺锁或锁软链拒绝。未添加任意 archive/CLI 转发。该端口只读回，不赋予 Gate、归档、Kt 或整体完成资格。
- `infra/delivery/runner/image.lock.json`：仅在既有 bootstrap 文件闭包加入固定 `lib/adapters/spec.js`，其余字节与基线一致。`tools/infra/runner.mjs` 仅在 safeBootstrapFile 精确 allowlist 增加该固定文件；相邻未登记 adapter 仍拒绝。
- 三个 owned 测试文件保留旧断言，补齐公开 Host 归档读回和锁签发、completed/串 Run/位置和锁竞争拒绝、Spec 预读防护/Native 后重核、bootstrap seal/cold-copy/缺依赖与未登记 adapter 拒绝。

Native 完整 Run reader 会校验受管 policy，所以原只读 Host 夹具的空 policy 补齐固定 ref/digest/revision 与 Kp/Kt 必需位；source qualification 仍缺失，既有资格与不启动断言未放宽。Native 全局 Host 注册沿既有子进程 fixture 隔离，不以重复注册伪造正常行为。

## 实跑证据

固定 Node 是 `/Users/mac/.nvm/versions/node/v24.15.0/bin/node`，实际 `v24.15.0`；二进制 SHA、7 个 owned 文件 SHA、精确所有权检查见 `scope-proof.json`。原 6da aggregate SHA `04795080295d7174af82913757254426b82037ea5028296a3602b86d200559dd`，OpenSpec 1.11.0 tar SHA `84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f`。工件从现有 Root 目录只读消费；没有复制全缓存或下载新源。

最终命令均在本工作树运行，保留原始输出：

```sh
TMPDIR=/private/tmp PATH=/Users/mac/.nvm/versions/node/v24.15.0/bin:$PATH P1_3_ACCEPTED_ARTIFACT_ROOT=/Users/mac/Code/sdd-harness node --test --test-reporter=tap test/spec-closeout.test.js test/comet-execution-binding.test.js test/comet-driver.test.js test/delivery-gate.test.js
# 18-final-source-regression.tap：207/207，0 fail，0 skip；session 40655

TMPDIR=/private/tmp PATH=/Users/mac/.nvm/versions/node/v24.15.0/bin:$PATH node tools/infra/runner.mjs build-plan --json
# 20-final-bootstrap-plan.json：exit 0；仍 ready:false / UNVERIFIED / executable:false

TMPDIR=/private/tmp PATH=/Users/mac/.nvm/versions/node/v24.15.0/bin:$PATH node --test --test-reporter=tap --test-name-pattern='Runner bootstrap plan seals|Runner bootstrap source view loads|Runner bootstrap refuses an undeclared import' test/infra-runner-isolation.test.js
# 21-final-bootstrap-seam.tap：3/3，0 fail，0 skip；session 64064

git diff --check
node --check lib/adapters/spec.js
node --check lib/adapters/comet-executor.js
node --check tools/infra/runner.mjs
bash scripts/agent-instructions-check.sh
bash scripts/agent-skill-check.sh
# 固定 Node 24.15；19-static-checks.log，均 exit 0
```

完整 owned 两份回归先前 99/99（session 19369，09）；相邻 driver/Gate 108/108（session 43707，11）。最终 207 是同一最终源码候选的合并复跑，不把这些累计为更多测试。所有 final 输入、Root 原 Native / tar、contract / DAG / drift-lock 与在场活配置摘要前后不变，见 inputs-before / inputs-final。

02 保留完整 Native reader 对旧空 policy 的真实拒绝；05 保留新测试对 `/var` 与 `/private/var` 别名的不当直接比较，之后只规范化新 fixture。07 保留首次签发矩阵的跨 fixture Native 全局注册污染，之后沿既有独立进程隔离。10 是新 import 未纳入 bootstrap 的真实拒绝；13/14 是补清单后 fixed allowlist 尚未同步的真实拒绝。16 的冷拷失败来自既存 temp 真实路径断言别名；未改旧断言，17/21 用 canonical TMPDIR 实际通过。03/04/06/08/09/11/17 为中间 GREEN；15 的摘要早于最终解释注释，仅保留历史，最终摘要以 20 为准。

最终 bootstrap digest：`a3d969932189bd8ba379269d04c7f49599bdef76329d11c8a5249b9c6031ebaf`。
最终 context digest：`329e733728df4bbcd0c63846d3b4132d7b10e650bf9b6acf189a91c0cb57ab71`。
旧 D/E 镜像证据不覆盖这些新字节；后续必须在最终集成候选上重建并重新资格化，当前 build-plan 的 exit 0 仅证明声明可导出。

## 边界与后续

未执行真实 Docker/模型 CLI、认证、网络、凭据、Outline 或平台写。既有 Host 组件回归使用原 Node 子进程协议 fixture，不能冒充真实 Docker、OS 隔离或角色资格；新增 archive 签发正反例均在物理启动前结束，相关 authority 拒绝例签名调用 0。

本树缺完整受管 Native/tools 缓存，未运行会触发所有环境路径的全 I02 矩阵及全仓 `bash scripts/check.sh`；由 Root 在完整最终集成输入和外部拒绝器下执行。独立 Spec/Standards、Root 集成、实际 Runner 重建/资格、生产角色、Kp→归档→Kt 与总体 Journey 均未验收。此候选不改变任务勾选或为业务完成签字。
