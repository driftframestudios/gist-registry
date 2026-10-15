"""Prove query meaning before observing an index on the same bounded workload."""

import argparse
import hashlib
import json
import platform
from datetime import UTC, datetime
from pathlib import Path

import psycopg

from owned_cluster import owned_cluster

ROOT = Path(__file__).resolve().parents[1]
QUERY = (ROOT / "sql/query.sql").read_text()
INDEX = (ROOT / "sql/index.sql").read_text()
DROP_INDEX = "drop index sample.transactional_outbox_pending_specimen_idx"
WORKLOAD = json.loads((ROOT / "fixtures/workload.json").read_text())
PLAN_FIELDS = (
    "Cache Hits",
    "Cache Misses",
    "Cache Evictions",
    "Cache Overflows",
    "Peak Memory Usage",
    "Node Type",
    "Relation Name",
    "Index Name",
    "Join Type",
    "Plan Rows",
    "Plan Width",
    "Startup Cost",
    "Total Cost",
    "Actual Rows",
    "Actual Loops",
    "Actual Startup Time",
    "Actual Total Time",
    "Rows Removed by Filter",
    "Heap Fetches",
    "Shared Hit Blocks",
    "Shared Read Blocks",
    "Shared Dirtied Blocks",
    "Shared Written Blocks",
    "Temp Read Blocks",
    "Temp Written Blocks",
)
SOURCE_FILES = (
    ".python-version",
    "tests/test_pending_outbox.py",
    "src/pending_outbox.py",
    "src/owned_cluster.py",
    "sql/schema.sql",
    "sql/query.sql",
    "sql/index.sql",
    "fixtures/semantic.json",
    "fixtures/workload.json",
    "expected/semantic.json",
    "pyproject.toml",
    "uv.lock",
)


class ProofError(RuntimeError):
    """A declared semantic or authority observation differed from its oracle."""


def require(condition, message):
    if not condition:
        raise ProofError(message)


def rows(connection, tenant, query=QUERY):
    return [list(row) for row in connection.execute(query, (tenant,)).fetchall()]


def install(owner):
    owner.execute((ROOT / "sql/schema.sql").read_text())
    fixture = json.loads((ROOT / "fixtures/semantic.json").read_text())
    with owner.cursor() as cursor:
        cursor.executemany(
            "insert into sample.tenant values (%s)", [(x,) for x in fixture["tenants"]]
        )
        cursor.executemany("insert into sample.specimen values (%s, %s)", fixture["specimens"])
        cursor.executemany(
            "insert into sample.transactional_outbox values (%s, %s, %s, %s)",
            fixture["messages"],
        )


def verify_semantics(reader):
    expected = json.loads((ROOT / "expected/semantic.json").read_text())
    for tenant, wanted in expected.items():
        require(
            rows(reader, tenant) == wanted,
            "Pending rows differ from the independent fixture oracle",
        )
    # Each changed predicate answers a different question; the literal oracle detects it.
    mutations = {
        "tenant_relation": ("pending.tenant_id = specimen.tenant_id", "true"),
        "aggregate_relation": ("pending.aggregate_id = specimen.specimen_id", "true"),
        "pending_state": (
            "pending.delivery_state <> 'delivered'",
            "pending.delivery_state = 'ready'",
        ),
    }
    for name, (original, changed) in mutations.items():
        require(QUERY.count(original) == 1, "The mutation target needs source-aware review")
        actual = rows(reader, "SYN-A", QUERY.replace(original, changed))
        require(
            actual != expected["SYN-A"], f"The independent oracle missed the {name} perturbation"
        )
    return {"tenants_checked": len(expected), "predicate_perturbations_detected": list(mutations)}


def expect_database_error(connection, sql, expected_type):
    try:
        connection.execute(sql)
    except expected_type:
        return
    raise ProofError("A deliberately invalid database operation was admitted")


