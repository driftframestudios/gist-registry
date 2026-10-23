import "../tools/node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  bigBenchCanary,
  buildPages,
  checkPages,
  checkProjection,
  mapsCanary,
  siteAuthorName,
  sourceRepositoryRevisionUrl,
  verifyAcceptedSource,
} from "../tools/build-pages.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const fixedSourceRevision = "1111111111111111111111111111111111111111";
const expectedSourceRepositoryOrigin =
  "https://github.com/driftframestudios/gist-registry";

const expectedPaths = [
  ".nojekyll",
  "AI-DATA-USE.md",
  "AUTHORS",
  "CNAME",
  "LICENSE",
  "assets/site.css",
  "data-use/index.html",
  "index.html",
  "observations/delivery/README.md",
  "observations/delivery/index.html",
  "observations/delivery/index.json",
  "observations/delivery/records/schema-registry-artifact-0.1.0-20260830t052206z.json",
  "projection-manifest.json",
  "registry.json",
  "robots.txt",
  "schemas/0.1.0/registry-artifact.schema.json",
  "schemas/delivery-observation/0.1.0/delivery-observation.schema.json",
  "schemas/gist-registry/0.1.0/index.html",
  "schemas/gist-registry/0.1.0/registry-artifact.schema.json",
  "schemas/gist-registry/delivery-observation/0.1.0/delivery-observation.schema.json",
  "schemas/gist-registry/delivery-observation/0.1.0/index.html",
  "schemas/gist-registry/index.html",
  "schemas/gist-registry/skills/0.1.0/index.html",
  "schemas/gist-registry/skills/0.1.0/public-skill-catalog.schema.json",
  "schemas/skills/0.1.0/public-skill-catalog.schema.json",
  "sitemap.xml",
  "skills/architecture-convergence-vantages/index.html",
  "skills/bounded-representation-admission/index.html",
  "skills/contextual-jargon-scan/index.html",
  "skills/controlled-context-comparison/index.html",
  "skills/design-token-pipeline-stewardship/index.html",
  "skills/index.html",
  "skills/index.json",
  "skills/interruption-safe-resource-ownership/index.html",
  "skills/longitudinal-observation-visualization/index.html",
  "skills/omics-coordinate-and-measurement-views/index.html",
  "skills/parity-bound-workload-measurement/index.html",
  "skills/probe-bearing-exemplar-formation/index.html",
  "skills/repository-collaboration-cycle/index.html",
  "skills/scientific-figure-composition/index.html",
  "skills/scientific-scale-and-transform-fidelity/index.html",
  "skills/secret-boundary-inspection/index.html",
  "skills/semantic-visual-receiver-contracts/index.html",
  "skills/source/.agents/runbooks/gist-registry-receiving-repository-use.v0.1.md",
  "skills/source/.agents/runbooks/receipts/gist-registry-receiving-repository-use.v0.1.json",
  "skills/source/.agents/skills/architecture-convergence-vantages/README.md",
  "skills/source/.agents/skills/architecture-convergence-vantages/SKILL.md",
  "skills/source/.agents/skills/architecture-convergence-vantages/references/filesystem-state-transitions.md",
  "skills/source/.agents/skills/bounded-representation-admission/README.md",
  "skills/source/.agents/skills/bounded-representation-admission/SKILL.md",
  "skills/source/.agents/skills/bounded-representation-admission/exercises/README.md",
  "skills/source/.agents/skills/bounded-representation-admission/exercises/exercise.py",
  "skills/source/.agents/skills/bounded-representation-admission/references/admission-design-and-evidence.md",
  "skills/source/.agents/skills/contextual-jargon-scan/README.md",
  "skills/source/.agents/skills/contextual-jargon-scan/SKILL.md",
  "skills/source/.agents/skills/contextual-jargon-scan/references/classification-and-recovery.md",
  "skills/source/.agents/skills/controlled-context-comparison/README.md",
  "skills/source/.agents/skills/controlled-context-comparison/SKILL.md",
  "skills/source/.agents/skills/controlled-context-comparison/exercises/README.md",
  "skills/source/.agents/skills/controlled-context-comparison/exercises/exercise.py",
  "skills/source/.agents/skills/controlled-context-comparison/references/design-and-evidence.md",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/README.md",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/SKILL.md",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/exercises/README.md",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/exercises/exercise.mjs",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/exercises/expected-receipt.json",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/exercises/pipeline.json",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/node-runtime-admission.mjs",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/package-lock.json",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/package.json",
  "skills/source/.agents/skills/design-token-pipeline-stewardship/references/tool-and-runtime-boundaries.md",
  "skills/source/.agents/skills/interruption-safe-resource-ownership/README.md",
  "skills/source/.agents/skills/interruption-safe-resource-ownership/SKILL.md",
  "skills/source/.agents/skills/interruption-safe-resource-ownership/exercises/README.md",
  "skills/source/.agents/skills/interruption-safe-resource-ownership/exercises/exercise.py",
  "skills/source/.agents/skills/interruption-safe-resource-ownership/references/mechanisms-and-evidence.md",
  "skills/source/.agents/skills/longitudinal-observation-visualization/README.md",
  "skills/source/.agents/skills/longitudinal-observation-visualization/SKILL.md",
  "skills/source/.agents/skills/longitudinal-observation-visualization/exercises/README.md",
  "skills/source/.agents/skills/longitudinal-observation-visualization/exercises/example.html",
  "skills/source/.agents/skills/longitudinal-observation-visualization/exercises/example.svg",
  "skills/source/.agents/skills/longitudinal-observation-visualization/exercises/exercise.py",
  "skills/source/.agents/skills/longitudinal-observation-visualization/exercises/expected-segments.json",
  "skills/source/.agents/skills/longitudinal-observation-visualization/exercises/observations.csv",
  "skills/source/.agents/skills/longitudinal-observation-visualization/exercises/values.csv",
  "skills/source/.agents/skills/longitudinal-observation-visualization/references/time-paths-and-evidence.md",
  "skills/source/.agents/skills/omics-coordinate-and-measurement-views/README.md",
  "skills/source/.agents/skills/omics-coordinate-and-measurement-views/SKILL.md",
  "skills/source/.agents/skills/omics-coordinate-and-measurement-views/exercises/verify.py",
  "skills/source/.agents/skills/omics-coordinate-and-measurement-views/references/assay-matrices-and-inference.md",
  "skills/source/.agents/skills/omics-coordinate-and-measurement-views/references/evidence-and-exercises.md",
  "skills/source/.agents/skills/omics-coordinate-and-measurement-views/references/genomic-coordinates-and-tracks.md",
  "skills/source/.agents/skills/parity-bound-workload-measurement/README.md",
  "skills/source/.agents/skills/parity-bound-workload-measurement/SKILL.md",
  "skills/source/.agents/skills/parity-bound-workload-measurement/exercises/README.md",
  "skills/source/.agents/skills/parity-bound-workload-measurement/exercises/exercise.py",
  "skills/source/.agents/skills/parity-bound-workload-measurement/references/design-and-evidence.md",
  "skills/source/.agents/skills/probe-bearing-exemplar-formation/README.md",
  "skills/source/.agents/skills/probe-bearing-exemplar-formation/SKILL.md",
  "skills/source/.agents/skills/probe-bearing-exemplar-formation/references/formation-evidence-and-recovery.md",
  "skills/source/.agents/skills/repository-collaboration-cycle/README.md",
  "skills/source/.agents/skills/repository-collaboration-cycle/SKILL.md",
  "skills/source/.agents/skills/repository-collaboration-cycle/exercises/receiving-task.md",
  "skills/source/.agents/skills/repository-collaboration-cycle/references/repository-adapter.md",
  "skills/source/.agents/skills/repository-collaboration-cycle/references/source-work-cycle.md",
  "skills/source/.agents/skills/scientific-figure-composition/README.md",
  "skills/source/.agents/skills/scientific-figure-composition/SKILL.md",
  "skills/source/.agents/skills/scientific-figure-composition/exercises/verify.py",
  "skills/source/.agents/skills/scientific-figure-composition/references/delivery-and-inspection.md",
  "skills/source/.agents/skills/scientific-figure-composition/references/evidence-and-exercises.md",
  "skills/source/.agents/skills/scientific-figure-composition/references/panel-type-color-and-emphasis.md",
  "skills/source/.agents/skills/scientific-scale-and-transform-fidelity/README.md",
  "skills/source/.agents/skills/scientific-scale-and-transform-fidelity/SKILL.md",
  "skills/source/.agents/skills/scientific-scale-and-transform-fidelity/exercises/verify.py",
  "skills/source/.agents/skills/scientific-scale-and-transform-fidelity/references/evidence-and-exercises.md",
  "skills/source/.agents/skills/scientific-scale-and-transform-fidelity/references/intervals-colors-and-density.md",
  "skills/source/.agents/skills/scientific-scale-and-transform-fidelity/references/signed-and-logarithmic-transforms.md",
  "skills/source/.agents/skills/secret-boundary-inspection/README.md",
  "skills/source/.agents/skills/secret-boundary-inspection/SKILL.md",
  "skills/source/.agents/skills/secret-boundary-inspection/exercises/README.md",
  "skills/source/.agents/skills/secret-boundary-inspection/exercises/exercise.mjs",
  "skills/source/.agents/skills/secret-boundary-inspection/exercises/source-identity.test.mjs",
  "skills/source/.agents/skills/secret-boundary-inspection/node-runtime-admission.mjs",
  "skills/source/.agents/skills/secret-boundary-inspection/package-lock.json",
  "skills/source/.agents/skills/secret-boundary-inspection/package.json",
  "skills/source/.agents/skills/secret-boundary-inspection/references/embedded-metadata.md",
  "skills/source/.agents/skills/secret-boundary-inspection/references/evidence-and-recovery.md",
  "skills/source/.agents/skills/secret-boundary-inspection/references/receiver-adapter-contract.md",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/README.md",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/SKILL.md",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/exercises/README.md",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/exercises/exercise.mjs",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/exercises/expected-receipt.json",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/exercises/receiver-contract.json",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/node-runtime-admission.mjs",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/package-lock.json",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/package.json",
  "skills/source/.agents/skills/semantic-visual-receiver-contracts/references/framework-and-receiving-boundaries.md",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/README.md",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/SKILL.md",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/exercises/README.md",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/exercises/comparisons.json",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/exercises/example.html",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/exercises/example.svg",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/exercises/exercise.py",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/exercises/regions.csv",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/exercises/values.csv",
  "skills/source/.agents/skills/spatial-support-and-change-visualization/references/support-and-evidence.md",
  "skills/source/.agents/skills/transaction-boundary-evidence-mapping/README.md",
  "skills/source/.agents/skills/transaction-boundary-evidence-mapping/SKILL.md",
  "skills/source/.agents/skills/transaction-boundary-evidence-mapping/references/failure-intervals-and-evidence.md",
  "skills/source/.agents/skills/typed-error-recovery-contracts/README.md",
  "skills/source/.agents/skills/typed-error-recovery-contracts/SKILL.md",
  "skills/source/.agents/skills/typed-error-recovery-contracts/exercises/README.md",
  "skills/source/.agents/skills/typed-error-recovery-contracts/exercises/exercise.py",
  "skills/source/.agents/skills/typed-error-recovery-contracts/exercises/offline-review-boundary.md",
  "skills/source/.agents/skills/typed-error-recovery-contracts/references/python-exception-boundaries.md",
  "skills/source/.agents/skills/versioned-exemplar-successor/README.md",
  "skills/source/.agents/skills/versioned-exemplar-successor/SKILL.md",
  "skills/source/.agents/skills/versioned-exemplar-successor/references/successor-and-projection-recovery.md",
  "skills/source/.agents/skills/visual-artifact-family-publication/README.md",
  "skills/source/.agents/skills/visual-artifact-family-publication/SKILL.md",
  "skills/source/.agents/skills/visual-artifact-family-publication/exercises/README.md",
  "skills/source/.agents/skills/visual-artifact-family-publication/exercises/exercise.mjs",
  "skills/source/.agents/skills/visual-artifact-family-publication/exercises/expected-receipt.json",
  "skills/source/.agents/skills/visual-artifact-family-publication/exercises/family.json",
  "skills/source/.agents/skills/visual-artifact-family-publication/exercises/pattern.svg",
  "skills/source/.agents/skills/visual-artifact-family-publication/node-runtime-admission.mjs",
  "skills/source/.agents/skills/visual-artifact-family-publication/package-lock.json",
  "skills/source/.agents/skills/visual-artifact-family-publication/package.json",
  "skills/source/.agents/skills/visual-artifact-family-publication/references/renderer-svg-and-metadata-boundaries.md",
  "skills/source/.agents/skills/visual-contract-receipt-design/README.md",
  "skills/source/.agents/skills/visual-contract-receipt-design/SKILL.md",
  "skills/source/.agents/skills/visual-contract-receipt-design/exercises/README.md",
  "skills/source/.agents/skills/visual-contract-receipt-design/exercises/decisions.json",
  "skills/source/.agents/skills/visual-contract-receipt-design/exercises/exercise.mjs",
  "skills/source/.agents/skills/visual-contract-receipt-design/exercises/expected-receipt.json",
  "skills/source/.agents/skills/visual-contract-receipt-design/node-runtime-admission.mjs",
  "skills/source/.agents/skills/visual-contract-receipt-design/package-lock.json",
  "skills/source/.agents/skills/visual-contract-receipt-design/package.json",
  "skills/source/.agents/skills/visual-contract-receipt-design/references/browser-evidence-and-variance.md",
  "skills/source/.agents/skills/visualization-question-routing/README.md",
  "skills/source/.agents/skills/visualization-question-routing/SKILL.md",
  "skills/source/.agents/skills/visualization-question-routing/exercises/README.md",
  "skills/source/.agents/skills/visualization-question-routing/exercises/exercise.py",
  "skills/source/.agents/skills/visualization-question-routing/exercises/records.csv",
  "skills/source/.agents/skills/visualization-question-routing/exercises/view-contracts.json",
  "skills/source/.agents/skills/visualization-question-routing/references/roles-and-evidence.md",
  "skills/spatial-support-and-change-visualization/index.html",
  "skills/transaction-boundary-evidence-mapping/index.html",
  "skills/typed-error-recovery-contracts/index.html",
  "skills/versioned-exemplar-successor/index.html",
  "skills/visual-artifact-family-publication/index.html",
  "skills/visual-contract-receipt-design/index.html",
  "skills/visualization-question-routing/index.html",
  "snippets/README.md",
  "snippets/cross-browser-visual-contract-observer/0.1.0/README.md",
  "snippets/cross-browser-visual-contract-observer/0.1.0/expected/observer-contract.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/fixtures/accepted/observations.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/fixtures/rejected/bitmap.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/fixtures/rejected/computed-style.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/fixtures/rejected/geometry-card-overlap.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/fixtures/rejected/interaction.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/fixtures/rejected/semantic.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/index.html",
  "snippets/cross-browser-visual-contract-observer/0.1.0/inventory/decisions.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/inventory/matrix.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/node-runtime-admission.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/package-lock.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/package.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/playwright.config.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/receipts/accepted/README.md",
  "snippets/cross-browser-visual-contract-observer/0.1.0/receipts/candidates/README.md",
  "snippets/cross-browser-visual-contract-observer/0.1.0/schema/receipt.schema.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/snippet.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/source/coordinates.json",
  "snippets/cross-browser-visual-contract-observer/0.1.0/source/receiver.html",
  "snippets/cross-browser-visual-contract-observer/0.1.0/src/browser-observer.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/src/contracts.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/src/publication.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/src/receipt-schema.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/tests/browser/receiver.spec.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/tests/contracts.test.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/tests/helpers.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/tests/publication.test.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/tests/receipt.test.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/tools/paths.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/tools/run-example.mjs",
  "snippets/cross-browser-visual-contract-observer/0.1.0/tools/serve-bound-receiver.mjs",
  "snippets/cross-browser-visual-contract-observer/README.md",
  "snippets/cross-browser-visual-contract-observer/index.html",
  "snippets/document-evidence-core-patterns/0.1.0/README.md",
  "snippets/document-evidence-core-patterns/0.1.0/gist/00-README.md",
  "snippets/document-evidence-core-patterns/0.1.0/gist/10-same-byte-capture.md",
  "snippets/document-evidence-core-patterns/0.1.0/gist/20-recovery-aware-promotion.md",
  "snippets/document-evidence-core-patterns/0.1.0/index.html",
  "snippets/document-evidence-core-patterns/0.1.0/snippet.json",
  "snippets/document-evidence-core-patterns/0.1.1/README.md",
  "snippets/document-evidence-core-patterns/0.1.1/gist/00-README.md",
  "snippets/document-evidence-core-patterns/0.1.1/gist/10-observed-effect-reconciliation.md",
  "snippets/document-evidence-core-patterns/0.1.1/gist/20-caller-retained-recovery.md",
  "snippets/document-evidence-core-patterns/0.1.1/index.html",
  "snippets/document-evidence-core-patterns/0.1.1/snippet.json",
  "snippets/document-evidence-core-patterns/README.md",
  "snippets/document-evidence-core-patterns/index.html",
  "snippets/document-evidence-extraction/0.1.0/.python-version",
  "snippets/document-evidence-extraction/0.1.0/README.md",
  "snippets/document-evidence-extraction/0.1.0/config/stopwords-en.txt",
  "snippets/document-evidence-extraction/0.1.0/expected/contract.json",
  "snippets/document-evidence-extraction/0.1.0/fixtures/reviewed-ocr/era-comparison.txt",
  "snippets/document-evidence-extraction/0.1.0/fixtures/reviewed-ocr/ocr-intake.txt",
  "snippets/document-evidence-extraction/0.1.0/fixtures/reviewed-ocr/orientation-output.txt",
  "snippets/document-evidence-extraction/0.1.0/fixtures/reviewed-ocr/requirements-core.txt",
  "snippets/document-evidence-extraction/0.1.0/fixtures/synthetic-ocr-capture.json",
  "snippets/document-evidence-extraction/0.1.0/index.html",
  "snippets/document-evidence-extraction/0.1.0/pyproject.toml",
  "snippets/document-evidence-extraction/0.1.0/snippet.json",
  "snippets/document-evidence-extraction/0.1.0/src/document_evidence.py",
  "snippets/document-evidence-extraction/0.1.0/tests/test_document_evidence.py",
  "snippets/document-evidence-extraction/0.1.0/uv.lock",
  "snippets/document-evidence-extraction/0.1.1/.python-version",
  "snippets/document-evidence-extraction/0.1.1/README.md",
  "snippets/document-evidence-extraction/0.1.1/config/stopwords-en.txt",
  "snippets/document-evidence-extraction/0.1.1/expected/contract.json",
  "snippets/document-evidence-extraction/0.1.1/fixtures/reviewed-ocr/era-comparison.txt",
  "snippets/document-evidence-extraction/0.1.1/fixtures/reviewed-ocr/ocr-intake.txt",
  "snippets/document-evidence-extraction/0.1.1/fixtures/reviewed-ocr/orientation-output.txt",
  "snippets/document-evidence-extraction/0.1.1/fixtures/reviewed-ocr/requirements-core.txt",
  "snippets/document-evidence-extraction/0.1.1/fixtures/synthetic-ocr-capture.json",
  "snippets/document-evidence-extraction/0.1.1/index.html",
  "snippets/document-evidence-extraction/0.1.1/pyproject.toml",
  "snippets/document-evidence-extraction/0.1.1/snippet.json",
  "snippets/document-evidence-extraction/0.1.1/src/document_evidence.py",
  "snippets/document-evidence-extraction/0.1.1/src/filesystem_promotion.py",
  "snippets/document-evidence-extraction/0.1.1/tests/test_document_evidence.py",
  "snippets/document-evidence-extraction/0.1.1/tests/test_filesystem_promotion.py",
  "snippets/document-evidence-extraction/0.1.1/uv.lock",
  "snippets/document-evidence-extraction/README.md",
  "snippets/document-evidence-extraction/index.html",
  "snippets/figma-variable-sync-reconciliation/0.1.0/README.md",
  "snippets/figma-variable-sync-reconciliation/0.1.0/expected/accepted-receipt.json",
  "snippets/figma-variable-sync-reconciliation/0.1.0/fixtures/accepted-sync.json",
  "snippets/figma-variable-sync-reconciliation/0.1.0/fixtures/dependency-cycle.json",
  "snippets/figma-variable-sync-reconciliation/0.1.0/index.html",
  "snippets/figma-variable-sync-reconciliation/0.1.0/node-runtime-admission.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/package-lock.json",
  "snippets/figma-variable-sync-reconciliation/0.1.0/package.json",
  "snippets/figma-variable-sync-reconciliation/0.1.0/snippet.json",
  "snippets/figma-variable-sync-reconciliation/0.1.0/src/canonical.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/src/coordinator.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/src/errors.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/src/example.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/src/fake-remote.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/src/planner.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/src/remote-contract.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/src/stores.mjs",
  "snippets/figma-variable-sync-reconciliation/0.1.0/tests/reconciliation.test.mjs",
  "snippets/figma-variable-sync-reconciliation/README.md",
  "snippets/figma-variable-sync-reconciliation/index.html",
  "snippets/index.html",
  "snippets/instrument-ingress-integrity/0.1.0/.python-version",
  "snippets/instrument-ingress-integrity/0.1.0/README.md",
  "snippets/instrument-ingress-integrity/0.1.0/expected/ingress-run.json",
  "snippets/instrument-ingress-integrity/0.1.0/fixtures/accepted-measurement.json",
  "snippets/instrument-ingress-integrity/0.1.0/fixtures/quarantined-measurement.json",
  "snippets/instrument-ingress-integrity/0.1.0/index.html",
  "snippets/instrument-ingress-integrity/0.1.0/pyproject.toml",
  "snippets/instrument-ingress-integrity/0.1.0/snippet.json",
  "snippets/instrument-ingress-integrity/0.1.0/src/instrument_ingress.py",
  "snippets/instrument-ingress-integrity/0.1.0/tests/test_instrument_ingress.py",
  "snippets/instrument-ingress-integrity/0.1.0/uv.lock",
  "snippets/instrument-ingress-integrity/README.md",
  "snippets/instrument-ingress-integrity/index.html",
  "snippets/lims-eln-enterprise-implementation/0.3.2/README.md",
  "snippets/lims-eln-enterprise-implementation/0.3.2/index.html",
  "snippets/lims-eln-enterprise-implementation/0.3.2/release-coordinate.json",
  "snippets/lims-eln-enterprise-implementation/0.3.2/snippet.json",
  "snippets/lims-eln-enterprise-implementation/0.3.2/source/idempotency.py",
  "snippets/lims-eln-enterprise-implementation/README.md",
  "snippets/lims-eln-enterprise-implementation/index.html",
  "snippets/migration-reconciliation-cutover/0.1.0/.python-version",
  "snippets/migration-reconciliation-cutover/0.1.0/README.md",
  "snippets/migration-reconciliation-cutover/0.1.0/expected/cutover-evaluation.json",
  "snippets/migration-reconciliation-cutover/0.1.0/fixtures/reconciled-cutover.json",
  "snippets/migration-reconciliation-cutover/0.1.0/fixtures/returned-for-evidence.json",
  "snippets/migration-reconciliation-cutover/0.1.0/index.html",
  "snippets/migration-reconciliation-cutover/0.1.0/pyproject.toml",
  "snippets/migration-reconciliation-cutover/0.1.0/snippet.json",
  "snippets/migration-reconciliation-cutover/0.1.0/src/migration_cutover.py",
  "snippets/migration-reconciliation-cutover/0.1.0/tests/test_migration_cutover.py",
  "snippets/migration-reconciliation-cutover/0.1.0/uv.lock",
  "snippets/migration-reconciliation-cutover/README.md",
  "snippets/migration-reconciliation-cutover/index.html",
  "snippets/postgresql-pending-outbox-query/0.1.0/.python-version",
  "snippets/postgresql-pending-outbox-query/0.1.0/README.md",
  "snippets/postgresql-pending-outbox-query/0.1.0/UPSTREAM-LICENSE",
  "snippets/postgresql-pending-outbox-query/0.1.0/exercises/parity-bound-query-plans.md",
  "snippets/postgresql-pending-outbox-query/0.1.0/expected/semantic.json",
  "snippets/postgresql-pending-outbox-query/0.1.0/fixtures/semantic.json",
  "snippets/postgresql-pending-outbox-query/0.1.0/fixtures/workload.json",
  "snippets/postgresql-pending-outbox-query/0.1.0/index.html",
  "snippets/postgresql-pending-outbox-query/0.1.0/observations/postgresql-17.json",
  "snippets/postgresql-pending-outbox-query/0.1.0/pyproject.toml",
  "snippets/postgresql-pending-outbox-query/0.1.0/snippet.json",
  "snippets/postgresql-pending-outbox-query/0.1.0/source-coordinate.json",
  "snippets/postgresql-pending-outbox-query/0.1.0/sql/index.sql",
  "snippets/postgresql-pending-outbox-query/0.1.0/sql/query.sql",
  "snippets/postgresql-pending-outbox-query/0.1.0/sql/schema.sql",
  "snippets/postgresql-pending-outbox-query/0.1.0/src/owned_cluster.py",
  "snippets/postgresql-pending-outbox-query/0.1.0/src/pending_outbox.py",
  "snippets/postgresql-pending-outbox-query/0.1.0/tests/test_pending_outbox.py",
  "snippets/postgresql-pending-outbox-query/0.1.0/uv.lock",
  "snippets/postgresql-pending-outbox-query/README.md",
  "snippets/postgresql-pending-outbox-query/index.html",
  "snippets/react-aria-visual-contract-receiver/0.1.0/README.md",
  "snippets/react-aria-visual-contract-receiver/0.1.0/config/build-budgets.json",
  "snippets/react-aria-visual-contract-receiver/0.1.0/expected/build-budget-contract.json",
  "snippets/react-aria-visual-contract-receiver/0.1.0/expected/receiver-contract.json",
  "snippets/react-aria-visual-contract-receiver/0.1.0/index.html",
  "snippets/react-aria-visual-contract-receiver/0.1.0/node-cli-entrypoint.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/node-runtime-admission.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/package-lock.json",
  "snippets/react-aria-visual-contract-receiver/0.1.0/package.json",
  "snippets/react-aria-visual-contract-receiver/0.1.0/receiver-entry.html",
  "snippets/react-aria-visual-contract-receiver/0.1.0/snippet.json",
  "snippets/react-aria-visual-contract-receiver/0.1.0/source/accepted-token-fixture.css",
  "snippets/react-aria-visual-contract-receiver/0.1.0/source/native-receiver.html",
  "snippets/react-aria-visual-contract-receiver/0.1.0/source/semantic-reading.html",
  "snippets/react-aria-visual-contract-receiver/0.1.0/source/token-coordinate.json",
  "snippets/react-aria-visual-contract-receiver/0.1.0/src/app.jsx",
  "snippets/react-aria-visual-contract-receiver/0.1.0/src/controller.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/src/main.jsx",
  "snippets/react-aria-visual-contract-receiver/0.1.0/src/model.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/src/styles.css",
  "snippets/react-aria-visual-contract-receiver/0.1.0/tests/fixtures/acme-light.tokens.css",
  "snippets/react-aria-visual-contract-receiver/0.1.0/tests/model.test.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/tests/receiver.test.jsx",
  "snippets/react-aria-visual-contract-receiver/0.1.0/tests/setup.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/tests/static-contract.test.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/tools/token-projection.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/tools/verify-build.mjs",
  "snippets/react-aria-visual-contract-receiver/0.1.0/vite.config.mjs",
  "snippets/react-aria-visual-contract-receiver/README.md",
  "snippets/react-aria-visual-contract-receiver/index.html",
  "snippets/specimen-custody-outbox/0.1.0/.python-version",
  "snippets/specimen-custody-outbox/0.1.0/README.md",
  "snippets/specimen-custody-outbox/0.1.0/expected/transfer-commit.json",
  "snippets/specimen-custody-outbox/0.1.0/fixtures/transfer-command.json",
  "snippets/specimen-custody-outbox/0.1.0/index.html",
  "snippets/specimen-custody-outbox/0.1.0/pyproject.toml",
  "snippets/specimen-custody-outbox/0.1.0/snippet.json",
  "snippets/specimen-custody-outbox/0.1.0/src/specimen_custody.py",
  "snippets/specimen-custody-outbox/0.1.0/tests/test_specimen_custody.py",
  "snippets/specimen-custody-outbox/0.1.0/uv.lock",
  "snippets/specimen-custody-outbox/README.md",
  "snippets/specimen-custody-outbox/index.html",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/README.md",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/adapters/figma-snapshot-to-dtcg.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/config/build-matrix.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/config/compatibility-envelope.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/config/style-dictionary.config.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/expected/pipeline-contract.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/accepted/delayed-async-hook.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/accepted/figma-snapshot.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/alias-cycle.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/figma-incomplete-mode.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/figma-normalized-name-collision.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/figma-private-description.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/figma-unsupported-type.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/missing-reference.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/normalized-name-collision.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/reserved-key.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/source-collision.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/type-mismatch.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/fixtures/rejected/unsupported-dtcg-feature.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/index.html",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/node-cli-entrypoint.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/node-runtime-admission.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/package-lock.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/package.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/snippet.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/src/contract.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/src/publication.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tests/build.test.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tests/graph.test.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tokens/components.tokens.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tokens/primitives.tokens.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tokens/semantics.tokens.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tokens/variants/acme/dark.tokens.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tokens/variants/acme/light.tokens.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tokens/variants/research/dark.tokens.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tokens/variants/research/light.tokens.json",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tools/build-candidates.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tools/load-coordinate.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tools/make-manifest.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tools/paths.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tools/run-example.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tools/validate-source.mjs",
  "snippets/style-dictionary-dtcg-pipeline/0.1.0/tools/verify-generated.mjs",
  "snippets/style-dictionary-dtcg-pipeline/README.md",
  "snippets/style-dictionary-dtcg-pipeline/index.html",
  "snippets/typed-absence-and-wire-shape/0.1.0/README.md",
  "snippets/typed-absence-and-wire-shape/0.1.0/expected/wire-shape.json",
  "snippets/typed-absence-and-wire-shape/0.1.0/fixtures/presence-cases.json",
  "snippets/typed-absence-and-wire-shape/0.1.0/index.html",
  "snippets/typed-absence-and-wire-shape/0.1.0/node-runtime-admission.mjs",
  "snippets/typed-absence-and-wire-shape/0.1.0/package-lock.json",
  "snippets/typed-absence-and-wire-shape/0.1.0/package.json",
  "snippets/typed-absence-and-wire-shape/0.1.0/run-example.mjs",
  "snippets/typed-absence-and-wire-shape/0.1.0/snippet.json",
  "snippets/typed-absence-and-wire-shape/0.1.0/src/typed-absence.ts",
  "snippets/typed-absence-and-wire-shape/0.1.0/tests/typed-absence.test.mjs",
  "snippets/typed-absence-and-wire-shape/0.1.0/tests/typed-absence.type-test.ts",
  "snippets/typed-absence-and-wire-shape/0.1.0/tsconfig.build.json",
  "snippets/typed-absence-and-wire-shape/0.1.0/tsconfig.json",
  "snippets/typed-absence-and-wire-shape/README.md",
  "snippets/typed-absence-and-wire-shape/index.html",
  "snippets/visual-pattern-artifact-compiler/0.1.0/README.md",
  "snippets/visual-pattern-artifact-compiler/0.1.0/expected/contract-expectation.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/fixtures/rejected/contract-mutations.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/fixtures/rejected/missing-alt.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/fixtures/rejected/missing-semantic-companion.html",
  "snippets/visual-pattern-artifact-compiler/0.1.0/fixtures/rejected/path-escape.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/fixtures/rejected/repeated-id.svg",
  "snippets/visual-pattern-artifact-compiler/0.1.0/fixtures/rejected/source-admission-cases.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/index.html",
  "snippets/visual-pattern-artifact-compiler/0.1.0/node-runtime-admission.mjs",
  "snippets/visual-pattern-artifact-compiler/0.1.0/package-lock.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/package.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/playwright.config.mjs",
  "snippets/visual-pattern-artifact-compiler/0.1.0/snippet.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/source/gallery-shell.html",
  "snippets/visual-pattern-artifact-compiler/0.1.0/source/pattern-contract.json",
  "snippets/visual-pattern-artifact-compiler/0.1.0/source/pattern.svg",
  "snippets/visual-pattern-artifact-compiler/0.1.0/src/compiler.mjs",
  "snippets/visual-pattern-artifact-compiler/0.1.0/tests/browser/gallery.spec.mjs",
  "snippets/visual-pattern-artifact-compiler/0.1.0/tests/compiler.test.mjs",
  "snippets/visual-pattern-artifact-compiler/0.1.0/tools/build-artifacts.mjs",
  "snippets/visual-pattern-artifact-compiler/0.1.0/tools/serve-gallery.mjs",
  "snippets/visual-pattern-artifact-compiler/README.md",
  "snippets/visual-pattern-artifact-compiler/index.html"
];

