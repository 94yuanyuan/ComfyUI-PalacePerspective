"""Concatenate background (verbatim) with perspective + occupancy clauses."""

from __future__ import annotations

from typing import Any, Sequence

try:
    from .grid import union_pixel_bbox
except ImportError:
    from grid import union_pixel_bbox

H_BAND = ("left", "center", "right")
V_BAND = ("upper", "middle", "lower")

SLOT = {
    ("upper", "left"): "in the upper-left of the frame",
    ("upper", "center"): "along the top-center of the frame",
    ("upper", "right"): "in the upper-right of the frame",
    ("middle", "left"): "on the left side of the frame",
    ("middle", "center"): "in the center of the frame",
    ("middle", "right"): "on the right side of the frame",
    ("lower", "left"): "in the lower-left of the frame",
    ("lower", "center"): "along the bottom-center of the frame",
    ("lower", "right"): "in the lower-right of the frame",
}

PRIMITIVE_NOUN = {
    "sphere": "sphere",
    "ball": "sphere",
    "球": "sphere",
    "box": "box",
    "cube": "box",
    "方": "box",
    "cylinder": "cylinder",
    "圓柱": "cylinder",
    "圆柱": "cylinder",
}


def normalize_primitive(raw: str) -> str:
    text = (raw or "").strip().lower()
    for key, noun in PRIMITIVE_NOUN.items():
        if key in text:
            return noun
    return "cylinder"


def is_two_point(mode: str) -> bool:
    text = mode or ""
    return "2" in text or "兩" in text or "两" in text


def slot_phrase(cells: Sequence[dict[str, int]], width: int = 1024, height: int = 1024) -> str:
    x1, y1, x2, y2 = union_pixel_bbox(cells, width, height)
    cx = 0.5 * (x1 + x2) / max(1, width)
    cy = 0.5 * (y1 + y2) / max(1, height)
    h = H_BAND[0 if cx < 1 / 3 else 1 if cx < 2 / 3 else 2]
    v = V_BAND[0 if cy < 1 / 3 else 1 if cy < 2 / 3 else 2]
    return SLOT[(v, h)]


def _vp_phrase(vx: float, vy: float) -> str:
    if vx < 0.0:
        xpart = "off-frame left"
    elif vx > 1.0:
        xpart = "off-frame right"
    elif vx < 0.34:
        xpart = "on the left"
    elif vx > 0.66:
        xpart = "on the right"
    else:
        xpart = "at the center"
    if vy < 0.0:
        ypart = "above the frame"
    elif vy > 1.0:
        ypart = "below the frame"
    elif vy >= 0.62:
        ypart = "low horizon"
    elif vy <= 0.32:
        ypart = "high horizon"
    else:
        ypart = "eye-level horizon"
    return xpart, ypart


def perspective_clause(mode: str, camera: dict[str, Any]) -> str:
    if camera.get("two_point") and camera.get("vps"):
        left, right = camera["vps"][0], camera["vps"][1]
        lx, ypart = _vp_phrase(float(left[0]), float(left[1]))
        rx, _ = _vp_phrase(float(right[0]), float(right[1]))
        return f"2-point perspective, vanishing points {lx} and {rx}, {ypart}"
    vx, vy = camera["vp"]
    xpart, ypart = _vp_phrase(float(vx), float(vy))
    return f"1-point perspective, vanishing point {xpart}, {ypart}"


def occupancy_clause(
    primitive: str,
    cells: Sequence[dict[str, int]],
    camera: dict[str, Any],
    width: int,
    height: int,
) -> str:
    noun = normalize_primitive(primitive)
    x1, y1, x2, y2 = union_pixel_bbox(cells, width, height)
    foot_y = y2 / max(1, height)
    horizon = float(camera.get("horizon", camera["vp"][1]))
    pose = "floating" if foot_y < horizon - 0.02 else "standing"
    slot = slot_phrase(cells, width, height)
    return f"a {noun} {pose} {slot}"


def compose_prompt(
    background: str,
    mode: str,
    primitive: str,
    cells: Sequence[dict[str, int]],
    camera: dict[str, Any],
    width: int,
    height: int,
    use_subject: bool = True,
) -> str:
    """Background stays verbatim. Perspective and occupancy are appended as new lines."""
    lines: list[str] = []
    scene = (background or "").rstrip()
    if scene:
        lines.append(scene)
    lines.append(perspective_clause(mode, camera))
    if use_subject:
        lines.append(occupancy_clause(primitive, cells, camera, width, height))
    return "\n".join(lines)
