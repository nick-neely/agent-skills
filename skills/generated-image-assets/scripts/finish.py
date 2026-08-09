#!/usr/bin/env python3
"""Trim, pad, and export an RGBA asset at high-DPI multipliers.

Deliberately small: prefer the project's own image tooling (sharp, etc.) when
it exists. This is the fallback for when it does not.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, UnidentifiedImageError

TRIM_RELATIVE_MASS = 0.001  # a row or column below this share of peak alpha is empty
SUPPORTED_FORMATS = ("png", "webp")


def load_rgba(input_path: Path) -> Image.Image:
    if not input_path.exists():
        raise SystemExit(f"error: input file not found: {input_path}")
    try:
        return Image.open(input_path).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise SystemExit(f"error: could not read image {input_path}: {exc}")


def trim(image: Image.Image) -> Image.Image:
    # Not getbbox(), which keys on alpha > 0: a couple of near-invisible stray
    # pixels left by a matte would then hold the box open and trim nothing.
    # Weighing each row and column by its total alpha ignores specks while
    # still preserving a genuine soft edge, which carries real mass.
    alpha = np.asarray(image.getchannel("A"), dtype=np.float64)
    columns = alpha.sum(axis=0)
    rows = alpha.sum(axis=1)
    if columns.max() <= 0:
        return image
    keep_x = np.nonzero(columns > TRIM_RELATIVE_MASS * columns.max())[0]
    keep_y = np.nonzero(rows > TRIM_RELATIVE_MASS * rows.max())[0]
    if not keep_x.size or not keep_y.size:
        return image
    return image.crop((int(keep_x[0]), int(keep_y[0]), int(keep_x[-1]) + 1, int(keep_y[-1]) + 1))


def pad(image: Image.Image, amount: int) -> Image.Image:
    if amount <= 0:
        return image
    canvas = Image.new("RGBA", (image.width + 2 * amount, image.height + 2 * amount), (0, 0, 0, 0))
    canvas.paste(image, (amount, amount), image)
    return canvas


def parse_scales(raw: str) -> list[float]:
    scales = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        value = float(part)
        if value <= 0:
            raise ValueError(f"--scales must be positive, got {part}")
        scales.append(value)
    if not scales:
        raise ValueError("--scales must list at least one value")
    return scales


def scale_suffix(scale: float) -> str:
    return "" if scale == 1 else f"@{scale:g}x"


def check_name(name: str) -> str:
    """Reject anything that is not a bare filename stem.

    `name` is interpolated straight into the output path, so a separator or a
    leading slash would write outside the directory the caller nominated.
    """
    if not name or name in (".", "..") or name != Path(name).name or "\\" in name:
        raise ValueError(f"--name must be a plain filename stem, got {name!r}")
    return name


def finish(
    input_path: Path,
    out_dir: Path,
    name: str,
    size: int | None,
    scales: list[float],
    formats: list[str],
    do_trim: bool,
    pad_amount: int,
) -> list[Path]:
    image = load_rgba(input_path)
    if do_trim:
        image = trim(image)
    image = pad(image, pad_amount)

    base_dim = max(image.width, image.height)
    base_scale = (size / base_dim) if size else 1.0

    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for scale in scales:
        total_scale = base_scale * scale
        dims = (max(1, round(image.width * total_scale)), max(1, round(image.height * total_scale)))
        resized = image if dims == image.size else image.resize(dims, Image.Resampling.LANCZOS)
        for fmt in formats:
            out_path = out_dir / f"{name}{scale_suffix(scale)}.{fmt}"
            save_kwargs = {"optimize": True}
            resized.save(out_path, **save_kwargs)
            written.append(out_path)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--size", type=int, help="Target base (1x) dimension for the longer side. Defaults to the source's own size.")
    parser.add_argument("--scales", default="1,2,3")
    parser.add_argument("--trim", action="store_true")
    parser.add_argument("--pad", type=int, default=0)
    parser.add_argument("--format", default="png")
    args = parser.parse_args()

    try:
        scales = parse_scales(args.scales)
        name = check_name(args.name)
    except ValueError as exc:
        raise SystemExit(f"error: {exc}")

    if args.size is not None and args.size <= 0:
        raise SystemExit("error: --size must be a positive number of pixels")
    if args.pad < 0:
        raise SystemExit("error: --pad must not be negative")

    formats = [f.strip().lower() for f in args.format.split(",") if f.strip()]
    if not formats:
        raise SystemExit("error: --format must list at least one format")
    unsupported = [f for f in formats if f not in SUPPORTED_FORMATS]
    if unsupported:
        raise SystemExit(
            f"error: unsupported --format {', '.join(unsupported)}; choose from "
            f"{', '.join(sorted(SUPPORTED_FORMATS))}"
        )

    written = finish(
        input_path=args.input,
        out_dir=args.out_dir,
        name=name,
        size=args.size,
        scales=scales,
        formats=formats,
        do_trim=args.trim,
        pad_amount=args.pad,
    )
    for path in written:
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
