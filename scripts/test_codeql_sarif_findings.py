import json
import tempfile
import unittest
from pathlib import Path

from check_codeql_sarif_findings import inspect_sarif


def write_sarif(root: Path, *, rule_severity="8.0", level="warning", results=None):
    document = {
        "version": "2.1.0",
        "runs": [{
            "tool": {"driver": {
                "rules": [{"id": "py/test-rule", "properties": {"security-severity": rule_severity}}]
            }},
            "results": results if results is not None else [{
                "ruleId": "py/test-rule",
                "level": level,
                "message": {"text": "Test finding"},
                "locations": [{"physicalLocation": {
                    "artifactLocation": {"uri": "worker.mjs"},
                    "region": {"startLine": 12}
                }}]
            }]
        }]
    }
    (root / "result.sarif").write_text(json.dumps(document), encoding="utf-8")


class CodeQLSarifGateTests(unittest.TestCase):
    def test_high_security_severity_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_sarif(root, rule_severity="7.0", level="warning")
            findings, blocking = inspect_sarif(root)
            self.assertEqual(len(findings), 1)
            self.assertEqual(len(blocking), 1)

    def test_critical_security_severity_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_sarif(root, rule_severity="9.5", level="note")
            _, blocking = inspect_sarif(root)
            self.assertEqual(len(blocking), 1)

    def test_error_level_blocks_without_numeric_severity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_sarif(root, rule_severity=None, level="error")
            _, blocking = inspect_sarif(root)
            self.assertEqual(len(blocking), 1)

    def test_medium_and_low_findings_are_reported_but_nonblocking(self):
        for severity in ("4.0", "6.9", None):
            with self.subTest(severity=severity), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                write_sarif(root, rule_severity=severity, level="warning")
                findings, blocking = inspect_sarif(root)
                self.assertEqual(len(findings), 1)
                self.assertEqual(blocking, [])

    def test_missing_sarif_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "No SARIF files"):
                inspect_sarif(Path(directory))

    def test_malformed_sarif_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "broken.sarif").write_text("{", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Cannot read valid SARIF"):
                inspect_sarif(root)


if __name__ == "__main__":
    unittest.main()
