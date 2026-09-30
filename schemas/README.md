# Registry schemas

This directory holds the versioned contracts used by authored source and
generated public discovery. Each schema has one canonical `kindlight.io`
identity and one repository-relative source path. The Pages builder preserves
the authored bytes at both retrieval routes.

| Contract | Version | Authored source | Used by |
| --- | --- | --- | --- |
| Registry artifact envelope | `0.1.0` | [`0.1.0/registry-artifact.schema.json`](0.1.0/registry-artifact.schema.json) | Every exact-version `snippet.json` |
| Delivery observation | `0.1.0` | [`delivery-observation/0.1.0/delivery-observation.schema.json`](delivery-observation/0.1.0/delivery-observation.schema.json) | Immutable signed-out response observations |
| Public skill catalog | `0.1.0` | [`skills/0.1.0/public-skill-catalog.schema.json`](skills/0.1.0/public-skill-catalog.schema.json) | Generated public-ready skill exchange data |

The [schema nursery](../SCHEMA-NURSERY.md) owns shared-envelope evolution. The
[artifact schema orientation](0.1.0/README.md) explains the first contract's
current evidence. Exact schema bytes remain versioned; an incompatible change
forms a new contract version and retrieval identity.

Run the complete schema and source-usage check from the repository root with:

```sh
npm ci
npm run check:schema
```

The command establishes that every registered artifact validates against its
declared schema and that repository schema relationships remain coherent.
Hosted media type and byte delivery receive their own observation under
[`observations/delivery/`](../observations/delivery/README.md).
