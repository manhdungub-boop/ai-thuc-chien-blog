#!/usr/bin/env python3
"""Fail the offline CodeQL job on high/critical security findings.

SARIF stays on the ephemeral GitHub Actions runner and is never uploaded.
The gate blocks findings with security-severity >= 7.0 (high/critical) or
SARIF level == "error". Lower-severity findings remain visible in the summary.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BLOCKING_SEVERITY = 7.0


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def inspect_sarif(directory: Path) -> tuple[list[dict[str, Any]], list[str]]:
    files = sorted(directory.rglob("*.sarif")) if directory.exists() else []
    if not files:
        raise ValueError(f"No SARIF files found under {directory}")

    findings: list[dict[str, Any]] = []
    errors: list[str] = []
    for path in files:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"Cannot read valid SARIF file {path}: {exc}") from exc

        runs = document.get("runs")
        if not isinstance(runs, list):
            raise ValueError(f"Invalid SARIF document (missing runs array): {path}")

        for run in runs:
            if not isinstance(run, dict):
                raise ValueError(f"Invalid SARIF run in {path}")
            driver = run.get("tool", {}).get("driver", {})
            rules = driver.get("rules", []) if isinstance(driver, dict) else []
            rules_by_id = {
                rule.get("id"): rule
                for rule in rules
                if isinstance(rule, dict) and rule.get("id")
            }
            results = run.get("results", [])
            if not isinstance(results, list):
                raise ValueError(f"Invalid SARIF results array in {path}")

            for result in results:
                if not isinstance(result, dict):
                    raise ValueError(f"Invalid SARIF result in {path}")
                rule_id = result.get("ruleId", "unknown")
                rule = rules_by_id.get(rule_id, {})
                result_props = result.get("properties") or {}
                rule_props = rule.get("properties") or {}
                severity = _number(
                    result_props.get("security-severity")
                    or rule_props.get("security-severity")
                )
                level = str(result.get("level", "")).lower()
                locations = result.get("locations") or [{}]
                physical = locations[0].get("physicalLocation", {}) if locations else {}
                artifact = physical.get("artifactLocation", {}).get("uri", "unknown")
                line = physical.get("region", {}).get("startLine", "?")
                message = (result.get("message") or {}).get("text", "").replace("\n", " ").strip()
                item = {
                    "rule_id": rule_id,
                    "severity": severity,
                    "level": level,
                    "artifact": artifact,
                    "line": line,
                    "message": message,
                }
                findings.append(item)
                if level == "error" or (severity is not None and severity >= BLOCKING_SEVERITY):
                    errors.append(
                        f"{rule_id} ({level or 'no level'}, "
                        f"security-severity={severity if severity is not None else 'n/a'}) "
                        f"at {artifact}:{line} — {message}"
                    )

    return findings, errors


def main() -> int:
    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("codeql-results")
    try:
        findings, blocking = inspect_sarif(directory)
    except ValueError as exc:
        print(f"::error::CodeQL SARIF gate could not verify analysis: {exc}")
        return 2

    print(f"CodeQL SARIF gate: {len(findings)} finding(s); {len(blocking)} blocking.")
    for item in findings:
        severity = item["severity"]
        severity_text = f"{severity:.1f}" if severity is not None else "n/a"
        print(
            f"- {item['level'] or 'no level'} / security-severity={severity_text}: "
            f"{item['rule_id']} — {item['artifact']}:{item['line']} — {item['message']}"
        )

    if blocking:
        print(f"::error::CodeQL reported {len(blocking)} high/critical or error-level finding(s).")
        for item in blocking:
            print(f"::error::{item}")
        return 1

    print("PASS: no high/critical (security-severity >= 7.0) or error-level findings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
