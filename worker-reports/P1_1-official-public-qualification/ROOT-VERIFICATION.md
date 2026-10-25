# 官方公开接口隔离资格：Root 复验

2026-10-26，原 P1_1 的受限资格研究。结论：机械观察通过，研究可消费；不批准生产版本切换、旧 Run 迁移、profile 启用或业务验收。

## 候选与实际执行

- 固定 `@rpamis/comet@0.5.0`，gitHead `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`；npm tar SHA256 `a36d88cd065e92266d483a6bf4946f9d61149a12f3075df107bfde3f4ad9c47f`。
- 作者冻结 manifest `5d4979ea48ee3e4b2d13445b36ca2659e82dfe231d2da6f270947bdd8324eaf5`，82/82 文件逐项核对并保全。官方包及 13 个依赖共 4,462 个解压文件与锁定 tarball 字节一致，无额外文件。
- Root 使用固定 Node 24.15.0 独立执行 `run-fixture.mjs`，会话 90083 终态 exit 0；prepare/resume/finish/deliver 四进程均 exit 0。独立目录 `qualification-WOp14F` 的同一 Run 达到 revision 51/completed。
- A/T/P 顺序、缺工件/错误语义/旧摘要拒绝、真实 Wait 阻断、过期 CAS 拒绝、跨进程保留原 Action/outcome 均有实际记录。两个不支持的 postarchive 插入点确实被工厂拒绝。
- 原生 Build/Verify 真实执行本地 Node 测试；原 Archive 执行实际 OpenSpec 1.14.3，再由本地 Git 提交通过原 delivery validator。它们是机械样例的实际操作，不是生产流程验收。
- 现有 `prepareCometSource`、`verifyPreparedSource` 也在另一 tmp 项目完成精确 0.5.0 GitHub 源码快照准备和 provenance 读回；55,731,441 字节归档 SHA256 `f89d7bf192be2a2f34501726148c503929e7bea164f7be88a041a2390857c3b0`，4,006 个安全成员，pnpm lock 与精确提交留存锁一致。未构建、安装或改生产锁。
- 原计划 `plan_guard.py` 返回 exit 0、valid；这只说明冻结计划结构未漂移，不是产品 ready。

原始记录保全在主检出 `.local/comet-reset/official-public-qualification/`，包括原冻结 82 文件、Root 四进程日志、真实最终 Run、原生输入及公开包字节校验。Root proof SHA256 `7a1a36302d6d514ee02c41ebfa478325bb32452a327a06b54302835455cc9099`。初次证据复制把作者派生的 `actual-run-input.json` 当成新 runner 必写文件而停止；已保留说明，改为保存原生 `fixture-input.json` 及明确标注的最终 Run.input 提取，未改写源证据。

## 独立审查与剩余工作

[Spec](reviews/spec.md) 和 [Standards](reviews/standards.md) 均通过限定机械研究范围；生产迁移仍 NO-GO。原 `/comet`/阶段命令不会自动绑定定制 application，真实 loader/CLI/宿主链及同 Run 后置 Kt 仍有缺口。后续 CLI 资格在另一 tmp 根独立进行，不修改本冻结样例。

角色及用户决定均为 synthetic fixture；真实角色、OS/ACL、平台、知识权限、旧 Run 兼容、生产 OpenSpec 1.11.0 及还原字节后旧证据不复活尚未验证。未使用 `.openspec.yaml` 依赖图契约，不能以旧文件路径归档代替它。没有 OS 或网络隔离证明。

Standards 的后续环境隔离建议保留原文。宿主规则禁止重设 HOME/CODEX_HOME，因此不采用其临时 HOME 建议；下一切片使用 COMET_DATA_DIR/XDG、禁系统/全局 Git 配置和空 hooks/templates，并明确保留隔离能力边界。

本轮业务接纳增量 0，原 129 required/103 场景与 F10 另期处置不变。主版本仍 0.4.5；官方最佳实践对齐不自动构成升级决定，后续版本选择必须以满足全部原义务的实际接线成本和证据为依据。