async function withProjection(action) {
  const container = await mkdtemp(join(tmpdir(), "gist-registry-pages-test-"));
  const output = resolve(container, "pages");
  try {
    await buildPages({
      root: repositoryRoot,
      output,
      sourceSha: fixedSourceRevision,
      sourceBinding: "test",
    });
    return await action({ container, output });
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}

async function git(root, arguments_) {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
  });
  return stdout.trim();
}

const fixtureExcludedPaths = new Set([
  ".git", ".artifacts", ".tools", "node_modules", ".venv", "__pycache__",
]);

async function copyAuthoredSource(sourceRoot, root) {
  await cp(sourceRoot, root, {
    recursive: true,
    filter: path => !relative(sourceRoot, path).split(/[\\/]/u)
      .some(part => fixtureExcludedPaths.has(part)),
  });
}

async function copyProjectionSource(sourceRoot, root) {
  await execFileAsync("git", ["clone", "--no-hardlinks", "--no-checkout", "--quiet", sourceRoot, root]);
  const refs = new Map((await git(sourceRoot, ["for-each-ref", "--format=%(refname) %(objectname)",
    "refs/remotes/origin/main", "refs/remotes/origin/docs", "refs/heads/main", "refs/heads/docs",
  ])).split("\n").map(line => line.split(" ")));
  // A detached CI checkout can hold delivery branches only as remote-tracking refs.
  for (const branch of ["main", "docs"]) {
    const revision = refs.get(`refs/remotes/origin/${branch}`) ?? refs.get(`refs/heads/${branch}`);
    assert.match(revision ?? "", /^[a-f0-9]{40}$/u, `source must retain ${branch}`);
    await git(root, ["fetch", "--quiet", "--no-tags", sourceRoot,
      `+${revision}:refs/remotes/origin/${branch}`]);
  }
  await copyAuthoredSource(sourceRoot, root);
}

