from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


PLACEHOLDERS = {"", "unknown", "tbd", "todo", "n/a", "na", "planned", "pending"}
WEAK_SEMANTICS = {
    "x", "ok", "okay", "works", "worked", "it works", "pass", "passes", "passed",
    "success", "successful", "correct", "valid", "check", "tested", "done", "good", "fine",
}
ASSERTION_OPERATORS = {
    "eq", "neq", "contains", "not_contains", "matches",
    "lt", "lte", "gt", "gte", "exists", "absent", "count_eq",
}
DIMENSION_ASSERTION_ROOTS = {
    "A": {"business", "terminal", "readback", "report"},
    "B": {"browser", "ux"},
    "C": {"accessibility", "ux"},
    "D": {"database", "datastore", "persistence", "readback", "state"},
    "E": {"authentication", "authorization", "isolation", "privacy", "security"},
    "F": {"contract", "integration", "journey"},
    "G": {"concurrency", "delivery", "idempotency", "ordering", "replay", "retry"},
    "H": {"compensation", "dlq", "recovery", "resilience", "timeout"},
    "I": {"compatibility", "deployment", "migration", "version"},
    "J": {"ci", "regression", "runner"},
}
NETWORK_ASSERTION_ROOTS = {"network", "readback", "report", "request", "response"}
GENERIC_ASSERTION_PARTS = {
    "behavior", "result", "output", "value", "thing", "something", "expected",
    "acceptable", "correct", "valid", "works", "worked", "working", "status",
    "okay", "ok", "good", "fine", "nominal", "proper", "properly",
}
ENUM_TOKEN_PATTERN = re.compile(
    r"^[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*::[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$"
)
ENUM_SCHEMA_SUFFIXES = {
    "Code", "Kind", "Level", "Mode", "Outcome", "Phase", "Reason", "Revision",
    "State", "Status", "Type", "Version",
}
TEST_ID_PATTERN = re.compile(
    r"^[A-Za-z0-9_.-]+::[A-Za-z0-9_./\[\]-]+::[A-Za-z0-9_.\[\]-]+$"
)
ACTUAL_PATH_PATTERN = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$-]*(?:\.[A-Za-z0-9_$-]+)+$")
SELECTOR_PREFIXES = ("#", ".", "[", "role=", "text=", "data-testid=")
DIMENSIONS = tuple("ABCDEFGHIJ")
VALID_AUTHORITIES = {"unit", "component", "contract", "integration", "real-stack", "browser/ux"}


