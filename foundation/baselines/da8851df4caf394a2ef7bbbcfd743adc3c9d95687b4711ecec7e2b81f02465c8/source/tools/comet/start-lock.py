#!/usr/bin/env python3
import fcntl
import os
import stat
import subprocess
import sys

if len(sys.argv)==3 and sys.argv[1]=='--claim-fd':
    fcntl.flock(int(sys.argv[2]),fcntl.LOCK_EX|fcntl.LOCK_NB)
    raise SystemExit(0)

if len(sys.argv)<3 or not hasattr(os,'O_NOFOLLOW'):
    raise SystemExit('start lock unavailable')
fd=os.open(sys.argv[1],os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
try:
    info=os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:
        raise SystemExit('unsafe start lock')
    fcntl.flock(fd,fcntl.LOCK_EX)
    env={**os.environ,'SDD_START_LOCK_FD':str(fd)}
    result=subprocess.run(sys.argv[2:],pass_fds=(fd,),capture_output=True,env=env)
    sys.stdout.buffer.write(result.stdout)
    sys.stderr.buffer.write(result.stderr)
    raise SystemExit(result.returncode)
finally:
    os.close(fd)
