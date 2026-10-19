"""9x9 palace: cell indexing and selection parse."""

from __future__ import annotations

import json
import math
from typing import Any, Sequence

GRID_SIZE = 9


def clamp_index(value: int, grid: int = GRID_SIZE) -> int:
    return max(0, min(int(value), grid - 1))


def cell_pixel_span(index: int, n_cells: int, size: int) -> tuple[int, int]:
    start = (int(index) * int(size)) // int(n_cells)
    end = ((int(index) + 1) * int(size)) // int(n_cells)
    return start, max(start + 1, end)


def cell_to_pixel_bbox(
    row: int,
    col: int,
    width: int,
    height: int,
    grid: int = GRID_SIZE,
) -> tuple[int, int, int, int]:
    row = clamp_index(row, grid)
    col = clamp_index(col, grid)
    x1, x2 = cell_pixel_span(col, grid, width)
    y1, y2 = cell_pixel_span(row, grid, height)
    return x1, y1, x2, y2


def union_pixel_bbox(
    cells: Sequence[dict[str, int]],
    width: int,
    height: int,
    grid: int = GRID_SIZE,
) -> tuple[int, int, int, int]:
    boxes = [cell_to_pixel_bbox(c["row"], c["col"], width, height, grid) for c in cells]
    if not boxes:
        return 0, 0, width, height
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def _as_cell(item: Any) -> dict[str, int] | None:
    if isinstance(item, dict):
        if "row" in item and "col" in item:
            return {"row": int(item["row"]), "col": int(item["col"])}
        if "r" in item and "c" in item:
            return {"row": int(item["r"]), "col": int(item["c"])}
        return None
    if isinstance(item, (list, tuple)) and len(item) >= 2:
        return {"row": int(item[0]), "col": int(item[1])}
    return None


