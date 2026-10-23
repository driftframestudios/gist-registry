# Bounded disposition and native-adapter exercise

From this skill package, including a copied public package, use the
runtime-admitted exercise route:

```sh
npm run exercise
```

The repository admits stable Node.js 22.23.4+, 24.22.1+, or 26.12.1+ within
its respective major line before the portable exercise receives control. From
the Gist Registry root, the equivalent route is
`npm run exercise:skill:secret-boundary-inspection`.

This synthetic model distinguishes clean, finding, error, unobserved and resting
scope states. Missing/duplicate scope records and failed canaries hold the
handoff. An always-clean mutation disagrees with the independent failure oracle.
These assertions establish the model's routing behavior, rather than any
scanner's recall or a repository's actual cleanliness.

## Local source-identity regression

With Git supporting `--no-lazy-fetch`, `--no-replace-objects` and
`--no-optional-locks` (observed with Git 2.50.1), run:

```sh
npm run test:source-identity
```

[The three retained cases](source-identity.test.mjs) use temporary synthetic Git
repositories to challenge replacement objects, a missing promisor blob, and
ambient repository overrides. Import markers establish whether the selected
module was reached. The missing-object case first proves the protected read
preserved absence, then performs a separate local file-transport hydration to
prove the fixture could fetch. These fixture writes and local hydration belong
to this regression command; it removes its temporary repositories afterward.
It requires neither a network connection nor an installed scanner. Removing
each of the three corresponding production guards in a disposable copy made
this suite fail during independent review.

## Optional actual receiver

The same script can exercise the reviewed HASE/Registry two-module adapter when
the task explicitly authorizes the selected local receiver:

```sh
npm run exercise -- --receiver /path/to/accepted-receiver --revision <full-accepted-sha>
```

The caller selects the receiver, its accepted or reviewed candidate revision,
and its already installed scanner, plus Git supporting `--no-lazy-fetch`, `--no-replace-objects` and
`--no-optional-locks` (observed with Git 2.50.1). The script checks the exact
wrapper, installer and configuration bytes against that Git revision before
importing the receiver's native API. Those flags keep object reads local and
bound to original objects; unavailable bytes or unsupported flags hold the
exercise before import. Git subprocesses clear inherited `GIT_*` overrides so
the explicitly selected receiver supplies repository identity. It performs
no installation, network request, source write, Git mutation, scope scan or
publication. Native canary input is generated in memory; provider validation
follows the receiver's accepted local-detection policy.

A real fresh canary must pass. Six injected process/report failures and a missing
canary must raise the independently expected native codes. A generated value in
raw report metadata and stderr must remain absent from the returned finding and
rendered diagnostic. The script emits only a revision, engine version,
configuration digest and normalized result; any failed assertion returns a fixed
held message and nonzero status. The exercise preserves receiver differences in
raw-report policy; it checks the public projection shared by these two owners.

Run the receiver's existing focused tests when its implementation changes.
Those tests own exact-index materialization, alternate-index/filter behavior,
local-history/merge coverage, installation and cleanup. The small portable
exercise deliberately avoids duplicating their fixtures or becoming a scanner
framework. An adapter with other source files or APIs supplies a reviewed
mapping and equivalent evidence before use.

## Evidence and recovery

The [evidence reference](../references/evidence-and-recovery.md) separates the
initial HASE baseline from final application of this package. Bind final results
to the receiver actually used in the existing PR. A held source identity returns
to the source owner; detector/report failure returns to the scanner owner.
Preserve accepted artifacts and private diagnostics while resolving that state.
The trusted, quiescent task environment remains an assumption. Native fault
injection proves translation and output behavior; it supplies neither a live
provider test nor an independent cold-start transfer observation.
