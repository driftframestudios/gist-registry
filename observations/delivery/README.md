# Delivery observations

This family records what one signed-out HTTPS request established about one
named, immutable source and projection. The authored schema, generated Pages
projection, and observed response keep distinct identities so a future
collaborator can see which equality was measured and when.

Each accepted observation has one immutable JSON record under `records/` and
one compact discovery entry in `index.json`. A later observation appends a new
record and index entry. Git history and reviewed pull requests preserve the
lineage of earlier evidence while current hosted behavior remains available to
fresh observation.

Version `0.1.0` is an experimental contract learned from the registry artifact
schema at its ordinary `kindlight.io` route. Its subject kind is intentionally
`schema`; a materially different artifact representation can inform a later
contract version without asking this first record to imply that relationship.

The record retains only decision-bearing public fields: canonical query-free
URL, status, content type, selected CORS value, byte digests, named Git
revisions, comparison result, evidence boundary, and recovery route. Raw
headers, cookies, request identifiers, network coordinates, certificate traces,
and local machine paths stay with the cycle that made the observation.

Run `npm run check:delivery-observations` to validate the schema and index,
recompute record digests, compare source and `docs` Git objects, parse the
observed media type, and confirm that the stated result follows from the named
evidence.
