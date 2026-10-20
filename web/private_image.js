// Load Image Private (GeN13) / Save Image Private (GeN13) / Preview Image Private (GeN13)
//   - original width x height is printed under the preview (from the thumb response headers)
//   - preview (SHOW / HIDE): collapse the preview area
//   - privacy (ON / OFF): ON draws a cover; hold the preview to see the real image
//   - privacy_style: mosaic (8 cells on the long edge) / frosted / gradient / palette / solid
//     frosted = blurred photo + frost; blur set by frost_blur (% of the long edge),
//               glass: plain / reeded / hammered texture in front
//     palette = the gradient re-colored by luminance (gradient map); custom uses 2 colors
//     solid   = auto (average color) or one picked color
//     gradient / palette: brightness 10-200 % (100 = unchanged)
//   These settings live in node.properties only: never in widgets_values, the prompt
//   or the API template. The core output preview is suppressed on both nodes so the
//   clear image is never drawn on the node itself.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { T, setTip, setWidgetTip, setWidgetLabel } from "./g13_i18n.js";

const LOAD_ID = "LoadImagePrivateGeN13";
const SAVE_ID = "SaveImagePrivateGeN13";
const PREVIEW_ID = "PreviewImagePrivateGeN13";
const NODE_IDS = [LOAD_ID, SAVE_ID, PREVIEW_ID];
const CAPTION_H = 18;
// minimum preview panel height (px); the node can be resized larger
const STYLES = ["mosaic", "frosted", "gradient", "palette", "solid"];
const PALETTES = {
  AURORA: ["#1B1446", "#5B2BD9", "#22D3EE", "#B8FFE9"],
  SUNSET: ["#2A0E3A", "#C2185B", "#FF7A45", "#FFD27A"],
  OCEAN: ["#031B34", "#0B5FA5", "#27C3D9", "#CFF6FF"],
  NEON: ["#12002B", "#8A5CFF", "#FF2E97", "#00F0FF"],
  VAPOR: ["#FF00FF", "#1DDAFF"],
  "EVA-01": ["#200040", "#A060FF", "#C0FF40"],
  "EVA-02": ["#200000", "#FF4040", "#FFC040"],
  CUSTOM: null,
};
const PALETTE_NAMES = Object.keys(PALETTES);
const MOSAIC_CELLS = 8;
const PREVIEW_MIN_H = 220;
const P_PREVIEW = "g13_preview";
const P_PRIVACY = "g13_privacy";
const P_STYLE = "g13_privacy_style";
const P_PALETTE = "g13_palette";
const P_CUSTOM = "g13_custom_colors";
const P_SOLID_AUTO = "g13_solid_auto";
const P_SOLID = "g13_solid_color";
const P_FROST = "g13_frost_blur";
const P_GLASS = "g13_glass";
const P_BRIGHT = "g13_brightness";
const GLASSES = ["plain", "reeded", "hammered"];
const DEFAULTS = {
  [P_PREVIEW]: true,
  [P_PRIVACY]: false,
  [P_STYLE]: "gradient",
  [P_PALETTE]: "AURORA",
  [P_CUSTOM]: ["#101030", "#FF5FA2"],
  [P_SOLID_AUTO]: true,
  [P_SOLID]: "#5B2A86",
  [P_FROST]: 4,
  [P_GLASS]: "plain",
  [P_BRIGHT]: 100,
};

function prop(node, key) {
  const v = node.properties?.[key];
  if (v === undefined) return Array.isArray(DEFAULTS[key]) ? DEFAULTS[key].slice() : DEFAULTS[key];
  return v;
}

function setProp(node, key, value) {
  node.properties = node.properties ?? {};
  node.properties[key] = value;
}

function frontOnly(w) {
  w.serialize = false;
  w.options = w.options ?? {};
  w.options.serialize = false;
  return w;
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Halve step by step so every target pixel averages the whole source area.
function downscale(img, w, h) {
  let src = img;
  let sw = img.naturalWidth || img.width;
  let sh = img.naturalHeight || img.height;
  while (sw / 2 >= w && sh / 2 >= h && (sw > w || sh > h)) {
    const nw = Math.max(w, Math.round(sw / 2));
    const nh = Math.max(h, Math.round(sh / 2));
    const c = makeCanvas(nw, nh);
    const x = c.getContext("2d");
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, nw, nh);
    src = c;
    sw = nw;
    sh = nh;
  }
  const c = makeCanvas(w, h);
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, w, h);
  return c;
}

