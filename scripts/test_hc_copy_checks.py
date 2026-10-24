"""Tests for hc-copy-checks.py. Run: python3 -m unittest scripts/test_hc_copy_checks.py"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "hc_copy_checks", pathlib.Path(__file__).with_name("hc-copy-checks.py"))
hc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hc)


class ToPayload(unittest.TestCase):
    def test_cron_check_payload(self):
        p = hc.to_payload({"name": "sds-pin-watcher", "schedule": "20 7 * * *", "tz": "America/New_York",
                           "grace": 14400, "timeout": 86400, "desc": "", "tags": ""})
        self.assertEqual(p, {"name": "sds-pin-watcher", "schedule": "20 7 * * *", "tz": "America/New_York",
                             "grace": 14400, "desc": "", "tags": "", "channels": "*", "unique": ["name"]})

    def test_interval_check_payload(self):
        p = hc.to_payload({"name": "sds-deploy-watcher", "timeout": 3600, "grace": 3600, "desc": "", "tags": ""})
        self.assertEqual(p["timeout"], 3600)
        self.assertNotIn("schedule", p)
        self.assertNotIn("tz", p)
        self.assertEqual(p["unique"], ["name"])

    def test_name_with_spaces_kept_exactly(self):
        p = hc.to_payload({"name": "Change Manager OPs Check", "timeout": 86400, "grace": 3600})
        self.assertEqual(p["name"], "Change Manager OPs Check")
        self.assertEqual(p["desc"], "")
        self.assertEqual(p["tags"], "")


if __name__ == "__main__":
    unittest.main()
