# A pending count with a matching PostgreSQL index

This package answers one question: how much work does PostgreSQL perform to
count pending outbox messages for every specimen in a selected tenant, while
preserving exact count meaning? Read [the query](sql/query.sql),
[the partial index](sql/index.sql), and [the synthetic schema](sql/schema.sql)
as the central example. The Python runner supplies disposable database ownership,
parameter binding, independent expectations, and a comparable plan observation.

## Meaning and relations

| Relation | Durable identity | Enforced relation or value meaning |
| --- | --- | --- |
| `tenant` | `tenant_id` | One synthetic tenant identity |
| `specimen` | `(tenant_id, specimen_id)` | Tenant foreign key; specimen IDs may repeat across tenants |
| `transactional_outbox` | `(tenant_id, message_id)` | Tenant foreign key; generic `aggregate_id`; one admitted delivery state |

Tenant-to-specimen and tenant-to-outbox are one-to-many foreign-key relations.
The outbox's generic aggregate association is a **soft relationship**. A message
can name an aggregate outside the specimen table; the fixture includes one.
The query associates messages using both `tenant_id` and `aggregate_id`.

`ready`, `leased`, and `recovery_required` all count as pending. `delivered`
contributes zero. A specimen with zero matching messages remains a result row
with integer zero; an absent tenant returns an empty result. Null and unknown
states fail database constraints. PostgreSQL `count(*)` returns `bigint`, which
Psycopg reads as a Python integer. Results have a declared specimen-ID ordering.
The runner initializes the cluster with the C locale for reproducible fixture
ordering.

The small [fixture](fixtures/semantic.json) and separately authored
[expected rows](expected/semantic.json) distinguish repeated specimen IDs,
pending states, delivered state, unrelated aggregates, empty results, and an
injection-shaped tenant string. Three executed query perturbations remove the
tenant relation, remove the aggregate relation, or narrow pending to `ready`;
the independent oracle detects each changed meaning.

## Run the proof

Use Python 3.12, `uv`, and an existing PostgreSQL 17 installation containing
`postgres`, `initdb`, `pg_ctl`, and `pg_isready`. Run as an ordinary operating-system user on
Linux or macOS. PostgreSQL initialization requires a user who can create and
own its temporary data directory. The version check runs before allocation.
From the repository root:

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/postgresql-pending-outbox-query/0.1.0 --locked \
  python snippets/postgresql-pending-outbox-query/0.1.0/src/pending_outbox.py \
  --postgres-bin /path/to/postgresql-17/bin
```

The command creates one new cluster in a mode-0700 temporary directory, serves
only its private Unix socket, installs synthetic tables as `fixture_owner`,
and executes the parameterized query as `query_reader`. The reader has SELECT
on the sample tables and USAGE on their schema. Tests observe denied INSERT
and schema CREATE operations. The runner stops its owned server and removes
its directory before emitting the normalized JSON result.

The `%s` in `query.sql` is a Psycopg value placeholder. A receiver using another
driver adopts that driver's bound-parameter syntax. The selected tenant is a
query argument; this artifact's reader can select either synthetic tenant.
Application tenant authorization belongs to the Enterprise signed-context and
row-security receiver. Local socket trust is restricted by the owned directory
permissions and shares the invoking operating-system identity's trust boundary.

Run the inexpensive contract and cleanup tests:

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/postgresql-pending-outbox-query/0.1.0 --locked \
  python -m unittest discover -s snippets/postgresql-pending-outbox-query/0.1.0/tests -v
```

Run the same suite with its explicit database proof enabled:

```sh
PENDING_QUERY_POSTGRES_BIN=/path/to/postgresql-17/bin \
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/postgresql-pending-outbox-query/0.1.0 --locked \
  python -m unittest discover -s snippets/postgresql-pending-outbox-query/0.1.0/tests -v
```

The first route reports the database test as a named skip; the configured route
executes every test. `ruff check` and `ruff format --check` on this package's
`src` and `tests` directories supply the focused style check.

## Read the observation

[The retained observation](observations/postgresql-17.json) binds its executable
source, fixture, oracle, tests, and dependency lock by SHA-256. It records the
engine, Python and driver versions, setting values and units, role, distribution,
table cardinalities, plan estimates, actual rows, loop counts, and buffers.
Both variants produce exactly 1,000 ordered rows with count 10 before measurement.

