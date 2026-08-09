#!/usr/bin/env python3
"""Remove a non-uniform background with a segmentation model.

For flat green/magenta backgrounds, prefer chroma-matte.py: it beats this on
flat backgrounds because rembg tends to fill interior holes and leave color
fringing. Use this script when the source background is not a uniform color
(photos, gradients, scenes).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

CACHE_ROOT = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "generated-image-assets"

# pymatting (used for alpha matting) pulls in numba, which by default tries to
# write its JIT cache inside site-packages and fails there with a permission
# error on most installs. Point it at a writable directory under our own
# cache root before rembg (and therefore pymatting) gets imported.
_numba_cache_dir = CACHE_ROOT / "numba-cache"
_numba_cache_dir.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("NUMBA_CACHE_DIR", str(_numba_cache_dir))

SETUP_HINT = 'node "<skill-root>/scripts/setup.mjs" --tier full --yes'

try:
    from PIL import Image, UnidentifiedImageError
    from rembg import new_session, remove
except ImportError as exc:
    setup_script = Path(__file__).resolve().parent / "setup.mjs"
    missing = exc.name or str(exc)
    raise SystemExit(
        f"error: the 'full' tier is not installed for this venv ({missing} missing).\n"
        f"run: node \"{setup_script}\" --tier full --yes"
    )

MODELS = ("isnet-general-use", "birefnet-general-lite", "u2net", "u2netp")

U2NET_HOME = Path(
    os.path.expanduser(os.environ.get("U2NET_HOME") or os.path.join(os.environ.get("XDG_DATA_HOME") or "~", ".u2net"))
)


def load_rgba(input_path: Path) -> Image.Image:
    if not input_path.exists():
        raise SystemExit(f"error: input file not found: {input_path}")
    try:
        return Image.open(input_path).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise SystemExit(f"error: could not read image {input_path}: {exc}")


def segment(
    input_path: Path,
    output_path: Path,
    model: str,
    alpha_matting: bool,
    foreground_threshold: int,
    background_threshold: int,
) -> None:
    image = load_rgba(input_path)

    cached = (U2NET_HOME / f"{model}.onnx").exists()
    if not cached:
        print(
            f"warning: model '{model}' is not cached at {U2NET_HOME}; "
            "first run will download roughly 170-220MB",
            file=sys.stderr,
        )

    session = new_session(model)
    result = remove(
        image,
        session=session,
        alpha_matting=alpha_matting,
        alpha_matting_foreground_threshold=foreground_threshold,
        alpha_matting_background_threshold=background_threshold,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(output_path)
    print(f"saved {output_path} model={model} alpha_matting={alpha_matting}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--model", choices=MODELS, default="isnet-general-use")
    parser.add_argument("--no-alpha-matting", action="store_true")
    parser.add_argument("--foreground-threshold", type=int, default=240)
    parser.add_argument("--background-threshold", type=int, default=10)
    args = parser.parse_args()

    segment(
        input_path=args.input,
        output_path=args.out,
        model=args.model,
        alpha_matting=not args.no_alpha_matting,
        foreground_threshold=args.foreground_threshold,
        background_threshold=args.background_threshold,
    )


if __name__ == "__main__":
    main()
