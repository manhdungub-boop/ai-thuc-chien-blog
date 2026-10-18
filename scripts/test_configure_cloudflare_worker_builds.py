#!/usr/bin/env python3
import unittest
from configure_cloudflare_worker_builds import WORKERS, EXPECTED_DEPLOY_COMMAND, REPO_ID, REPO_NAME, TARGET_BUILD_COMMAND, validate_trigger
def trigger_for(spec, **overrides):
 t={"trigger_uuid":spec["trigger_uuid"],"external_script_id":spec["tag"],"root_directory":"/","branch_includes":["main"],"deploy_command":EXPECTED_DEPLOY_COMMAND,"build_command":"legacy copy command","build_token_uuid":"test-token-uuid","repo_connection":{"repo_name":REPO_NAME,"repo_id":REPO_ID}}
 t.update(overrides); return t
class TriggerValidationTests(unittest.TestCase):
 def test_both_expected_workers_match(self):
  for spec in WORKERS:
   with self.subTest(worker=spec["name"]): self.assertEqual(validate_trigger([trigger_for(spec)],spec)["trigger_uuid"],spec["trigger_uuid"])
 def test_wrong_worker_tag_is_rejected(self):
  with self.assertRaisesRegex(ValueError,"tag mismatch"): validate_trigger([trigger_for(WORKERS[0],external_script_id="wrong-tag")],WORKERS[0])
 def test_wrong_repository_is_rejected(self):
  with self.assertRaisesRegex(ValueError,"repository identity mismatch"): validate_trigger([trigger_for(WORKERS[0],repo_connection={"repo_name":"other","repo_id":"1"})],WORKERS[0])
 def test_wrong_deploy_command_is_rejected(self):
  with self.assertRaisesRegex(ValueError,"deploy command mismatch"): validate_trigger([trigger_for(WORKERS[0],deploy_command="unexpected")],WORKERS[0])
 def test_nonproduction_branch_is_rejected(self):
  with self.assertRaisesRegex(ValueError,"production branch main"): validate_trigger([trigger_for(WORKERS[0],branch_includes=["develop"])],WORKERS[0])
 def test_missing_or_duplicate_trigger_is_rejected(self):
  with self.assertRaisesRegex(ValueError,"found 0"): validate_trigger([],WORKERS[0])
  t=trigger_for(WORKERS[0])
  with self.assertRaisesRegex(ValueError,"found 2"): validate_trigger([t,dict(t)],WORKERS[0])
 def test_legacy_build_command_is_the_only_field_to_change(self):
  t=validate_trigger([trigger_for(WORKERS[0])],WORKERS[0])
  self.assertNotEqual(t["build_command"],TARGET_BUILD_COMMAND); self.assertEqual(t["deploy_command"],EXPECTED_DEPLOY_COMMAND)
if __name__=="__main__": unittest.main(verbosity=2)