test("the public projection is deterministic for one source revision", async () => {
  const result = await checkPages({
    root: repositoryRoot,
    sourceSha: fixedSourceRevision,
    sourceBinding: "test",
  });
  assert.equal(result.fileCount, expectedPaths.length);
  assert.equal(result.sourceRevision, fixedSourceRevision);
  assert.match(result.manifestSha256, /^[a-f0-9]{64}$/u);
});

test("the projection has one exact allowlisted inventory and complete digest manifest", async () => {
  await withProjection(async ({ output }) => {
    const result = await checkProjection({ root: repositoryRoot, output });
    const manifest = JSON.parse(
      await readFile(resolve(output, "projection-manifest.json"), "utf8"),
    );
    const actualPaths = [...manifest.files.map(file => file.path), "projection-manifest.json"].sort();

    assert.deepEqual(actualPaths, expectedPaths);
    assert.equal(result.fileCount, expectedPaths.length);
    assert.equal(manifest.sourceRevision, fixedSourceRevision);
    assert.equal(
      manifest.fileScope,
      "Every projection file except projection-manifest.json itself.",
    );
    assert.equal(manifest.files.some(file => file.path === "projection-manifest.json"), false);
    assert.equal(actualPaths.some(path => path.startsWith(".github/")), false);
    assert.equal(actualPaths.some(path => path.startsWith("planning/")), false);
    assert.equal(actualPaths.some(path => path.startsWith("orientation/")), false);
    assert.equal(actualPaths.includes("AGENTS.md"), false);
    assert.equal(actualPaths.includes("README.md"), false);
  });
});

