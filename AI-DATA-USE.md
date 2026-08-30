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

This repository and its `kindlight.io` projection use GitHub and GitHub Pages
infrastructure directly. They are not proxied by Cloudflare, have no cPanel
deployment, and make no WAF-enforcement claim. GitHub controls crawler and
network behavior on its own hosts. The checked-in [`robots.txt`](robots.txt)
expresses a Pages-origin preference for conforming crawlers; it is an intent
signal rather than an access-control boundary.

The current user-agent distinctions follow provider documentation for
[OpenAI search and training](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq),
[Anthropic training, search, and user retrieval](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler),
[Google-Extended](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers),
[Applebot-Extended](https://support.apple.com/en-us/119829),
[Perplexity search and user retrieval](https://docs.perplexity.ai/docs/resources/perplexity-crawlers),
and [Common Crawl](https://commoncrawl.org/ccbot). Default access remains open
for search, citation, and person-directed retrieval while the named training
and broad-corpus tokens receive the repository's opt-out preference.

Google currently uses `Google-Extended` as one control for both model training
and some Gemini grounding. The selected opt-out gives the training-data
boundary precedence for that combined token while leaving Google Search
inclusion unaffected. This provider-specific coupling is recorded here so a
later separation can be adopted when the platform exposes one.

Creating a public or unlisted Gist is a publication event. Every such
projection carries the exact marker stack and identifies its canonical
repository semantic ID, version, path, and digest. Benchmark-specific files
also carry their official marker locally; ordinary source files remain focused
on their executable behavior.