The [large fixture](fixtures/workload.json) adds 1,000 specimens, 10,000 pending
messages spread evenly across them, and 1,000 delivered messages. The small
semantic fixture remains present: total tables contain 3 tenants, 1,003
specimens, and 11,007 messages. `VACUUM ANALYZE` establishes explicit statistics
and visibility-map coverage before the quiescent read workload.

The baseline retains primary-key indexes and omits only the pending-count
index. After equality checks, the runner drops and rebuilds that index to
observe baseline then indexed plans on the same rows. It records one sample
per variant. Warm cache, measurement order, visibility, and sampled statistics
can change results. PostgreSQL's planner selects node types; exact result rows
and index catalog meaning define correctness. No timing or plan-node threshold
controls success. See PostgreSQL's [EXPLAIN guidance](https://www.postgresql.org/docs/17/using-explain.html)
and [partial-index predicate guidance](https://www.postgresql.org/docs/17/indexes-partial.html).

### Whole-path cost

For N selected specimens, M total outbox messages, and P matching pending
messages, a repeated unindexed scan can inspect O(N × M) rows. The demonstrated
partial B-tree can instead perform N keyed searches plus matching-entry visits:
approximately O(N log M + P), with heap visits affected by visibility and plan
choice. `count(*)` still visits the matching entries; producing the complete
summary still costs O(N) output. A grouped single pass is another useful
successor candidate when workload distribution favors it.

PostgreSQL owns joins, aggregates, statistics, buffers and any memoization.
The runner's SQL series generation keeps the large fixture out of Python
message-object lists. Its parity check intentionally materializes expected,
baseline and indexed result lists: O(N) additional Python space, including
transient fetched tuples during conversion to JSON-ready lists. EXPLAIN's
execution time covers server execution; client transfer, Python allocation,
index construction, fixture setup, and teardown have separate cost boundaries.

The partial index uses additional storage proportional to pending entries and
adds write maintenance when messages enter or leave its predicate. Normal
`CREATE INDEX` can block table writes. This disposable, quiescent setup owns
that interval. A live-system receiver chooses a lock budget or separately
planned concurrent index creation and measures write costs before adoption.
See PostgreSQL's [index creation contract](https://www.postgresql.org/docs/17/sql-createindex.html).

## Failures and recovery

An oracle mismatch ends the proof before comparison. Restore the intended
query, fixture, or schema in a successor and rerun all semantic controls.
A selected runtime with a different PostgreSQL major fails before cluster
creation. The runner bounds process waits and reader statements, and keeps
process diagnostics inside its private working directory.

The runner owns the actual server process before readiness polling and waits
for that process during cleanup. Cleanup also runs after a body interruption,
failed start, or interruption before the server creates its PID file. If shutdown fails,
the runner preserves the owned directory, exposes its local recovery path, and
retains the body and cleanup failures together. Use that path with the selected
`pg_ctl` to inspect and stop the owned server before removing the directory.
Abrupt operating-system termination can require the same manual recovery.
Successful cleanup here uses immediate stop for a disposable fixture; durable
restart and crash-recovery guarantees remain with the upstream harness.

## Provenance and receiving scope

This is an authorized **adaptation**, with newly authored synthetic schema,
fixtures, runner and oracle. [The source coordinate](source-coordinate.json)
records Enterprise commit `ae213e7c01262431030a2a8d81129bed090f1376`, its complete
V005 query owner, V007 index owner and configured-test owner, and exact Git blobs
and file digests. It also records the official PostgreSQL archive used for the
local 17.10 observation. The runtime installer remains with the caller.

LIMS/ELN Enterprise Implementation is authored by Vikrant Varun Kudesia and
maintained by Driftframe Studios, Limited Liability Company. Humans own
authorship, review and release decisions; generative systems assist the work.
Git history and reviewed pull requests carry contribution credit. Its [Apache-2.0 license](UPSTREAM-LICENSE) is retained with this package.
The adaptation keeps the query and index forms while its new source files
carry the smaller sample boundary.

The Enterprise repository retains delivery transitions, signed tenant context,
row security, grants, lease fencing, replay, payload integrity, Flyway upgrade,
ordinary-role integration and restart acceptance. This example establishes
count semantics, database constraints, parameter binding, setup/read separation,
owned-cluster cleanup and one bounded query-plan comparison. A production
receiver supplies its own authorization, migration and workload evidence.

[Family orientation](../README.md) ·
[Measurement exercise](exercises/parity-bound-query-plans.md)
