ARG PYTHON_BASE_IMAGE
ARG NODE_BASE_IMAGE
FROM ${PYTHON_BASE_IMAGE} AS python-runtime
FROM ${NODE_BASE_IMAGE}
COPY --from=python-runtime /usr/local/ /usr/local/
RUN node -e 'if(process.version!=="v24.15.0")process.exit(1)' && python3 -I -c 'import sys,ssl,tarfile,hashlib,bz2,lzma,ctypes,sqlite3; assert sys.version_info[:2]==(3,12)'
USER 65534:65534
ENTRYPOINT ["node"]
