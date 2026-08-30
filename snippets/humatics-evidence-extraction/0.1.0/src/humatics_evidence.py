"""Inspectable OCR capture and deterministic evidence extraction.

The collection stage is environment-observed. The analysis stage is designed
to be deterministic for one capture and pinned Python dependency set.
"""

from __future__ import annotations

import argparse
import atexit
import hashlib
import io
import json
import os
import platform
import re
import shutil
import tempfile
import unicodedata
import warnings
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

WORKFLOW_VERSION = "0.1.0"
ARTIFACT_ID = "humatics-evidence-extraction"
OUTPUT_SENTINEL = ".humatics-evidence-output.json"
NEGATION_TERMS = frozenset({"neither", "never", "no", "nor", "not", "without"})
TOKEN_PATTERN = re.compile(r"[a-z0-9]+(?:['-][a-z0-9]+)*")
DEFAULT_STOPWORDS = Path(__file__).resolve().parents[1] / "config" / "stopwords-en.txt"
_MATPLOTLIB_CONFIG: tempfile.TemporaryDirectory[str] | None = None


def _cleanup_matplotlib_config() -> None:
    global _MATPLOTLIB_CONFIG
    if _MATPLOTLIB_CONFIG is not None:
        _MATPLOTLIB_CONFIG.cleanup()
        _MATPLOTLIB_CONFIG = None


class EvidenceWorkflowError(RuntimeError):
    """Base exception with an actionable collaboration boundary."""


class OutputExistsError(EvidenceWorkflowError):
    """Raised when an accepted-looking output needs explicit replacement."""