def verify_authority_and_constraints(owner, reader):
    role = reader.execute(
        "select current_user, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
        "from pg_roles where rolname=current_user"
    ).fetchone()
    require(
        role == ("query_reader", False, False, False, False, False), "Use the ordinary query role"
    )
    expect_database_error(
        reader, "insert into sample.tenant values ('DENIED')", psycopg.errors.InsufficientPrivilege
    )
    expect_database_error(
        reader, "create table sample.denied (id int)", psycopg.errors.InsufficientPrivilege
    )
    expect_database_error(
        owner,
        "insert into sample.specimen values ('SYN-A','SYN-1')",
        psycopg.errors.UniqueViolation,
    )
    expect_database_error(
        owner,
        "insert into sample.specimen values ('ABSENT','SYN-1')",
        psycopg.errors.ForeignKeyViolation,
    )
    expect_database_error(
        owner,
        "insert into sample.transactional_outbox values ('SYN-A','BAD','SYN-1','unknown')",
        psycopg.errors.CheckViolation,
    )
    expect_database_error(
        owner,
        "insert into sample.transactional_outbox values ('SYN-A','NULL','SYN-1',null)",
        psycopg.errors.NotNullViolation,
    )
    return {"role": role[0], "denied_writes": 2, "relational_constraint_controls": 4}


def load_workload(owner):
    # Fixed capacity is part of this artifact coordinate; scaling earns its own review.
    require(
        (
            WORKLOAD["specimens"],
            WORKLOAD["pending_messages"],
            WORKLOAD["delivered_messages"],
            WORKLOAD["pending_per_specimen"],
        )
        == (1000, 10000, 1000, 10),
        "Restore the declared bounded workload before running this coordinate",
    )
    tenant = WORKLOAD["tenant"]
    owner.execute("insert into sample.tenant values (%s)", (tenant,))
    owner.execute(
        "insert into sample.specimen select %s, 'SYN-'||lpad(n::text,4,'0') "
        "from generate_series(1,1000) n",
        (tenant,),
    )
    owner.execute(
        "insert into sample.transactional_outbox "
        "select %s, 'P-'||n, 'SYN-'||lpad((((n-1)%%1000)+1)::text,4,'0'), "
        "(array['ready','leased','recovery_required'])[((n-1)%%3)+1] "
        "from generate_series(1,10000) n",
        (tenant,),
    )
    owner.execute(
        "insert into sample.transactional_outbox "
        "select %s, 'D-'||n, 'SYN-'||lpad(n::text,4,'0'), 'delivered' "
        "from generate_series(1,1000) n",
        (tenant,),
    )
    # Vacuum makes visibility-map coverage an explicit part of this read-only workload.
    owner.execute("vacuum (analyze) sample.specimen")
    owner.execute("vacuum (analyze) sample.transactional_outbox")


def verify_index(owner):
    definition, predicate, valid, role = owner.execute(
        "select pg_get_indexdef(i.indexrelid),pg_get_expr(i.indpred,i.indrelid),"
        "i.indisvalid,pg_get_userbyid(c.relowner) "
        "from pg_index i join pg_class c on c.oid=i.indexrelid "
        "where i.indexrelid='sample.transactional_outbox_pending_specimen_idx'::regclass"
    ).fetchone()
    require("(tenant_id, aggregate_id)" in definition, "Index keys changed")
    require(predicate == "(delivery_state <> 'delivered'::text)", "Index predicate changed")
    require(valid and role == "fixture_owner", "Index validity or setup ownership changed")
    return {
        "keys": ["tenant_id", "aggregate_id"],
        "predicate": predicate,
        "owner": role,
        "valid": valid,
    }


def normalize_plan(record):
    def visit(node):
        result = {key: node[key] for key in PLAN_FIELDS if key in node}
        if "Plans" in node:
            result["Plans"] = [visit(child) for child in node["Plans"]]
        return result

    return {
        "planning_ms": record["Planning Time"],
        "execution_ms": record["Execution Time"],
        "plan": visit(record["Plan"]),
    }