def parse_selection(raw: Any, grid: int = GRID_SIZE) -> list[dict[str, int]]:
    data: Any = raw
    if raw is None or raw == "":
        data = {}
    elif isinstance(raw, (bytes, bytearray)):
        data = raw.decode("utf-8")
    if isinstance(data, str):
        text = data.strip()
        if not text:
            data = {}
        else:
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                data = {}

    cells: list[dict[str, int]] = []
    if isinstance(data, dict):
        if "cells" in data and isinstance(data["cells"], list):
            for item in data["cells"]:
                cell = _as_cell(item)
                if cell:
                    cells.append(cell)
        else:
            cell = _as_cell(data)
            if cell:
                cells.append(cell)
    elif isinstance(data, list):
        for item in data:
            cell = _as_cell(item)
            if cell:
                cells.append(cell)

    unique: list[dict[str, int]] = []
    seen: set[tuple[int, int]] = set()
    for cell in cells:
        row = clamp_index(cell["row"], grid)
        col = clamp_index(cell["col"], grid)
        key = (row, col)
        if key in seen:
            continue
        seen.add(key)
        unique.append({"row": row, "col": col})
    if not unique:
        unique.append({"row": grid // 2, "col": grid // 2})
    return unique


def _wrap_pi(angle: float) -> float:
    a = float(angle)
    while a <= -math.pi:
        a += 2.0 * math.pi
    while a > math.pi:
        a -= 2.0 * math.pi
    return a


def _angle_sep(a: float, b: float) -> float:
    d = abs(_wrap_pi(a - b))
    return min(d, 2.0 * math.pi - d)


def default_ray_angles(vx: float, vy: float) -> list[float]:
    """Rays from the VP toward the bottom-left and bottom-right of the frame."""
    return [
        math.atan2(1.0 - vy, 0.0 - vx),
        math.atan2(1.0 - vy, 1.0 - vx),
    ]


def _separate_angles(a0: float, a1: float) -> list[float]:
    min_sep = math.radians(15.0)
    max_sep = math.radians(170.0)
    a0, a1 = _wrap_pi(a0), _wrap_pi(a1)
    d = _angle_sep(a0, a1)
    if d < min_sep:
        sign = 1.0 if _wrap_pi(a1 - a0) >= 0.0 else -1.0
        a1 = _wrap_pi(a0 + sign * min_sep)
    elif d > max_sep:
        sign = 1.0 if _wrap_pi(a1 - a0) >= 0.0 else -1.0
        a1 = _wrap_pi(a0 + sign * max_sep)
    return [a0, a1]


def _clamp_xy(vx: float, vy: float) -> list[float]:
    return [min(3.0, max(-2.0, float(vx))), min(3.0, max(-2.0, float(vy)))]


def default_two_vps(horizon: float = 0.42) -> list[list[float]]:
    return [[-0.2, horizon], [1.2, horizon]]


def camera_pairs(camera: dict[str, Any]) -> list[tuple[list[float], list[float]]]:
    """Return [(vp, angles), ...] — one pair for 1-point, two for 2-point."""
    if camera.get("two_point") and camera.get("vps") and camera.get("angle_pairs"):
        out = []
        for vp, ang in zip(camera["vps"], camera["angle_pairs"]):
            out.append((list(vp), list(ang)))
        return out
    return [(list(camera["vp"]), list(camera["angles"]))]


def parse_camera(raw: Any, mode: str = "") -> dict[str, Any]:
    """VP(s) in image uv (may be outside [0,1]) plus ray angles in uv-space.

    1-point: one VP + two rays. 2-point: two VPs locked to one horizon, two
    rays each. Ground is the intersection of those sectors.
    """
    data: Any = raw
    if isinstance(raw, (bytes, bytearray)):
        data = raw.decode("utf-8")
    if isinstance(data, str):
        try:
            data = json.loads(data.strip() or "{}")
        except json.JSONDecodeError:
            data = {}
    if not isinstance(data, dict):
        data = {}

    two = "2" in (mode or "") or "兩" in (mode or "") or "两" in (mode or "")

    if "vp" not in data and "vps" not in data:
        horizon = float(data.get("horizon", 0.42))
        vanish_raw = data.get("vanish", data.get("vanish_x", 0.5))
        xs: list[float] = []
        if isinstance(vanish_raw, (list, tuple)):
            xs = [float(v) for v in vanish_raw]
        else:
            xs = [float(vanish_raw)]
        if two:
            if len(xs) < 2:
                vps = default_two_vps(horizon)
            else:
                vps = [_clamp_xy(xs[0], horizon), _clamp_xy(xs[-1], horizon)]
            data = {
                "vps": vps,
                "angle_pairs": [default_ray_angles(*vps[0]), default_ray_angles(*vps[1])],
                "vp": vps[0],
                "angles": default_ray_angles(*vps[0]),
            }
        else:
            vx = xs[0] if xs else 0.5
            data = {"vp": [vx, horizon], "angles": default_ray_angles(vx, horizon)}

    vp_raw = data.get("vp", [0.5, 0.42])
    if not isinstance(vp_raw, (list, tuple)) or len(vp_raw) < 2:
        vp_raw = [0.5, 0.42]
    vx, vy = _clamp_xy(vp_raw[0], vp_raw[1])

    angles_raw = data.get("angles")
    if not isinstance(angles_raw, (list, tuple)) or len(angles_raw) < 2:
        angles = default_ray_angles(vx, vy)
    else:
        angles = _separate_angles(float(angles_raw[0]), float(angles_raw[1]))

    vps_raw = data.get("vps")
    pairs_raw = data.get("angle_pairs")
    if two:
        if not isinstance(vps_raw, (list, tuple)) or len(vps_raw) < 2:
            vps = default_two_vps(vy)
        else:
            vps = [_clamp_xy(vps_raw[0][0], vps_raw[0][1]), _clamp_xy(vps_raw[1][0], vps_raw[1][1])]
        hy = vps[0][1]
        vps[0][1] = hy
        vps[1][1] = hy
        if not isinstance(pairs_raw, (list, tuple)) or len(pairs_raw) < 2:
            angle_pairs = [default_ray_angles(*vps[0]), default_ray_angles(*vps[1])]
        else:
            angle_pairs = [
                _separate_angles(float(pairs_raw[0][0]), float(pairs_raw[0][1])),
                _separate_angles(float(pairs_raw[1][0]), float(pairs_raw[1][1])),
            ]
        if vps[0][0] > vps[1][0]:
            vps[0], vps[1] = vps[1], vps[0]
            angle_pairs[0], angle_pairs[1] = angle_pairs[1], angle_pairs[0]
        if abs(vps[1][0] - vps[0][0]) < 0.12:
            vps[1][0] = min(3.0, vps[0][0] + 0.12)
        return {
            "vp": vps[0],
            "angles": angle_pairs[0],
            "vps": vps,
            "angle_pairs": angle_pairs,
            "horizon": hy,
            "vanish": [vps[0][0], vps[1][0]],
            "two_point": True,
        }

    if isinstance(vps_raw, (list, tuple)) and len(vps_raw) >= 2:
        mx = 0.5 * (float(vps_raw[0][0]) + float(vps_raw[1][0]))
        my = float(vps_raw[0][1])
        vx, vy = _clamp_xy(mx, my)
        angles = default_ray_angles(vx, vy)

    return {
        "vp": [vx, vy],
        "angles": angles,
        "horizon": vy,
        "vanish": [vx],
        "two_point": False,
    }
