from __future__ import annotations

import json
import re
from datetime import timedelta, timezone
from pathlib import Path
from typing import Any

from .common import (
    Artifact,
    RunContext,
    is_text,
    parse_time,
    require_text,
    require_text_list,
    sha256_file,
)


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
STRUCTURED_TYPES = {
    "scope-plan",
    "command-report",
    "runner-report",
    "source-identity",
    "lifecycle-report",
    "contract-report",
    "browser-report",
    "route-scan-report",
    "subagent-report",
    "redaction-report",
    "ci-report",
    "provenance-report",
    "readback-report",
}
RAW_TYPES = {"raw-log", "trace", "dom-snapshot", "accessibility-report", "screenshot"}
VALID_TYPES = STRUCTURED_TYPES | RAW_TYPES
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "provider token": re.compile(r"\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{20,}\b"),
    "bearer token": re.compile(r"Authorization\s*:\s*Bearer\s+\S+", re.IGNORECASE),
    "assigned secret": re.compile(
        r"\b(?:password|passwd|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*['\"]?[^\s,'\"]{8,}",
        re.IGNORECASE,
    ),
}


def _source_map(value: Any, run: RunContext, path: str, errors: list[str]) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        errors.append(f"{path}: required non-empty component->revision object")
        return {}
    result: dict[str, str] = {}
    for component, revision in value.items():
        if not is_text(component) or not is_text(revision):
            errors.append(f"{path}: component and revision must be non-placeholder strings")
            continue
        result[component] = revision
        source = run.sources.get(component)
        if source is None:
            errors.append(f"{path}.{component}: component is absent from run.sources")
        elif source.revision != revision:
            errors.append(f"{path}.{component}: revision does not match run.sources")
    return result


def _load_payload(
    target: Path | None,
    artifact_type: str | None,
    evidence_id: str,
    verify_files: bool,
    errors: list[str],
) -> tuple[dict[str, Any] | None, bytes | None]:
    if not verify_files or target is None or not target.is_file():
        return None, None
    try:
        raw = target.read_bytes()
    except OSError as exc:
        errors.append(f"evidence_catalog.{evidence_id}.path: cannot read evidence file: {exc}")
        return None, None
    if artifact_type not in STRUCTURED_TYPES:
        return None, raw
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        errors.append(f"evidence_catalog.{evidence_id}: {artifact_type} must contain parseable JSON")
        return None, raw
    if not isinstance(payload, dict):
        errors.append(f"evidence_catalog.{evidence_id}: {artifact_type} JSON must be an object")
        return None, raw
    return payload, raw


def _validate_envelope(
    artifact: Artifact,
    raw: bytes | None,
    run: RunContext,
    errors: list[str],
) -> None:
    path = f"evidence_catalog.{artifact.evidence_id}"
    if raw is None:
        return
    if artifact.artifact_type == "screenshot":
        return
    if artifact.run_id.encode() not in raw:
        errors.append(f"{path}: evidence content does not contain run.run_id")
    for correlation in artifact.correlation_values:
        if correlation.encode() not in raw:
            errors.append(f"{path}: evidence content does not contain declared correlation '{correlation}'")

    payload = artifact.payload
    if artifact.artifact_type not in STRUCTURED_TYPES or payload is None:
        return
    expected_scalars = {"artifact_type": artifact.artifact_type, "run_id": artifact.run_id}
    if artifact.artifact_type != "scope-plan":
        expected_scalars["plan_digest"] = run.plan_digest
    for key, expected in expected_scalars.items():
        if payload.get(key) != expected:
            errors.append(f"{path}: embedded {key} does not match the ledger")

    expected_sets = {
        "journey_ids": artifact.journey_ids,
        "case_ids": artifact.case_ids,
        "hop_ids": artifact.hop_ids,
        "correlation_values": artifact.correlation_values,
    }
    for key, expected in expected_sets.items():
        observed = payload.get(key)
        if not isinstance(observed, list) or set(observed) != expected:
            errors.append(f"{path}: embedded {key} does not match evidence_catalog")
    if payload.get("source_revisions") != artifact.source_revisions:
        errors.append(f"{path}: embedded source_revisions do not match evidence_catalog")


