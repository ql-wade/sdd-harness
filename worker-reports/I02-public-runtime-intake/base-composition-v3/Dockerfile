ARG PYTHON_BASE_IMAGE
ARG NODE_BASE_IMAGE
FROM ${PYTHON_BASE_IMAGE} AS python-runtime
RUN mkdir /public-pydeps && cp -L /lib/aarch64-linux-gnu/libbz2.so.1.0 /lib/aarch64-linux-gnu/libcom_err.so.2 /lib/aarch64-linux-gnu/libcrypt.so.1 /lib/aarch64-linux-gnu/libcrypto.so.3 /lib/aarch64-linux-gnu/libdb-5.3.so /lib/aarch64-linux-gnu/libffi.so.8 /lib/aarch64-linux-gnu/libgdbm.so.6 /lib/aarch64-linux-gnu/libgssapi_krb5.so.2 /lib/aarch64-linux-gnu/libk5crypto.so.3 /lib/aarch64-linux-gnu/libkeyutils.so.1 /lib/aarch64-linux-gnu/libkrb5.so.3 /lib/aarch64-linux-gnu/libkrb5support.so.0 /lib/aarch64-linux-gnu/liblzma.so.5 /lib/aarch64-linux-gnu/libncursesw.so.6 /lib/aarch64-linux-gnu/libnsl.so.2 /lib/aarch64-linux-gnu/libpanelw.so.6 /lib/aarch64-linux-gnu/libreadline.so.8 /lib/aarch64-linux-gnu/libsqlite3.so.0 /lib/aarch64-linux-gnu/libssl.so.3 /lib/aarch64-linux-gnu/libtinfo.so.6 /lib/aarch64-linux-gnu/libtirpc.so.3 /lib/aarch64-linux-gnu/libuuid.so.1 /lib/aarch64-linux-gnu/libz.so.1 /public-pydeps/
FROM ${NODE_BASE_IMAGE}
COPY --from=python-runtime /usr/local/ /usr/local/
COPY --from=python-runtime /public-pydeps/ /lib/aarch64-linux-gnu/
RUN node -e 'if(process.version!=="v24.15.0")process.exit(1)' && python3 -I -c 'import sys,ssl,tarfile,hashlib,bz2,lzma,ctypes,sqlite3,readline,curses,dbm.gnu; assert sys.version_info[:2]==(3,12)'
USER 65534:65534
ENTRYPOINT ["node"]
