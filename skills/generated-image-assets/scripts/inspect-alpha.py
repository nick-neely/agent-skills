#!/usr/bin/env python3
"""Verify an RGBA cutout without spending vision tokens on every check.

Writes a contact sheet (the image over light, dark, and checkerboard grounds,
plus an alpha-only view and a zoomed crop of the busiest edge region) and
prints a small JSON report to stdout: opaque/transparent/partial pixel
fractions, whether interior holes survived, residual chroma-key spill on the
antialiased edge, and the content bounding box.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError

THUMB = 320  # contact-sheet panel size, in pixels
PAD = 12
LOCAL_RADIUS = 6  # window for sampling the subject color beside an edge pixel
MIN_HOLE_PIXELS = 64  # below this an "interior hole" is antialiasing noise
CONTENT_RELATIVE_MASS = 0.001  # a row or column below this share of peak alpha is empty
EDGE_TOUCH_MIN = 4  # a couple of stray border pixels is noise, not clipping


def parse_rgb(value: str | None) -> np.ndarray | None:
    if value is None:
        return None
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        raise ValueError("--key must be a hex RGB value like #00ff00")
    return np.array([int(raw[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def sample_key(rgb: np.ndarray) -> np.ndarray:
    # Same border-median sampling as chroma-matte.py, so a report on a
    # chroma-matte output measures spill against the color it was keyed on.
    border = np.concatenate(
        [rgb[0, :, :], rgb[-1, :, :], rgb[:, 0, :], rgb[:, -1, :]],
        axis=0,
    )
    return np.median(border, axis=0)


def box_sum(values: np.ndarray, radius: int) -> np.ndarray:
    """Sum over a (2*radius+1) square window, via an integral image."""
    flat = values.ndim == 2
    if flat:
        values = values[..., None]
    padded = np.pad(values, ((radius + 1, radius), (radius + 1, radius), (0, 0)))
    cumulative = padded.cumsum(0).cumsum(1)
    h, w = values.shape[:2]
    span = 2 * radius + 1
    total = (
        cumulative[span:, span:]
        - cumulative[:h, span:]
        - cumulative[span:, :w]
        + cumulative[:h, :w]
    )
    return total[..., 0] if flat else total


def measure_spill(rgb: np.ndarray, alpha: np.ndarray, key_rgb: np.ndarray) -> dict:
    """How far edge pixels still lean toward the key color.

    Absolute distance from the key cannot answer this: it is dominated by the
    subject's own color, so a perfectly despilled edge on a subject sitting far
    from the key still scores high. Compare each edge pixel against the local
    opaque subject color instead, and project that difference onto the
    direction pointing at the key. 0 is fully despilled, 1 is fully key colored.
    """
    opaque = (alpha >= 250).astype(np.float32)
    band = (alpha > 0) & (alpha < 250)

    weight = box_sum(opaque, LOCAL_RADIUS)
    local = box_sum(rgb * opaque[..., None], LOCAL_RADIUS) / np.maximum(weight, 1e-6)[..., None]

    # Needs enough opaque neighbours for the local color to mean anything.
    usable = band & (weight > 4)
    if usable.sum() < 32:
        return {"residual_spill": 0.0, "residual_spill_p95": 0.0, "edge_band_pixels": int(band.sum())}

    toward_key = key_rgb - local[usable]
    deviation = rgb[usable] - local[usable]
    denominator = np.maximum((toward_key * toward_key).sum(-1), 1e-6)
    fraction = np.clip((deviation * toward_key).sum(-1) / denominator, -1.0, 1.0)
    return {
        "residual_spill": round(float(fraction.mean()), 4),
        "residual_spill_p95": round(float(np.percentile(fraction, 95)), 4),
        "edge_band_pixels": int(band.sum()),
    }


def load_rgba(input_path: Path) -> Image.Image:
    if not input_path.exists():
        raise SystemExit(f"error: input file not found: {input_path}")
    try:
        return Image.open(input_path).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise SystemExit(f"error: could not read image {input_path}: {exc}")


def flood_fill_from_border(mask: np.ndarray) -> np.ndarray:
    """Return the subset of `mask` reachable from the image border, 4-connected."""
    h, w = mask.shape
    reached = np.zeros_like(mask)
    dq: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        if mask[y, x] and not reached[y, x]:
            reached[y, x] = True
            dq.append((y, x))

    for x in range(w):
        seed(0, x)
        seed(h - 1, x)
    for y in range(h):
        seed(y, 0)
        seed(y, w - 1)

    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                dq.append((ny, nx))
    return reached


def component_sizes(mask: np.ndarray) -> list[int]:
    """Sizes of the 4-connected components of True cells in `mask`, largest first."""
    h, w = mask.shape
    visited = np.zeros_like(mask)
    ys, xs = np.nonzero(mask)
    sizes = []
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if visited[y0, x0]:
            continue
        size = 0
        dq: deque[tuple[int, int]] = deque([(y0, x0)])
        visited[y0, x0] = True
        while dq:
            y, x = dq.popleft()
            size += 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    dq.append((ny, nx))
        sizes.append(size)
    sizes.sort(reverse=True)
    return sizes


def content_bbox(alpha: np.ndarray) -> tuple[int, int, int, int] | None:
    # Weigh rows and columns by total alpha rather than testing for any nonzero
    # pixel. A handful of near-invisible strays would otherwise stretch the box
    # to the whole image, while a genuine soft edge carries real mass and stays.
    columns = alpha.sum(axis=0)
    rows = alpha.sum(axis=1)
    if columns.max() <= 0:
        return None
    keep_x = np.nonzero(columns > CONTENT_RELATIVE_MASS * columns.max())[0]
    keep_y = np.nonzero(rows > CONTENT_RELATIVE_MASS * rows.max())[0]
    if not keep_x.size or not keep_y.size:
        return None
    return int(keep_x[0]), int(keep_y[0]), int(keep_x[-1]) + 1, int(keep_y[-1]) + 1


def checkerboard(size: tuple[int, int], cell: int = 12) -> Image.Image:
    w, h = size
    board = Image.new("RGB", (w, h), (204, 204, 204))
    draw = ImageDraw.Draw(board)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if ((x // cell) + (y // cell)) % 2 == 0:
                draw.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(153, 153, 153))
    return board


def composite_over(image: Image.Image, ground: Image.Image) -> Image.Image:
    return Image.alpha_composite(ground.convert("RGBA"), image).convert("RGB")


def busiest_edge_window(partial_mask: np.ndarray, win: int) -> tuple[int, int]:
    """Top-left corner of the win x win window with the most partial-alpha pixels."""
    h, w = partial_mask.shape
    win = min(win, h, w)
    integral = np.zeros((h + 1, w + 1), dtype=np.int64)
    integral[1:, 1:] = np.cumsum(np.cumsum(partial_mask.astype(np.int64), axis=0), axis=1)
    # Sum over every win x win window via the integral image, vectorized.
    sums = (
        integral[win:, win:]
        - integral[:-win, win:]
        - integral[win:, :-win]
        + integral[:-win, :-win]
    )
    if sums.size == 0 or sums.max() == 0:
        return max(0, (h - win) // 2), max(0, (w - win) // 2)
    flat = int(np.argmax(sums))
    y0, x0 = divmod(flat, sums.shape[1])
    return y0, x0


def label_panel(panel: Image.Image, text: str) -> Image.Image:
    canvas = Image.new("RGB", (panel.width, panel.height + 18), (32, 32, 32))
    canvas.paste(panel, (0, 18))
    draw = ImageDraw.Draw(canvas)
    draw.text((2, 2), text, fill=(230, 230, 230), font=ImageFont.load_default())
    return canvas


def fit_thumb(image: Image.Image, size: int = THUMB) -> Image.Image:
    scale = min(1.0, size / max(image.width, image.height))
    if scale >= 1.0:
        return image
    dims = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(dims, Image.Resampling.LANCZOS)


def build_sheet(image: Image.Image, alpha: np.ndarray, partial_mask: np.ndarray) -> Image.Image:
    w, h = image.size

    light = fit_thumb(composite_over(image, Image.new("RGB", (w, h), (245, 245, 245))))
    dark = fit_thumb(composite_over(image, Image.new("RGB", (w, h), (24, 24, 24))))
    check = fit_thumb(composite_over(image, checkerboard((w, h))))
    alpha_view = fit_thumb(Image.fromarray(alpha, "L").convert("RGB"))

    # Keep the window small enough that the panel is genuinely magnified: sized
    # to a quarter of the image it came out at 1x, which magnified nothing.
    win = max(24, min(w, h, THUMB // 2))
    y0, x0 = busiest_edge_window(partial_mask, win)
    crop = image.crop((x0, y0, min(w, x0 + win), min(h, y0 + win)))
    # Composite it like every other panel. Chroma-matte leaves the key color in
    # the RGB under transparent pixels, so showing the crop raw paints them
    # solid key and a clean cutout reads as a failed one.
    crop = composite_over(crop, checkerboard(crop.size))
    zoom = max(2, THUMB // max(crop.width, crop.height))
    zoomed = crop.resize((crop.width * zoom, crop.height * zoom), Image.Resampling.NEAREST)

    panels = [
        label_panel(light, "on light"),
        label_panel(dark, "on dark"),
        label_panel(check, "on checkerboard"),
        label_panel(alpha_view, "alpha channel"),
        label_panel(zoomed, f"busiest edge, {zoom}x zoom"),
    ]

    cell_w = max(p.width for p in panels) + PAD
    cell_h = max(p.height for p in panels) + PAD
    cols = 3
    rows = (len(panels) + cols - 1) // cols
    sheet = Image.new("RGB", (cell_w * cols, cell_h * rows), (16, 16, 16))
    for i, panel in enumerate(panels):
        row, col = divmod(i, cols)
        sheet.paste(panel, (col * cell_w + PAD // 2, row * cell_h + PAD // 2))
    return sheet


def inspect(input_path: Path, out_path: Path, key: np.ndarray | None) -> dict:
    image = load_rgba(input_path)
    arr = np.asarray(image).astype(np.float32)
    rgb = arr[..., :3]
    alpha_f = arr[..., 3]
    alpha_u8 = alpha_f.astype(np.uint8)
    total = alpha_f.size

    opaque_mask = alpha_f >= 255
    transparent_mask = alpha_f <= 0
    partial_mask = ~opaque_mask & ~transparent_mask

    key_rgb = key if key is not None else sample_key(rgb)

    reached = flood_fill_from_border(transparent_mask)
    holes_mask = transparent_mask & ~reached
    # Single-pixel gaps between antialiased strands are not holes anyone cares
    # about, so report the ones big enough to read as deliberate.
    hole_sizes = [size for size in component_sizes(holes_mask) if size >= MIN_HOLE_PIXELS]
    hole_count = len(hole_sizes)
    hole_pixels = int(sum(hole_sizes))

    spill = measure_spill(rgb, alpha_f, key_rgb)

    bbox = content_bbox(alpha_f)
    if bbox is None:
        bbox_x0 = bbox_y0 = bbox_x1 = bbox_y1 = 0
        clipped = False
    else:
        bbox_x0, bbox_y0, bbox_x1, bbox_y1 = bbox
        # Real clipping presents a run of solid pixels along a border line.
        solid = alpha_f >= 128
        clipped = any(
            int(edge.sum()) >= EDGE_TOUCH_MIN
            for edge in (solid[0, :], solid[-1, :], solid[:, 0], solid[:, -1])
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet = build_sheet(image, alpha_u8, partial_mask)
    sheet.save(out_path)

    return {
        "width": image.width,
        "height": image.height,
        "fraction_opaque": round(float(opaque_mask.sum()) / total, 4),
        "fraction_transparent": round(float(transparent_mask.sum()) / total, 4),
        "fraction_partial": round(float(partial_mask.sum()) / total, 4),
        "interior_hole_count": hole_count,
        "interior_hole_pixels": hole_pixels,
        "largest_holes": hole_sizes[:5],
        **spill,
        "key_hex": f"#{int(key_rgb[0]):02x}{int(key_rgb[1]):02x}{int(key_rgb[2]):02x}",
        "bbox_x0": bbox_x0,
        "bbox_y0": bbox_y0,
        "bbox_x1": bbox_x1,
        "bbox_y1": bbox_y1,
        "content_clipped": bool(clipped),
        "sheet_path": str(out_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", type=Path, help="Contact sheet PNG. Defaults to <input>.inspect.png")
    parser.add_argument("--key", help="Key color for spill measurement, e.g. #00ff00. Defaults to border median.")
    args = parser.parse_args()

    try:
        key = parse_rgb(args.key)
    except ValueError as exc:
        raise SystemExit(f"error: {exc}")

    out_path = args.out or args.input.with_name(args.input.stem + ".inspect.png")
    report = inspect(args.input, out_path, key)
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
