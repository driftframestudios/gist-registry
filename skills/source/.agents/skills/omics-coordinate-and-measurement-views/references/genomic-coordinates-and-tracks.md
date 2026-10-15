# Genomic coordinates and tracks

Load this branch for range joins, annotations, coverage, or variant views. The
reference assembly and format semantics determine the interval; the renderer
preserves those decisions in geometry and its companion.

## Admit the coordinate frame

A useful coordinate record identifies the assembly/accession or exact reference,
sequence name and length when required, coordinate convention, feature type,
strand, and annotation release. Sequence aliasing (`1` / `chr1`) needs an
explicit mapping. Identical chromosome labels and positions on two assemblies
are insufficient for an overlay. A liftover records chain/tool identity,
parameters, unmapped or multiply mapped records, and any change in strand or
span. Keep those outcomes recoverable alongside the accepted mapped subset.

For an ordinary nonempty interval on a linear reference:

```text
BED half-open:        [s, e)     length = e - s
one-based closed:     [s+1, e]   length = e - (s+1) + 1
```

Thus `[0,1)` represents the first base; `[1,2)` is adjacent and distinct. The
conversion is an origin/endpoint conversion on the same reference. It supplies
no evidence of an assembly conversion.

The [UCSC BED specification](https://genome.ucsc.edu/FAQ/FAQformat.html#format1)
also admits zero-length insertion features and relative block starts. The
[GFF3 specification](https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md)
assigns specific meanings to insertion sites and circular features. A generic
`start + 1` conversion is therefore intentionally restricted to the ordinary
nonempty interval case. A negative-strand GFF3 feature still has ascending
start/end; its strand and CDS phase govern biological orientation. Split exons
retain their blocks, while a spanning gene interval retains its different role.

Variant views use the [VCF 4.5 specification](https://samtools.github.io/hts-specs/VCFv4.5.pdf)
and a fitting format reader. POS, REF, ALT, padding bases, symbolic alleles,
structural spans, and breakends jointly determine meaning. An indel's record
anchor can differ from the changed bases. Treating each record as an ordinary
one-base feature may be appropriate for a site overview only when that reading
is explicit and detailed alleles remain available.

## Keep track values interpretable

Carry unit/normalization, sample/assay identity, strand policy, aggregation,
window/bin width, and clipping with each quantitative track. Read depth,
fragments, base coverage, normalized signal, and peak score are distinct
quantities. A feature count is not automatically a measured molecular amount.

Compare these options before selecting track geometry:

| Option | Useful reading | Condition |
| --- | --- | --- |
| Common y-domain | Absolute amplitude across compatible tracks | Same unit and normalization; small signals remain recoverable. |
| Independent y-domains | Within-track shape | Every scale visible; caption states that heights support within-track reading. |
| Summary plus detail | Broad location followed by feature inspection | Show resolution/aggregation; details recover retained records. |
| Separate panels/reference mapping | Incompatible coordinates or units | Explain relation and preserve each source frame. |

An overview's pixel density can require aggregation. Name whether the bin shows
mean, maximum, sum, or another statistic; these operations change what a peak
means. A rendering optimization earns a measured input size, time/memory or file
size observation. A small fixture proves only its selected coordinate cases.

## Decision-changing counterexamples

- Adjacent one-base intervals expose off-by-one overlap.
- An insertion site exposes the limits of a nonempty interval adapter.
- Two assemblies with the same chromosome label expose an unproved overlay.
- Reversed visual direction exposes confusion between strand and storage order.
- Equal normalized peak shapes with different absolute amplitudes expose a
  comparison made under independent y-domains.

A production adapter tests the relevant cases against its format owner. The
package exercise covers ordinary intervals and explicitly returns insertion
and ambiguous-reference cases to their owning adapter.
