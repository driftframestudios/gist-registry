"""Independent semantic expectations and owned-cluster failure observations."""

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import owned_cluster  # noqa: E402
import pending_outbox  # noqa: E402


class QueryContractTests(unittest.TestCase):
    def test_retained_observation_binds_executed_source_and_license(self):
        observation = json.loads((ROOT / "observations/postgresql-17.json").read_text())
        self.assertEqual(set(observation["source_sha256"]), set(pending_outbox.SOURCE_FILES))
        for path, expected in observation["source_sha256"].items():
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), expected, path)
        source = json.loads((ROOT / "source-coordinate.json").read_text())
        self.assertEqual(
            hashlib.sha256((ROOT / "UPSTREAM-LICENSE").read_bytes()).hexdigest(),
            source["source_files"]["LICENSE"]["sha256"],
        )

    def test_literal_oracle_preserves_pending_empty_and_tenant_meanings(self):
        self.assertEqual(
            json.loads((ROOT / "expected/semantic.json").read_text()),
            {
                "SYN-A": [["SYN-1", 3], ["SYN-2", 0]],
                "SYN-B": [["SYN-1", 2]],
                "SYN-ABSENT": [],
                "SYN-A' OR true --": [],
            },
        )

    def test_normalization_keeps_cost_cardinality_and_buffer_observations(self):
        record = {
            "Planning Time": 0.1,
            "Execution Time": 1.5,
            "Plan": {
                "Node Type": "Nested Loop",
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Plan Rows": 990,
                "Shared Hit Blocks": 24,
                "Output": ["private expression omitted"],
                "Plans": [
                    {
                        "Node Type": "Index Only Scan",
                        "Actual Rows": 10,
                        "Actual Loops": 1000,
                        "Shared Read Blocks": 0,
                        "Heap Fetches": 0,
                    }
                ],
            },
        }
        normalized = pending_outbox.normalize_plan(record)
        self.assertEqual(normalized["plan"]["Plan Rows"], 990)
        self.assertEqual(normalized["plan"]["Plans"][0]["Actual Rows"], 10)
        self.assertEqual(normalized["plan"]["Plans"][0]["Actual Loops"], 1000)
        self.assertEqual(normalized["plan"]["Shared Hit Blocks"], 24)
        self.assertNotIn("Output", normalized["plan"])

    def test_changed_workload_capacity_is_rejected_before_sql(self):
        from unittest.mock import Mock

        owner = Mock()
        with (
            patch.dict(pending_outbox.WORKLOAD, {"specimens": 1000000000}),
            self.assertRaises(pending_outbox.ProofError),
        ):
            pending_outbox.load_workload(owner)
        owner.execute.assert_not_called()

    def test_wrong_major_is_rejected_before_creating_a_cluster(self):
        from subprocess import CompletedProcess

        with tempfile.TemporaryDirectory() as directory:
            for name in ("postgres", "pg_ctl", "initdb", "pg_isready"):
                (Path(directory) / name).touch()
            with (
                patch.object(
                    owned_cluster.subprocess,
                    "run",
                    return_value=CompletedProcess(
                        [],
                        0,
                        stdout="postgres (PostgreSQL) 18.6\n",
                    ),
                ),
                self.assertRaisesRegex(owned_cluster.ClusterError, "major version 17"),
            ):
                owned_cluster.postgres_binaries(directory)


