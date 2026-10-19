"""Palace Perspective: rotatable 1-point rays + occupancy layout + concat prompt."""

from __future__ import annotations

import json

import torch

from .grid import parse_camera, parse_selection
from .prompt import compose_prompt, occupancy_clause, perspective_clause, slot_phrase
from .render import render_layout


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "on", "yes", "主體"}


MAX_RESOLUTION = 16384

PERSPECTIVE_CHOICES = [
    "1-point (一點透視)",
    "2-point (兩點透視)",
]

PRIMITIVE_CHOICES = [
    "Sphere (球體)",
    "Box (方體)",
    "Cylinder (圓柱體)",
]

DEFAULT_CAMERA = '{"vp":[0.5,0.42],"angles":[0.859,2.283]}'


class PalacePerspective:
    """User types background + perspective; optional subject occupancy on the 9x9."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "background_prompt": (
                    "STRING",
                    {
                        "forceInput": True,
                        "multiline": True,
                        "dynamicPrompts": True,
                        "default": "",
                    },
                ),
                "perspective_mode": (PERSPECTIVE_CHOICES, {"default": PERSPECTIVE_CHOICES[0]}),
                "primitive": (PRIMITIVE_CHOICES, {"default": PRIMITIVE_CHOICES[2]}),
                "width": (
                    "INT",
                    {"default": 832, "min": 16, "max": MAX_RESOLUTION, "step": 8},
                ),
                "height": (
                    "INT",
                    {"default": 1216, "min": 16, "max": MAX_RESOLUTION, "step": 8},
                ),
            },
            "optional": {
                "grid_selection": (
                    "STRING",
                    {
                        "default": '{"grid":9,"cells":[{"row":4,"col":4}]}',
                        "multiline": False,
                        "hidden": True,
                        "socketless": True,
                    },
                ),
                "camera_lines": (
                    "STRING",
                    {
                        "default": DEFAULT_CAMERA,
                        "multiline": False,
                        "hidden": True,
                        "socketless": True,
                    },
                ),
                "subject": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "label_on": "on",
                        "label_off": "off",
                        "tooltip": "On: pick palace cells and emit occupancy. Off: perspective only.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "IMAGE", "STRING")
    RETURN_NAMES = ("prompt", "layout_image", "brief")
    FUNCTION = "run"
    CATEGORY = "conditioning / palace_perspective"
    DESCRIPTION = (
        "9x9 palace plus rotatable rays. Subject toggle: on = pick cells + occupancy, "
        "off = perspective only. 1-point: two rays, one VP. "
        "2-point: two colored pairs on a shared horizon; ground is their overlapping quad. "
        "VPs may sit off-frame. Background stays verbatim. layout_image → spatial ControlNet / LLLite."
    )

    def run(
        self,
        background_prompt,
        perspective_mode,
        primitive,
        width,
        height,
        grid_selection="",
        camera_lines="",
        subject=True,
    ):
        use_subject = _as_bool(subject)
        cells = parse_selection(grid_selection) if use_subject else []
        cam = parse_camera(camera_lines, perspective_mode)
        prompt = compose_prompt(
            background_prompt or "",
            perspective_mode,
            primitive,
            cells,
            cam,
            int(width),
            int(height),
            use_subject=use_subject,
        )
        layout_np = render_layout(
            int(width),
            int(height),
            cells,
            perspective_mode,
            primitive,
            cam,
            use_subject=use_subject,
        )
        layout = torch.from_numpy(layout_np).unsqueeze(0)
        occ = (
            occupancy_clause(primitive, cells, cam, int(width), int(height))
            if use_subject
            else ""
        )
        brief = {
            "perspective": "2-point" if cam["two_point"] else "1-point",
            "subject": use_subject,
            "vp": cam["vp"],
            "angles": cam["angles"],
            "vps": cam.get("vps"),
            "angle_pairs": cam.get("angle_pairs"),
            "primitive": primitive if use_subject else None,
            "cells": cells,
            "slot": slot_phrase(cells, int(width), int(height)) if use_subject else "",
            "perspective_clause": perspective_clause(perspective_mode, cam),
            "occupancy_clause": occ,
        }
        print(f"[PalacePerspective] vp={cam['vp']} subject={use_subject} {occ}")
        return (prompt, layout, json.dumps(brief, ensure_ascii=False, indent=2))


NODE_CLASS_MAPPINGS = {
    "PalacePerspective": PalacePerspective,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PalacePerspective": "Palace Perspective",
}
