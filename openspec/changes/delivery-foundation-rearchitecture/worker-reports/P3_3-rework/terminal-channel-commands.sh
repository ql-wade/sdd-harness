#!/bin/sh
# =============================================================================
# P3_3 rework（rework-seven-p1-r1）— 终端通道清单（对照 I02 terminal-channel-commands.sh 先例）。
# 会话沙箱无 docker daemon（EPERM，实测在案）；本清单不代跑、不伪造其输出。
#
# S0 结论（已验证，无需终端通道）：P3_3 的 construction scope（恢复配方 +
# 有限核心事务恢复切片）零 docker 类操作——全部证据来自真实受管 Comet CLI
# 子进程（fingerprint d4370930，node spawn + 真实 SIGKILL）与真实磁盘字节
# （journal/锁/yaml/回执读回）。已执行证据：
#   worker-reports/P3_3-rework/evidence/05-owned-suite-green-x2.txt
#   worker-reports/P3_3-rework/evidence/04-green-journey-pass.txt
#   worker-reports/P3_3-rework/evidence/14-kill-window-evidence.txt
#
# 以下段落属于 V_RW_REAL_COMET_RECOVERY 的 VERIFY 尾（同产品 Run 的 live
# Outline 未知结果窗口 + 独立监控/备份资格），本任务不执行、不签 PASS；
# 逐段人工在具备 docker daemon 的终端通道执行，每段判据全部满足才算该段
# PASS；任何一段不满足即停，未执行段落一律记 UNVERIFIED（holder=VERIFY）。
# =============================================================================
set -u
REPO="$(git rev-parse --show-toplevel)" || exit 1

# -----------------------------------------------------------------------------
# S1 Outline 栈健康（VERIFY 尾前置；仅当该 Run 的恢复窗口需要 live Outline 时）
# -----------------------------------------------------------------------------
docker version --format '{{.Server.Version}}'
# 判据 S1.1：输出版本号（非 EPERM/连接错误）；失败即 S1 段 UNVERIFIED 终止。
docker compose -f "$REPO/infra/delivery/outline/compose.yaml" ps
# 判据 S1.2：outline/postgres/redis/minio/dex 五服务 Up（digest-pinned，images.lock
#            准入在案）；缺失即 S1 段 UNVERIFIED——不得以宿主 curl 代替容器内判据。
docker compose -f "$REPO/infra/delivery/outline/compose.yaml" exec -T outline wget -qO- http://127.0.0.1:3000/health
# 判据 S1.3：输出健康回报（容器内 200）；失败即停。

# -----------------------------------------------------------------------------
# S2 恢复窗口注入（VERIFY 尾；真实容器级故障注入，接受器=Outline 容器，非计数脚本）
# -----------------------------------------------------------------------------
# 在 V_SAME_RUN_DELIVERY 同产品 Run 的 pending Outline publish 窗口内：
#   docker compose -f "$REPO/infra/delivery/outline/compose.yaml" kill outline
# 判据 S2.1：容器真实退出（docker ps 显示 Exited/重启中）；独立监控（I07）留
#            下故障证据；随后 Comet 监督器仅恢复原 authority（同 Run/operation）。
#   docker compose -f "$REPO/infra/delivery/outline/compose.yaml" up -d outline
# 判据 S2.2：恢复后按 H04/H05 读回固定 UUID 文档与 lastRevision；无重复发布、
#            无重复建页；未满足即 UNVERIFIED（不转 PASS）。