test("schemas, observations, registry data, and artifact representations preserve authored bytes", async () => {
  await withProjection(async ({ output }) => {
    const authoredSchema = await readFile(
      resolve(repositoryRoot, "schemas/0.1.0/registry-artifact.schema.json"),
    );
    assert.equal(
      createHash("sha256").update(authoredSchema).digest("hex"),
      "32475af0ad5e4b96d25a3ca2d458d2a814b2d73bd4a0d84055fb1703ff78f4de",
      "published artifact schema 0.1.0 retains its exact byte identity",
    );
    const authoredRegistry = await readFile(resolve(repositoryRoot, "registry.json"));
    const authoredObservation = await readFile(
      resolve(repositoryRoot, "observations/delivery/index.json"),
    );
    const authoredSource = await readFile(
      resolve(
        repositoryRoot,
        "snippets/document-evidence-extraction/0.1.0/src/document_evidence.py",
      ),
    );
    const authoredCompanion = await readFile(
      resolve(
        repositoryRoot,
        "snippets/document-evidence-core-patterns/0.1.0/gist/10-same-byte-capture.md",
      ),
    );
    const authoredSuccessorCompanion = await readFile(
      resolve(
        repositoryRoot,
        "snippets/document-evidence-core-patterns/0.1.1/gist/10-observed-effect-reconciliation.md",
      ),
    );
    const authoredCustodySource = await readFile(
      resolve(
        repositoryRoot,
        "snippets/specimen-custody-outbox/0.1.0/src/specimen_custody.py",
      ),
    );
    const authoredIngressSource = await readFile(
      resolve(
        repositoryRoot,
        "snippets/instrument-ingress-integrity/0.1.0/src/instrument_ingress.py",
      ),
    );
    const authoredRepositoryCoordinate = await readFile(
      resolve(
        repositoryRoot,
        "snippets/lims-eln-enterprise-implementation/0.3.2/release-coordinate.json",
      ),
    );
    const authoredRepositoryExcerpt = await readFile(
      resolve(
        repositoryRoot,
        "snippets/lims-eln-enterprise-implementation/0.3.2/source/idempotency.py",
      ),
    );
    const authoredMigrationSource = await readFile(
      resolve(
        repositoryRoot,
        "snippets/migration-reconciliation-cutover/0.1.0/src/migration_cutover.py",
      ),
    );
    const authoredTypedAbsenceSource = await readFile(
      resolve(
        repositoryRoot,
        "snippets/typed-absence-and-wire-shape/0.1.0/src/typed-absence.ts",
      ),
    );

    assert.deepEqual(
      await readFile(resolve(output, "schemas/0.1.0/registry-artifact.schema.json")),
      authoredSchema,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "schemas/gist-registry/0.1.0/registry-artifact.schema.json",
        ),
      ),
      authoredSchema,
    );
    assert.deepEqual(await readFile(resolve(output, "registry.json")), authoredRegistry);
    assert.deepEqual(
      await readFile(resolve(output, "observations/delivery/index.json")),
      authoredObservation,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/document-evidence-extraction/0.1.0/src/document_evidence.py",
        ),
      ),
      authoredSource,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/document-evidence-core-patterns/0.1.0/gist/10-same-byte-capture.md",
        ),
      ),
      authoredCompanion,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/document-evidence-core-patterns/0.1.1/gist/10-observed-effect-reconciliation.md",
        ),
      ),
      authoredSuccessorCompanion,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/specimen-custody-outbox/0.1.0/src/specimen_custody.py",
        ),
      ),
      authoredCustodySource,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/instrument-ingress-integrity/0.1.0/src/instrument_ingress.py",
        ),
      ),
      authoredIngressSource,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/lims-eln-enterprise-implementation/0.3.2/release-coordinate.json",
        ),
      ),
      authoredRepositoryCoordinate,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/lims-eln-enterprise-implementation/0.3.2/source/idempotency.py",
        ),
      ),
      authoredRepositoryExcerpt,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/migration-reconciliation-cutover/0.1.0/src/migration_cutover.py",
        ),
      ),
      authoredMigrationSource,
    );
    assert.deepEqual(
      await readFile(
        resolve(
          output,
          "snippets/typed-absence-and-wire-shape/0.1.0/src/typed-absence.ts",
        ),
      ),
      authoredTypedAbsenceSource,
    );
  });
});