def _resolve_target(
    relative: str | None,
    root: Path | None,
    evidence_id: str,
    paths: dict[Path, str],
    errors: list[str],
) -> Path | None:
    path = f"evidence_catalog.{evidence_id}.path"
    if not relative:
        return None
    candidate = Path(relative)
    if candidate.is_absolute():
        errors.append(f"{path}: must be relative to the ledger directory")
        return None
    if root is None:
        return None
    target = (root / candidate).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        errors.append(f"{path}: escapes the ledger directory")
        return None
    previous = paths.get(target)
    if previous:
        errors.append(f"{path}: duplicates evidence file used by '{previous}'")
    paths[target] = evidence_id
    return target


def _verify_target(
    target: Path | None,
    digest: str,
    run: RunContext,
    path: str,
    verify_files: bool,
    errors: list[str],
) -> None:
    if not verify_files or target is None:
        return
    if not target.is_file():
        errors.append(f"{path}.path: evidence file does not exist")
        return
    if digest and sha256_file(target) != digest:
        errors.append(f"{path}.sha256: hash does not match evidence file")
    if not run.started_at or not run.completed_at:
        return
    modified = target.stat().st_mtime
    if not run.started_at.timestamp() - 5 <= modified <= run.completed_at.timestamp() + 5:
        errors.append(f"{path}.path: file mtime is outside the run window")


def _parse_catalog_item(
    evidence_id: str,
    item: Any,
    run: RunContext,
    root: Path | None,
    paths: dict[Path, str],
    verify_files: bool,
    errors: list[str],
) -> Artifact | None:
    path = f"evidence_catalog.{evidence_id}"
    if not is_text(evidence_id) or not isinstance(item, dict):
        errors.append(f"{path}: required evidence object with non-placeholder ID")
        return None
    artifact_type = require_text(item, "artifact_type", path, errors)
    if artifact_type and artifact_type not in VALID_TYPES:
        errors.append(f"{path}.artifact_type: unsupported type '{artifact_type}'")
    relative = require_text(item, "path", path, errors)
    digest = require_text(item, "sha256", path, errors) or ""
    if digest and not SHA256_RE.fullmatch(digest):
        errors.append(f"{path}.sha256: required lowercase SHA-256 hex")
    run_id = require_text(item, "run_id", path, errors) or ""
    if run.run_id and run_id != run.run_id:
        errors.append(f"{path}.run_id: does not match run.run_id")
    captured_at = parse_time(item.get("captured_at"), f"{path}.captured_at", errors)
    if captured_at and run.started_at and captured_at < run.started_at:
        errors.append(f"{path}.captured_at: predates run.started_at")
    if captured_at and run.completed_at and captured_at > run.completed_at:
        errors.append(f"{path}.captured_at: exceeds run.completed_at")
    source_revisions = _source_map(item.get("source_revisions"), run, f"{path}.source_revisions", errors)
    journey_ids = set(require_text_list(item, "journey_ids", path, errors, allow_empty=True))
    case_ids = set(require_text_list(item, "case_ids", path, errors, allow_empty=True))
    hop_ids = set(require_text_list(item, "hop_ids", path, errors, allow_empty=True))
    correlations = set(require_text_list(item, "correlation_values", path, errors, allow_empty=True))
    target = _resolve_target(relative, root, evidence_id, paths, errors)
    _verify_target(target, digest, run, path, verify_files, errors)
    body, raw = _load_payload(target, artifact_type, evidence_id, verify_files, errors)
    artifact = Artifact(
        evidence_id, artifact_type or "", target, digest, run_id, captured_at,
        source_revisions, journey_ids, case_ids, hop_ids, correlations, body
    )
    _validate_envelope(artifact, raw, run, errors)
    return artifact