def observe(reader):
    record = reader.execute(
        "explain (analyze, buffers, format json) " + QUERY,
        (WORKLOAD["tenant"],),
    ).fetchone()[0][0]
    return normalize_plan(record)


def prove(directory):
    with (
        owned_cluster(directory) as connection_parameters,
        psycopg.connect(
            **connection_parameters,
            user="fixture_owner",
            autocommit=True,
        ) as owner,
    ):
        install(owner)
        with psycopg.connect(
            **connection_parameters, user="query_reader", autocommit=True
        ) as reader:
            reader.execute("set statement_timeout = '30s'")
            reader.execute("set work_mem = '4MB'")
            reader.execute("set jit = off")
            semantics = verify_semantics(reader)
            authority = verify_authority_and_constraints(owner, reader)
            load_workload(owner)
            expected = [[f"SYN-{n:04d}", 10] for n in range(1, 1001)]
            baseline_rows = rows(reader, WORKLOAD["tenant"])
            require(
                baseline_rows == expected, "Baseline workload differs from its exact count oracle"
            )
            owner.execute(INDEX)
            index = verify_index(owner)
            indexed_rows = rows(reader, WORKLOAD["tenant"])
            require(
                indexed_rows == expected == baseline_rows, "Index variant changed query meaning"
            )
            verify_semantics(reader)
            # Admit comparison after semantic parity; measure the same quiescent fixture.
            owner.execute(DROP_INDEX)
            baseline_plan = observe(reader)
            owner.execute(INDEX)
            indexed_plan = observe(reader)
            settings = {
                name: {"value": value, "unit": unit}
                for name, value, unit in reader.execute(
                    "select name, setting, unit from pg_settings where name in "
                    "('server_version','server_version_num','work_mem','shared_buffers','jit',"
                    "'default_statistics_target','random_page_cost','seq_page_cost','effective_cache_size',"
                    "'max_parallel_workers_per_gather','fsync','synchronous_commit','full_page_writes') "
                    "order by name"
                ).fetchall()
            }
            result = {
                "artifact": "postgresql-pending-outbox-query@0.1.0",
                "runtime": {
                    "python": platform.python_version(),
                    "psycopg": psycopg.__version__,
                    "postgresql": settings.pop("server_version")["value"],
                    "server_version_num": settings.pop("server_version_num")["value"],
                    "platform": platform.system(),
                    "machine": platform.machine(),
                },
                "settings": settings,
                "semantics": semantics,
                "authority": authority,
                "index": index,
                "workload": WORKLOAD,
                "table_rows": {
                    name: owner.execute(f"select count(*) from sample.{name}").fetchone()[0]
                    for name in ("tenant", "specimen", "transactional_outbox")
                },
                "semantic_parity": {
                    "rows": 1000,
                    "count_per_specimen": 10,
                    "admitted_before_measurement": True,
                },
                "measurement": {
                    "samples_per_variant": 1,
                    "timing_scope": "PostgreSQL EXPLAIN ANALYZE; client fetch, Python allocation, index build and cleanup lie outside this timing",
                    "order": ["baseline", "indexed"],
                    "statistics": "vacuum analyze before parity and measurements",
                    "fixture_writes_during_measurement": 0,
                    "baseline": baseline_plan,
                    "indexed": indexed_plan,
                },
                "source_sha256": {
                    path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
                    for path in SOURCE_FILES
                },
            }
    result["observed_at_utc"] = datetime.now(UTC).isoformat()
    result["owned_cluster"] = {"created": 1, "stopped": 1, "directories_removed": 1}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--postgres-bin", required=True, help="Existing PostgreSQL 17 bin directory"
    )
    arguments = parser.parse_args()
    print(json.dumps(prove(arguments.postgres_bin), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