function blurredGradient(img) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const long = Math.max(iw, ih);
  const seed = downscale(img, iw >= ih ? 4 : 3, iw >= ih ? 3 : 4);
  const W = Math.max(1, Math.round((256 * iw) / long));
  const H = Math.max(1, Math.round((256 * ih) / long));
  const c = makeCanvas(W, H);
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.filter = "blur(20px) saturate(1.4)";
  x.drawImage(seed, -W * 0.25, -H * 0.25, W * 1.5, H * 1.5);
  return c;
}

function frostPercent(node) {
  const v = Math.round(Number(prop(node, P_FROST)));
  return Number.isFinite(v) ? Math.min(10, Math.max(2, v)) : 5;
}

// seeded PRNG so the glass pattern stays the same on every rebuild
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleAt(src, W, H, x, y) {
  const xi = Math.min(W - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
  return (yi * W + xi) * 4;
}

// reeded glass: vertical flutes, each flips the view across its width, lit edge + dark groove
function reededGlass(src, dst, W, H) {
  const strip = Math.max(6, Math.round(Math.max(W, H) / 18));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x % strip) / strip;
      const j = sampleAt(src, W, H, x + (0.5 - u) * strip * 2.2, y);
      const shade = (1 - Math.cos((u - 0.5) * Math.PI)) * -38;
      const glint = Math.pow(Math.max(0, 1 - Math.abs(u - 0.22) * 7), 2) * 60;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) dst[i + c] = src[j + c] + shade + glint;
      dst[i + 3] = 255;
    }
  }
}

// hammered glass: irregular dimples bend the view locally, lit from the top left.
// Height map = seeded random grid, smooth-scaled and blurred (no lattice streaks).
// HAMMER_CELLS dimples across the long edge; depth and light scale with the dimple size.
const HAMMER_CELLS = 70;
function hammeredGlass(src, dst, W, H) {
  const long = Math.max(W, H);
  const cell = long / HAMMER_CELLS;
  const k = cell / (256 / 22); // tuned at 22 cells on a 256 px canvas
  const gw = Math.max(4, Math.round((W / long) * HAMMER_CELLS));
  const gh = Math.max(4, Math.round((H / long) * HAMMER_CELLS));
  const seed = makeCanvas(gw, gh);
  const sx = seed.getContext("2d");
  const cells = sx.createImageData(gw, gh);
  const rand = rng(1313);
  for (let i = 0; i < cells.data.length; i += 4) {
    const v = Math.round(rand() * 255);
    cells.data[i] = cells.data[i + 1] = cells.data[i + 2] = v;
    cells.data[i + 3] = 255;
  }
  sx.putImageData(cells, 0, 0);
  const hc = makeCanvas(W, H);
  const hx = hc.getContext("2d");
  hx.imageSmoothingEnabled = true;
  hx.imageSmoothingQuality = "high";
  const r = cell * 0.37;
  hx.filter = `blur(${r}px)`;
  hx.drawImage(seed, -r * 2, -r * 2, W + r * 4, H + r * 4);
  const hd = hx.getImageData(0, 0, W, H).data;
  const h = (x, y) => hd[sampleAt(hd, W, H, x, y)] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = h(x + 1, y) - h(x - 1, y);
      const gy = h(x, y + 1) - h(x, y - 1);
      const j = sampleAt(src, W, H, x + gx * 90 * k * k, y + gy * 90 * k * k);
      const lit = Math.max(-1, Math.min(1, (-gx - gy) * 9 * k)) * 36;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) dst[i + c] = src[j + c] + lit;
      dst[i + 3] = 255;
    }
  }
}

// blurred photo, optional glass texture, light frost, fine grain, thin edge highlight
function frosted(img, pct, glass) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const long = Math.max(iw, ih);
  const W = Math.max(1, Math.round((256 * iw) / long));
  const H = Math.max(1, Math.round((256 * ih) / long));
  const r = (256 * pct) / 100;
  const pad = r * 2; // draw past the edges so the blur does not fade to transparent
  const c = makeCanvas(W, H);
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.filter = `blur(${r}px)`;
  x.drawImage(img, -pad, -pad, W + pad * 2, H + pad * 2);
  x.filter = "none";

  if (glass === "reeded" || glass === "hammered") {
    const base = x.getImageData(0, 0, W, H);
    const out = x.createImageData(W, H);
    (glass === "reeded" ? reededGlass : hammeredGlass)(base.data, out.data, W, H);
    x.putImageData(out, 0, 0);
  }

  x.fillStyle = "rgba(240,240,240,0.12)";
  x.fillRect(0, 0, W, H);
  const grain = glass === "reeded" ? 8 : glass === "hammered" ? 6 : 14;
  const d = x.getImageData(0, 0, W, H);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const n = (Math.random() - 0.5) * grain;
    a[i] += n;
    a[i + 1] += n;
    a[i + 2] += n;
  }
  x.putImageData(d, 0, 0);
  x.strokeStyle = "rgba(255,255,255,0.25)";
  x.lineWidth = 1;
  x.strokeRect(0.5, 0.5, W - 1, H - 1);
  return c;
}