test("public discovery routes carry collaboration and continuation orientation", async () => {
  await withProjection(async ({ output }) => {
    const root = await readFile(resolve(output, "index.html"), "utf8");
    const artifacts = await readFile(resolve(output, "snippets/index.html"), "utf8");
    const artifactSourceGuide = await readFile(resolve(output, "snippets/README.md"));
    const extractionFamily = await readFile(
      resolve(output, "snippets/document-evidence-extraction/index.html"),
      "utf8",
    );
    const companionFamily = await readFile(
      resolve(output, "snippets/document-evidence-core-patterns/index.html"),
      "utf8",
    );
    const custodyFamily = await readFile(
      resolve(output, "snippets/specimen-custody-outbox/index.html"),
      "utf8",
    );
    const repositoryExemplarFamily = await readFile(
      resolve(output, "snippets/lims-eln-enterprise-implementation/index.html"),
      "utf8",
    );
    const migrationFamily = await readFile(
      resolve(output, "snippets/migration-reconciliation-cutover/index.html"),
      "utf8",
    );
    const typedAbsenceFamily = await readFile(
      resolve(output, "snippets/typed-absence-and-wire-shape/index.html"),
      "utf8",
    );
    const tokenPipelineFamily = await readFile(
      resolve(output, "snippets/style-dictionary-dtcg-pipeline/index.html"),
      "utf8",
    );
    const receiverFamily = await readFile(
      resolve(output, "snippets/react-aria-visual-contract-receiver/index.html"),
      "utf8",
    );
    const observerFamily = await readFile(
      resolve(output, "snippets/cross-browser-visual-contract-observer/index.html"),
      "utf8",
    );
    const artifactCompilerFamily = await readFile(
      resolve(output, "snippets/visual-pattern-artifact-compiler/index.html"),
      "utf8",
    );
    const figmaReconciliationFamily = await readFile(
      resolve(output, "snippets/figma-variable-sync-reconciliation/index.html"),
      "utf8",
    );

    assert.match(root, /a durable coordinate from its first legible form/u);
    assert.match(root, /every accepted coordinate remains available/u);
    assert.match(root, /Evaluate or reuse/u);
    assert.match(root, /13 registered families with 15 exact-version packages/u);
    assert.match(root, /rel="alternate" type="application\/json"/u);
    assert.match(artifacts, /Choose a family by the mechanism you need/u);
    assert.match(artifacts, /machine-readable exact-version catalog/u);
    assert.equal(
      [...artifacts.matchAll(/<article class="card">/gu)].length,
      13,
      "artifact discovery must render one card per registered family",
    );
    assert.deepEqual(
      artifactSourceGuide,
      await readFile(resolve(repositoryRoot, "snippets/README.md")),
    );
    assert.match(
      extractionFamily,
      /href="\/snippets\/document-evidence-extraction\/README\.md"/u,
    );
    assert.match(
      extractionFamily,
      /Registry acceptance, manifest maturity, family continuation/u,
    );
    assert.match(extractionFamily, /Registry standing<\/dt><dd>Registered · 2 exact versions/u);
    assert.match(companionFamily, /document-evidence-core-patterns\/0\.1\.0\//u);
    assert.match(companionFamily, /document-evidence-core-patterns\/0\.1\.1\//u);
    assert.match(
      custodyFamily,
      /href="\/snippets\/specimen-custody-outbox\/README\.md"/u,
    );
    assert.match(custodyFamily, /specimen-custody-outbox\/0\.1\.0\//u);
    assert.match(
      migrationFamily,
      /href="\/snippets\/migration-reconciliation-cutover\/README\.md"/u,
    );
    assert.match(migrationFamily, /migration-reconciliation-cutover\/0\.1\.0\//u);
    assert.match(
      repositoryExemplarFamily,
      /href="\/snippets\/lims-eln-enterprise-implementation\/README\.md"/u,
    );
    assert.match(
      repositoryExemplarFamily,
      /lims-eln-enterprise-implementation\/0\.3\.2\//u,
    );
    assert.match(
      typedAbsenceFamily,
      /href="\/snippets\/typed-absence-and-wire-shape\/README\.md"/u,
    );
    assert.match(typedAbsenceFamily, /typed-absence-and-wire-shape\/0\.1\.0\//u);
    assert.match(tokenPipelineFamily, /style-dictionary-dtcg-pipeline\/0\.1\.0\//u);
    assert.match(receiverFamily, /react-aria-visual-contract-receiver\/0\.1\.0\//u);
    assert.match(observerFamily, /cross-browser-visual-contract-observer\/0\.1\.0\//u);
    assert.match(artifactCompilerFamily, /visual-pattern-artifact-compiler\/0\.1\.0\//u);
    assert.match(figmaReconciliationFamily, /figma-variable-sync-reconciliation\/0\.1\.0\//u);
  });
});

test("public skill routes expose only the selected exact source packages", async () => {
  await withProjection(async ({ output }) => {
    const catalog = JSON.parse(await readFile(resolve(output, "skills/index.json"), "utf8"));
    const expectedNames = [
  "architecture-convergence-vantages",
  "bounded-representation-admission",
  "contextual-jargon-scan",
  "controlled-context-comparison",
  "design-token-pipeline-stewardship",
  "interruption-safe-resource-ownership",
  "longitudinal-observation-visualization",
  "omics-coordinate-and-measurement-views",
  "parity-bound-workload-measurement",
  "probe-bearing-exemplar-formation",
  "repository-collaboration-cycle",
  "scientific-figure-composition",
  "scientific-scale-and-transform-fidelity",
  "secret-boundary-inspection",
  "semantic-visual-receiver-contracts",
  "spatial-support-and-change-visualization",
  "transaction-boundary-evidence-mapping",
  "typed-error-recovery-contracts",
  "versioned-exemplar-successor",
  "visual-artifact-family-publication",
  "visual-contract-receipt-design",
  "visualization-question-routing"
];
    assert.deepEqual(catalog.skills.map(skill => skill.name), expectedNames);
    assert.equal(catalog.sourceRevision, fixedSourceRevision);

    for (const skill of catalog.skills) {
      const html = await readFile(
        resolve(output, "skills", skill.name, "index.html"),
        "utf8",
      );
      assert.ok(html.includes('href="' + skill.source.publishedPath + '"'));
      assert.ok(html.includes('href="' + skill.source.repositoryUrl + '"'));
      assert.ok(html.includes(skill.source.sha256));
      assert.ok(html.includes("<h2>Operator guide</h2>"));
      assert.ok(
        html.includes(
          'href="/skills/source/.agents/skills/' + skill.name + '/README.md"',
        ),
      );
      assert.deepEqual(
        await readFile(resolve(output, skill.source.publishedPath.slice(1))),
        await readFile(resolve(repositoryRoot, skill.source.repositoryPath)),
      );
      for (const dependency of skill.dependencies) {
        assert.ok(html.includes('href="' + dependency.publishedPath + '"'));
        assert.ok(html.includes(dependency.sha256));
        assert.deepEqual(
          await readFile(resolve(output, dependency.publishedPath.slice(1))),
          await readFile(resolve(repositoryRoot, dependency.repositoryPath)),
        );
      }
    }

    const manifest = await readFile(resolve(output, "projection-manifest.json"), "utf8");
    const catalogHtml = await readFile(resolve(output, "skills/index.html"), "utf8");
    for (const name of ["repository-collaboration-cycle", "secret-boundary-inspection"]) {
      assert.ok(manifest.includes(`skills/${name}/index.html`));
      assert.ok(catalogHtml.includes(`/skills/${name}/`));
    }
  });
});

test("projection fixtures retain delivery history from a detached remote-only checkout", async () => {
  const container = await mkdtemp(join(tmpdir(), "gist-registry-ci-projection-"));
  const source = resolve(container, "ci-source");
  const root = resolve(container, "fixture");
  const output = resolve(container, "pages");
  try {
    // Mirror the existing refs once, then reproduce the checkout shape used by CI.
    await execFileAsync("git", ["clone", "--mirror", "--no-hardlinks", "--quiet",
      repositoryRoot, resolve(source, ".git")]);
    await git(source, ["config", "core.bare", "false"]);
    await git(source, ["update-ref", "--no-deref", "HEAD", await git(repositoryRoot, ["rev-parse", "HEAD"])]);
    const localRefs = await git(source, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]);
    for (const line of localRefs.split("\n").filter(Boolean)) {
      const [ref, revision] = line.split(" ");
      if (["refs/heads/main", "refs/heads/docs"].includes(ref)) {
        await git(source, ["update-ref", ref.replace("refs/heads/", "refs/remotes/origin/"), revision]);
      }
      await git(source, ["update-ref", "-d", ref]);
    }
    assert.equal(await git(source, ["for-each-ref", "--format=%(refname)", "refs/heads"]), "");
    await assert.rejects(git(source, ["symbolic-ref", "--quiet", "HEAD"]));
    await copyAuthoredSource(repositoryRoot, source);
    await copyProjectionSource(source, root);
    for (const branch of ["main", "docs"]) {
      assert.equal(await git(root, ["rev-parse", `refs/remotes/origin/${branch}`]),
        await git(source, ["rev-parse", `refs/remotes/origin/${branch}`]));
    }
    await buildPages({ root, output, sourceSha: fixedSourceRevision, sourceBinding: "test" });
    await checkProjection({ root, output });
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("a newly withheld package stays outside the complete generated projection", async () => {
  const container = await mkdtemp(join(tmpdir(), "gist-registry-withheld-projection-"));
  const root = resolve(container, "source");
  const output = resolve(container, "pages");
  try {
    // The projection also validates historical delivery evidence against source Git objects.
    await copyProjectionSource(repositoryRoot, root);
    const name = "private-calibration-recipe";
    const sourcePath = `.agents/skills/${name}/SKILL.md`;
    const readmePath = `.agents/skills/${name}/README.md`;
    await mkdir(resolve(root, `.agents/skills/${name}`));
    await writeFile(resolve(root, sourcePath), [
      "---", `name: ${name}`,
      "description: Calibrates a private fixture. Applies during this projection test.",
      "---", "", "# Private calibration recipe", "",
    ].join("\n"));
    await writeFile(resolve(root, readmePath), "# Private calibration recipe guide\n");
    const selectionPath = resolve(root, ".agents/skills/publication-selection.json");
    const selection = JSON.parse(await readFile(selectionPath, "utf8"));
    selection.skills.push({ name, sourcePath, publicationStanding: "public_possible",
      evidenceStanding: "instruction_only", dependencies: [readmePath], readinessNote: "Private fixture." });
    selection.skills.sort((left, right) => left.name.localeCompare(right.name));
    await writeFile(selectionPath, JSON.stringify(selection, null, 2) + "\n");
    await buildPages({ root, output, sourceSha: fixedSourceRevision, sourceBinding: "test" });
    await checkProjection({ root, output });
    const manifest = JSON.parse(await readFile(resolve(output, "projection-manifest.json"), "utf8"));
    const paths = [...manifest.files.map(file => file.path), "projection-manifest.json"];
    assert.equal(paths.some(path => path.includes(name)), false);
    for (const path of paths) {
      const text = (await readFile(resolve(output, path), "utf8")).toLocaleLowerCase("en-US");
      assert.equal(text.includes(name), false, path);
      assert.equal(text.includes("private calibration recipe"), false, path);
    }
    // A generated carrier with the withheld title fails the same boundary check.
    const target = resolve(output, "skills/index.html");
    const changed = Buffer.from((await readFile(target, "utf8")) + "Private calibration recipe");
    await writeFile(target, changed);
    const entry = manifest.files.find(file => file.path === "skills/index.html");
    entry.bytes = changed.length;
    entry.sha256 = createHash("sha256").update(changed).digest("hex");
    await writeFile(resolve(output, "projection-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await assert.rejects(checkProjection({ root, output }), /must not name or title a skill outside the public-ready set/u);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("artifact file inspection links retain local bytes and bind GitHub to the source revision", async () => {
  await withProjection(async ({ output }) => {
    const registry = JSON.parse(await readFile(resolve(repositoryRoot, "registry.json"), "utf8"));

    for (const entry of registry.entries) {
      const manifest = JSON.parse(
        await readFile(resolve(repositoryRoot, entry.manifestPath), "utf8"),
      );
      const html = await readFile(
        resolve(output, entry.canonicalPath, "index.html"),
        "utf8",
      );
      const encodedCanonicalPath = entry.canonicalPath
        .split("/")
        .map(segment => encodeURIComponent(segment))
        .join("/");

      assert.ok(
        html.includes(
          'href="' +
            expectedSourceRepositoryOrigin +
            "/commit/" +
            fixedSourceRevision +
            '"',
        ),
        entry.semanticId + " must link the displayed source revision",
      );
      assert.ok(
        html.includes(
          'href="' +
            expectedSourceRepositoryOrigin +
            "/tree/" +
            fixedSourceRevision +
            "/" +
            encodedCanonicalPath +
            '"',
        ),
        entry.semanticId + " must link its exact source directory",
      );

      for (const representation of manifest.representations) {
        const sourcePath = entry.canonicalPath + "/" + representation.path;
        const encodedSourcePath = sourcePath
          .split("/")
          .map(segment => encodeURIComponent(segment))
          .join("/");
        assert.ok(
          html.includes('href="/' + sourcePath + '"'),
          sourcePath + " must retain its byte-preserving Pages link",
        );
        assert.ok(
          html.includes(
            'href="' +
              expectedSourceRepositoryOrigin +
              "/blob/" +
              fixedSourceRevision +
              "/" +
              encodedSourcePath +
              '"',
          ),
          sourcePath + " must link its exact GitHub file view",
        );
      }

      assert.match(html, /filename opens the byte-preserving kindlight\.io projection/u);
      assert.match(html, /access follows the repository’s current visibility/u);
      assert.match(html, /Registry standing<\/dt><dd>Registered exact version/u);
      assert.match(html, /Manifest maturity<\/dt><dd><code>candidate<\/code>/u);
      assert.match(html, /rel="alternate" type="application\/json"/u);
      assert.equal(html.includes('target="_blank"'), false);
    }
  });
});

test("repository inspection paths preserve separators and encode path data", () => {
  assert.equal(
    sourceRepositoryRevisionUrl(
      "blob",
      fixedSourceRevision,
      'snippets/space #?%"/β.py',
    ),
    expectedSourceRepositoryOrigin +
      "/blob/" +
      fixedSourceRevision +
      "/snippets/space%20%23%3F%25%22/%CE%B2.py",
  );
});

test("public-boundary carrier parity remains independent from a rewritten manifest", async () => {
  await withProjection(async ({ output }) => {
    const carrierPath = resolve(output, "AI-DATA-USE.md");
    const changedBytes = Buffer.from("changed public-boundary carrier\n", "utf8");
    await writeFile(carrierPath, changedBytes);

    const manifestPath = resolve(output, "projection-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const entry = manifest.files.find(file => file.path === "AI-DATA-USE.md");
    entry.bytes = changedBytes.length;
    entry.sha256 = createHash("sha256").update(changedBytes).digest("hex");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    await assert.rejects(
      checkProjection({ root: repositoryRoot, output }),
      /AI-DATA-USE\.md must preserve authored public-boundary bytes/u,
    );
  });
});

test("skill source parity remains independent from a rewritten projection manifest", async () => {
  await withProjection(async ({ output }) => {
    const sourcePath =
      "skills/source/.agents/skills/contextual-jargon-scan/SKILL.md";
    const changedBytes = Buffer.from("changed skill source\n", "utf8");
    await writeFile(resolve(output, sourcePath), changedBytes);

    const manifestPath = resolve(output, "projection-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const entry = manifest.files.find(file => file.path === sourcePath);
    entry.bytes = changedBytes.length;
    entry.sha256 = createHash("sha256").update(changedBytes).digest("hex");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    await assert.rejects(
      checkProjection({ root: repositoryRoot, output }),
      /must preserve exact skill source bytes/u,
    );
  });
});

test("every generated HTML surface carries the shared author and footer attribution contract", async () => {
  await withProjection(async ({ output }) => {
    const authors = await readFile(resolve(repositoryRoot, "AUTHORS"), "utf8");
    const manifest = JSON.parse(
      await readFile(resolve(output, "projection-manifest.json"), "utf8"),
    );
    const htmlPaths = manifest.files
      .map(file => file.path)
      .filter(path => path.endsWith("index.html"));
    assert.ok(htmlPaths.length > 0);

    for (const path of htmlPaths) {
      const html = await readFile(resolve(output, path), "utf8");
      const mapsPosition = html.indexOf(mapsCanary);
      const bigBenchPosition = html.indexOf(bigBenchCanary);
      const authorMeta = '<meta name="author" content="' + siteAuthorName + '">';
      const authorFooter =
        '<p class="site-author">Gist Registry author: <a rel="author" href="/AUTHORS">' +
        siteAuthorName +
        "</a>.</p>";
      const authorPosition = html.indexOf(authorFooter);
      const copyrightPosition = html.indexOf(
        "© 2026 Driftframe Studios, Limited Liability Company.",
      );
      assert.equal(
        [...html.matchAll(/<meta name="author"/gu)].length,
        1,
        path + " must carry exactly one author meta element",
      );
      assert.ok(html.includes(authorMeta), path + " must carry the shared author name");
      assert.equal(
        html.split(authorFooter).length - 1,
        1,
        path + " must carry one visible author attribution",
      );
      assert.ok(mapsPosition >= 0, path + " must carry the MAPS marker");
      assert.ok(bigBenchPosition > mapsPosition, path + " must stack BIG-bench after MAPS");
      assert.ok(
        authorPosition > bigBenchPosition,
        path + " must place the visible author after the marker stack",
      );
      assert.ok(
        copyrightPosition > authorPosition,
        path + " must place copyright after the author attribution",
      );
      assert.equal(
        html.indexOf("<p", copyrightPosition),
        -1,
        path + " must keep copyright as the final visible footer paragraph",
      );
    }

    assert.equal(
      authors.split(siteAuthorName).length - 1,
      1,
      "AUTHORS must carry the shared author identity exactly once",
    );
    assert.ok(
      authors.includes(
        "authored by " + siteAuthorName + " and maintained by Driftframe\n" +
          "Studios, Limited Liability Company.",
      ),
      "AUTHORS must distinguish personal authorship from company maintenance",
    );
    assert.match(
      authors,
      /Git history and reviewed pull\nrequests carry contribution credit\./u,
      "AUTHORS must retain the contribution-credit route",
    );
    assert.match(
      authors,
      /Copyright notices remain in their established repository and page\ncarriers\./u,
      "AUTHORS must keep copyright in its established carriers",
    );
  });
});

test("the projection expresses training restraint and open person-directed retrieval", async () => {
  await withProjection(async ({ output }) => {
    const robots = await readFile(resolve(output, "robots.txt"), "utf8");
    assert.match(robots, /User-agent: GPTBot\nDisallow: \/\n/u);
    assert.match(robots, /User-agent: ClaudeBot\nDisallow: \/\n/u);
    assert.match(robots, /User-agent: CCBot\nDisallow: \/\n/u);
    assert.match(robots, /User-agent: OAI-SearchBot\nAllow: \/\n/u);
    assert.match(robots, /User-agent: ChatGPT-User\nAllow: \/\n/u);
    assert.match(robots, /User-agent: \*\nAllow: \/\n$/u);
    assert.equal((await readFile(resolve(output, ".nojekyll"))).length, 0);
    assert.equal(await readFile(resolve(output, "CNAME"), "utf8"), "kindlight.io\n");
  });
});

test("replacement is limited to output previously created by this builder", async () => {
  const container = await mkdtemp(join(tmpdir(), "gist-registry-pages-ownership-test-"));
  const output = resolve(container, "pages");
  try {
    await mkdir(output);
    await writeFile(resolve(output, "unrelated"), "unrelated", "utf8");
    await assert.rejects(
      buildPages({
        root: repositoryRoot,
        output,
        sourceSha: fixedSourceRevision,
        sourceBinding: "test",
      }),
      /existing output needs its projection manifest/u,
    );
    assert.equal(await readFile(resolve(output, "unrelated"), "utf8"), "unrelated");
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("an owned output can be rebuilt without retaining undeclared files", async () => {
  await withProjection(async ({ output }) => {
    await writeFile(resolve(output, "transient-local-note.txt"), "local only\n", "utf8");
    await buildPages({
      root: repositoryRoot,
      output,
      sourceSha: fixedSourceRevision,
      sourceBinding: "test",
    });
    await assert.rejects(readFile(resolve(output, "transient-local-note.txt")), /ENOENT/u);
    await checkProjection({ root: repositoryRoot, output });
  });
});

test("source identity requires a complete immutable Git coordinate", async () => {
  const container = await mkdtemp(join(tmpdir(), "gist-registry-pages-revision-test-"));
  try {
    await assert.rejects(
      buildPages({
        root: repositoryRoot,
        output: resolve(container, "pages"),
        sourceSha: "c1b9bc8",
        sourceBinding: "test",
      }),
      /source revision must be a full lowercase Git SHA/u,
    );
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("accepted source binding rejects mismatched, modified, and untracked inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "gist-registry-source-binding-test-"));
  try {
    await writeFile(resolve(root, "input.txt"), "accepted\n", "utf8");
    await git(root, ["init", "-q"]);
    await git(root, ["add", "input.txt"]);
    await git(root, [
      "-c",
      "user.name=Projection Test",
      "-c",
      "user.email=projection-test@example.invalid",
      "commit",
      "-qm",
      "Add accepted input",
    ]);
    const head = await git(root, ["rev-parse", "HEAD"]);

    assert.equal(
      await verifyAcceptedSource({
        root,
        requestedRevision: head,
        inputPaths: ["input.txt"],
      }),
      head,
    );
    await assert.rejects(
      verifyAcceptedSource({
        root,
        requestedRevision: fixedSourceRevision,
        inputPaths: ["input.txt"],
      }),
      /source revision must equal HEAD/u,
    );

    await writeFile(resolve(root, "input.txt"), "modified\n", "utf8");
    await assert.rejects(
      verifyAcceptedSource({
        root,
        requestedRevision: head,
        inputPaths: ["input.txt"],
      }),
      /publication source must be a clean Git worktree/u,
    );

    await writeFile(resolve(root, "input.txt"), "accepted\n", "utf8");
    await writeFile(resolve(root, "new-public-input.txt"), "untracked\n", "utf8");
    await assert.rejects(
      verifyAcceptedSource({
        root,
        requestedRevision: head,
        inputPaths: ["input.txt", "new-public-input.txt"],
      }),
      /publication source must be a clean Git worktree/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
