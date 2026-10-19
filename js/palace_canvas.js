import { app } from "../../scripts/app.js";

const NODE_NAMES = new Set(["PalacePerspective"]);
const GRID = 9;
const GRID_H = 400;
const GRID_SLOT = GRID_H;
const PAD = 8;
const HIT = 10;
const MIN_SEP = (15 * Math.PI) / 180;
const MAX_SEP = (170 * Math.PI) / 180;
const VIEW_MIN = -0.5;
const VIEW_SPAN = 2.0;

const COLORS = {
  panel: "#12141a",
  panelEdge: "rgba(120, 210, 255, 0.45)",
  margin: "rgba(0, 0, 0, 0.35)",
  minor: "rgba(180, 200, 220, 0.22)",
  major: "rgba(180, 200, 220, 0.55)",
  fill: "rgba(80, 200, 255, 0.28)",
  hover: "rgba(255, 255, 255, 0.10)",
  preview: "rgba(80, 220, 180, 0.28)",
  rayA: "#3ee0ff",
  rayB: "#ff5ad5",
  groundFar: "rgba(110, 118, 132, 0.72)",
  groundNear: "rgba(245, 248, 255, 0.82)",
  horizon: "rgba(255, 255, 255, 0.45)",
  vp: "#ffe56a",
  text: "#e8f4ff",
  muted: "rgba(232, 244, 255, 0.6)",
};
const PAIR_COLORS = [COLORS.rayA, COLORS.rayB];
const MIN_VP_SEP = 0.12;