function brightPercent(node) {
  const v = Math.round(Number(prop(node, P_BRIGHT)) / 5) * 5;
  return Number.isFinite(v) ? Math.min(200, Math.max(10, v)) : 100;
}

// brightness for the gradient styles: 100 = unchanged, lower darker, higher brighter
function brighten(src, pct) {
  if (pct === 100) return src;
  const c = makeCanvas(src.width, src.height);
  const x = c.getContext("2d");
  x.filter = `brightness(${pct}%)`;
  x.drawImage(src, 0, 0);
  return c;
}

function validHex(v) {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function customStops(node) {
  const c = prop(node, P_CUSTOM);
  const d = DEFAULTS[P_CUSTOM];
  return [0, 1].map((i) => (Array.isArray(c) && validHex(c[i]) ? c[i] : d[i]));
}

function paletteStops(node) {
  const name = prop(node, P_PALETTE);
  return PALETTES[name] ?? (name === "CUSTOM" ? customStops(node) : PALETTES.AURORA);
}

// Photoshop-style gradient map: luminance (stretched to full range) -> stops, dark to light
function gradientMap(src, stops) {
  const c = makeCanvas(src.width, src.height);
  const x = c.getContext("2d");
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  const L = new Float32Array(a.length / 4);
  let mn = 1;
  let mx = 0;
  for (let i = 0; i < L.length; i++) {
    const l = (0.2126 * a[i * 4] + 0.7152 * a[i * 4 + 1] + 0.0722 * a[i * 4 + 2]) / 255;
    L[i] = l;
    if (l < mn) mn = l;
    if (l > mx) mx = l;
  }
  const S = stops.map((h) => [1, 3, 5].map((k) => parseInt(h.substr(k, 2), 16)));
  const n = S.length - 1;
  const range = mx - mn || 1;
  for (let i = 0; i < L.length; i++) {
    // light dither hides 8-bit banding after the range stretch
    const t = Math.min(n, Math.max(0, ((L[i] - mn) / range + (Math.random() - 0.5) * 0.012) * n));
    const k = Math.min(n - 1, Math.floor(t));
    const f = t - k;
    for (let j = 0; j < 3; j++) a[i * 4 + j] = Math.round(S[k][j] + (S[k + 1][j] - S[k][j]) * f);
    a[i * 4 + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}

function buildCover(node) {
  const img = node._pvImg;
  node._pvCover = null;
  if (!img) return;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const long = Math.max(iw, ih);
  const style = prop(node, P_STYLE);
  if (style === "solid") {
    const fixed = prop(node, P_SOLID);
    if (!prop(node, P_SOLID_AUTO) && validHex(fixed)) {
      node._pvCover = { solid: fixed };
    } else {
      const d = downscale(img, 1, 1).getContext("2d").getImageData(0, 0, 1, 1).data;
      node._pvCover = { solid: `rgb(${d[0]},${d[1]},${d[2]})` };
    }
  } else if (style === "frosted") {
    node._pvCover = { canvas: frosted(img, frostPercent(node), prop(node, P_GLASS)), smooth: true };
  } else if (style === "gradient") {
    node._pvCover = { canvas: brighten(blurredGradient(img), brightPercent(node)), smooth: true };
  } else if (style === "palette") {
    const mapped = gradientMap(blurredGradient(img), paletteStops(node));
    node._pvCover = { canvas: brighten(mapped, brightPercent(node)), smooth: true };
  } else {
    const mw = Math.max(1, Math.round((MOSAIC_CELLS * iw) / long));
    const mh = Math.max(1, Math.round((MOSAIC_CELLS * ih) / long));
    node._pvCover = { canvas: downscale(img, mw, mh), smooth: false };
  }
}

function clearThumb(node) {
  node._pvImg = null;
  node._pvCover = null;
  node._pvSize = null;
  if (node._pvUrl) URL.revokeObjectURL(node._pvUrl);
  node._pvUrl = null;
  redraw(node);
}

async function loadThumb(node, kind, filename, subfolder = "") {
  const seq = (node._pvSeq = (node._pvSeq ?? 0) + 1);
  if (!filename) {
    clearThumb(node);
    return;
  }
  const q = new URLSearchParams({ type: kind, filename, subfolder, t: String(Date.now()) });
  let blob;
  let size;
  try {
    const resp = await api.fetchApi(`/gen13/private/thumb?${q}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const w = parseInt(resp.headers.get("X-Image-Width"), 10);
    const h = parseInt(resp.headers.get("X-Image-Height"), 10);
    size = w > 0 && h > 0 ? [w, h] : null;
    blob = await resp.blob();
  } catch (err) {
    if (seq === node._pvSeq) clearThumb(node);
    return;
  }
  if (seq !== node._pvSeq) return;
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    if (seq !== node._pvSeq) {
      URL.revokeObjectURL(url);
      return;
    }
    if (node._pvUrl) URL.revokeObjectURL(node._pvUrl);
    node._pvUrl = url;
    node._pvImg = img;
    node._pvSize = size ?? [img.naturalWidth, img.naturalHeight];
    buildCover(node);
    redraw(node);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (seq === node._pvSeq) clearThumb(node);
  };
  img.src = url;
}

function imageWidget(node) {
  return node.widgets?.find((w) => w.name === "image");
}

function refreshLoad(node) {
  let value = String(imageWidget(node)?.value ?? "");
  if (value.endsWith("]") && value.includes(" [")) value = value.slice(0, value.lastIndexOf(" ["));
  const cut = value.lastIndexOf("/");
  loadThumb(node, "input", cut < 0 ? value : value.slice(cut + 1), cut < 0 ? "" : value.slice(0, cut));
}

async function uploadFile(node, file) {
  const body = new FormData();
  body.append("image", file);
  body.append("type", "input");
  let data;
  try {
    const resp = await api.fetchApi("/upload/image", { method: "POST", body });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    console.warn("[Load Image Private (GeN13)] upload failed:", err);
    return;
  }
  const path = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
  const w = imageWidget(node);
  if (!w) return;
  const values = w.options?.values;
  if (Array.isArray(values) && !values.includes(path)) values.push(path);
  w.value = path;
  w.callback?.(path);
}

const ASSET_TYPE = "application/x-comfy-asset-info";
const URI_TYPES = ["text/uri-list", "text/x-moz-url"];
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;

// dragover: anything that could turn into an image file (the real check happens on drop)
function dragHasImage(e) {
  const dt = e?.dataTransfer;
  if (!dt) return false;
  const types = [...(dt.types ?? [])];
  if (types.includes("Files") || [...(dt.items ?? [])].some((i) => i.kind === "file")) return true;
  return types.includes(ASSET_TYPE) || URI_TYPES.some((t) => types.includes(t));
}

// drop: a dropped file, or an image URL from this server (queue / history card, /view link) as a File
async function droppedImageFile(e) {
  const dt = e?.dataTransfer;
  if (!dt) return null;
  const file = [...(dt.files ?? [])].find((f) => f.type.startsWith("image/") || (!f.type && IMAGE_EXT.test(f.name)));
  if (file) return file;
  let info = null;
  try { info = JSON.parse(dt.getData(ASSET_TYPE) || "null"); } catch { info = null; }
  const t = URI_TYPES.find((x) => [...(dt.types ?? [])].includes(x));
  const uri = t ? (dt.getData(t) || "").split("\n")[0].trim() : "";
  if (!uri) return null;
  let u;
  try { u = new URL(uri, location.href); } catch { return null; }
  if (u.origin !== location.origin) return null;          // 只抓自己伺服器上的圖
  try {
    const resp = await fetch(u);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob.type.startsWith("image/")) return null;
    const name = info?.filename ?? u.searchParams.get("filename") ?? u.pathname.split("/").pop() ?? "dropped.png";
    return new File([blob], name, { type: blob.type });
  } catch {
    return null;
  }
}

function pickFile(node) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    if (input.files?.[0]) uploadFile(node, input.files[0]);
  };
  input.click();
}

function applySize(node) {
  const on = prop(node, P_PREVIEW);
  if (node._pvPanel) node._pvPanel.hidden = !on;
  const min = node.computeSize();
  node.size[0] = Math.max(node.size[0], min[0]);
  node.size[1] = on ? Math.max(node.size[1], min[1]) : min[1];
  node.setSize?.([node.size[0], node.size[1]]);
  redraw(node);
}

// The preview is a DOM widget with its own <canvas>, so it shows in both the classic
// canvas (Nodes 1.0) and Vue nodes (Nodes 2.0).
function redraw(node) {
  paint(node);
  node.setDirtyCanvas?.(true, true);
}

function paint(node) {
  const cv = node._pvCanvas;
  node._pvRect = null;
  if (!cv) return;
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (!W || !H) return;
  const box = cv.getBoundingClientRect();
  const zoom = box.width > 0 ? box.width / W : 1;
  const k = (window.devicePixelRatio || 1) * zoom; // sharp at any canvas zoom
  const pw = Math.max(1, Math.round(W * k));
  const ph = Math.max(1, Math.round(H * k));
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw;
    cv.height = ph;
  }
  node._pvScale = k;
  const ctx = cv.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(k, 0, 0, k, 0, 0);

  const img = node._pvImg;
  if (!img || !prop(node, P_PREVIEW)) return;
  const boxW = W;
  const boxH = H - CAPTION_H;
  if (boxW < 20 || boxH < 20) return;
  const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const x = (boxW - w) / 2;
  const y = (boxH - h) / 2;
  node._pvRect = [x, y, w, h];

  const cover = node._pvCover;
  if (node._pvReveal || !prop(node, P_PRIVACY)) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, x, y, w, h);
  } else if (cover?.solid) {
    ctx.fillStyle = cover.solid;
    ctx.fillRect(x, y, w, h);
  } else if (cover) {
    ctx.imageSmoothingEnabled = cover.smooth;
    ctx.drawImage(cover.canvas, x, y, w, h);
  } // no cover yet: draw nothing, never the clear image

  // original size under the preview, like the core Preview Image
  const size = node._pvSize;
  if (size) {
    ctx.font = "11px Arial, sans-serif";
    ctx.fillStyle = "#CCCCCC";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${size[0]} \u00D7 ${size[1]}  (${((size[0] * size[1]) / 1e6).toFixed(2)} MP)`, W / 2, y + h + CAPTION_H / 2 + 1);
  }
}

function addPreviewPanel(node) {
  if (typeof node.addDOMWidget !== "function") return;
  const el = document.createElement("div");
  el.style.cssText = "width:100%;height:100%;position:relative;overflow:hidden";
  const cv = document.createElement("canvas");
  cv.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:default";
  el.appendChild(cv);
  const panel = node.addDOMWidget("g13_preview_panel", "g13preview", el, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PREVIEW_MIN_H,
    surfaces: { canvas: "shown", vueNode: "shown", panel: "never" },
  });
  frontOnly(panel);
  node._pvCanvas = cv;
  node._pvPanel = panel;
  try {
    new ResizeObserver(() => paint(node)).observe(el);
  } catch (err) {
    /* older browsers: painted on the next redraw */
  }

  // the panel is an HTML element sitting over the canvas: a file dropped on it never reaches the
  // canvas drop handler (the browser just opens the image), so hand it to the node's own handler.
  // Dropping on the title bar already worked; this makes the preview area work the same way.
  el.addEventListener("dragover", (e) => {
    if (!node.onDragOver?.(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  el.addEventListener("drop", (e) => {
    if (!node.onDragDrop || !node.onDragOver?.(e)) return;
    e.preventDefault();
    e.stopPropagation();
    Promise.resolve(node.onDragDrop(e)).catch((err) => console.warn("[GeN13] drop failed:", err));
  });

  // hold the preview to reveal, release anywhere to cover again
  cv.addEventListener("pointerdown", (e) => {
    const r = node._pvRect;
    if (!r || !prop(node, P_PRIVACY)) return;
    const b = cv.getBoundingClientRect();
    const lx = ((e.clientX - b.left) * cv.clientWidth) / b.width;
    const ly = ((e.clientY - b.top) * cv.clientHeight) / b.height;
    if (lx < r[0] || lx > r[0] + r[2] || ly < r[1] || ly > r[1] + r[3]) return;
    e.preventDefault();
    e.stopPropagation();
    node._pvReveal = true;
    paint(node);
    const end = () => {
      node._pvReveal = false;
      paint(node);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", end);
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
  });
}

function syncWidgets(node) {
  const w = node._pvW;
  if (!w) return;
  w.preview.value = prop(node, P_PREVIEW);
  w.privacy.value = prop(node, P_PRIVACY);
  w.style.value = prop(node, P_STYLE);
  w.palette.value = prop(node, P_PALETTE);
  w.frost.value = frostPercent(node);
  w.glass.value = prop(node, P_GLASS);
  w.bright.value = brightPercent(node);
  updateVisibility(node);
}

function updateVisibility(node) {
  const w = node._pvW;
  if (!w) return;
  const style = prop(node, P_STYLE);
  const want = {
    palette: style !== "palette",
    custom: !(style === "palette" && prop(node, P_PALETTE) === "CUSTOM"),
    solid: style !== "solid",
    frost: style !== "frosted",
    glass: style !== "frosted",
    bright: style !== "gradient" && style !== "palette",
  };
  let changed = false;
  for (const k of Object.keys(want)) {
    if (w[k].hidden !== want[k]) {
      w[k].hidden = want[k];
      changed = true;
    }
  }
  if (changed) applySize(node);
}

function colorInput(value, onInput) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = value.toLowerCase();
  input.style.cssText = "width:36px;height:28px;padding:0;border:1px solid #555;background:none;cursor:pointer";
  input.oninput = () => onInput(input.value.toUpperCase());
  return input;
}

function refreshCover(node) {
  buildCover(node);
  redraw(node);
}

// small floating panel next to the pointer; closes on outside click or Escape
// kind "palette": two pickers, dark -> light. kind "solid": AUTO + one picker
function openColorPanel(node, event, kind) {
  document.getElementById("g13-color-panel")?.remove();
  const panel = document.createElement("div");
  panel.id = "g13-color-panel";
  const px = Math.min((event?.clientX ?? innerWidth / 2) + 8, innerWidth - 200);
  const py = Math.min((event?.clientY ?? innerHeight / 2) + 8, innerHeight - 60);
  panel.style.cssText = `position:fixed;left:${px}px;top:${py}px;z-index:10000;display:flex;gap:8px;` +
    "align-items:center;padding:8px;background:#222;border:1px solid #555;border-radius:6px";
  if (kind === "solid") {
    const auto = document.createElement("button");
    auto.type = "button";
    auto.textContent = "AUTO";
    setTip(auto, T("Auto: uses the image's average color.", "自動:取圖片平均色。"));
    const paint = () => {
      const on = prop(node, P_SOLID_AUTO);
      auto.style.cssText = "height:28px;padding:0 10px;display:flex;align-items:center;justify-content:center;" +
        `line-height:1;font:12px Arial,sans-serif;background:none;border-radius:4px;cursor:pointer;` +
        `border:1px solid ${on ? "#C0FF00" : "#555"};color:${on ? "#C0FF00" : "#ccc"}`;
    };
    auto.onclick = () => {
      setProp(node, P_SOLID_AUTO, true);
      paint();
      refreshCover(node);
    };
    paint();
    panel.appendChild(auto);
    panel.appendChild(colorInput(validHex(prop(node, P_SOLID)) ? prop(node, P_SOLID) : DEFAULTS[P_SOLID], (v) => {
      setProp(node, P_SOLID, v);
      setProp(node, P_SOLID_AUTO, false);
      paint();
      refreshCover(node);
    }));
  } else {
    customStops(node).forEach((value, i) => {
      panel.appendChild(colorInput(value, (v) => {
        const next = customStops(node);
        next[i] = v;
        setProp(node, P_CUSTOM, next);
        refreshCover(node);
      }));
    });
  }
  const close = (e) => {
    if (e && panel.contains(e.target)) return;
    panel.remove();
    document.removeEventListener("pointerdown", close, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  document.body.appendChild(panel);
}

function setupNode(node, isLoad) {
  // keep the core output preview off this node (canvas and Vue paths)
  node.hideOutputImages = true;
  node.onDrawBackground = function () {};
  node.imgs = undefined;

  for (const key of Object.keys(DEFAULTS)) {
    if (node.properties?.[key] === undefined) setProp(node, key, DEFAULTS[key]);
  }

  if (isLoad) {
    const iw = imageWidget(node);
    if (iw) {
      const cb = iw.callback;
      iw.callback = function () {
        const r = cb?.apply(this, arguments);
        refreshLoad(node);
        return r;
      };
    }
    const up = frontOnly(node.addWidget("button", "choose file to upload", null, () => pickFile(node), { serialize: false }));
    setWidgetLabel(up, T("choose file to upload", "選擇檔案上傳"));
    setWidgetTip(up, T("Upload: choose an image file; dropping an image on the node also works.", "上傳:選擇圖片檔,也可直接把圖片拖到節點上。"));
    // same sources as the core Load Image: files from the OS, and images dragged from the queue /
    // history panel or another tab (asset card or URL, fetched from our own server and uploaded)
    node.onDragOver = dragHasImage;
    node.onDragDrop = async (e) => {
      const file = await droppedImageFile(e);
      if (!file) return false;
      await uploadFile(node, file);
      return true;
    };
  }

  addPrivacyWidgets(node);
  applySize(node);
  if (isLoad) setTimeout(() => refreshLoad(node), 300);
}

// preview / privacy widgets + the DOM preview panel; shared with Load Latest Image
function addPrivacyWidgets(node) {
  for (const key of Object.keys(DEFAULTS)) {
    if (node.properties?.[key] === undefined) setProp(node, key, DEFAULTS[key]);
  }
  const preview = frontOnly(
    node.addWidget("toggle", "preview", prop(node, P_PREVIEW), (v) => {
      setProp(node, P_PREVIEW, !!v);
      applySize(node);
    }, { on: "SHOW", off: "HIDE", serialize: false })
  );
  const privacy = frontOnly(
    node.addWidget("toggle", "privacy", prop(node, P_PRIVACY), (v) => {
      setProp(node, P_PRIVACY, !!v);
      redraw(node);
    }, { on: "ON", off: "OFF", serialize: false })
  );
  const style = frontOnly(
    node.addWidget("combo", "privacy_style", prop(node, P_STYLE), (v) => {
      setProp(node, P_STYLE, STYLES.includes(v) ? v : "mosaic");
      updateVisibility(node);
      buildCover(node);
      redraw(node);
    }, { values: STYLES, serialize: false })
  );
  const palette = frontOnly(
    node.addWidget("combo", "palette", prop(node, P_PALETTE), (v) => {
      setProp(node, P_PALETTE, PALETTE_NAMES.includes(v) ? v : "AURORA");
      updateVisibility(node);
      buildCover(node);
      redraw(node);
    }, { values: PALETTE_NAMES, serialize: false })
  );
  const custom = frontOnly(
    node.addWidget("button", "edit custom colors", null, (...args) => {
      const ev = args.find((a) => a && typeof a === "object" && "clientX" in a);
      openColorPanel(node, ev, "palette");
    }, { serialize: false })
  );
  const solid = frontOnly(
    node.addWidget("button", "edit solid color", null, (...args) => {
      const ev = args.find((a) => a && typeof a === "object" && "clientX" in a);
      openColorPanel(node, ev, "solid");
    }, { serialize: false })
  );
  const frost = frontOnly(
    node.addWidget("number", "frost_blur", frostPercent(node), (v) => {
      const n = Math.min(10, Math.max(2, Math.round(Number(v) || 5)));
      setProp(node, P_FROST, n);
      if (frost.value !== n) frost.value = n;
      refreshCover(node);
    }, { min: 2, max: 10, step: 10, step2: 1, round: 1, precision: 0, serialize: false })
  );
  const glass = frontOnly(
    node.addWidget("combo", "glass", prop(node, P_GLASS), (v) => {
      setProp(node, P_GLASS, GLASSES.includes(v) ? v : "plain");
      refreshCover(node);
    }, { values: GLASSES, serialize: false })
  );
  const bright = frontOnly(
    node.addWidget("number", "brightness", brightPercent(node), (v) => {
      const n = Math.min(200, Math.max(10, Math.round((Number(v) || 100) / 5) * 5));
      setProp(node, P_BRIGHT, n);
      if (bright.value !== n) bright.value = n;
      refreshCover(node);
    }, { min: 10, max: 200, step: 50, step2: 5, round: 5, precision: 0, serialize: false })
  );
  setWidgetLabel(custom, T("edit custom colors", "編輯自訂色"));
  setWidgetLabel(solid, T("edit solid color", "編輯純色"));
  setWidgetTip(preview, T("Preview: SHOW opens the image panel; HIDE folds it away. Front end only, never in the prompt.", "預覽:SHOW 顯示圖片面板,HIDE 收起;只存在前端,不寫入 prompt。"));
  setWidgetTip(privacy, T("Privacy: ON covers the preview; hold the preview to see the real image.", "隱私:ON 時預覽加上遮罩,按住預覽可看原圖。"));
  setWidgetTip(style, T("Cover style: mosaic, frosted glass, blurred gradient, palette gradient map, or one solid color.", "遮罩樣式:馬賽克、霧面玻璃、模糊漸層、色盤漸層映射或單一純色。"));
  setWidgetTip(palette, T("Palette: colors of the gradient map, dark to light; CUSTOM uses your two colors.", "色盤:漸層映射的配色,由暗到亮;CUSTOM 使用自訂的兩色。"));
  setWidgetTip(custom, T("Custom colors: the dark and light ends of the CUSTOM palette.", "自訂色:CUSTOM 色盤的暗端與亮端兩色。"));
  setWidgetTip(solid, T("Solid color: AUTO uses the image's average color, or pick a fixed color.", "純色:AUTO 取圖片平均色,或指定固定顏色。"));
  setWidgetTip(frost, T("Frost blur: blur radius as a % of the long edge; higher values blur more.", "霧化模糊:模糊半徑,以長邊百分比計;數值越高越模糊。"));
  setWidgetTip(glass, T("Glass: texture in front of the frost; plain, reeded (vertical ribs) or hammered.", "玻璃:霧面前的紋理;plain 平板、reeded 長虹直紋、hammered 錘紋。"));
  setWidgetTip(bright, T("Brightness: cover brightness in %; 100 is unchanged, higher values are brighter.", "亮度:遮罩亮度百分比,100 為不變;數值越高越亮。"));
  for (const w of [palette, custom, solid, frost, glass, bright]) w.hidden = true;
  node._pvW = { preview, privacy, style, palette, custom, solid, frost, glass, bright };
  addPreviewPanel(node);
  updateVisibility(node);
}

// ---- API for other GeN13 nodes (Load Latest Image) ------------------------------
// attachPrivacy(node): add the preview / privacy widgets and panel (call last in onNodeCreated)
// setPreviewImage(node, img, [w, h]): show a loaded HTMLImageElement; clearPreviewImage(node)
// installPrivacyHooks(nodeType): onConfigure sync + zoom repaint
export function attachPrivacy(node) {
  addPrivacyWidgets(node);
  applySize(node);
}

export function setPreviewImage(node, img, size) {
  node._pvImg = img;
  node._pvSize = size && size[0] > 0 && size[1] > 0 ? size : [img.naturalWidth, img.naturalHeight];
  buildCover(node);
  redraw(node);
}

export function setPreviewSize(node, size) {
  if (size && size[0] > 0 && size[1] > 0) node._pvSize = size;
  paint(node);
}

export function clearPreviewImage(node) {
  node._pvImg = null;
  node._pvCover = null;
  node._pvSize = null;
  redraw(node);
}

export function installPrivacyHooks(nodeType) {
  const onConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    const r = onConfigure?.apply(this, arguments);
    syncWidgets(this);
    if (!prop(this, P_PREVIEW)) applySize(this);
    buildCover(this);
    return r;
  };
  // classic canvas: repaint when the canvas zoom changes so the preview stays sharp
  const onDraw = nodeType.prototype.onDrawForeground;
  nodeType.prototype.onDrawForeground = function () {
    onDraw?.apply(this, arguments);
    const cv = this._pvCanvas;
    if (!cv || !cv.clientWidth) return;
    const k = (window.devicePixelRatio || 1) * (cv.getBoundingClientRect().width / cv.clientWidth);
    if (Math.abs(k - (this._pvScale ?? 0)) > 0.01) paint(this);
  };
}

app.registerExtension({
  name: "gen13.private_image",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!NODE_IDS.includes(nodeData.name)) return;
    const isLoad = nodeData.name === LOAD_ID;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      setupNode(this, isLoad);
      return r;
    };

    installPrivacyHooks(nodeType);
    if (isLoad) {
      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const r = onConfigure?.apply(this, arguments);
        setTimeout(() => refreshLoad(this), 300);
        return r;
      };
    }

    if (!isLoad) {
      const onExecuted = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (output) {
        onExecuted?.apply(this, arguments);
        this.imgs = undefined;
        const im = output?.images?.[0];
        if (im) loadThumb(this, im.type || "output", im.filename, im.subfolder || "");
      };
    }
  },
});
