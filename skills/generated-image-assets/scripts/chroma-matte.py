#!/usr/bin/env python3
"""Remove a flat chroma-key background with soft alpha and despill.

This is for generated raster assets produced on a uniform green/magenta
background. It is not a general photo background remover.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, UnidentifiedImageError

# Share of the subject's own distance from the key at which alpha saturates.
# Measured across a corpus of generated icons and 3D renders: 0.8 roughly
# halves residual fringing against a fixed cutoff, while 0.9 starts tinting
# edges away from the key on some subjects.
OPAQUE_FRACTION = 0.8


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    span = max(edge1 - edge0, 1e-6)
    t = np.clip((x - edge0) / span, 0, 1)
    return t * t * (3 - 2 * t)


def sample_key(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate(
        [rgb[0, :, :], rgb[-1, :, :], rgb[:, 0, :], rgb[:, -1, :]],
        axis=0,
    )
    return np.median(border, axis=0)


def parse_rgb(value: str | None) -> np.ndarray | None:
    if value is None:
        return None
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        raise ValueError("--key must be a hex RGB value like #ff00ff")
    return np.array([int(raw[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def load_rgba(input_path: Path) -> Image.Image:
    if not input_path.exists():
        raise SystemExit(f"error: input file not found: {input_path}")
    try:
        return Image.open(input_path).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise SystemExit(f"error: could not read image {input_path}: {exc}")


def auto_opaque(dist: np.ndarray, transparent: float) -> float:
    """Pick the distance at which a pixel counts as fully subject.

    A fixed cutoff silently breaks despill. Alpha saturates at `opaque`, and
    only non-saturated pixels get unmixed, so when the subject sits far from
    the key the genuine blend pixels land above the cutoff, are called fully
    opaque, and keep their share of key color as a visible fringe. Scaling the
    cutoff to how far this subject actually sits from the key keeps those
    pixels inside the band that gets unmixed. Overshooting is its own failure,
    tinting edges away from the key, so this stays well under the median.
    """
    subject = dist[dist > transparent * 4]
    if subject.size < 64:
        return 105.0
    return float(np.clip(OPAQUE_FRACTION * np.median(subject), 60.0, 255.0))


def matte(
    input_path: Path,
    output_path: Path,
    key: np.ndarray | None,
    transparent: float,
    opaque: float | None,
    neutral_protect: bool,
) -> None:
    image = load_rgba(input_path)
    arr = np.asarray(image).astype(np.float32)
    rgb = arr[..., :3]

    key_rgb = key if key is not None else sample_key(rgb)
    dist = np.linalg.norm(rgb - key_rgb, axis=2)
    if opaque is None:
        opaque = auto_opaque(dist, transparent)
    alpha = smoothstep(transparent, opaque, dist)

    if neutral_protect:
        maxc = rgb.max(axis=2)
        minc = rgb.min(axis=2)
        chroma = maxc - minc
        alpha = np.where((chroma < 20) & (dist > transparent * 1.5), np.maximum(alpha, 0.92), alpha)

    # Unmix antialiased edge pixels from the key color:
    # observed = alpha * subject + (1 - alpha) * key
    a = np.clip(alpha[..., None], 1e-3, 1.0)
    unmixed = np.clip((rgb - (1 - a) * key_rgb) / a, 0, 255)
    edge = (alpha > 0.02) & (alpha < 0.98)

    out_rgb = rgb.copy()
    out_rgb[edge] = unmixed[edge]

    out_alpha = np.round(alpha * 255).astype(np.uint8)
    out_alpha[dist <= transparent] = 0

    out = np.dstack([np.round(out_rgb).astype(np.uint8), out_alpha])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, "RGBA").save(output_path)

    print(
        f"saved {output_path} key=#{int(key_rgb[0]):02x}{int(key_rgb[1]):02x}{int(key_rgb[2]):02x} "
        f"transparent={transparent:g} opaque={opaque:g}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--key", help="Optional key color, e.g. #ff00ff. Defaults to border median.")
    parser.add_argument("--transparent", type=float, default=18)
    parser.add_argument(
        "--opaque",
        type=float,
        default=None,
        help="Distance at which a pixel is fully subject. Derived from the image when omitted.",
    )
    parser.add_argument("--no-neutral-protect", action="store_true")
    args = parser.parse_args()

    try:
        key = parse_rgb(args.key)
    except ValueError as exc:
        raise SystemExit(f"error: {exc}")

    matte(
        input_path=args.input,
        output_path=args.out,
        key=key,
        transparent=args.transparent,
        opaque=args.opaque,
        neutral_protect=not args.no_neutral_protect,
    )


if __name__ == "__main__":
    main()
