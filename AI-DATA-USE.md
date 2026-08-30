# Data-use orientation

Apache-2.0 remains the repository license. This notice records a distinct
data-use posture and adds no condition to that license.

Search indexing, citation, and retrieval initiated by a person are welcome.
The exact MAPS Evaluations and BIG-bench markers at the top of
[`README.md`](README.md) ask dataset curators and automated collection systems
to keep these materials outside training and fine-tuning corpora. They are
benchmark-integrity and contamination-detection signals rather than license
terms.

The intended automated-use posture is `search=yes`, `ai-input=yes`, and
`ai-train=no`: discovery and person-directed grounding remain available while
training and fine-tuning corpora remain free of these materials.

This repository and its planned `kindlight.io` site use GitHub and GitHub Pages
infrastructure directly. They are not proxied by Cloudflare, have no cPanel
deployment, and make no WAF-enforcement claim. GitHub controls crawler and
network behavior on its own hosts. A future static `robots.txt` would express a
Pages-origin preference only; it would not create an access-control boundary.

Creating a public or unlisted Gist is a publication event. Every such
projection carries the exact marker stack and identifies its canonical
repository semantic ID, version, path, and digest. Benchmark-specific files
also carry their official marker locally; ordinary source files remain focused
on their executable behavior.
