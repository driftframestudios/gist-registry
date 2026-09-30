# Obsidian adapter

This adapter maps the same provider-neutral orientation record into an
Obsidian vault or another Markdown knowledge base. The repository catalog
keeps semantic identity stable while the vault owns note paths, aliases, and
local organization.

## Vault-side metadata

A compatible note can expose provider-local frontmatter such as:

```yaml
semantic_key: "@driftframe/practitioner-probes"
title: "Practitioner Probes"
aliases:
  - "Practitioner Probe collection"
source_role: "canonical-page"
```

This frontmatter lives in the vault. Vault name, note path, workspace root,
application URI, and sync provider stay in a local resolver outside the
tracked Gist Registry catalog.

## Resolution order

1. Match `semantic_key` when the catalog record carries one.
2. Match the exact title.
3. Match an alias only when its note also agrees with the expected parent or
   source family.
4. Prefer a note marked as the canonical source. Treat a mirror, extract, or
   imported copy as a projection whose source relation remains visible.
5. Return the same normalized observation used by the Notion adapter.

The resolver returns `resolved`, `ambiguous`, `unavailable`, or
`unauthorized`. An unavailable vault or ambiguous note leaves the external
source unobserved and hands work to the catalog record's local fallback.

## MCP configuration

An MCP server can implement this adapter with three bounded capabilities:

1. resolve a semantic key or exact title;
2. fetch the selected note and its frontmatter; and
3. return the normalized semantic observation.

The MCP implementation retains provider credentials and physical paths. Its
response to the collaborator carries semantic identity, source role, observed
resolution status, catalog access standing, catalog publication standing,
observation date, and contribution. This separation lets the same catalog work
with filesystem vaults, synced knowledge bases, or other Markdown platforms.

## Evidence boundary

A resolved note establishes the content of that vault projection at one
observation time. The note becomes meaning authority only when its metadata and
governance explicitly assign that role. Gist Registry source, tests,
manifests, and live work state retain their repository authority.