def is_text(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() not in PLACEHOLDERS


def is_concrete_text(value: Any, *, min_chars: int = 8) -> bool:
    if not is_text(value):
        return False
    normalized = " ".join(value.strip().split()).lower()
    return len(normalized) >= min_chars and normalized not in WEAK_SEMANTICS


def canonical_json_object(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    canonical = json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return parsed if canonical == value else None


def _concrete_expected(value: Any) -> bool:
    if isinstance(value, str):
        normalized = " ".join(value.strip().split()).lower()
        schema = value.split("::", 1)[0].split(".")[-1] if "::" in value else ""
        enum_value = value.split("::", 1)[1] if "::" in value else value
        tokens = _identifier_tokens(enum_value)
        return bool(
            normalized
            and not re.search(r"\s", value)
            and ENUM_TOKEN_PATTERN.fullmatch(value)
            and any(schema.endswith(suffix) for suffix in ENUM_SCHEMA_SUFFIXES)
            and normalized not in WEAK_SEMANTICS | GENERIC_ASSERTION_PARTS
            and not (tokens & GENERIC_ASSERTION_PARTS)
            and not _contains_generic_fragment(enum_value)
        )
    if value is None:
        return False
    if isinstance(value, (dict, list)):
        return False
    return isinstance(value, (bool, int, float))


def _valid_assertion(
    actual: Any,
    operator: Any,
    expected: Any,
    allowed_roots: set[str] | None = None,
) -> bool:
    if not isinstance(actual, str) or ACTUAL_PATH_PATTERN.fullmatch(actual) is None:
        return False
    root = actual.split(".", 1)[0]
    if allowed_roots is not None and root not in allowed_roots:
        return False
    if _identifier_tokens(actual) & GENERIC_ASSERTION_PARTS or _contains_generic_fragment(actual):
        return False
    return operator in ASSERTION_OPERATORS and _concrete_expected(expected)


def _identifier_tokens(value: str) -> set[str]:
    expanded = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", value)
    return {
        token.lower()
        for token in re.split(r"[^A-Za-z0-9]+", expanded)
        if token
    }


def _contains_generic_fragment(value: str) -> bool:
    collapsed = re.sub(r"[^a-z0-9]", "", value.lower())
    return any(
        len(part) >= 4 and part in collapsed
        for part in WEAK_SEMANTICS | GENERIC_ASSERTION_PARTS
    )


def is_test_assertion(value: Any, dimension: str | None = None) -> bool:
    parsed = canonical_json_object(value)
    if parsed is None or set(parsed) != {"actual", "expected", "operator", "test_id"}:
        return False
    allowed_roots = DIMENSION_ASSERTION_ROOTS.get(dimension) if dimension else None
    return bool(
        TEST_ID_PATTERN.fullmatch(str(parsed.get("test_id", "")))
        and _valid_assertion(
            parsed.get("actual"), parsed.get("operator"), parsed.get("expected"), allowed_roots
        )
    )


def is_browser_action(value: Any) -> bool:
    parsed = canonical_json_object(value)
    if parsed is None or set(parsed) != {"action", "target", "value"}:
        return False
    if parsed.get("action") not in {
        "navigate", "click", "fill", "select", "press", "wait_for", "reload",
        "hover", "check", "uncheck", "upload",
    }:
        return False
    target = parsed.get("target")
    return isinstance(target, str) and (
        target.startswith(("/", "http://", "https://")) or target.startswith(SELECTOR_PREFIXES)
    )


def is_dom_assertion(value: Any) -> bool:
    parsed = canonical_json_object(value)
    if parsed is None or set(parsed) != {"expected", "operator", "selector"}:
        return False
    selector = parsed.get("selector")
    return bool(
        isinstance(selector, str)
        and selector.startswith(SELECTOR_PREFIXES)
        and parsed.get("operator") in ASSERTION_OPERATORS
        and _concrete_expected(parsed.get("expected"))
    )


def is_network_assertion(value: Any) -> bool:
    parsed = canonical_json_object(value)
    required = {"method", "status", "url"}
    if parsed is None or not required.issubset(parsed) or set(parsed) - (required | {"body_assertion"}):
        return False
    method = parsed.get("method")
    url = parsed.get("url")
    status = parsed.get("status")
    if method not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
        return False
    if not isinstance(url, str) or not url.startswith(("/", "http://", "https://")):
        return False
    if type(status) is not int or not 100 <= status <= 599:
        return False
    body = parsed.get("body_assertion")
    if body is None:
        return True
    return bool(
        isinstance(body, dict)
        and set(body) == {"actual", "expected", "operator"}
        and _valid_assertion(
            body.get("actual"), body.get("operator"), body.get("expected"),
            NETWORK_ASSERTION_ROOTS,
        )
    )


def require_text(obj: Any, key: str, path: str, errors: list[str]) -> str | None:
    value = obj.get(key) if isinstance(obj, dict) else None
    if not is_text(value):
        errors.append(f"{path}.{key}: required non-placeholder string")
        return None
    return value.strip()


def require_list(
    obj: Any,
    key: str,
    path: str,
    errors: list[str],
    *,
    allow_empty: bool = False,
) -> list[Any]:
    value = obj.get(key) if isinstance(obj, dict) else None
    if not isinstance(value, list) or (not allow_empty and not value):
        qualifier = "list" if allow_empty else "non-empty list"
        errors.append(f"{path}.{key}: required {qualifier}")
        return []
    return value


def require_text_list(
    obj: Any,
    key: str,
    path: str,
    errors: list[str],
    *,
    allow_empty: bool = False,
) -> list[str]:
    values = require_list(obj, key, path, errors, allow_empty=allow_empty)
    if any(not is_text(item) for item in values):
        errors.append(f"{path}.{key}: every item must be a non-placeholder string")
    return [item.strip() for item in values if is_text(item)]


def require_refs(
    obj: Any,
    key: str,
    path: str,
    errors: list[str],
    *,
    allow_empty: bool = False,
) -> list[str]:
    return require_text_list(obj, key, path, errors, allow_empty=allow_empty)


def require_bool(obj: Any, key: str, path: str, errors: list[str]) -> bool | None:
    value = obj.get(key) if isinstance(obj, dict) else None
    if type(value) is not bool:
        errors.append(f"{path}.{key}: required boolean")
        return None
    return value


def require_count(obj: Any, key: str, path: str, errors: list[str]) -> int | None:
    value = obj.get(key) if isinstance(obj, dict) else None
    if type(value) is not int or value < 0:
        errors.append(f"{path}.{key}: required non-negative integer")
        return None
    return value


def parse_time(value: Any, path: str, errors: list[str]) -> datetime | None:
    if not is_text(value):
        errors.append(f"{path}: required ISO-8601 timestamp")
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"{path}: invalid ISO-8601 timestamp")
        return None
    if parsed.utcoffset() is None:
        errors.append(f"{path}: timezone offset is required")
        return None
    return parsed


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def authority_satisfied(required: str, available: set[str]) -> bool:
    if required == "contract":
        return "contract" in available
    if required == "browser/ux":
        return "browser/ux" in available
    ladder = ["unit", "component", "integration", "real-stack"]
    if required not in ladder:
        return False
    minimum = ladder.index(required)
    return any(authority in available for authority in ladder[minimum:])


@dataclass(frozen=True)
class SourceIdentity:
    component: str
    repo: str
    revision: str
    dirty_fingerprint: str
    build_digest: str

    def as_dict(self) -> dict[str, str]:
        return {
            "component": self.component,
            "repo": self.repo,
            "revision": self.revision,
            "dirty_fingerprint": self.dirty_fingerprint,
            "build_digest": self.build_digest,
        }


@dataclass
class Artifact:
    evidence_id: str
    artifact_type: str
    path: Path | None
    digest: str
    run_id: str
    captured_at: datetime | None
    source_revisions: dict[str, str]
    journey_ids: set[str]
    case_ids: set[str]
    hop_ids: set[str]
    correlation_values: set[str]
    payload: dict[str, Any] | None = None


@dataclass
class CommandRecord:
    command_id: str
    phase: str
    kind: str
    command: str
    expected: str
    exit_code: int
    started_at: datetime | None
    completed_at: datetime | None
    evidence: set[str]
    outputs: set[str]
    test_identity: str | None
    source_fingerprints: dict[str, str]
    source_revisions: dict[str, str]


@dataclass
class RunnerRecord:
    report_id: str
    command_id: str
    phase: str
    authority: str
    project: str
    source_revisions: dict[str, str]
    journey_ids: set[str]
    case_ids: set[str]
    hop_ids: set[str]
    evidence: set[str]


@dataclass
class RunContext:
    run_id: str | None = None
    plan_digest: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    sources: dict[str, SourceIdentity] = field(default_factory=dict)
    source_identity_refs: dict[str, set[str]] = field(default_factory=dict)
    commands: dict[str, CommandRecord] = field(default_factory=dict)
    outputs_by_kind: dict[str, set[str]] = field(default_factory=dict)
    runners: dict[str, RunnerRecord] = field(default_factory=dict)
    roles_by_journey: dict[str, dict[str, str]] = field(default_factory=dict)
    service_components: set[str] = field(default_factory=set)
    service_topology: dict[str, dict[str, str]] = field(default_factory=dict)
    trust_level: str | None = None
    base_dir: Path | None = None


def artifact_hashes(refs: set[str], catalog: dict[str, Artifact]) -> set[str]:
    return {catalog[ref].digest for ref in refs if ref in catalog}


def require_independent(
    groups: dict[str, set[str]],
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
) -> None:
    names = list(groups)
    for left_index, left in enumerate(names):
        for right in names[left_index + 1 :]:
            if groups[left] & groups[right]:
                errors.append(f"{path}: {left} and {right} evidence reuse the same ID")
            if artifact_hashes(groups[left], catalog) & artifact_hashes(groups[right], catalog):
                errors.append(f"{path}: {left} and {right} evidence are byte-identical")


def collect_refs(value: Any, path: str, errors: list[str]) -> set[str]:
    refs: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if key == "evidence_catalog":
                continue
            if key in {"evidence", "outputs"} or key.endswith("_evidence"):
                refs |= _refs_from_container(child, child_path, errors)
            else:
                refs |= collect_refs(child, child_path, errors)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            refs |= collect_refs(child, f"{path}[{index}]", errors)
    return refs


def _refs_from_container(value: Any, path: str, errors: list[str]) -> set[str]:
    if isinstance(value, list):
        refs = {item.strip() for item in value if is_text(item)}
        if len(refs) != len(value):
            errors.append(f"{path}: every evidence reference must be a string ID")
        return refs
    if isinstance(value, dict):
        refs: set[str] = set()
        for key, child in value.items():
            refs |= _refs_from_container(child, f"{path}.{key}", errors)
        return refs
    errors.append(f"{path}: required evidence ID list or mapping of lists")
    return set()
