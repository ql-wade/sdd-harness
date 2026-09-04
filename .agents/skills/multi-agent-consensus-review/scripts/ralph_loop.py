#!/usr/bin/env python3
"""Bounded Ralph-style outer loop for multi-Agent review rounds.

The caller supplies a dispatch command. That command is responsible for
starting fresh read-only Agent sessions and writing one ballot per participant
to REVIEW_ROUND_DIR. This controller only dispatches, tallies, persists state,
and stops on a mechanically verified result.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Sequence


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def write_json(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def fail(state: Dict[str, Any], state_path: Path, reason: str) -> int:
    state["status"] = "BLOCKED"
    state["finished_at"] = now_utc()
    state["stop_reason"] = reason
    write_json(state_path, state)
    print(json.dumps({"status": "BLOCKED", "reason": reason, "state": str(state_path)}, ensure_ascii=False, indent=2))
    return 1


def dispatch_meta_errors(path: Path, manifest: Dict[str, Any], round_number: int) -> list[str]:
    if not path.exists():
        return [f"missing dispatch metadata: {path}"]
    try:
        meta = read_json(path)
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        return [f"invalid dispatch metadata {path}: {exc}"]
    errors: list[str] = []
    if meta.get("round") != round_number:
        errors.append("dispatch metadata round mismatch")
    if sorted(meta.get("participants", [])) != sorted(manifest.get("participants", [])):
        errors.append("dispatch metadata participants mismatch")
    if meta.get("artifact_sha256") != manifest.get("artifact_sha256"):
        errors.append("dispatch metadata artifact digest mismatch")
    if not isinstance(meta.get("prompt_sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", meta.get("prompt_sha256", "")):
        errors.append("dispatch metadata prompt_sha256 must be lowercase SHA-256 hex")
    if meta.get("fresh_processes") is not True:
        errors.append("dispatch metadata fresh_processes must be true")
    if meta.get("read_only") is not True:
        errors.append("dispatch metadata read_only must be true")
    if meta.get("artifact_edited") is not False:
        errors.append("dispatch metadata artifact_edited must be false")
    if meta.get("status") != "OK":
        errors.append("dispatch metadata status must be OK")
    return errors


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run bounded Ralph-style consensus rounds")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--dispatch-command", required=True, help="argv string; invoked without a shell")
    parser.add_argument("--max-rounds", type=int)
    parser.add_argument("--stop-file")
    parser.add_argument("--dispatch-timeout", type=float, default=1800.0, help="seconds per round dispatch; default 1800")
    args = parser.parse_args(argv)

    manifest_path = Path(args.manifest).resolve()
    run_dir = manifest_path.parent
    manifest = read_json(manifest_path)
    configured_max = int(manifest["max_rounds"])
    max_rounds = configured_max if args.max_rounds is None else args.max_rounds
    if not 1 <= max_rounds <= min(configured_max, 5):
        print(json.dumps({"status": "BLOCKED", "reason": f"max-rounds must be 1..{min(configured_max, 5)}"}, ensure_ascii=False))
        return 1
    if args.dispatch_timeout <= 0:
        print(json.dumps({"status": "BLOCKED", "reason": "dispatch-timeout must be positive"}, ensure_ascii=False))
        return 1
    command = shlex.split(args.dispatch_command)
    if not command:
        print(json.dumps({"status": "BLOCKED", "reason": "dispatch command is empty"}, ensure_ascii=False))
        return 1

    stop_file = Path(args.stop_file).resolve() if args.stop_file else run_dir / "stop.md"
    state_path = run_dir / "ralph-state.json"
    if state_path.exists():
        print(json.dumps({"status": "BLOCKED", "reason": f"state already exists; refusing to overwrite: {state_path}"}, ensure_ascii=False, indent=2))
        return 1
    populated_rounds = [
        path for path in run_dir.glob("round-*")
        if path.is_dir() and (any(path.glob("ballot-*.json")) or (path / "tally.json").exists())
    ]
    if populated_rounds:
        print(json.dumps({"status": "BLOCKED", "reason": f"existing ballots found; use a new run directory: {[str(path) for path in populated_rounds]}"}, ensure_ascii=False, indent=2))
        return 1
    state: Dict[str, Any] = {
        "version": 1,
        "review_id": manifest["review_id"],
        "started_at": now_utc(),
        "status": "RUNNING",
        "max_rounds": max_rounds,
        "completion_promise": "CONSENSUS_REVIEW_PASSED",
        "rounds": [],
    }
    write_json(state_path, state)
    logs_dir = run_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    for round_number in range(max_rounds + 1):
        if stop_file.exists():
            state["status"] = "STOPPED"
            state["finished_at"] = now_utc()
            state["stop_reason"] = f"stop file present: {stop_file}"
            write_json(state_path, state)
            print(json.dumps({"status": "STOPPED", "state": str(state_path)}, ensure_ascii=False, indent=2))
            return 1

        round_dir = run_dir / f"round-{round_number:02d}"
        round_dir.mkdir(parents=True, exist_ok=True)
        if any(round_dir.glob("ballot-*.json")):
            return fail(state, state_path, f"round already contains ballots; refusing to overwrite: {round_dir}")
        log_path = logs_dir / f"ralph-round-{round_number:02d}.log"
        previous_tally = run_dir / f"round-{round_number - 1:02d}" / "tally.json" if round_number > 0 else Path("")
        debate_log = run_dir / "debate" / f"round-{round_number:02d}.md"
        env = os.environ.copy()
        env.update({
            "REVIEW_RUN_DIR": str(run_dir),
            "REVIEW_ROUND": str(round_number),
            "REVIEW_ROUND_DIR": str(round_dir),
            "REVIEW_MANIFEST": str(manifest_path),
            "REVIEW_ARTIFACT": str(manifest["artifact"]),
            "REVIEW_STOP_FILE": str(stop_file),
            "REVIEW_PREVIOUS_TALLY": str(previous_tally) if round_number > 0 else "",
            "REVIEW_DEBATE_LOG": str(debate_log),
        })
        with log_path.open("w", encoding="utf-8") as log:
            log.write(f"started_at={now_utc()}\nround={round_number}\ncommand={command!r}\n")
            try:
                dispatch = subprocess.run(command, cwd=run_dir, env=env, stdout=log, stderr=subprocess.STDOUT, text=True, timeout=args.dispatch_timeout)
            except subprocess.TimeoutExpired:
                log.write(f"dispatch_timeout={args.dispatch_timeout}\n")
                return fail(state, state_path, f"dispatch timed out in round {round_number} after {args.dispatch_timeout}s; see {log_path}")
            except OSError as exc:
                return fail(state, state_path, f"could not start dispatch command: {exc}")
            log.write(f"dispatch_exit={dispatch.returncode}\n")
        if dispatch.returncode != 0:
            return fail(state, state_path, f"dispatch command failed in round {round_number}: exit {dispatch.returncode}; see {log_path}")

        meta_path = round_dir / "dispatch-meta.json"
        metadata_errors = dispatch_meta_errors(meta_path, manifest, round_number)
        if metadata_errors:
            return fail(state, state_path, "; ".join(metadata_errors))

        tally_command = [
            sys.executable,
            str(Path(__file__).with_name("review_gate.py").resolve()),
            "tally",
            "--manifest",
            str(manifest_path),
            "--round-dir",
            str(round_dir),
        ]
        tally_process = subprocess.run(tally_command, cwd=run_dir, capture_output=True, text=True)
        with log_path.open("a", encoding="utf-8") as log:
            log.write("\n--- tally stdout ---\n")
            log.write(tally_process.stdout)
            log.write("\n--- tally stderr ---\n")
            log.write(tally_process.stderr)
        tally_path = round_dir / "tally.json"
        if not tally_path.exists():
            return fail(state, state_path, f"tally did not produce {tally_path}")
        try:
            tally = read_json(tally_path)
        except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
            return fail(state, state_path, f"tally output is malformed: {exc}")
        if tally_process.returncode not in (0, 1):
            return fail(state, state_path, f"tally command failed with exit {tally_process.returncode}; see {log_path}")
        if tally_process.returncode == 0 and tally.get("status") != "PASSED":
            return fail(state, state_path, f"tally exit/status mismatch: exit 0 with {tally.get('status')}")
        if tally_process.returncode != 0 and tally.get("status") == "PASSED":
            return fail(state, state_path, "tally exit/status mismatch: non-zero exit with PASSED")
        state["rounds"].append({
            "round": round_number,
            "tally": str(tally_path),
            "status": tally.get("status"),
            "dissenters": tally.get("dissenters", []),
            "log": str(log_path),
            "finished_at": now_utc(),
        })
        write_json(state_path, state)

        if tally.get("status") == "PASSED":
            state["status"] = "PASSED"
            state["finished_at"] = now_utc()
            write_json(state_path, state)
            print(json.dumps({"status": "PASSED", "round": round_number, "tally": str(tally_path), "state": str(state_path)}, ensure_ascii=False, indent=2))
            print("<promise>CONSENSUS_REVIEW_PASSED</promise>")
            return 0
        if tally.get("status") == "DEBATE_REQUIRED" and round_number > 0:
            previous_path = run_dir / f"round-{round_number - 1:02d}" / "tally.json"
            if previous_path.exists():
                previous_tally = read_json(previous_path)
                if tally.get("finding_fingerprint") == previous_tally.get("finding_fingerprint"):
                    return fail(state, state_path, f"unchanged dissent fingerprint after round {round_number}; see {tally_path}")
        if tally.get("status") != "DEBATE_REQUIRED":
            return fail(state, state_path, f"review stopped with {tally.get('status')}; see {tally_path}")

    return fail(state, state_path, "maximum Ralph rounds reached without unanimous approval")


if __name__ == "__main__":
    raise SystemExit(main())
