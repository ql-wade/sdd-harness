#!/usr/bin/env python3
"""Deterministic gate for multi-Agent review ballots.

The script deliberately has no model or CLI integration. Agent dispatch is an
adapter concern; this file validates the evidence that an adapter writes and
is the only authority allowed to declare a review passed.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import math
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple


CRITERIA: Dict[str, List[str]] = {
    "architecture": [
        "requirements_fit",
        "boundaries",
        "reliability",
        "security_operations",
        "evolution_testability",
    ],
    "code": ["correctness", "security", "maintainability", "tests", "operability"],
    "general": ["correctness", "completeness", "risk", "evidence", "actionability"],
}
REQUIRED_PARTICIPANTS = ["claude-code", "zcode", "codex-agent"]
VERDICTS = {"APPROVE", "REJECT", "ABSTAIN"}
SEVERITIES = {"BLOCKER", "MAJOR", "MINOR", "NOTE"}


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def die(message: str, code: int = 2) -> None:
    print(json.dumps({"valid": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(code)


def read_json(path: Path) -> Dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"file not found: {path}")
    except json.JSONDecodeError as exc:
        die(f"invalid JSON in {path}: {exc}")
    except (UnicodeDecodeError, IsADirectoryError, PermissionError, OSError) as exc:
        die(f"cannot read JSON file {path}: {exc}")
    if not isinstance(value, dict):
        die(f"JSON root must be an object: {path}")
    return value


def write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def digest_path(path: Path) -> str:
    """Hash a file or a directory deterministically, excluding .git metadata."""

    if not path.exists():
        die(f"artifact does not exist: {path}")
    h = hashlib.sha256()
    if path.is_file():
        # plain content hash — matches `shasum -a 256` so reviewers can verify artifact identity directly
        h.update(path.read_bytes())
        return h.hexdigest()
    if not path.is_dir():
        die(f"artifact must be a regular file or directory: {path}")
    for child in sorted(path.rglob("*")):
        if ".git" in child.parts or not child.is_file():
            continue
        relative = child.relative_to(path).as_posix()
        h.update(relative.encode("utf-8"))
        h.update(b"\0")
        h.update(child.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def criteria_for(manifest: Mapping[str, Any]) -> List[str]:
    review_type = manifest.get("review_type")
    if review_type not in CRITERIA:
        return []
    return list(manifest.get("criteria") or CRITERIA[review_type])


def manifest_errors(manifest: Mapping[str, Any]) -> List[str]:
    errors: List[str] = []
    required = [
        "version",
        "review_id",
        "review_type",
        "initiator",
        "participants",
        "artifact",
        "artifact_sha256",
        "criteria",
        "thresholds",
        "max_rounds",
    ]
    for field in required:
        if field not in manifest:
            errors.append(f"manifest missing {field}")
    participants = manifest.get("participants")
    if not isinstance(participants, list) or not participants or not all(isinstance(x, str) for x in participants):
        errors.append("manifest participants must be a non-empty string list")
    else:
        if len(set(participants)) != len(participants):
            errors.append("manifest participants must be unique")
        if manifest.get("initiator") not in participants:
            errors.append("manifest initiator must be a participant")
        if sorted(participants) != sorted(REQUIRED_PARTICIPANTS):
            dq = manifest.get("degraded_quorum")
            degraded_ok = (
                isinstance(dq, dict)
                and dq.get("authorized_by") == "user"
                and isinstance(dq.get("reason"), str)
                and len(dq.get("reason").strip()) >= 20
                and set(participants).issubset(set(REQUIRED_PARTICIPANTS))
                and len(participants) >= 2
            )
            if not degraded_ok:
                errors.append("manifest participants must be exactly claude-code,zcode,codex-agent, or a degraded quorum (>=2 known agents) with degraded_quorum{authorized_by:'user', reason>=20 chars}")
    if manifest.get("review_type") not in CRITERIA:
        errors.append("manifest review_type must be architecture, code, or general")
    if not isinstance(manifest.get("criteria"), list) or not manifest.get("criteria"):
        errors.append("manifest criteria must be a non-empty list")
    if not isinstance(manifest.get("artifact_sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", manifest.get("artifact_sha256", "")):
        errors.append("manifest artifact_sha256 must be a lowercase SHA-256 hex string")
    thresholds = manifest.get("thresholds")
    if not isinstance(thresholds, dict):
        errors.append("manifest thresholds must be an object")
    else:
        for key in ("overall", "criterion"):
            if not is_number(thresholds.get(key)) or not 0 <= float(thresholds[key]) <= 10:
                errors.append(f"manifest thresholds.{key} must be a number from 0 to 10")
    if not isinstance(manifest.get("max_rounds"), int) or not 1 <= manifest.get("max_rounds") <= 5:
        errors.append("manifest max_rounds must be an integer from 1 to 5")
    return errors


def validate_ballot(manifest: Mapping[str, Any], ballot: Mapping[str, Any], expected_round: int | None = None) -> List[str]:
    errors: List[str] = []
    required = [
        "review_id",
        "round",
        "agent",
        "artifact_sha256",
        "verdict",
        "score",
        "findings",
        "assumptions",
        "confidence",
        "summary",
    ]
    for field in required:
        if field not in ballot:
            errors.append(f"missing {field}")
    extra_fields = sorted(set(ballot) - set(required) - {"$schema"})  # $schema: benign JSON-Schema echo from agents, stripped
    if extra_fields:
        errors.append(f"unexpected ballot fields: {', '.join(extra_fields)}")
    if ballot.get("review_id") != manifest.get("review_id"):
        errors.append("review_id does not match manifest")
    if not isinstance(ballot.get("round"), int) or ballot.get("round") < 0:
        errors.append("round must be a non-negative integer")
    elif expected_round is not None and ballot.get("round") != expected_round:
        errors.append(f"round must equal {expected_round}")
    agent = ballot.get("agent")
    if agent not in manifest.get("participants", []):
        errors.append("agent is not a required participant")
    if ballot.get("artifact_sha256") != manifest.get("artifact_sha256"):
        errors.append("artifact_sha256 does not match manifest")
    if ballot.get("verdict") not in VERDICTS:
        errors.append("verdict must be APPROVE, REJECT, or ABSTAIN")

    score = ballot.get("score")
    if not isinstance(score, dict):
        errors.append("score must be an object")
    else:
        if not is_number(score.get("overall")) or not 0 <= float(score["overall"]) <= 10:
            errors.append("score.overall must be a number from 0 to 10")
        criterion_scores = score.get("criteria")
        if not isinstance(criterion_scores, dict):
            errors.append("score.criteria must be an object")
        else:
            extra_criteria = sorted(set(criterion_scores) - set(criteria_for(manifest)))
            if extra_criteria:
                errors.append(f"unexpected score criteria: {', '.join(extra_criteria)}")
            for criterion in criteria_for(manifest):
                value = criterion_scores.get(criterion)
                if not is_number(value) or not 0 <= float(value) <= 10:
                    errors.append(f"score.criteria.{criterion} must be a number from 0 to 10")

    findings = ballot.get("findings")
    if not isinstance(findings, list):
        errors.append("findings must be a list")
    else:
        ids = set()
        for index, finding in enumerate(findings):
            if not isinstance(finding, dict):
                errors.append(f"finding {index} must be an object")
                continue
            extra_finding_fields = sorted(set(finding) - {"id", "severity", "claim", "evidence", "recommendation", "blocking"})
            if extra_finding_fields:
                errors.append(f"finding {index} has unexpected fields: {', '.join(extra_finding_fields)}")
            for field in ("id", "severity", "claim", "evidence", "recommendation", "blocking"):
                if field not in finding:
                    errors.append(f"finding {index} missing {field}")
            finding_id = finding.get("id")
            if not isinstance(finding_id, str) or not finding_id:
                errors.append(f"finding {index} id must be a non-empty string")
            elif finding_id in ids:
                errors.append(f"duplicate finding id: {finding_id}")
            else:
                ids.add(finding_id)
            if finding.get("severity") not in SEVERITIES:
                errors.append(f"finding {index} severity must be one of {sorted(SEVERITIES)}")
            if not isinstance(finding.get("evidence"), str) or not finding.get("evidence", "").strip():
                errors.append(f"finding {index} must cite evidence")
            if not isinstance(finding.get("claim"), str) or not finding.get("claim", "").strip():
                errors.append(f"finding {index} claim must be a non-empty string")
            if not isinstance(finding.get("recommendation"), str):
                errors.append(f"finding {index} recommendation must be a string")
            if not isinstance(finding.get("blocking"), bool):
                errors.append(f"finding {index} blocking must be boolean")
            elif finding.get("severity") == "BLOCKER" and not finding.get("blocking"):
                errors.append(f"finding {index} BLOCKER must set blocking=true")

    for field in ("assumptions",):
        value = ballot.get(field)
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            errors.append(f"{field} must be a list of strings")
    if not is_number(ballot.get("confidence")) or not 0 <= float(ballot["confidence"]) <= 1:
        errors.append("confidence must be a number from 0 to 1")
    if not isinstance(ballot.get("summary"), str) or not ballot.get("summary", "").strip():
        errors.append("summary must be a non-empty string")
    return errors


def parse_round(round_dir: Path) -> int:
    match = re.search(r"round-(\d+)$", round_dir.name)
    if not match:
        die(f"round directory must be named round-NN: {round_dir}")
    return int(match.group(1))


def cmd_init(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir).resolve()
    if run_dir.exists() and any(run_dir.iterdir()):
        die(f"run directory already exists and is not empty: {run_dir}")
    run_dir.mkdir(parents=True, exist_ok=True)
    artifact = Path(args.artifact).resolve()
    participants = [item.strip() for item in args.participants.split(",") if item.strip()]
    if not participants or len(set(participants)) != len(participants):
        die("participants must be a comma-separated list of unique IDs")
    if args.initiator not in participants:
        die("initiator must be included in participants")
    if len(participants) < 2:
        die("at least two participants are required")
    if args.review_type not in CRITERIA:
        die("review-type must be architecture, code, or general")
    manifest = {
        "version": 1,
        "review_id": run_dir.name,
        "created_at": now_utc(),
        "review_type": args.review_type,
        "initiator": args.initiator,
        "participants": participants,
        **({"degraded_quorum": {"authorized_by": "user", "reason": args.degraded_quorum_reason}}
           if getattr(args, "degraded_quorum_reason", None) else {}),
        "artifact": str(artifact),
        "artifact_sha256": digest_path(artifact),
        "scope": args.scope,
        "decision": args.decision,
        "criteria": CRITERIA[args.review_type],
        "thresholds": {"overall": float(args.min_score), "criterion": float(args.min_criterion_score)},
        "max_rounds": int(args.max_rounds),
        "status": "COLLECTING",
    }
    errors = manifest_errors(manifest)
    if errors:
        die("; ".join(errors))
    write_json(run_dir / "manifest.json", manifest)
    for name in ("round-00", "debate", "logs"):
        (run_dir / name).mkdir(parents=True, exist_ok=True)
    print(json.dumps({"status": "INITIALIZED", "manifest": str(run_dir / "manifest.json"), "artifact_sha256": manifest["artifact_sha256"]}, ensure_ascii=False, indent=2))


def load_manifest(path: Path) -> Dict[str, Any]:
    manifest = read_json(path)
    errors = manifest_errors(manifest)
    if errors:
        die("invalid manifest: " + "; ".join(errors))
    return manifest


def cmd_validate(args: argparse.Namespace) -> None:
    manifest = load_manifest(Path(args.manifest).resolve())
    ballot_path = Path(args.ballot).resolve()
    ballot = read_json(ballot_path)
    errors = validate_ballot(manifest, ballot, args.round)
    if errors:
        print(json.dumps({"valid": False, "ballot": str(ballot_path), "errors": errors}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    print(json.dumps({"valid": True, "ballot": str(ballot_path), "agent": ballot["agent"], "round": ballot["round"]}, ensure_ascii=False, indent=2))


def collect_ballots(manifest: Mapping[str, Any], round_dir: Path) -> Tuple[int, List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    round_number = parse_round(round_dir)
    ballots: List[Dict[str, Any]] = []
    invalid: List[Dict[str, Any]] = []
    files = sorted(round_dir.glob("ballot-*.json"))
    for path in files:
        try:
            ballot = read_json(path)
        except SystemExit:
            invalid.append({"file": str(path), "errors": ["unreadable or invalid JSON"]})
            continue
        errors = validate_ballot(manifest, ballot, round_number)
        if errors:
            invalid.append({"file": str(path), "agent": ballot.get("agent"), "errors": errors})
        else:
            ballots.append({"file": str(path), "data": ballot})
    return round_number, ballots, invalid, files


def cmd_tally(args: argparse.Namespace) -> None:
    manifest = load_manifest(Path(args.manifest).resolve())
    round_dir = Path(args.round_dir).resolve()
    if not round_dir.exists() or not round_dir.is_dir():
        die(f"round directory does not exist: {round_dir}")
    round_number, valid_entries, invalid, files = collect_ballots(manifest, round_dir)
    artifact_path = Path(manifest["artifact"])
    artifact_changed = False
    artifact_error: str | None = None
    current_artifact_sha256: str | None = None
    if not artifact_path.exists():
        artifact_error = f"artifact no longer exists: {artifact_path}"
    else:
        current_artifact_sha256 = digest_path(artifact_path)
        artifact_changed = current_artifact_sha256 != manifest["artifact_sha256"]
    by_agent: Dict[str, Dict[str, Any]] = {}
    duplicates: List[str] = []
    for entry in valid_entries:
        agent = entry["data"]["agent"]
        if agent in by_agent:
            duplicates.append(agent)
        else:
            by_agent[agent] = entry
    missing = [agent for agent in manifest["participants"] if agent not in by_agent]
    errors = list(invalid)
    if duplicates:
        errors.append({"duplicate_agents": sorted(set(duplicates))})

    summaries: List[Dict[str, Any]] = []
    blocking: List[Dict[str, Any]] = []
    dissenters: List[str] = []
    finding_records: List[Dict[str, Any]] = []
    for agent in manifest["participants"]:
        entry = by_agent.get(agent)
        if not entry:
            continue
        ballot = entry["data"]
        criteria_scores = ballot["score"]["criteria"]
        min_criterion = min(float(criteria_scores[key]) for key in manifest["criteria"])
        ballot_blockers = [finding for finding in ballot["findings"] if finding["blocking"]]
        if ballot["verdict"] != "APPROVE" or float(ballot["score"]["overall"]) < float(manifest["thresholds"]["overall"]) or min_criterion < float(manifest["thresholds"]["criterion"]) or ballot_blockers:
            dissenters.append(agent)
        for finding in ballot_blockers:
            blocking.append({"agent": agent, **finding})
        for finding in ballot["findings"]:
            finding_records.append({
                "agent": agent,
                "id": finding["id"],
                "severity": finding["severity"],
                "claim": finding["claim"],
                "evidence": finding["evidence"],
                "blocking": finding["blocking"],
            })
        summaries.append({
            "agent": agent,
            "verdict": ballot["verdict"],
            "overall": float(ballot["score"]["overall"]),
            "min_criterion": min_criterion,
            "blocking_findings": len(ballot_blockers),
            "summary": ballot["summary"],
        })

    votes = {verdict: sum(1 for item in summaries if item["verdict"] == verdict) for verdict in sorted(VERDICTS)}
    if artifact_error or artifact_changed:
        status = "BLOCKED"
        next_action = "reinitialize the review against the current artifact revision"
    elif errors or missing:
        status = "INCOMPLETE"
        next_action = "complete the required valid ballots; do not debate or pass yet"
    elif not dissenters:
        status = "PASSED"
        next_action = "write the conclusion and next-step plan"
    elif round_number >= int(manifest["max_rounds"]):
        status = "BLOCKED"
        next_action = "request human direction or new evidence; maximum debate rounds reached"
    else:
        status = "DEBATE_REQUIRED"
        next_action = f"open debate round {round_number + 1:02d}, resolve dissent, and re-ballot"

    tally = {
        "version": 1,
        "review_id": manifest["review_id"],
        "round": round_number,
        "created_at": now_utc(),
        "status": status,
        "artifact_sha256": manifest["artifact_sha256"],
        "current_artifact_sha256": current_artifact_sha256,
        "artifact_changed": artifact_changed,
        "artifact_error": artifact_error,
        "participants": manifest["participants"],
        "present_agents": sorted(by_agent),
        "missing_agents": missing,
        "invalid_ballots": errors,
        "votes": votes,
        "dissenters": dissenters,
        "blocking_findings": blocking,
        "findings": sorted(finding_records, key=lambda item: (item["id"], item["agent"], item["claim"])),
        "ballots": summaries,
        "next_action": next_action,
    }
    finding_fingerprint = hashlib.sha256(
        json.dumps(tally["findings"], ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    tally["finding_fingerprint"] = finding_fingerprint
    tally_path = round_dir / "tally.json"
    write_json(tally_path, tally)
    print(json.dumps({**tally, "tally": str(tally_path)}, ensure_ascii=False, indent=2))
    if status != "PASSED":
        raise SystemExit(1)


def cmd_finalize(args: argparse.Namespace) -> None:
    manifest = load_manifest(Path(args.manifest).resolve())
    tally_path = Path(args.tally).resolve()
    tally = read_json(tally_path)
    if tally.get("review_id") != manifest["review_id"]:
        die("tally review_id does not match manifest")
    if tally.get("artifact_sha256") != manifest["artifact_sha256"]:
        die("tally artifact_sha256 does not match manifest")
    round_dir = tally_path.parent
    with tempfile.TemporaryDirectory(prefix="review-recheck-") as temp_name:
        recheck_dir = Path(temp_name) / round_dir.name
        recheck_dir.mkdir(parents=True, exist_ok=True)
        for ballot_path in round_dir.glob("ballot-*.json"):
            shutil.copy2(ballot_path, recheck_dir / ballot_path.name)
        recheck_args = argparse.Namespace(manifest=str(Path(args.manifest).resolve()), round_dir=str(recheck_dir))
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                cmd_tally(recheck_args)
        except SystemExit as exc:
            if exc.code not in (0, 1):
                raise
        fresh_tally_path = recheck_dir / "tally.json"
        if not fresh_tally_path.exists():
            die("could not re-tally ballots during finalization")
        fresh_tally = read_json(fresh_tally_path)
    if fresh_tally.get("status") != "PASSED":
        die(f"cannot finalize: fresh tally status is {fresh_tally.get('status')}")
    integrity_fields = [
        "review_id", "round", "status", "artifact_sha256", "current_artifact_sha256",
        "artifact_changed", "artifact_error", "participants", "present_agents",
        "missing_agents", "invalid_ballots", "votes", "dissenters", "blocking_findings",
        "findings", "ballots", "next_action", "finding_fingerprint",
    ]
    for field in integrity_fields:
        if tally.get(field) != fresh_tally.get(field):
            die(f"tally.json failed fresh-ballot integrity check at field: {field}")
    conclusion = Path(args.conclusion_file).read_text(encoding="utf-8").strip()
    next_plan = Path(args.next_plan_file).read_text(encoding="utf-8").strip()
    if not conclusion or not next_plan:
        die("conclusion and next-plan files must both be non-empty")
    if int(tally.get("round", 0)) > 0:
        if not args.debate_log or not Path(args.debate_log).exists():
            die("a debate log is required when finalizing after round 0")
    lines = [
        "# Multi-Agent Consensus Review",
        "",
        f"- Status: **PASSED** (unanimous)",
        f"- Review ID: `{manifest['review_id']}`",
        f"- Review type: `{manifest['review_type']}`",
        f"- Initiator: `{manifest['initiator']}`",
        f"- Participants: {', '.join(f'`{agent}`' for agent in manifest['participants'])}",
        f"- Round: `{tally['round']}`",
        f"- Artifact SHA-256: `{manifest['artifact_sha256']}`",
        "",
        "## Ballots",
        "",
        "| Agent | Verdict | Overall | Min criterion | Blockers |",
        "|---|---:|---:|---:|---:|",
    ]
    for ballot in tally.get("ballots", []):
        lines.append(f"| `{ballot['agent']}` | `{ballot['verdict']}` | {ballot['overall']:.1f} | {ballot['min_criterion']:.1f} | {ballot['blocking_findings']} |")
    lines.extend(["", "## Conclusion", "", conclusion, "", "## Next-step plan", "", next_plan, ""])
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"status": "FINALIZED", "output": str(output)}, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deterministic multi-Agent review gate")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init")
    init.add_argument("--run-dir", required=True)
    init.add_argument("--review-type", choices=sorted(CRITERIA), required=True)
    init.add_argument("--initiator", required=True)
    init.add_argument("--participants", required=True)
    init.add_argument("--artifact", required=True)
    init.add_argument("--scope", required=True)
    init.add_argument("--decision", default="authorize the next step only after unanimous approval")
    init.add_argument("--min-score", type=float, default=8.0)
    init.add_argument("--min-criterion-score", type=float, default=7.0)
    init.add_argument("--max-rounds", type=int, default=3)
    init.add_argument("--degraded-quorum-reason", type=str, default=None,
                      help="record a user-authorized degraded quorum (>=2 known agents); reason must be >=20 chars")
    init.set_defaults(func=cmd_init)

    validate = sub.add_parser("validate")
    validate.add_argument("--manifest", required=True)
    validate.add_argument("--ballot", required=True)
    validate.add_argument("--round", type=int)
    validate.set_defaults(func=cmd_validate)

    tally = sub.add_parser("tally")
    tally.add_argument("--manifest", required=True)
    tally.add_argument("--round-dir", required=True)
    tally.set_defaults(func=cmd_tally)

    finalize = sub.add_parser("finalize")
    finalize.add_argument("--manifest", required=True)
    finalize.add_argument("--tally", required=True)
    finalize.add_argument("--conclusion-file", required=True)
    finalize.add_argument("--next-plan-file", required=True)
    finalize.add_argument("--debate-log")
    finalize.add_argument("--output", required=True)
    finalize.set_defaults(func=cmd_finalize)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except BrokenPipeError:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
