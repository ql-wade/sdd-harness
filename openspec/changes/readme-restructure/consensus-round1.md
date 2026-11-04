# README 重构 consensus 存档（round 1，2026-11-04）

> 三席透镜：定位与受众 / 信息架构与渐进披露 / 可实施性与维护性。三席均 REPAIR——
> 12 major + 14 minor 全部合并为 11 主题逐字落文（proposal v2/v3，处置对照表见
> consensus-round1-progress.md「moderator 合并处置」节）。moderator 认证：九节结构
> 与读者动线三席一致成立，findings 均为文本级/事实级修正，无 blocker、无方向性推翻。

## 裁决

| 席 | 透镜 | VERDICT | findings |
|---|---|---|---|
| 1 | 定位与受众一致性 | REPAIR | 2 major + 6 minor |
| 2 | 信息架构与渐进披露 | REPAIR | 5 major + 6 minor |
| 3 | 可实施性与维护性 | REPAIR | 5 major + 2 minor |

关键修正（major 级，全部实证）：前置要求错列（工具链 ≥18 vs 旅程 ≥22.16）、决策者
首跳指向设计态文档、快速开始丢 SDD_SESSION_ID/两步安装、审批点宿主标注错误
（/dev/tty 非 agent chat）、CI badge 实测全红（分步条件）、D5 目标文档写错
（分层图在 scaffold-architecture.md:30-42）、同步纪律缺位（FRAMEWORK v27 漂移实证）、
D3 素材不可定位（判定语义表转正、不发空占位）。

minor 亮点：审计回读读者补入（五类读者）、Kt 终点行、compare 措辞中性化、
tagline 定语统一「脚手架」、engineer 路径消分叉、D1=A（docs/reference.md 三条件）、
D2 一句话+链接零损失（yaml 全信息核实）、仓库实际公开（非内部措辞修正）、
AC-3 at-risk 八项清单、AC 双轨 route 自举。

## 研究来源与共识强度分级（11 来源，2026-11-04 实抓原文）

**业界共识（≥3 独立来源交叉）**：首屏四问（GitHub docs + opensource.guide +
makeareadme）；badges（makeareadme + awesome-readme + 6/6 实测）；demo/视觉
（makeareadme + awesome-readme + 4/6 实测）；快速开始最小化（makeareadme + 全实测）；
渐进披露 README→docs（GitHub docs + makeareadme + Diátaxis + 7/7 实测）；FAQ/陷阱
入口在 README 内容在 docs（goose + aider + backstage）；双语 = 平级翻译文件
（opencode 22 语 + OmO 10 语 + spec-kit + backstage）；agent 入口与 README 分工
（agents.md 标准 + OpenSpec/opencode 生态实践）。

**品类强模式（流程/平台类多来源）**：按需决策表（spec-kit）；双受众分节
（cookiecutter + backstage）；对话 transcript demo（OpenSpec）；Why/compare 章节
（spec-kit + OpenSpec）；Adopters 资产（backstage）；自证专章（spec-kit + OpenSpec）；
命令宿主标注（spec-kit）；判定语义显式化（spec-kit verdict 表）。

**单一来源/权威规定**：README 只放上手必需（GitHub 官方文档精确表述）；相对链接
规则与 500 KiB 截断（GitHub 官方）；Diátaxis 四象限（单框架，Gatsby/Cloudflare/
Vonage 背书）。

**打折共识（外部成立、本仓库缩减）**：badge 全家桶（内部仓库仅 CI/环境/license——
实测修正后：CI 红暂不上、无 license 不加、静态版本 badge 裁弃）；多语言矩阵
（中文团队仓库——项目所有者 2026-11-04 裁定中英双份，EN 主 + ZH 平级，回归业界范式）。

**来源清单**：sst/opencode、code-yeongyu/oh-my-openagent（OmO，前身 oh-my-opencode，
多源交叉确证）、Aider-AI/aider、block/goose、anthropics/claude-code、github/spec-kit、
Fission-AI/OpenSpec、backstage/backstage、cookiecutter/cookiecutter、agents.md、
docs.github.com/about-readmes（+ makeareadme、opensource.guide、awesome-readme、
diataxis.fr 辅助）。各 README 为 2026-11-04 单时点快照。

## 收敛认证

三席 findings 全部为可修订项（无 blocker、无方向推翻），v2/v3 逐字应用后 moderator
认证：README 重构方案共识成立。定位决策（架构展示页 + 中英双份 + 去 AI 味）为项目
所有者 2026-11-04 直接指令，v3 已记录。
