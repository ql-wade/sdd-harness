"""Owned, non-interactive CLI process groups for reviewers and their controller."""

from __future__ import annotations

import atexit
import json
import sys
import os
import plistlib
import signal
import shutil
import subprocess
import threading
import time
from pathlib import Path

_live: set[subprocess.Popen] = set()
_lock = threading.RLock()
_cancelled = threading.Event()
_shutdown_grace = 3


def check_silent_command(argv) -> None:
    executable = Path(argv[0]).expanduser()
    executable = Path(shutil.which(str(executable)) or executable).resolve()
    if executable.name.lower() in {"open", "osascript", "terminal", "iterm", "iterm2"}:
        raise OSError("consensus requires a non-interactive CLI; GUI launchers are unsupported")
    # App-bundle runtimes propagate process.execPath to plugin subprocesses.
    if executable.parent.name == "MacOS" and executable.parent.parent.name == "Contents":
        info = plistlib.loads((executable.parent.parent / "Info.plist").read_bytes())
        if not (info.get("LSUIElement") or info.get("LSBackgroundOnly")):
            raise OSError("consensus requires a background app helper, not a foreground app executable")


def spawn(argv, **kwargs) -> subprocess.Popen:
    check_silent_command(argv)
    with _lock:
        if _cancelled.is_set():
            raise OSError("consensus execution cancelled")
        process = subprocess.Popen(argv, start_new_session=True, **kwargs)
        process._consensus_cleanup_dir = kwargs.get("env", {}).get("REVIEW_RUN_DIR")
        _live.add(process)
    if _cancelled.is_set():
        finish(process)
        raise OSError("consensus execution cancelled")
    return process


def _signal_group(process, signum, errors) -> bool | None:
    try:
        os.killpg(process.pid, signum)
        return True
    except ProcessLookupError:
        return False
    except OSError as exc:
        errors.append(f"signal {signum}: {exc}")
        return None


def _reap_group(process, deadline, errors) -> dict:
    # The leader can exit before its MCP children; retain the owned PGID.
    while time.monotonic() < deadline:
        if not _signal_group(process, 0, errors):
            break
        process.poll()
        time.sleep(0.05)
    _signal_group(process, signal.SIGKILL, errors)
    try:
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"wait: {exc}")
        try:
            process.kill()
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired) as exc:
            errors.append(f"leader cleanup: {exc}")
    status = "complete"
    members = []
    if errors:
        try:
            probe = subprocess.run(
                ["ps", "-g", str(process.pid), "-o", "pid=,stat="],
                capture_output=True, text=True, timeout=2,
            )
            if probe.returncode not in (0, 1):
                raise OSError("owned process-group membership unavailable")
            rows = [line.split() for line in probe.stdout.splitlines() if line.strip()]
            if any(len(row) != 2 or not row[0].isdigit() for row in rows):
                raise OSError("malformed process-group membership response")
            members = [" ".join(row) for row in rows if not row[1].startswith("Z")]
            status = "failed" if members or process.returncode is None else "complete"
        except (OSError, subprocess.TimeoutExpired) as exc:
            errors.append(f"membership probe: {exc}")
            status = "unverified"
    receipt = {"pid": process.pid, "pgid": process.pid, "status": status,
               "returncode": process.returncode, "live_members": members, "errors": errors}
    directory = getattr(process, "_consensus_cleanup_dir", None)
    if isinstance(directory, (str, Path)):
        try:
            path = Path(directory) / "logs" / f"process-{process.pid}.cleanup.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        except OSError as exc:
            errors.append(f"cleanup receipt: {exc}")
            receipt["status"] = "unverified"
    if receipt["status"] == "complete":
        with _lock:
            _live.discard(process)
    else:
        print(json.dumps({"cleanup": receipt}), file=sys.stderr)
    return receipt


def finish(process) -> dict:
    errors = []
    _signal_group(process, signal.SIGTERM, errors)
    return _reap_group(process, time.monotonic() + 5, errors)


def stop_all() -> None:
    _cancelled.set()
    with _lock:
        processes = list(_live)
    errors = {process: [] for process in processes}
    for process in processes:
        _signal_group(process, signal.SIGTERM, errors[process])
    deadline = time.monotonic() + _shutdown_grace
    for process in processes:
        _reap_group(process, deadline, errors[process])


def install_signal_handlers(on_cancel=None, *, grace=3) -> None:
    global _shutdown_grace
    _shutdown_grace = grace

    def cancel(signum, _frame):
        signal.signal(signum, signal.SIG_IGN)
        stop_all()
        if on_cancel is not None:
            on_cancel(signum)
        raise SystemExit(128 + signum)
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, cancel)


def run(argv, *, input=None, timeout=None, stop_file=None, **kwargs):
    process = spawn(argv, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL, **kwargs)
    deadline = None if timeout is None else time.monotonic() + timeout
    result = None
    try:
        while True:
            if stop_file is not None and stop_file.exists():
                raise InterruptedError("review stop file present")
            remaining = None if deadline is None else deadline - time.monotonic()
            if remaining is not None and remaining <= 0:
                raise subprocess.TimeoutExpired(argv, timeout)
            try:
                stdout, stderr = process.communicate(input=input, timeout=min(0.2, remaining) if remaining is not None else 0.2)
                result = subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)
                return result
            except subprocess.TimeoutExpired:
                input = None
    finally:
        cleanup = finish(process)
        if result is not None:
            result.cleanup = cleanup


atexit.register(stop_all)