class OwnedClusterTests(unittest.TestCase):
    def setUp(self):
        self.container = tempfile.TemporaryDirectory()
        self.addCleanup(self.container.cleanup)
        self.root = Path(self.container.name) / "owned"
        self.root.mkdir()
        self.operations = []
        self.binaries = {
            name: Path(name) for name in ("postgres", "initdb", "pg_ctl", "pg_isready")
        }
        self.server = Mock()
        self.server.poll.return_value = None
        self.patchers = [
            patch.object(owned_cluster.subprocess, "Popen", return_value=self.server),
            patch.object(owned_cluster, "await_ready"),
            patch.object(owned_cluster, "postgres_binaries", return_value=self.binaries),
            patch.object(owned_cluster.tempfile, "mkdtemp", return_value=str(self.root)),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def command(self, _arguments, _log, operation):
        self.operations.append(operation)
        if operation == "cluster initialization":
            (self.root / "data").mkdir()

    def test_success_releases_only_its_owned_directory(self):
        sibling = self.root.parent / "unrelated"
        sibling.mkdir()
        with (
            patch.object(owned_cluster, "command", side_effect=self.command),
            owned_cluster.owned_cluster("unused"),
        ):
            self.assertTrue(self.root.exists())
        self.assertFalse(self.root.exists())
        self.assertTrue(sibling.exists())
        self.server.send_signal.assert_called_once_with(owned_cluster.signal.SIGQUIT)
        self.server.wait.assert_called_once_with(timeout=30)

    def test_body_interruption_still_stops_and_removes_cluster(self):
        interruption = KeyboardInterrupt("synthetic interruption")
        with (
            patch.object(owned_cluster, "command", side_effect=self.command),
            self.assertRaises(KeyboardInterrupt) as caught,
            owned_cluster.owned_cluster("unused"),
        ):
            raise interruption
        self.assertIs(caught.exception, interruption)
        self.assertFalse(self.root.exists())
        self.server.send_signal.assert_called_once_with(owned_cluster.signal.SIGQUIT)
        self.server.wait.assert_called_once_with(timeout=30)

    def test_readiness_interruption_before_pid_file_still_stops_exact_process(self):
        interruption = KeyboardInterrupt("synthetic startup interruption")
        with (
            patch.object(owned_cluster, "command", side_effect=self.command),
            patch.object(owned_cluster, "await_ready", side_effect=interruption),
            self.assertRaises(KeyboardInterrupt) as caught,
            owned_cluster.owned_cluster("unused"),
        ):
            self.fail("An interrupted start reaches cleanup")
        self.assertIs(caught.exception, interruption)
        self.server.send_signal.assert_called_once_with(owned_cluster.signal.SIGQUIT)
        self.server.wait.assert_called_once_with(timeout=30)
        self.assertFalse(self.root.exists())

    def test_readiness_failure_after_process_creation_still_stops_exact_process(self):
        with (
            patch.object(owned_cluster, "command", side_effect=self.command),
            patch.object(
                owned_cluster, "await_ready", side_effect=owned_cluster.ClusterError("start")
            ),
            self.assertRaises(owned_cluster.ClusterError),
            owned_cluster.owned_cluster("unused"),
        ):
            self.fail("A failed start reaches cleanup")
        self.server.wait.assert_called_once_with(timeout=30)
        self.assertFalse(self.root.exists())

    def test_shutdown_failure_retains_directory_and_both_failures(self):
        body = KeyboardInterrupt("synthetic interruption")
        teardown = owned_cluster.ClusterError("synthetic shutdown failure")

        self.server.wait.side_effect = teardown
        with (
            patch.object(owned_cluster, "command", side_effect=self.command),
            self.assertRaises(BaseExceptionGroup) as caught,
            owned_cluster.owned_cluster("unused"),
        ):
            raise body
        self.assertEqual(caught.exception.exceptions, (body, teardown))
        self.assertTrue(self.root.exists())
        self.assertIn("retained for local recovery", teardown.__notes__[0])


@unittest.skipUnless(
    os.environ.get("PENDING_QUERY_POSTGRES_BIN"),
    "Set the explicit PostgreSQL 17 bin directory for owned-cluster proof",
)
class PostgreSQLTests(unittest.TestCase):
    def test_configured_owned_cluster_semantics_perturbations_and_plan_parity(self):
        result = pending_outbox.prove(os.environ["PENDING_QUERY_POSTGRES_BIN"])
        self.assertEqual(
            result["authority"],
            {
                "role": "query_reader",
                "denied_writes": 2,
                "relational_constraint_controls": 4,
            },
        )
        self.assertEqual(
            result["semantics"]["predicate_perturbations_detected"],
            ["tenant_relation", "aggregate_relation", "pending_state"],
        )
        self.assertEqual(
            result["table_rows"], {"tenant": 3, "specimen": 1003, "transactional_outbox": 11007}
        )
        self.assertEqual(result["semantic_parity"]["rows"], 1000)
        self.assertEqual(
            result["owned_cluster"], {"created": 1, "stopped": 1, "directories_removed": 1}
        )
        self.assertTrue(result["runtime"]["server_version_num"].startswith("17"))


if __name__ == "__main__":
    unittest.main()
