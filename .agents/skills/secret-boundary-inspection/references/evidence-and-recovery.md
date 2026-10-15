# Evidence, alternatives and recovery

Primary mechanics checked 2026-10-15. Detector effectiveness, wrapper behavior,
receiving use and publication each retain their own evidence.

## Four package routes

1. **Publish every repository dependency:** preserves implementation detail but couples the contract to complete runbooks, orientation, configuration, installer and tests.
2. **Portable procedure plus a receiver-owned adapter:** selected for Issue #56. HASE already has an accepted implementation; this route makes its responsibilities and failure evidence explicit.
3. **Embed a complete runnable reference scanner:** useful when a named receiver lacks an implementation; it adds a maintained scanner and installation owner beyond this task.
4. **Keep the contract local:** fitting while no receiver or complete package exists. A publication flag alone supplies neither dependency closure nor receiver proof.

## Source → decision → proof

| Official source | Design consequence | Receiving proof and limit |
| --- | --- | --- |
| [Betterleaks 1.8.1 scanning](https://github.com/betterleaks/betterleaks/blob/v1.8.1/docs/scanning.md) and [configuration](https://github.com/betterleaks/betterleaks/blob/v1.8.1/docs/config.md) | Directory, stdin and Git scopes differ; provider validation is a distinct network-capable operation. | Use the receiver's declared flags/configuration; a fresh canary checks one selected detection path rather than every rule's recall. |
| [Git object access](https://git-scm.com/docs/git-cat-file) and [local original-object options](https://git-scm.com/docs/git) | Raw blob bytes, filter-converted output, replacement refs and lazy acquisition are distinct choices. | Preserve exact indexed bytes; read accepted source with replacement refs and lazy fetching disabled. Missing objects hold source admission. |
| [Git history options](https://git-scm.com/docs/git-log) and [shallow-state query](https://git-scm.com/docs/git-rev-parse) | All local refs and a non-shallow clone define a local traversal, not global object coverage. | Exercise merge and non-current-ref cases; name unfetched and binary-patch limits. |
| [Node 22 child-process events](https://nodejs.org/docs/latest-v22.x/api/child_process.html) | Start errors, exit codes, signals and completed stdio have different meanings. | Inject failure beside successful canary handling; keep diagnostics private and return an incomplete state. |
| [GitHub sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) | Credential containment and coordinated history repair have separate consequences. | Return a plausible live candidate privately to its owner before cleanup or wider history actions. |

A detector comparison or a broad recall claim would require a corpus, rule and
version-specific evaluation. This package makes neither claim. It exercises
its chosen path and retains universal absence, credential validity and hosted
exposure as separate questions.

## Observed baseline and final receiver

The initial design review applied the method to accepted HASE
`4eebab07a37fe2be46659fbeee1dc7085a25a678`. Its 25 focused native tests passed
with zero skips, including real pinned-scanner exact-index, smudge-filter,
merge-resolution and non-current-ref cases. A fresh operational canary passed.
Independent native-module controls observed unexpected exit/signal, malformed
report, unredacted secret, contradictory exit/report, absent canary, protected
metadata feedback and bounded child output. Source remained unchanged.

That baseline informed this package; it preceded the final portable package.
The completed receiving exercise used HASE
`ba014f200117530ddd6f1275df9102bab32279e9`, preserving that revision's scanner,
installer and configuration bytes while the receiving task updated orientation.
The portable script passed a fresh native canary and all eight fault/output
controls. A deliberately stale source coordinate produced fixed held feedback,
nonzero status and no acceptance receipt.

The receiver independently ran its 25 focused native tests with zero skips.
Its actual pinned Betterleaks 1.8.1 artifact route observed clean input, then a
generated non-issued candidate as a protected finding, then clean recovery after
removal. An owned Node child that signaled itself passed through the real
process/scan boundary as an operational failure; a subsequent real artifact
scan completed clean. The receiver also observed its tree, exact proposed index
and all-local-ref history after fresh canary proof. The temporary artifact was
removed. Its configuration digest was
`a002cacbac5640fcb32249fb9c8d4e141d810a860587ebd2e86673014d94bd15`.
[HASE PR #488](https://github.com/driftframestudios/human-ai-systems-exemplars/pull/488)
holds the final task and index identities. After the orientation change formed
receiver commit `0781f4e5588903149605386cc0cfe5521862a950`, the final portable
exercise passed again with that explicit coordinate. Its three scanner-owner
files remained byte-identical to the accepted base. This rerun also exercised
the strengthened local-original-object source admission.

The retained source-identity regression separately checks replacement refs,
missing promisor bytes and inherited Git overrides in disposable synthetic
repositories. Independent removal of each matching guard made that suite fail.
This is source-admission proof; the real receiver runs establish native scanner
and output behavior.

The same portable script also passed against Registry
`024797b881b030ca83ca3fe5b57cba19e58bb46d`, using its own installation and
configuration. These are changed-context uses within a shared collaboration
lineage. Native engine artifact observations, process-boundary fault controls,
synthetic assertions, independent review and a new receiver's cold-start use
retain their distinct evidence layers.

## Recovery without widening the task

A scanner error returns the fixed category and last supported scope to its
implementation owner; preserve source and accepted output. A finding enters
private triage and holds its affected handoff. A plausible live credential
routes containment to the credential owner; repository repair follows the
appropriate separately authorized plan. An incomplete clone returns to its ref
acquisition owner before a history claim. Raw candidate values, logs and
provider coordinates stay out of the durable return.

After the repair or missing evidence arrives, repeat the fresh canary and the
changed scopes. Keep one normalized receipt with the original receiving task;
additional records earn their place through a new decision or receiver.
