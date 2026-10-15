# One parity-bound query-plan exercise

The receiving decision is whether the partial-index form earns a runnable
teaching place beside its query. This is a natural use of
[`parity-bound-workload-measurement`](../../../../.agents/skills/parity-bound-workload-measurement/SKILL.md):
the SQL package supplies a real database workload and independent meaning
oracle while the skill supplies the comparison boundary.

Four candidate forms were considered: a source-only SQL excerpt, the complete
custody/outbox service, this bounded query-and-index package, and a restart
harness. The bounded package makes query meaning and physical work observable
without requiring the service's authorization, delivery and recovery machinery.
The source-only excerpt stays useful as provenance; the broader service and
restart harness retain their existing Enterprise receivers.

## Held conditions and proof

Both variants execute the same parameterized lateral count as the same ordinary
role on the same synthetic rows. The large tenant has 1,000 specimens, 10,000
pending messages and 1,000 delivered messages, with uniform aggregate fan-in
of 10 pending messages per specimen. The small semantic fixture remains
present. Reader concurrency and fixture mutation during measurement are zero;
there is one active query at a time. Output is 1,000 ordered identifier/integer
pairs. Input shape has two fixed relational identity components and four
admitted states. The fixture's IDs, rows and result bytes are bounded by its
versioned source; this run leaves payload width and skew as successor variables.

The runner first compares both variants against independently specified rows,
including exact zero and empty-result cases. It detects tenant, aggregate and
state predicate perturbations. It verifies database constraints and ordinary
read authority. Cleanup has focused successful-body, interrupted-body,
failed-start and failed-shutdown controls. Both query variants use that same
resource owner. Only after parity passes does the runner collect EXPLAIN data.

`VACUUM ANALYZE` precedes parity and the measured reads. Baseline comes first,
indexed second, in one serial invocation. The baseline keeps primary-key
indexes. The indexed form adds the fixed-predicate partial index. Cache warmth
and index creation order remain visible limits. The selected settings, engine,
platform, fixture and exact executable hashes are retained in
[the observation](../observations/postgresql-17.json).

## Retained observation

The accepted measurement invocation used PostgreSQL 17.10, Python 3.12.13 and
Psycopg 3.3.6 on Darwin/arm64. One sample per variant was collected at the
observation's UTC timestamp. With n=1, the median and range endpoints equal
the single value; there is no tail estimate or inferential comparison.

| Variant | Samples | Execution milliseconds: value / median / range | Root shared hits | Root shared reads |
| --- | ---: | --- | ---: | ---: |
| Baseline | 1 | 424.444 / 424.444 / 424.444–424.444 | 89,007 | 0 |
| Partial index | 1 | 1.116 / 1.116 / 1.116–1.116 | 1,993 | 15 |

Both return 1,000 rows with count 10. The baseline outbox node is a sequential
scan: 10 actual rows per loop over 1,000 loops, with 10,997 rows removed per
loop. The indexed outbox node is an index-only scan: 10 actual rows per loop
over 1,000 loops and zero heap fetches. Both estimate 3 matching rows per loop;
the actual cardinality remains distinct from that estimate. The raw normalized
tree also preserves PostgreSQL's memoization and memory observations when
present. Root and child buffer counts overlap; sum distinct phases rather than
adding every plan node.

This invocation completed without a semantic mismatch, query failure or cleanup
failure. Separate test invocations establish contract and recovery behavior;
their timings carry no performance comparison claim. Earlier development runs
changed the observer source and served implementation feedback. The retained
comparison binds only the twelve source files named in its observation.

## Decision and variable costs

**Disposition: adopt this teaching form; defer production adoption to the
receiving workload.** The observation connects a predicate-preserving index to
a concrete change in database work. Exact semantics, catalog shape and cleanup
controls earn acceptance; a timing threshold supplies no acceptance gate.

The complete path includes synthetic fixture creation, statistics and visibility
preparation, two parity result sets, index construction, server execution,
client transfer, Python tuple/list allocation, JSON rendering, and shutdown.
The retained milliseconds measure server execution only. The runner allocates
O(N) result storage; the index adds pending-entry storage and state-change write
maintenance. Warm-cache reads, visibility, write traffic, data skew, output
width, concurrency, delivery-state distribution and N/M growth can change the
receiving decision. The [cost analysis](../README.md#whole-path-cost) gives the
algorithmic envelope without converting one local timing into a production
budget or energy claim.

The stop rule is one successful fixed-workload comparison after all controls
pass. Re-entry follows a material change to the query, fixture, runtime,
observer, dependency, platform, or receiver. A successor can compare a grouped
single pass, interleave enough repeated samples for a stable distribution,
measure Python peak allocation and index write costs, and establish a named
workload budget when those observations change an actual deployment choice.