class DependencyUnavailableError(EvidenceWorkflowError):
    """Raised when an optional local stage lacks its runtime dependency."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def write_json(path: Path, value: Any) -> None:
    path.write_bytes(canonical_json(value))


def load_stopwords(path: Path = DEFAULT_STOPWORDS) -> tuple[frozenset[str], str]:
    source = path.read_bytes()
    words = {
        line.strip().lower()
        for line in source.decode("utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    # TARGET: negation remains visible even when a general stop-word list carries it.
    return frozenset(words - NEGATION_TERMS), sha256_bytes(source)


def normalize_text(text: str, stopwords: frozenset[str]) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text).lower()
    return [
        token
        for token in TOKEN_PATTERN.findall(normalized)
        if token not in stopwords and (len(token) > 1 or token.isdigit())
    ]


def _require_analysis_dependencies():
    global _MATPLOTLIB_CONFIG
    if "MPLCONFIGDIR" not in os.environ:
        if _MATPLOTLIB_CONFIG is None:
            _MATPLOTLIB_CONFIG = tempfile.TemporaryDirectory(prefix="gist-registry-matplotlib-")
            atexit.register(_cleanup_matplotlib_config)
        os.environ["MPLCONFIGDIR"] = _MATPLOTLIB_CONFIG.name
    try:
        import numpy  # type: ignore
        import PIL  # type: ignore
        import scipy  # type: ignore
        import sklearn  # type: ignore
        from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore

        # WordCloud opens its packaged stop-word file without a context
        # manager during import. This artifact supplies its own stop-word source;
        # keep that one upstream ResourceWarning out of otherwise focused output.
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore", category=ResourceWarning, module="wordcloud.wordcloud"
            )
            import wordcloud  # type: ignore
            from wordcloud import WordCloud  # type: ignore
    except ImportError as error:
        raise DependencyUnavailableError(
            "Resolve the committed artifact lock before analysis: "
            "uv --cache-dir .artifacts/uv-cache sync "
            "--project snippets/humatics-evidence-extraction/0.1.0 --locked"
        ) from error
    versions = {
        "python": platform.python_version(),
        "numpy": str(numpy.__version__),
        "scipy": str(scipy.__version__),
        "scikitLearn": str(sklearn.__version__),
        "pillow": str(PIL.__version__),
        "wordcloud": str(wordcloud.__version__),
    }
    return versions, TfidfVectorizer, WordCloud


def _validate_capture(capture: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    if capture.get("artifactId") != ARTIFACT_ID:
        raise EvidenceWorkflowError(f"capture artifactId must be {ARTIFACT_ID}")
    if capture.get("captureVersion") != WORKFLOW_VERSION:
        raise EvidenceWorkflowError(f"captureVersion must be {WORKFLOW_VERSION}")
    capture_tuple = (
        capture.get("captureRole"),
        capture.get("sourceClass"),
        capture.get("reviewStanding"),
    )
    supported_capture_tuples = {
        ("local_ocr_capture", "local_image_observation", "requires_human_review"),
        ("local_ocr_capture", "local_image_observation", "reviewed"),
        (
            "reviewed_synthetic_fixture",
            "realistic_synthetic",
            "reviewed_synthetic_fixture",
        ),
    }
    if capture_tuple not in supported_capture_tuples:
        raise EvidenceWorkflowError(
            "captureRole, sourceClass, and reviewStanding must identify one coherent "
            "supported capture state"
        )
    engine = capture.get("ocrEngine")
    if not isinstance(engine, Mapping):
        raise EvidenceWorkflowError("capture.ocrEngine must be an object")
    for field in ("name", "version", "settings"):
        if not isinstance(engine.get(field), str) or not str(engine[field]).strip():
            raise EvidenceWorkflowError(f"capture.ocrEngine.{field} must be a non-empty string")
    documents = capture.get("documents")
    if not isinstance(documents, list) or not documents:
        raise EvidenceWorkflowError("capture.documents must contain at least one document")
    seen: set[str] = set()
    for document in documents:
        if not isinstance(document, Mapping):
            raise EvidenceWorkflowError("every captured document must be an object")
        for field in ("id", "era", "sourceName", "sourceSha256", "text"):
            if not isinstance(document.get(field), str) or not str(document[field]).strip():
                raise EvidenceWorkflowError(
                    f"captured document field {field} must be a non-empty string"
                )
        if document["id"] in seen:
            raise EvidenceWorkflowError(f"duplicate captured document id {document['id']}")
        seen.add(str(document["id"]))
        if not re.fullmatch(r"[a-f0-9]{64}", str(document["sourceSha256"])):
            raise EvidenceWorkflowError(f"document {document['id']} has a malformed sourceSha256")
        if Path(str(document["sourceName"])).name != document["sourceName"] or "\\" in str(
            document["sourceName"]
        ):
            raise EvidenceWorkflowError(
                f"document {document['id']} sourceName must not contain a local path"
            )
    return documents


def extract_term_weights(
    documents: Sequence[Mapping[str, Any]],
    stopwords: frozenset[str],
    *,
    top_n: int = 24,
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]], dict[str, list[str]]]:
    if top_n < 1:
        raise EvidenceWorkflowError("top_n must be positive")
    _, TfidfVectorizer, _ = _require_analysis_dependencies()
    normalized = {
        str(document["id"]): normalize_text(str(document["text"]), stopwords)
        for document in documents
    }
    corpus = [" ".join(normalized[str(document["id"])]) for document in documents]
    if not any(corpus):
        raise EvidenceWorkflowError("normalization produced an empty corpus")

    vectorizer = TfidfVectorizer(
        lowercase=False,
        norm="l2",
        smooth_idf=True,
        sublinear_tf=True,
        token_pattern=r"(?u)\b\w[\w'-]*\b",
    )
    matrix = vectorizer.fit_transform(corpus)
    terms = vectorizer.get_feature_names_out()

    def ordered(values: Iterable[float]) -> list[dict[str, Any]]:
        rows = [
            {"term": str(term), "weight": round(float(weight), 8)}
            for term, weight in zip(terms, values, strict=True)
            if float(weight) > 0
        ]
        return sorted(rows, key=lambda row: (-row["weight"], row["term"]))[:top_n]

    era_indexes: dict[str, list[int]] = defaultdict(list)
    for index, document in enumerate(documents):
        era_indexes[str(document["era"])].append(index)
    by_era = {
        era: ordered(matrix[indexes].mean(axis=0).A1)
        for era, indexes in sorted(era_indexes.items())
    }
    combined = ordered(matrix.mean(axis=0).A1)
    return by_era, combined, normalized


def render_word_cloud(
    weights: Sequence[Mapping[str, Any]],
    output_path: Path,
    *,
    width: int = 1200,
    height: int = 720,
    seed: int = 27,
) -> dict[str, Any]:
    versions, _, WordCloud = _require_analysis_dependencies()
    frequencies = {str(row["term"]): float(row["weight"]) for row in weights}
    if not frequencies:
        raise EvidenceWorkflowError("word-cloud rendering requires at least one weighted term")
    cloud = WordCloud(
        width=width,
        height=height,
        background_color="white",
        color_func=lambda *args, **kwargs: "#17345f",
        collocations=False,
        normalize_plurals=False,
        random_state=seed,
    ).generate_from_frequencies(frequencies)
    cloud.to_file(str(output_path))
    if not cloud.font_path:
        raise EvidenceWorkflowError("word-cloud rendering did not resolve a font path")
    font_path = Path(cloud.font_path)
    weight_digest = sha256_bytes(canonical_json(frequencies))
    return {
        "mediaType": "image/png",
        "width": width,
        "height": height,
        "seed": seed,
        "weightsSha256": weight_digest,
        "sha256": sha256_file(output_path),
        "environment": versions,
        "font": {
            "name": font_path.name,
            "sha256": sha256_file(font_path),
        },
    }


def _output_sentinel_record() -> dict[str, str]:
    return {
        "artifactId": ARTIFACT_ID,
        "role": "analysis_output",
        "workflowVersion": WORKFLOW_VERSION,
    }


def _require_owned_output_directory(path: Path, label: str) -> None:
    if path.is_symlink():
        raise EvidenceWorkflowError(f"{label} must not be a symbolic link: {path}")
    if not path.is_dir():
        raise EvidenceWorkflowError(f"{label} must be a directory: {path}")
    sentinel = path / OUTPUT_SENTINEL
    if sentinel.is_symlink() or not sentinel.is_file():
        raise EvidenceWorkflowError(
            f"{label} is not an owned {ARTIFACT_ID} output; preserving it unchanged: {path}"
        )
    try:
        record = json.loads(sentinel.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceWorkflowError(
            f"{label} has an unreadable ownership sentinel: {path}"
        ) from error
    if record != _output_sentinel_record():
        raise EvidenceWorkflowError(
            f"{label} has a different ownership sentinel; preserving it unchanged: {path}"
        )


def _promote_staged_directory(staged: Path, target: Path, *, replace: bool) -> None:
    _require_owned_output_directory(staged, "staged output")
    if target.is_symlink():
        raise EvidenceWorkflowError(f"output must not be a symbolic link: {target}")
    if target.exists():
        if not replace:
            raise OutputExistsError(
                f"output already exists: {target}; choose a new path or pass --replace"
            )
        _require_owned_output_directory(target, "existing output")
    backup: Path | None = None
    if target.exists():
        backup = target.with_name(f".{target.name}.previous-{os.getpid()}")
        if backup.exists() or backup.is_symlink():
            raise EvidenceWorkflowError(f"recovery path already exists: {backup}")
        target.rename(backup)
    try:
        staged.rename(target)
    except Exception:
        if backup is not None and not target.exists():
            backup.rename(target)
        raise
    else:
        if backup is not None:
            try:
                shutil.rmtree(backup)
            except OSError as error:
                warnings.warn(
                    f"replacement completed; prior output remains at {backup} because "
                    f"cleanup did not complete: {error}",
                    RuntimeWarning,
                    stacklevel=2,
                )


def _require_owned_capture(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise EvidenceWorkflowError(f"existing capture is not a replaceable regular file: {path}")
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceWorkflowError(f"existing capture is not an owned capture: {path}") from error
    if (
        record.get("artifactId") != ARTIFACT_ID
        or record.get("captureVersion") != WORKFLOW_VERSION
        or record.get("captureRole") != "local_ocr_capture"
    ):
        raise EvidenceWorkflowError(
            f"existing capture has a different owner; preserving it: {path}"
        )


def _promote_staged_capture(staged: Path, target: Path, *, replace: bool) -> None:
    if staged.is_symlink() or not staged.is_file():
        raise EvidenceWorkflowError(f"staged capture must be a regular file: {staged}")
    if target.is_symlink():
        raise EvidenceWorkflowError(f"capture output must not be a symbolic link: {target}")
    if target.exists():
        if not replace:
            raise OutputExistsError(
                f"capture already exists: {target}; choose a new path or pass --replace"
            )
        _require_owned_capture(target)
    backup: Path | None = None
    if target.exists():
        backup = target.with_name(f".{target.name}.previous-{os.getpid()}")
        if backup.exists() or backup.is_symlink():
            raise EvidenceWorkflowError(f"capture recovery path already exists: {backup}")
        target.rename(backup)
    try:
        staged.rename(target)
    except Exception:
        if backup is not None and not target.exists():
            backup.rename(target)
        raise
    else:
        if backup is not None:
            try:
                backup.unlink()
            except OSError as error:
                warnings.warn(
                    f"capture replacement completed; prior capture remains at {backup} "
                    f"because cleanup did not complete: {error}",
                    RuntimeWarning,
                    stacklevel=2,
                )


def analyze_capture(
    capture_path: Path,
    output_dir: Path,
    *,
    stopwords_path: Path = DEFAULT_STOPWORDS,
    top_n: int = 24,
    seed: int = 27,
    replace: bool = False,
) -> dict[str, Any]:
    requested_output = output_dir.absolute()
    if requested_output.is_symlink():
        raise EvidenceWorkflowError(f"output must not be a symbolic link: {requested_output}")
    output_dir = requested_output.parent.resolve() / requested_output.name
    if output_dir.exists():
        if not replace:
            raise OutputExistsError(
                f"output already exists: {output_dir}; choose a new path or pass --replace"
            )
        _require_owned_output_directory(output_dir, "existing output")

    capture_bytes = capture_path.read_bytes()
    capture = json.loads(capture_bytes.decode("utf-8"))
    documents = _validate_capture(capture)
    stopwords, stopwords_digest = load_stopwords(stopwords_path)
    by_era, combined, normalized = extract_term_weights(documents, stopwords, top_n=top_n)

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    staged = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.staged-", dir=output_dir.parent))
    try:
        write_json(staged / OUTPUT_SENTINEL, _output_sentinel_record())
        term_record = {
            "workflowVersion": WORKFLOW_VERSION,
            "captureSha256": sha256_bytes(capture_bytes),
            "sourceCaptureRole": capture["captureRole"],
            "sourceClass": capture["sourceClass"],
            "sourceReviewStanding": capture["reviewStanding"],
            "stopwordsSha256": stopwords_digest,
            "retainedNegationTerms": sorted(
                NEGATION_TERMS.intersection(
                    token for tokens in normalized.values() for token in tokens
                )
            ),
            "documentCount": len(documents),
            "topN": top_n,
            "eras": sorted(by_era),
            "ordering": "descending weight with lexical tie-break",
            "byEra": by_era,
            "combined": combined,
        }
        write_json(staged / "term-weights.json", term_record)
        render = render_word_cloud(combined, staged / "word-cloud.png", seed=seed)
        render["sourceCaptureRole"] = capture["captureRole"]
        render["sourceClass"] = capture["sourceClass"]
        render["sourceReviewStanding"] = capture["reviewStanding"]
        write_json(staged / "render-metadata.json", render)
        _promote_staged_directory(staged, output_dir, replace=replace)
    except Exception:
        if staged.exists():
            shutil.rmtree(staged)
        raise
    return {"termWeights": term_record, "render": render}


def ocr_image(source_bytes: bytes, _source_name: str) -> dict[str, str]:
    try:
        import pytesseract  # type: ignore
        from PIL import Image, ImageEnhance, ImageOps  # type: ignore
    except ImportError as error:
        raise DependencyUnavailableError(
            "Install Pillow and pytesseract before the OCR collection stage"
        ) from error
    try:
        engine_version = str(pytesseract.get_tesseract_version()).splitlines()[0]
    except Exception as error:
        raise DependencyUnavailableError(
            "A local Tesseract executable is required for OCR collection"
        ) from error
    with Image.open(io.BytesIO(source_bytes)) as image:
        prepared = ImageOps.grayscale(image)
        prepared = ImageOps.autocontrast(prepared)
        prepared = ImageEnhance.Contrast(prepared).enhance(1.4)
        text = pytesseract.image_to_string(prepared, lang="eng", config="--psm 6")
    return {
        "text": text,
        "engineName": "tesseract",
        "engineVersion": engine_version,
        "settings": (
            "grayscale; autocontrast; contrast=1.4; language=eng; page-segmentation-mode=6"
        ),
    }


def collect_ocr(
    documents: Sequence[tuple[str, str, Path]],
    output_path: Path,
    *,
    reader: Callable[[bytes, str], Mapping[str, str]] = ocr_image,
    replace: bool = False,
) -> dict[str, Any]:
    if not documents:
        raise EvidenceWorkflowError("OCR collection requires at least one document")
    requested_output = output_path.absolute()
    if requested_output.is_symlink():
        raise EvidenceWorkflowError(
            f"capture output must not be a symbolic link: {requested_output}"
        )
    output_path = requested_output.parent.resolve() / requested_output.name
    if output_path.exists():
        if not replace:
            raise OutputExistsError(
                f"capture already exists: {output_path}; choose a new path or pass --replace"
            )
        _require_owned_capture(output_path)
    captured: list[dict[str, str]] = []
    engine: dict[str, str] | None = None
    seen: set[str] = set()
    for document_id, era, source_path in documents:
        if not isinstance(document_id, str) or not document_id.strip():
            raise EvidenceWorkflowError("OCR document id must be a non-empty string")
        if not isinstance(era, str) or not era.strip():
            raise EvidenceWorkflowError(
                f"OCR document {document_id} era must be a non-empty string"
            )
        if document_id in seen:
            raise EvidenceWorkflowError(f"duplicate OCR document id {document_id}")
        seen.add(document_id)
        source_path = source_path.resolve()
        if output_path == source_path:
            raise EvidenceWorkflowError("capture output must differ from every source document")
        source_bytes = source_path.read_bytes()
        result = reader(source_bytes, source_path.name)
        for field in ("text", "engineName", "engineVersion", "settings"):
            if not isinstance(result.get(field), str) or not str(result[field]).strip():
                raise EvidenceWorkflowError(f"OCR reader field {field} must be a non-empty string")
        current_engine = {
            "name": str(result["engineName"]),
            "version": str(result["engineVersion"]),
            "settings": str(result["settings"]),
        }
        if engine is not None and engine != current_engine:
            raise EvidenceWorkflowError("one OCR capture must use one engine configuration")
        engine = current_engine
        captured.append(
            {
                "id": document_id,
                "era": era,
                "sourceName": source_path.name,
                "sourceSha256": sha256_bytes(source_bytes),
                "text": str(result["text"]),
            }
        )
    record = {
        "artifactId": ARTIFACT_ID,
        "captureVersion": WORKFLOW_VERSION,
        "captureRole": "local_ocr_capture",
        "reviewStanding": "requires_human_review",
        "sourceClass": "local_image_observation",
        "ocrEngine": engine,
        "documents": captured,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, staged_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.staged-",
        dir=output_path.parent,
    )
    os.close(descriptor)
    staged = Path(staged_name)
    try:
        write_json(staged, record)
        _promote_staged_capture(staged, output_path, replace=replace)
    finally:
        if staged.exists():
            staged.unlink()
    return record


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)

    analyze = commands.add_parser(
        "analyze", help="analyze a capture while preserving its review standing"
    )
    analyze.add_argument("capture", type=Path)
    analyze.add_argument("--output", type=Path, required=True)
    analyze.add_argument("--stopwords", type=Path, default=DEFAULT_STOPWORDS)
    analyze.add_argument("--top-n", type=int, default=24)
    analyze.add_argument("--seed", type=int, default=27)
    analyze.add_argument("--replace", action="store_true")

    ocr = commands.add_parser("ocr", help="collect local OCR into a reviewable capture")
    ocr.add_argument(
        "--document", nargs=3, action="append", metavar=("ID", "ERA", "IMAGE"), required=True
    )
    ocr.add_argument("--output", type=Path, required=True)
    ocr.add_argument("--replace", action="store_true")
    return root


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "analyze":
            result = analyze_capture(
                args.capture,
                args.output,
                stopwords_path=args.stopwords,
                top_n=args.top_n,
                seed=args.seed,
                replace=args.replace,
            )
            print(
                f"analysis complete: {args.output} "
                f"(source review standing: "
                f"{result['termWeights']['sourceReviewStanding']})"
            )
        else:
            documents = [(identifier, era, Path(image)) for identifier, era, image in args.document]
            collect_ocr(documents, args.output, replace=args.replace)
            print(f"OCR capture ready for review: {args.output}")
    except (EvidenceWorkflowError, FileNotFoundError, json.JSONDecodeError) as error:
        print(f"humatics evidence workflow: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
