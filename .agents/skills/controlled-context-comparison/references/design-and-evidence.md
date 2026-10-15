# Controlled context: design and evidence

Sources inspected 2026-10-15. The experiment owns the changed concept, invariant
source, observed output family, and unit of inference. A chart or equal digest
alone supplies no causal warrant.

## Four routes

1. **Compare existing outputs:** useful for discovery; source differences can confound interpretation.
2. **Change one raw field:** simple; dependent normalization can alter information content or other semantics.
3. **Generate an equivalent-information pair with declared dependencies:** selected for the local exercise; invariant evidence and permitted administrative effects remain independently checkable.
4. **Randomized/blocked or broader observational study:** fitting when population inference or several varying factors lead; carries a statistical design and larger sampling responsibility.

## Evidence → rule → observation

- Official [scikit-learn common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html) explains how information leakage and preprocessing choices affect evaluation. **Transfer:** document construction order and target-dependent features before comparing outputs. **Observation:** the exercise rejects an arm whose source digest differs while allowing the declared context field. The library's train/test examples support the leakage mechanism; this administrative fixture is a design translation rather than a model-training experiment.
- [NIST randomized block designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm) describes separating the factor of interest from nuisance variation. **Transfer:** distinguish controlled source, changed context, and residual variation, and retain the subject/episode as an inference unit. **Observation:** both arms share the same evidence and literal expected result; administrative workflow outcomes differ as intended. Wider causal claims require the fitting design, assignment, and assumptions.
- Official [PyTorch reproducibility guidance](https://pytorch.org/docs/stable/notes/randomness.html) bounds reproducibility across releases, platforms, and devices. **Rule:** seed, dependency versions, tool/retrieval state, and actual outcomes have separate roles. **Observation:** the deterministic local observer avoids a stochastic claim; a later model receiver must record its actual environment and repeats.

## Counterexamples and stopping

A leaf code and its parent category can carry different evidence. A normalization
step can leak a target. Excluding failed or abstained arms can manufacture
agreement. Repeated runs of one subject can inflate an apparent sample size.
The smallest recovery is to restate the intervention, preserve all outcome
classes, and route population inference to its statistical owner.

The local exercise observes a real candidate contract's controls during this
skill-refinement task. It preserves a positive control, unchanged-input control,
and a failed arm. Its evidence establishes those constructed cases; external
models, patient/business consequences, and population effects remain outside its
execution. A natural receiver's exact source and result belong in the receiving
pull request rather than a second mutable receipt here.
