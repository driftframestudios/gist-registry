# Receiver-owned adapter contract

Load when connecting the portable procedure to an actual repository. This is a
responsibility mapping, not a required new API or a scanner implementation.
A short record in the receiving PR can bind the existing owners and commands.

## Minimum mapping

| Responsibility | Receiving input | Distinguishing observation |
| --- | --- | --- |
| Authority and source | Authorized action, accepted revision or reviewed candidate, implementation owner | Selected source and actual invoked modules agree; incidental checkout state stays explicit. |
| Installation | Engine/version, platform, archive/binary evidence, local receipt policy | Changed bytes or invalid installation state prevent inspection. |
| Configuration | Exact configuration identity, rule selection, reviewed exceptions | A fresh selected-rule canary detects through this configuration; hidden policy changes hold review. |
| Process boundary | Arguments, environment, validation/network policy, timeout/output budget | Nonzero error or signal remains incomplete; private diagnostics stay inside the owner. |
| Tree/artifact | Included files, ignored/generated material, excluded caches, entry types, containment | The requested artifact is actually scanned; unsupported or escaping entries hold that scope. |
| Index | Indexed bytes, stage policy, filter behavior, alternate-index policy, temporary ownership | A worktree-clean/index-finding fixture remains a finding; unchanged/skip-worktree entries retain scope. |
| History | Clone depth, available refs, traversal and merge policy | Merge-introduced and non-current-ref fixtures are visible; unavailable history remains explicit. |
| Result and recovery | Canary, completed scopes, clean/finding/error/resting states, safe projection | A scanner fault cannot become a clean receipt; public object and diagnostic omit sensitive content. |

Supply only the rows needed by the requested scope. A new receiver that supports
a tree scan can return that result while index/history remain unsupported. A
receiver claiming those scopes must provide their distinct proof before use.

## Outcome mapping

The receiving implementation owns exact exit codes and types. Preserve this
meaning across any translation:

| Observation | Handoff disposition | Next owner |
| --- | --- | --- |
| Canary passed; every requested scope completed clean | Observation complete within named scope | Existing receiving handoff |
| Admitted finding | Affected handoff held | Private triage and, where needed, credential owner |
| Process/report/redaction/installation failure | Observation incomplete | Scanner implementation owner |
| Index unchanged under a declared resting policy | Index resting, with that reason | Receiver decides whether its requested observation is satisfied |
| Requested scope missing, unsupported, or pending | Scope held/unobserved | Scope or implementation owner |

Keep completed observations useful when the local protocol exposes them, while
an incomplete required scope still holds the combined handoff. The portable
package creates neither a retry loop nor an incident-response mandate.

## Two actual implementations and their differences

At Registry `024797b881b030ca83ca3fe5b57cba19e58bb46d`, the native owner is
`tools/scan-secret-material.mjs`, with `tools/install-betterleaks.mjs`,
`.betterleaks.toml`, and `tests/security/secret-material.test.mjs`. Its installer
pins both archive and executable digests in source. Its operational canary also
rejects its value anywhere in raw stdout/stderr.

At the final HASE receiver `ba014f200117530ddd6f1275df9102bab32279e9`, the same relative owner roles
exist, while installation verifies a pinned archive and a receipt-bound
executable digest. The wrapper permits sensitive raw metadata transiently and
removes it from returned findings and rendered feedback. Its cache boundaries
and reviewed exceptions differ from Registry's. The receiving record describes
the actual policy instead of inheriting the other repository's guarantee.

Both expose native Node module boundaries for a small fault exercise. Their
actual CLI remains the production entry point. The included exercise targets
that reviewed two-module layout; a different scanner supplies its own mapping
and evidence rather than adapting to an accidental JavaScript interface.

## Source closure and transfer

This package's required files are its core, three references, exercise guide,
exercise script and source-identity regression. All operative instructions travel in that closure.
Repository code, configuration, installation assets and runbooks are supplied
by the named receiver and retain its revision and authority. They are inputs to
application, not hidden files that a public reader must retrieve from Registry.
Optional external sources establish mechanics and lineage. Publication of the
package does not publish a receiving repository or authorize its scanner run.

For the included native adapter, verify the selected revision and exact wrapper,
installer and configuration bytes before import. Read original locally available
Git objects with replacement refs, lazy fetching and optional locks disabled;
missing objects hold admission rather than trigger acquisition. The two reviewed modules use
Node built-ins and each other. A changed dependency graph requires a new source
review. The exercise does not establish hostile-host isolation or a concurrent
immutable snapshot; run in the receiver's quiescent trusted task environment.