def validate_catalog(
    value: Any,
    run: RunContext,
    base_dir: Path | None,
    verify_files: bool,
    errors: list[str],
) -> dict[str, Artifact]:
    if verify_files and base_dir is None:
        errors.append("evidence_catalog: base_dir is required when verify_files is true")
    if not isinstance(value, dict) or not value:
        errors.append("evidence_catalog: required non-empty object")
        return {}
    root = base_dir.resolve() if base_dir is not None else None
    paths: dict[Path, str] = {}
    catalog: dict[str, Artifact] = {}
    for evidence_id, item in value.items():
        artifact = _parse_catalog_item(
            evidence_id, item, run, root, paths, verify_files, errors
        )
        if artifact is not None:
            catalog[evidence_id] = artifact
    digest_owners: dict[str, str] = {}
    for evidence_id, artifact in catalog.items():
        owner = digest_owners.get(artifact.digest)
        if owner:
            errors.append(
                f"evidence_catalog.{evidence_id}: byte-identical to independent artifact '{owner}'"
            )
        else:
            digest_owners[artifact.digest] = evidence_id
    return catalog


def require_types(
    refs: set[str] | list[str],
    allowed: set[str],
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
) -> None:
    for ref in refs:
        artifact = catalog.get(ref)
        if artifact and artifact.artifact_type not in allowed:
            choices = ", ".join(sorted(allowed))
            errors.append(f"{path}: '{ref}' must be typed as one of {choices}")


def require_correlation(
    refs: set[str] | list[str],
    correlation: str | None,
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
    *,
    every: bool = True,
    exact: bool = False,
) -> None:
    if not correlation or not refs:
        return
    matched = []
    for ref in refs:
        artifact = catalog.get(ref)
        if exact and artifact and artifact.correlation_values != {correlation}:
            errors.append(f"{path}: '{ref}' must carry exactly the Journey correlation")
        matched.append(bool(artifact and correlation in artifact.correlation_values))
    if every and not all(matched):
        errors.append(f"{path}: every runtime evidence item must carry the Journey correlation")
    elif not every and not any(matched):
        errors.append(f"{path}: at least one evidence item must carry the Journey correlation")


def require_journey_scope(
    refs: set[str] | list[str],
    journey_id: str | None,
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
    *,
    exact: bool = False,
) -> None:
    if not journey_id:
        return
    for ref in refs:
        artifact = catalog.get(ref)
        if artifact and exact and artifact.journey_ids != {journey_id}:
            errors.append(f"{path}: '{ref}' must be scoped to exactly Journey '{journey_id}'")
        elif artifact and journey_id not in artifact.journey_ids:
            errors.append(f"{path}: '{ref}' is not scoped to Journey '{journey_id}'")


def require_case_scope(
    refs: set[str] | list[str],
    case_id: str | None,
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
    *,
    exact: bool = False,
) -> None:
    if not case_id:
        return
    for ref in refs:
        artifact = catalog.get(ref)
        if artifact and exact and artifact.case_ids != {case_id}:
            errors.append(f"{path}: '{ref}' must be scoped to exactly Case '{case_id}'")
        elif artifact and case_id not in artifact.case_ids:
            errors.append(f"{path}: '{ref}' is not scoped to Case '{case_id}'")


def require_hop_scope(
    refs: set[str] | list[str],
    hop_id: str | None,
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
    *,
    exact: bool = False,
) -> None:
    if not hop_id:
        return
    for ref in refs:
        artifact = catalog.get(ref)
        if artifact and exact and artifact.hop_ids != {hop_id}:
            errors.append(f"{path}: '{ref}' must be scoped to exactly Hop '{hop_id}'")
        elif artifact and hop_id not in artifact.hop_ids:
            errors.append(f"{path}: '{ref}' is not scoped to Hop '{hop_id}'")


def require_component_binding(
    refs: set[str] | list[str],
    component: str | None,
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
) -> None:
    if not component:
        return
    for ref in refs:
        artifact = catalog.get(ref)
        if artifact and component not in artifact.source_revisions:
            errors.append(f"{path}: {component} evidence is not source-bound to its component")


def payload(ref: str, expected_type: str, catalog: dict[str, Artifact]) -> dict[str, Any] | None:
    artifact = catalog.get(ref)
    if artifact is None or artifact.artifact_type != expected_type:
        return None
    return artifact.payload


def scan_sensitive_content(catalog: dict[str, Artifact], errors: list[str]) -> None:
    for evidence_id, artifact in catalog.items():
        if artifact.artifact_type == "screenshot" or artifact.path is None or not artifact.path.is_file():
            continue
        try:
            text = artifact.path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                errors.append(
                    f"evidence_catalog.{evidence_id}: possible {label} found; redact before closure"
                )
