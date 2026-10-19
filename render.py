"""Filled inverse-depth scaffold: ground / sky / occupancy, no construction lines."""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np
from PIL import Image, ImageDraw

try:
    from .grid import camera_pairs, union_pixel_bbox
    from .prompt import normalize_primitive
except ImportError:
    from grid import camera_pairs, union_pixel_bbox
    from prompt import normalize_primitive


def _clip(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def _toward(px: float, py: float, vx: float, vy: float, t: float) -> tuple[float, float]:
    return px + (vx - px) * t, py + (vy - py) * t


def _edge_inside(
    xx: np.ndarray,
    yy: np.ndarray,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    refx: float,
    refy: float,
    feather: float,
) -> np.ndarray:
    """Soft weight in [0,1]: 1 on the same side of A→B as the reference point."""
    lx = bx - ax
    ly = by - ay
    length = float(np.hypot(lx, ly)) + 1e-6
    dist = ((xx - ax) * ly - (yy - ay) * lx) / length
    ref = ((refx - ax) * ly - (refy - ay) * lx) / length
    dist = dist * np.sign(ref + 1e-9)
    return np.clip(dist / max(feather, 1.0), 0.0, 1.0)


def _sector_mask(
    xx: np.ndarray,
    yy: np.ndarray,
    width: int,
    height: int,
    vp: Sequence[float],
    angles: Sequence[float],
    near_x: float,
    near_y: float,
    feather: float,
) -> np.ndarray:
    vx = float(vp[0]) * (width - 1)
    vy = float(vp[1]) * (height - 1)
    a0, a1 = float(angles[0]), float(angles[1])
    span = 8.0 * max(width, height)
    b0x = vx + math.cos(a0) * (width - 1) * span
    b0y = vy + math.sin(a0) * (height - 1) * span
    b1x = vx + math.cos(a1) * (width - 1) * span
    b1y = vy + math.sin(a1) * (height - 1) * span
    w0 = _edge_inside(xx, yy, vx, vy, b0x, b0y, near_x, near_y, feather)
    w1 = _edge_inside(xx, yy, vx, vy, b1x, b1y, near_x, near_y, feather)
    return w0 * w1


def _planes(width: int, height: int, camera: dict[str, Any]) -> np.ndarray:
    """Sky plus the sector (1-point) or the overlap of two sectors (2-point).

    2-point ground is the intersection of the two fans (a quad / degenerate
    triangle), clipped below the shared horizon. Gradient is stretched
    across that overlap so near=white and far=gray even when the tile is small.
    """
    yy, xx = np.indices((height, width), dtype=np.float32)
    sky = np.full((height, width), 0.06, dtype=np.float32)
    sky += 0.06 * np.clip(1.0 - yy / max(float(height - 1), 1.0), 0.0, 1.0)
    near_x = 0.5 * (width - 1)
    near_y = float(height - 1)
    feather = max(4.0, 0.008 * max(width, height))
    pairs = camera_pairs(camera)
    mask = np.ones((height, width), dtype=np.float32)
    far_x = 0.0
    far_y = 0.0
    for vp, angles in pairs:
        mask = mask * _sector_mask(xx, yy, width, height, vp, angles, near_x, near_y, feather)
        far_x += float(vp[0]) * (width - 1)
        far_y += float(vp[1]) * (height - 1)
    n = max(len(pairs), 1)
    far_x /= n
    far_y /= n
    if len(pairs) >= 2:
        mask = mask * np.clip((yy - far_y) / max(feather, 1.0), 0.0, 1.0)
    ax = near_x - far_x
    ay = near_y - far_y
    denom = ax * ax + ay * ay + 1e-6
    along = np.clip(((xx - far_x) * ax + (yy - far_y) * ay) / denom, 0.0, 1.0)
    inside = mask > 0.05
    if np.any(inside):
        lo = float(along[inside].min())
        hi = float(along[inside].max())
        if hi - lo > 1e-4:
            along = np.clip((along - lo) / (hi - lo), 0.0, 1.0)
        else:
            along = np.where(inside, 1.0, along)
    ground = 0.18 + 0.82 * along
    return (sky * (1.0 - mask) + ground * mask).astype(np.float32)


def _shade_sphere(canvas: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> None:
    h, w = canvas.shape
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return
    yy, xx = np.ogrid[y1:y2, x1:x2]
    cx = 0.5 * (x1 + x2 - 1)
    cy = 0.5 * (y1 + y2 - 1)
    rx = max(1.0, 0.5 * (x2 - x1))
    ry = max(1.0, 0.5 * (y2 - y1))
    nx = (xx - cx) / rx
    ny = (yy - cy) / ry
    r2 = nx * nx + ny * ny
    mask = r2 <= 1.0
    nz = np.sqrt(np.clip(1.0 - r2, 0.0, 1.0))
    light = np.clip(0.40 + 0.60 * (-0.35 * nx - 0.45 * ny + 0.80 * nz), 0.20, 1.0)
    region = canvas[y1:y2, x1:x2]
    region[mask] = light[mask]


def _blit_gray(canvas: np.ndarray, overlay: Image.Image) -> None:
    src = np.asarray(overlay, dtype=np.float32) / 255.0
    canvas[:] = np.where(src > 0.0, src, canvas)


def _fill_poly(draw: ImageDraw.ImageDraw, pts: Sequence[tuple[float, float]], fill: int) -> None:
    if len(pts) < 3:
        return
    draw.polygon([(int(round(p[0])), int(round(p[1]))) for p in pts], fill=fill)


def _draw_box(
    draw: ImageDraw.ImageDraw,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    vanish: Sequence[tuple[float, float]],
    two_point: bool,
) -> None:
    if two_point and len(vanish) >= 2:
        vl, vr = vanish[0], vanish[-1]
        rec = 0.32
        bl, br = (x1, y2), (x2, y2)
        tl, tr = (x1, y1), (x2, y1)
        bl2 = _toward(bl[0], bl[1], vl[0], vl[1], rec)
        br2 = _toward(br[0], br[1], vr[0], vr[1], rec)
        tl2 = _toward(tl[0], tl[1], vl[0], vl[1], rec)
        tr2 = _toward(tr[0], tr[1], vr[0], vr[1], rec)
        _fill_poly(draw, [bl2, br2, tr2, tl2], 110)
        _fill_poly(draw, [br, br2, tr2, tr], 150)
        _fill_poly(draw, [bl, br, tr, tl], 220)
        return
    vp = vanish[0]
    rec = 0.28
    back = [
        _toward(x1, y1, vp[0], vp[1], rec),
        _toward(x2, y1, vp[0], vp[1], rec),
        _toward(x2, y2, vp[0], vp[1], rec),
        _toward(x1, y2, vp[0], vp[1], rec),
    ]
    _fill_poly(draw, back, 100)
    _fill_poly(draw, [(x2, y1), back[1], back[2], (x2, y2)], 145)
    _fill_poly(draw, [(x1, y1), (x2, y1), (x2, y2), (x1, y2)], 225)


def _draw_cylinder(draw: ImageDraw.ImageDraw, x1: float, y1: float, x2: float, y2: float) -> None:
    rx = 0.5 * (x2 - x1)
    cx = 0.5 * (x1 + x2)
    cap = max(4.0, (x2 - x1) * 0.22)
    _fill_poly(
        draw,
        [(x1, y1 + cap * 0.5), (x2, y1 + cap * 0.5), (x2, y2 - cap * 0.5), (x1, y2 - cap * 0.5)],
        190,
    )
    draw.ellipse([cx - rx, y2 - cap, cx + rx, y2], fill=130)
    draw.ellipse([cx - rx, y1, cx + rx, y1 + cap], fill=230)


def render_layout(
    width: int,
    height: int,
    cells: Sequence[dict[str, int]],
    mode: str,
    primitive: str,
    camera: dict[str, Any],
    use_subject: bool = True,
) -> np.ndarray:
    """Return float32 RGB (H, W, 3) in [0, 1]."""
    width = max(16, int(width))
    height = max(16, int(height))
    two = bool(camera.get("two_point")) or "2" in (mode or "") or "兩" in (mode or "")
    arr = _planes(width, height, camera)
    if not use_subject or not cells:
        rgb = np.repeat(np.clip(arr, 0.0, 1.0)[..., None], 3, axis=2)
        return rgb.astype(np.float32)

    x1, y1, x2, y2 = union_pixel_bbox(cells, width, height)
    pad = 2
    x1, y1, x2, y2 = x1 - pad, y1 - pad, x2 + pad, y2 + pad
    kind = normalize_primitive(primitive)
    vps = [
        (float(vp[0]) * (width - 1), float(vp[1]) * (height - 1))
        for vp, _ in camera_pairs(camera)
    ]
    if kind == "sphere":
        _shade_sphere(arr, int(x1), int(y1), int(x2), int(y2))
    else:
        overlay = Image.new("L", (width, height), 0)
        od = ImageDraw.Draw(overlay)
        if kind == "box":
            _draw_box(od, x1, y1, x2, y2, vps, two)
        else:
            _draw_cylinder(od, x1, y1, x2, y2)
        _blit_gray(arr, overlay)

    rgb = np.repeat(np.clip(arr, 0.0, 1.0)[..., None], 3, axis=2)
    return rgb.astype(np.float32)
