# Comet Runner 镜像构建声明（RunnerInfra.v1 / RoleBoundary.v1）—— 仅声明：本宿主无 container daemon（EPERM），
# 该构建从未执行，buildStatus=UNVERIFIED（见 infra/delivery/runner/image.lock.json sourceInputs.containerBuildStatus）。
# 基镜像与全部固定哈希经 --build-arg 从 infra/delivery/runner/image.lock.json 解析注入；本文件不内嵌任何 tag/digest/哈希值。
# 构建契约复用 toolchain-baseline.json extension_delivery 的限定 prepare/build 工具（P1_1/P1_6，hostBuildFingerprint 见 lock）。
# 基镜像须提供 node 24.15.0 / pnpm 10.18.3 工具链（integrations/comet/upstream.lock.json toolchain）；其选定与认证属资源准入（up 前）。

ARG RUNNER_BASE_IMAGE
FROM ${RUNNER_BASE_IMAGE}

# 固定输入（构建入口注入，对照 integrations/comet/upstream.lock.json 与 image.lock.json sourceInputs）：
#   SOURCE_SHA256        <- sourceInputs.archiveSha256
#   PATCH_0001_SHA256    <- sourceInputs.patches[0001-matt-method-profile].sha256
#   PATCH_1_6_SHA256     <- sourceInputs.patches[tests/1_6].sha256
ARG SOURCE_SHA256
ARG PATCH_0001_SHA256
ARG PATCH_1_6_SHA256

# 构建上下文 = 仓库根。限定工具与 lock 以仓库布局镜像进容器，使 build.mjs 的补丁完整性检查
# （PATCH_INTEGRITY_MISMATCH 纪律）按原相对路径生效。
COPY tools/comet/ /build/repo/tools/comet/
COPY integrations/comet/upstream.lock.json /build/repo/integrations/comet/upstream.lock.json
COPY integrations/comet/patches/0001-matt-method-profile.patch /build/repo/integrations/comet/patches/0001-matt-method-profile.patch
COPY integrations/comet/patches/tests/1_6.patch /build/repo/integrations/comet/patches/tests/1_6.patch
COPY .sdd/cache/runner-build/comet-source.tar.gz /build/comet-source.tar.gz

# 输入完整性：archive 与两 patch 的 sha256 必须与 lock 一致，任何不一致立即终止构建。
RUN echo "${SOURCE_SHA256}  /build/comet-source.tar.gz" | sha256sum -c - \
  && echo "${PATCH_0001_SHA256}  /build/repo/integrations/comet/patches/0001-matt-method-profile.patch" | sha256sum -c - \
  && echo "${PATCH_1_6_SHA256}  /build/repo/integrations/comet/patches/tests/1_6.patch" | sha256sum -c -

# 受控构建（声明）：prepare + build 由限定工具执行，补丁按 lock 校验应用，fingerprint 由工具按
# archive+patches+toolchain 计算；容器内 fingerprint 须与 sourceInputs.hostBuildFingerprint 一致方可作为镜像内容。
# 本步骤从未执行（UNVERIFIED）：准入时先在受控环境重建并核对 fingerprint 与 digest，再认证镜像。
RUN node /build/repo/tools/comet/build.mjs \
      --archive /build/comet-source.tar.gz \
      --project /build/work \
      --lock /build/repo/integrations/comet/upstream.lock.json

# 非 root 运行身份与角色工作区挂载点（挂载策略见 workspace-mounts.json；控制卷只对 controller 可写）。
RUN useradd --uid 10001 --user-group --create-home comet \
  && mkdir -p /comet/state /comet/receipts /comet/issuance /workspace \
  && cometEntry=$(find /build/work/builds -path '*/work/bin/comet.js' -type f | head -n 1) \
  && ln -s "$cometEntry" /usr/local/bin/comet-runner \
  && chown -R comet:comet /comet /workspace

USER comet
WORKDIR /workspace
ENTRYPOINT ["node", "/usr/local/bin/comet-runner"]