function parseCells(raw) {
  let data = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) data = {};
    else {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }
  }
  const cells = [];
  const push = (row, col) => {
    const r = Math.max(0, Math.min(GRID - 1, Number(row)));
    const c = Math.max(0, Math.min(GRID - 1, Number(col)));
    if (Number.isFinite(r) && Number.isFinite(c)) cells.push({ row: r, col: c });
  };
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object") push(item.row ?? item.r, item.col ?? item.c);
    }
  } else if (data && typeof data === "object") {
    if (Array.isArray(data.cells)) {
      for (const item of data.cells) {
        if (item && typeof item === "object") push(item.row ?? item.r, item.col ?? item.c);
      }
    } else if ("row" in data && "col" in data) {
      push(data.row, data.col);
    }
  }
  const seen = new Set();
  const unique = [];
  for (const cell of cells) {
    const key = `${cell.row},${cell.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cell);
  }
  return unique.length ? unique : [{ row: 4, col: 4 }];
}

function serializeCells(cells) {
  return JSON.stringify({ grid: GRID, cells });
}

function wrapPi(a) {
  let x = a;
  while (x <= -Math.PI) x += 2 * Math.PI;
  while (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

function angleSep(a, b) {
  const d = Math.abs(wrapPi(a - b));
  return Math.min(d, 2 * Math.PI - d);
}

function defaultAngles(vx, vy) {
  return [Math.atan2(1 - vy, 0 - vx), Math.atan2(1 - vy, 1 - vx)];
}

function clampUv(x, y) {
  return [
    Math.min(3, Math.max(-2, Number.isFinite(Number(x)) ? Number(x) : 0.5)),
    Math.min(3, Math.max(-2, Number.isFinite(Number(y)) ? Number(y) : 0.42)),
  ];
}

function defaultTwoVps(hy) {
  const y = Number.isFinite(Number(hy)) ? Number(hy) : 0.42;
  return [
    [-0.2, y],
    [1.2, y],
  ];
}

function defaultCamera(two) {
  if (two) {
    const vps = defaultTwoVps(0.42);
    const angle_pairs = [defaultAngles(vps[0][0], vps[0][1]), defaultAngles(vps[1][0], vps[1][1])];
    return {
      vp: vps[0],
      angles: angle_pairs[0],
      vps,
      angle_pairs,
      two_point: true,
    };
  }
  const vp = [0.5, 0.42];
  return { vp, angles: defaultAngles(vp[0], vp[1]), two_point: false };
}

function separateAngles(a0, a1, editIndex) {
  let a = [wrapPi(a0), wrapPi(a1)];
  const i = editIndex === 0 || editIndex === 1 ? editIndex : 1;
  const j = 1 - i;
  const d = angleSep(a[0], a[1]);
  if (d < MIN_SEP) {
    const sign = wrapPi(a[i] - a[j]) >= 0 ? 1 : -1;
    a[i] = wrapPi(a[j] + sign * MIN_SEP);
  } else if (d > MAX_SEP) {
    const sign = wrapPi(a[i] - a[j]) >= 0 ? 1 : -1;
    a[i] = wrapPi(a[j] + sign * MAX_SEP);
  }
  return a;
}

function lockTwoVps(vpsIn, pairsIn) {
  let left = clampUv(vpsIn?.[0]?.[0], vpsIn?.[0]?.[1]);
  let right = clampUv(vpsIn?.[1]?.[0], vpsIn?.[1]?.[1]);
  const hy = left[1];
  right[1] = hy;
  const pair0 = Array.isArray(pairsIn?.[0]) && pairsIn[0].length >= 2 ? pairsIn[0] : defaultAngles(left[0], left[1]);
  const pair1 = Array.isArray(pairsIn?.[1]) && pairsIn[1].length >= 2 ? pairsIn[1] : defaultAngles(right[0], right[1]);
  let pairs = [
    separateAngles(Number(pair0[0]), Number(pair0[1]), 1),
    separateAngles(Number(pair1[0]), Number(pair1[1]), 1),
  ];
  if (left[0] > right[0]) {
    const swapVp = left;
    left = right;
    right = swapVp;
    pairs = [pairs[1], pairs[0]];
  }
  if (right[0] - left[0] < MIN_VP_SEP) right[0] = Math.min(3, left[0] + MIN_VP_SEP);
  return {
    vp: left,
    angles: pairs[0],
    vps: [left, right],
    angle_pairs: pairs,
    two_point: true,
  };
}

function parseCamera(raw, two) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw.trim() || "{}");
    } catch {
      data = {};
    }
  }
  if (!data || typeof data !== "object") data = {};
  if ((!Array.isArray(data.vp) || data.vp.length < 2) && (!Array.isArray(data.vps) || data.vps.length < 2)) {
    const hy = Number(data.horizon);
    const vy = Number.isFinite(hy) ? hy : 0.42;
    let xs = [];
    if (Array.isArray(data.vanish) && data.vanish.length) xs = data.vanish.map(Number);
    else if (Number.isFinite(Number(data.vanish))) xs = [Number(data.vanish)];
    if (two) {
      const vps = xs.length >= 2 ? [clampUv(xs[0], vy), clampUv(xs[xs.length - 1], vy)] : defaultTwoVps(vy);
      data = {
        vps,
        angle_pairs: [defaultAngles(vps[0][0], vps[0][1]), defaultAngles(vps[1][0], vps[1][1])],
        vp: vps[0],
        angles: defaultAngles(vps[0][0], vps[0][1]),
      };
    } else {
      const vx = xs.length ? xs[0] : 0.5;
      data = { vp: [vx, vy], angles: defaultAngles(vx, vy) };
    }
  }
  if (two) {
    let vps;
    if (Array.isArray(data.vps) && data.vps.length >= 2) vps = data.vps;
    else if (Array.isArray(data.vp) && data.vp.length >= 2) vps = defaultTwoVps(Number(data.vp[1]));
    else vps = defaultTwoVps(0.42);
    const pairs = Array.isArray(data.angle_pairs) && data.angle_pairs.length >= 2 ? data.angle_pairs : null;
    return lockTwoVps(vps, pairs);
  }
  let vx;
  let vy;
  let fromTwo = false;
  if (Array.isArray(data.vps) && data.vps.length >= 2) {
    vx = (Number(data.vps[0][0]) + Number(data.vps[1][0])) / 2;
    vy = Number(data.vps[0][1]);
    fromTwo = true;
  } else {
    vx = Number(data.vp?.[0]);
    vy = Number(data.vp?.[1]);
  }
  const vp = clampUv(vx, vy);
  let angles = fromTwo ? defaultAngles(vp[0], vp[1]) : data.angles;
  if (!Array.isArray(angles) || angles.length < 2) angles = defaultAngles(vp[0], vp[1]);
  angles = separateAngles(Number(angles[0]), Number(angles[1]), 1);
  return { vp, angles, two_point: false };
}

const HIDDEN_SLOT_NAMES = new Set(["grid_selection", "camera_lines"]);

function hideWidget(widget) {
  if (!widget) return;
  if (widget.type !== "hidden") {
    widget._ppOrigType = widget.type;
    widget._ppOrigComputeSize = widget.computeSize;
    widget._ppOrigLayoutSize = widget.computeLayoutSize;
  }
  widget.hidden = true;
  widget.type = "hidden";
  widget.computeSize = () => [0, -4];
  widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
  widget.options = Object.assign({}, widget.options || {}, {
    hidden: true,
    socketless: true,
  });
  if (widget.element) {
    widget.element.style.display = "none";
    widget.element.hidden = true;
  }
}

function showWidget(widget) {
  if (!widget) return;
  widget.hidden = false;
  widget.type = widget._ppOrigType || widget.type || "combo";
  if (widget._ppOrigComputeSize) widget.computeSize = widget._ppOrigComputeSize;
  else delete widget.computeSize;
  if (widget._ppOrigLayoutSize) widget.computeLayoutSize = widget._ppOrigLayoutSize;
  else delete widget.computeLayoutSize;
  if (widget.options) widget.options.hidden = false;
  if (widget.element) {
    widget.element.style.display = "";
    widget.element.hidden = false;
  }
}

function stripHiddenSlots(node) {
  if (!Array.isArray(node?.inputs)) return;
  node.inputs = node.inputs.filter((inp) => {
    const name = inp?.name || inp?.widget?.name;
    if (!HIDDEN_SLOT_NAMES.has(name)) return true;
    inp.hidden = true;
    return false;
  });
  node._setConcreteSlots?.();
}

function isSerializableWidget(widget) {
  if (!widget) return false;
  if (widget.name === "pp_palace_canvas") return false;
  if (widget.serialize === false) return false;
  return true;
}

function applySavedWidgets(node, info) {
  const widgets = (node.widgets || []).filter(isSerializableWidget);
  const named = info?.widgets_values_named;
  if (named && typeof named === "object") {
    for (const widget of widgets) {
      if (widget.name && Object.prototype.hasOwnProperty.call(named, widget.name)) {
        widget.value = named[widget.name];
      }
    }
  }
}

function getAspect(node) {
  const w = Number(node.widgets?.find((x) => x.name === "width")?.value || 1024);
  const h = Number(node.widgets?.find((x) => x.name === "height")?.value || 1024);
  return Math.max(0.25, Math.min(4, w / Math.max(1, h)));
}

function fitRect(maxW, maxH, aspect) {
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { x: (maxW - w) / 2, y: (maxH - h) / 2, w, h };
}

function layoutView(canvasW, canvasH, aspect) {
  const boxW = Math.max(8, canvasW - PAD * 2);
  const boxH = Math.max(8, canvasH - PAD * 2);
  const world = fitRect(boxW, boxH, aspect);
  world.x += PAD;
  world.y += PAD;
  const inner = {
    x: world.x + world.w * 0.25,
    y: world.y + world.h * 0.25,
    w: world.w * 0.5,
    h: world.h * 0.5,
  };
  return { world, inner };
}

function imgToCanvas(u, v, world) {
  return [
    world.x + ((u - VIEW_MIN) / VIEW_SPAN) * world.w,
    world.y + ((v - VIEW_MIN) / VIEW_SPAN) * world.h,
  ];
}

function canvasToImg(x, y, world) {
  return [
    ((x - world.x) / world.w) * VIEW_SPAN + VIEW_MIN,
    ((y - world.y) / world.h) * VIEW_SPAN + VIEW_MIN,
  ];
}

function cellKey(cell) {
  return `${cell.row},${cell.col}`;
}

function hasCell(cells, cell) {
  return cells.some((c) => cellKey(c) === cellKey(cell));
}

function rectCells(a, b) {
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  const out = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) out.push({ row, col });
  }
  return out;
}

function hitCell(x, y, rect) {
  if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) return null;
  const col = Math.min(GRID - 1, Math.max(0, Math.floor(((x - rect.x) / rect.w) * GRID)));
  const row = Math.min(GRID - 1, Math.max(0, Math.floor(((y - rect.y) / rect.h) * GRID)));
  return { row, col };
}

function distToRay(px, py, vx, vy, angle, world) {
  const [cx, cy] = imgToCanvas(vx, vy, world);
  const cdx = Math.cos(angle) * (world.w / VIEW_SPAN);
  const cdy = Math.sin(angle) * (world.h / VIEW_SPAN);
  const len = Math.hypot(cdx, cdy) || 1;
  return Math.abs((px - cx) * (cdy / len) - (py - cy) * (cdx / len));
}

function widget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function isTwoPoint(node) {
  const mode = String(widget(node, "perspective_mode")?.value || "");
  return mode.includes("2") || mode.includes("兩") || mode.includes("两");
}

function isSubjectOn(node) {
  const w = widget(node, "subject");
  if (!w) return true;
  const v = w.value;
  if (v === false || v === 0 || v === "false" || v === "off") return false;
  return true;
}

function syncSubjectUi(node) {
  const on = isSubjectOn(node);
  const prim = widget(node, "primitive");
  if (prim) {
    if (on) showWidget(prim);
    else hideWidget(prim);
  }
  node._pp?.redraw?.();
  node.setDirtyCanvas?.(true, true);
}

function readCells(node) {
  return parseCells(widget(node, "grid_selection")?.value);
}

function writeCells(node, cells) {
  const w = widget(node, "grid_selection");
  const value = serializeCells(cells);
  if (w) {
    w.value = value;
    w.callback?.(value);
  }
  node.properties = node.properties || {};
  node.properties.pp_grid_selection = value;
  node._pp?.redraw?.();
  node.setDirtyCanvas?.(true, true);
}

function readCamera(node) {
  return parseCamera(widget(node, "camera_lines")?.value, isTwoPoint(node));
}

function writeCamera(node, camera) {
  const next = parseCamera(camera, isTwoPoint(node));
  const value = JSON.stringify(next);
  const w = widget(node, "camera_lines");
  if (w) {
    w.value = value;
    w.callback?.(value);
  }
  node.properties = node.properties || {};
  node.properties.pp_camera_lines = value;
  node._pp?.redraw?.();
  node.setDirtyCanvas?.(true, true);
}

function cameraPairs(camera) {
  if (camera.two_point && Array.isArray(camera.vps) && Array.isArray(camera.angle_pairs)) {
    return camera.vps.map((vp, i) => ({ vp, angles: camera.angle_pairs[i], pair: i }));
  }
  return [{ vp: camera.vp, angles: camera.angles, pair: 0 }];
}

function hitHandle(x, y, view, camera) {
  const { world } = view;
  const pairs = cameraPairs(camera);
  for (let p = 0; p < pairs.length; p++) {
    const [cx, cy] = imgToCanvas(pairs[p].vp[0], pairs[p].vp[1], world);
    if (Math.hypot(x - cx, y - cy) <= HIT + 2) return { type: "vp", index: p };
  }
  let best = null;
  let bestD = HIT + 1;
  for (let p = 0; p < pairs.length; p++) {
    for (let i = 0; i < 2; i++) {
      const d = distToRay(x, y, pairs[p].vp[0], pairs[p].vp[1], pairs[p].angles[i], world);
      if (d < bestD) {
        bestD = d;
        best = { type: "ray", pair: p, index: i };
      }
    }
  }
  if (best && bestD <= HIT) return best;
  return null;
}

function lineSide(px, py, ax, ay, bx, by) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function intersectSegLine(p, q, ax, ay, bx, by) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const lx = bx - ax;
  const ly = by - ay;
  const den = dx * ly - dy * lx;
  if (Math.abs(den) < 1e-12) return [p[0], p[1]];
  const t = ((ax - p[0]) * ly - (ay - p[1]) * lx) / den;
  return [p[0] + t * dx, p[1] + t * dy];
}

function clipPoly(poly, ax, ay, bx, by, refx, refy) {
  if (!poly.length) return poly;
  const sign = lineSide(refx, refy, ax, ay, bx, by) >= 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pin = lineSide(p[0], p[1], ax, ay, bx, by) * sign >= -1e-9;
    const qin = lineSide(q[0], q[1], ax, ay, bx, by) * sign >= -1e-9;
    if (pin && qin) out.push(q);
    else if (pin && !qin) out.push(intersectSegLine(p, q, ax, ay, bx, by));
    else if (!pin && qin) {
      out.push(intersectSegLine(p, q, ax, ay, bx, by));
      out.push(q);
    }
  }
  return out;
}

function overlapPolygon(pairs) {
  const lo = VIEW_MIN;
  const hi = VIEW_MIN + VIEW_SPAN;
  let poly = [
    [lo, lo],
    [hi, lo],
    [hi, hi],
    [lo, hi],
  ];
  const near = [0.5, 1.0];
  for (const pair of pairs) {
    const [vx, vy] = pair.vp;
    for (const a of pair.angles) {
      poly = clipPoly(poly, vx, vy, vx + Math.cos(a), vy + Math.sin(a), near[0], near[1]);
      if (!poly.length) return poly;
    }
  }
  if (pairs.length >= 2) {
    const hy = pairs[0].vp[1];
    poly = clipPoly(poly, lo, hy, hi, hy, near[0], near[1]);
  }
  return poly;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function fillOverlap(ctx, pairs, world) {
  const poly = overlapPolygon(pairs);
  if (poly.length < 3) return poly;
  const farU =
    pairs.reduce((s, p) => s + p.vp[0], 0) / Math.max(pairs.length, 1);
  const farV =
    pairs.reduce((s, p) => s + p.vp[1], 0) / Math.max(pairs.length, 1);
  const [fx, fy] = imgToCanvas(farU, farV, world);
  const [nx, ny] = imgToCanvas(0.5, 1.0, world);
  const grad = ctx.createLinearGradient(fx, fy, nx, ny);
  grad.addColorStop(0, COLORS.groundFar);
  grad.addColorStop(1, COLORS.groundNear);
  ctx.beginPath();
  const [x0, y0] = imgToCanvas(poly[0][0], poly[0][1], world);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < poly.length; i++) {
    const [x, y] = imgToCanvas(poly[i][0], poly[i][1], world);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  return poly;
}

function drawPair(ctx, vp, angles, world, rayColors, vpFill) {
  const [vpx, vpy] = imgToCanvas(vp[0], vp[1], world);
  for (let i = 0; i < 2; i++) {
    const a = angles[i];
    const cdx = Math.cos(a) * (world.w / VIEW_SPAN);
    const cdy = Math.sin(a) * (world.h / VIEW_SPAN);
    ctx.strokeStyle = rayColors[i] || rayColors[0];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(vpx - cdx * 8, vpy - cdy * 8);
    ctx.lineTo(vpx + cdx * 8, vpy + cdy * 8);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(vpx, vpy, 6, 0, Math.PI * 2);
  ctx.fillStyle = vpFill;
  ctx.fill();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function ensureStyles() {
  if (document.getElementById("pp-palace-style")) return;
  const style = document.createElement("style");
  style.id = "pp-palace-style";
  style.textContent = `
    .pp-palace-root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      background: ${COLORS.panel};
      border: 1px solid ${COLORS.panelEdge};
      border-radius: 8px;
      overflow: hidden;
      box-sizing: border-box;
      user-select: none;
    }
    .pp-palace-root canvas {
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      min-height: 0;
      display: block;
      cursor: crosshair;
      touch-action: none;
    }
    .pp-palace-footer {
      flex: 0 0 22px;
      height: 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      font: 11px sans-serif;
      color: ${COLORS.text};
      background: rgba(0,0,0,0.28);
      overflow: hidden;
    }
    .pp-palace-footer .label {
      white-space: nowrap;
      flex: 0 0 auto;
    }
    .pp-palace-footer .hint {
      color: ${COLORS.muted};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex: 1 1 auto;
      text-align: right;
    }
  `;
  document.head.appendChild(style);
}

function attachCanvas(node) {
  ensureStyles();
  const state = (node._pp = {
    hover: null,
    dragStart: null,
    dragHandle: null,
    additive: false,
    view: null,
  });

  const root = document.createElement("div");
  root.className = "pp-palace-root";
  const canvas = document.createElement("canvas");
  const footer = document.createElement("div");
  footer.className = "pp-palace-footer";
  footer.innerHTML = `<span class="label">palace</span><span class="hint">drag VP · drag lines · drag cells · right-click reset</span>`;
  root.appendChild(canvas);
  root.appendChild(footer);

  function cssSize() {
    const box = canvas.getBoundingClientRect();
    return { width: Math.max(1, box.width), height: Math.max(1, box.height) };
  }

  function redraw() {
    const { width, height } = cssSize();
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.floor(width * dpr));
    const pxH = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const view = layoutView(width, height, getAspect(node));
    const { world, inner: rect } = view;
    state.view = view;

    const subjectOn = isSubjectOn(node);
    const cells = subjectOn ? readCells(node) : [];
    const camera = readCamera(node);
    const selected = new Set(cells.map(cellKey));
    const cellW = rect.w / GRID;
    const cellH = rect.h / GRID;

    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = COLORS.margin;
    ctx.fillRect(world.x, world.y, world.w, world.h);
    ctx.fillStyle = "#161922";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    const fillSet = (set, color) => {
      ctx.fillStyle = color;
      for (const key of set) {
        const [row, col] = key.split(",").map(Number);
        ctx.fillRect(rect.x + col * cellW, rect.y + row * cellH, cellW, cellH);
      }
    };
    if (subjectOn) {
      fillSet(selected, COLORS.fill);
      if (state.hover) {
        ctx.fillStyle = COLORS.hover;
        ctx.fillRect(rect.x + state.hover.col * cellW, rect.y + state.hover.row * cellH, cellW, cellH);
      }
      if (state.dragStart && state.hover && !state.dragHandle) {
        fillSet(new Set(rectCells(state.dragStart, state.hover).map(cellKey)), COLORS.preview);
      }
    }

    ctx.strokeStyle = COLORS.minor;
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      const gx = rect.x + (i * rect.w) / GRID;
      const gy = rect.y + (i * rect.h) / GRID;
      ctx.beginPath();
      ctx.moveTo(gx, rect.y);
      ctx.lineTo(gx, rect.y + rect.h);
      ctx.moveTo(rect.x, gy);
      ctx.lineTo(rect.x + rect.w, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.major;
    ctx.lineWidth = 1.6;
    for (const t of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.moveTo(rect.x + t * rect.w, rect.y);
      ctx.lineTo(rect.x + t * rect.w, rect.y + rect.h);
      ctx.moveTo(rect.x, rect.y + t * rect.h);
      ctx.lineTo(rect.x + rect.w, rect.y + t * rect.h);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.8;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    const pairs = cameraPairs(camera);
    let groundPoly = null;
    if (camera.two_point) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(world.x, world.y, world.w, world.h);
      ctx.clip();
      const hy = pairs[0].vp[1];
      const [hx0, hy0] = imgToCanvas(VIEW_MIN, hy, world);
      const [hx1, hy1] = imgToCanvas(VIEW_MIN + VIEW_SPAN, hy, world);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = COLORS.horizon;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx0, hy0);
      ctx.lineTo(hx1, hy1);
      ctx.stroke();
      ctx.setLineDash([]);
      groundPoly = fillOverlap(ctx, pairs, world);
      ctx.restore();
    }
    for (const pair of pairs) {
      const rayColors = camera.two_point
        ? [PAIR_COLORS[pair.pair], PAIR_COLORS[pair.pair]]
        : PAIR_COLORS;
      const vpFill = camera.two_point ? PAIR_COLORS[pair.pair] : COLORS.vp;
      drawPair(ctx, pair.vp, pair.angles, world, rayColors, vpFill);
    }

    const offFrame = pairs.some(
      (p) => p.vp[0] < 0 || p.vp[0] > 1 || p.vp[1] < 0 || p.vp[1] > 1,
    );
    const off = offFrame ? " · VP off-frame" : "";
    const labelEl = footer.querySelector(".label");
    if (labelEl) {
      const kind = camera.two_point ? "2pt" : "1pt";
      const subj = subjectOn
        ? `${cells.length} cell${cells.length === 1 ? "" : "s"}`
        : "no subject";
      labelEl.textContent = `${kind} · ${subj}${off}`;
    }
    const hintEl = footer.querySelector(".hint");
    if (hintEl) {
      if (!subjectOn) {
        hintEl.textContent = "subject off · drag VP / lines · right-click reset";
      } else if (camera.two_point) {
        const missed =
          groundPoly &&
          groundPoly.length >= 3 &&
          cells.every((c) => !pointInPoly((c.col + 0.5) / GRID, (c.row + 0.5) / GRID, groundPoly));
        hintEl.textContent = missed
          ? "ground is the light overlap — inner rays closed it under the cells"
          : "ground = light overlap of both fans · shared horizon · drag VPs/lines";
      } else {
        hintEl.textContent = "drag VP · drag lines to rotate · drag cells · right-click reset";
      }
    }
  }

  state.redraw = redraw;

  function posFromEvent(event) {
    const box = canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const [x, y] = posFromEvent(event);
    if (event.button === 2) {
      if (isSubjectOn(node)) writeCells(node, [{ row: 4, col: 4 }]);
      writeCamera(node, defaultCamera(isTwoPoint(node)));
      state.dragStart = null;
      state.dragHandle = null;
      return;
    }
    if (!state.view) return;
    const handle = hitHandle(x, y, state.view, readCamera(node));
    if (handle) {
      state.dragHandle = handle;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }
    if (!isSubjectOn(node)) return;
    const cell = hitCell(x, y, state.view.inner);
    if (!cell) return;
    state.dragStart = cell;
    state.hover = cell;
    state.additive = !!(event.ctrlKey || event.metaKey);
    canvas.setPointerCapture(event.pointerId);
    redraw();
  });

  canvas.addEventListener("pointermove", (event) => {
    const [x, y] = posFromEvent(event);
    if (state.dragHandle && state.view) {
      const cam = readCamera(node);
      const [u, v] = canvasToImg(x, y, state.view.world);
      if (state.dragHandle.type === "vp") {
        const i = state.dragHandle.index ?? 0;
        if (cam.two_point) {
          const hy = Math.min(3, Math.max(-2, v));
          let nx = Math.min(3, Math.max(-2, u));
          if (i === 0) nx = Math.min(nx, cam.vps[1][0] - MIN_VP_SEP);
          else nx = Math.max(nx, cam.vps[0][0] + MIN_VP_SEP);
          cam.vps[i] = [nx, hy];
          cam.vps[1 - i][1] = hy;
        } else {
          cam.vp = [Math.min(3, Math.max(-2, u)), Math.min(3, Math.max(-2, v))];
        }
      } else if (state.dragHandle.type === "ray") {
        const i = state.dragHandle.index;
        if (cam.two_point) {
          const p = state.dragHandle.pair ?? 0;
          const vp = cam.vps[p];
          const next = Math.atan2(v - vp[1], u - vp[0]);
          cam.angle_pairs[p] = separateAngles(
            i === 0 ? next : cam.angle_pairs[p][0],
            i === 1 ? next : cam.angle_pairs[p][1],
            i,
          );
        } else {
          const next = Math.atan2(v - cam.vp[1], u - cam.vp[0]);
          cam.angles = separateAngles(
            i === 0 ? next : cam.angles[0],
            i === 1 ? next : cam.angles[1],
            i,
          );
        }
      }
      writeCamera(node, cam);
      return;
    }
    const cell =
      state.view && isSubjectOn(node) ? hitCell(x, y, state.view.inner) : null;
    if (cellKey(cell || { row: -1, col: -1 }) === cellKey(state.hover || { row: -2, col: -2 })) return;
    state.hover = cell;
    redraw();
  });

  canvas.addEventListener("pointerup", (event) => {
    canvas.style.cursor = "crosshair";
    if (state.dragHandle) {
      state.dragHandle = null;
      return;
    }
    if (!state.dragStart) return;
    const [x, y] = posFromEvent(event);
    const end = (state.view && hitCell(x, y, state.view.inner)) || state.hover || state.dragStart;
    const boxed = rectCells(state.dragStart, end);
    if (state.additive) {
      const current = readCells(node);
      const map = new Map(current.map((c) => [cellKey(c), c]));
      if (boxed.length === 1 && hasCell(current, boxed[0])) map.delete(cellKey(boxed[0]));
      else for (const c of boxed) map.set(cellKey(c), c);
      writeCells(node, [...map.values()]);
    } else {
      writeCells(node, boxed);
    }
    state.dragStart = null;
    state.additive = false;
  });

  canvas.addEventListener("pointerleave", () => {
    if (state.dragStart || state.dragHandle) return;
    state.hover = null;
    redraw();
  });

  const observer = new ResizeObserver(() => redraw());
  observer.observe(root);
  observer.observe(canvas);

  const canvasWidget = node.addDOMWidget("pp_palace_canvas", "PP_PALACE", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => GRID_SLOT,
    getMaxHeight: () => GRID_SLOT,
    getHeight: () => GRID_SLOT,
    afterResize: () => redraw(),
  });
  canvasWidget.serialize = false;
  canvasWidget.computedHeight = GRID_SLOT;
  canvasWidget.computeSize = function (width) {
    const nodeW = node.size?.[0] || 380;
    const w = Number.isFinite(width) && width > 80 ? width : Math.max(80, nodeW - 20);
    return [w, GRID_SLOT];
  };
  canvasWidget.computeLayoutSize = () => ({
    minHeight: GRID_SLOT,
    maxHeight: GRID_SLOT,
    minWidth: 0,
  });
  root.style.width = "100%";
  root.style.height = "100%";

  requestAnimationFrame(() => redraw());
  setTimeout(redraw, 50);
  setTimeout(redraw, 250);
  return canvasWidget;
}

app.registerExtension({
  name: "palace.PalacePerspective",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!NODE_NAMES.has(nodeData.name)) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);

      hideWidget(widget(this, "grid_selection"));
      hideWidget(widget(this, "camera_lines"));
      stripHiddenSlots(this);

      const canvasWidget = attachCanvas(this);
      const list = this.widgets;
      const modeW = widget(this, "perspective_mode");
      const subjectW = widget(this, "subject");
      const primW = widget(this, "primitive");
      if (subjectW && modeW) {
        const si = list.indexOf(subjectW);
        if (si >= 0) list.splice(si, 1);
        list.splice(list.indexOf(modeW) + 1, 0, subjectW);
      }
      const canvasIndex = list.indexOf(canvasWidget);
      const anchor = primW || subjectW || modeW || widget(this, "height");
      if (canvasIndex >= 0 && anchor) {
        list.splice(canvasIndex, 1);
        list.splice(list.indexOf(anchor) + 1, 0, canvasWidget);
      }

      for (const name of ["width", "height", "perspective_mode", "subject"]) {
        const w = widget(this, name);
        if (!w) continue;
        const orig = w.callback;
        w.callback = (...args) => {
          orig?.apply(w, args);
          if (name === "perspective_mode") writeCamera(this, readCamera(this));
          if (name === "subject") syncSubjectUi(this);
          this._pp?.redraw?.();
          this.setDirtyCanvas?.(true, true);
        };
      }
      syncSubjectUi(this);

      const origOnResize = this.onResize;
      this.onResize = (size) => {
        origOnResize?.apply(this, arguments);
        const el = canvasWidget.element || canvasWidget.container;
        if (el) {
          el.style.width = "100%";
          el.style.height = `${GRID_SLOT}px`;
        }
        this._pp?.redraw?.();
      };

      const size = this.computeSize?.() || this.size;
      if (size) this.setSize?.([Math.max(size[0], 380), Math.max(size[1], 640)]);
      return r;
    };

    const origSerialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const data = origSerialize ? origSerialize.apply(this, arguments) : {};
      const serializable = (this.widgets || []).filter(isSerializableWidget);
      if (Array.isArray(data.widgets_values)) {
        data.widgets_values = serializable.map((w) => w.value);
      }
      if (data.widgets_values_named && typeof data.widgets_values_named === "object") {
        delete data.widgets_values_named.pp_palace_canvas;
      }
      return data;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = onConfigure?.apply(this, arguments);
      applySavedWidgets(this, info);
      hideWidget(widget(this, "grid_selection"));
      hideWidget(widget(this, "camera_lines"));
      stripHiddenSlots(this);
      syncSubjectUi(this);
      requestAnimationFrame(() => this._pp?.redraw?.());
      this.setDirtyCanvas?.(true, true);
      return r;
    };
  },
});
