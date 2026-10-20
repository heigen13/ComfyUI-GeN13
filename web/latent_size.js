// Resize (GeN13)
//   - mode: I2I / T2I. T2I (or I2I with no running image) -> no source: 1:1 / 3:2 / ... use megapixels
//     (+ invert), keep and custom use width x height (custom: invert swaps the two fields); images
//     are sent as None (upstream muted / bypassed counts as no image; checked on every draw)
//   - linked widgets (width / height / edge_length / megapixels fed by a link) show the value of the
//     last run, or "\u2190 input" before the first run
//   - status line (grey): the current settings, live (I2I · keep · long edge 2048, T2I · 1920 × 1088)
//   - size lines below it: one per linked image (IMAGE1..IMAGE4), the real size from the last run;
//     changing a widget never wipes them. No image1 / samples: the first line is LATENT, computed live
//     (width x height); samples only: the first line is LATENT from the last run.
//   - I2I without image1 but with image2..4 linked: the size widgets stay live (they still apply to
//     the reference images) and their size lines stay visible
//     Last sizes are kept in node.properties so they survive a reload.
//   - widgets that do not apply are greyed out: custom -> megapixels, other ratios ->
//     (nothing), keep -> width / height / invert / keep_proportion / crop_position, pad_color only for pad,
//     resize (fit inside, no crop / pad) -> crop_position, batch_size off when samples is linked
//   - keep: keep_size = original / megapixels / long or short edge = edge_length
//   - custom: width / height round DOWN to multiple_of, so the output never exceeds them
//   - invert: a button widget (frontend only, no backend field) flips the ratio (16:9 <-> 9:16) or,
//     in custom, swaps width / height. Its label says what it will do
//   - ratio mode: width / height / megapixels stay consistent (type one, the others follow)
//   - button widgets render in both the classic canvas (Nodes 1.0) and Vue nodes (2.0)

import { app } from "../../scripts/app.js";
import { isOff, onModeChange, inLink, inLinked } from "./g13_mode.js";
import { pick } from "./g13_i18n.js";

const IDS = ["ResizeGeN13"];
const IMAGES = ["image1", "image2", "image3", "image4"];
const P_SIZES = "g13_sizes";

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

// value of a widget; when its input is linked, the value reported by the last run (or null)
function val(node, name, dflt) {
  if (linked(node, name)) {
    const v = node.properties?.g13_params?.[name];
    return v == null ? null : Number(v);
  }
  const v = Number(w(node, name)?.value);
  return Number.isFinite(v) && v !== 0 ? v : dflt;
}

function floor(v, m) {
  return Math.max(m, Math.floor(v / m) * m);
}

function snap(v, m) {
  return Math.max(m, Math.round(v / m) * m);
}

function calc(node) {
  const ratio = w(node, "aspect_ratio")?.value;
  const mp = val(node, "megapixels", 1) ?? 1;
  const m = Number(w(node, "multiple_of")?.value) || 32;
  if (ratio === "custom") {
    const a = val(node, "width", 2048) ?? 2048;
    const b = val(node, "height", 1152) ?? 1152;
    return [floor(a, m), floor(b, m)]; // custom never exceeds the typed size
  }
  if (ratio === "keep") return null;
  const [a, b] = String(ratio).split(":").map(Number);
  const total = 1024 * 1024 * mp;
  const ww = Math.sqrt((total * a) / b);
  return [snap(ww, m), snap(total / ww, m)];
}

// ratio mode (1:1 / 3:2 / ...): width, height and megapixels are kept consistent on the node.
// Typing a width computes the height from the ratio (and vice versa) and rewrites megapixels, which
// is what the backend reads; changing the ratio / invert / megapixels / multiple_of rewrites width
// and height. Linked width / height are left alone.
function syncRatio(node, changed) {
  const ratio = w(node, "aspect_ratio")?.value;
  if (!ratio || ratio === "keep" || ratio === "custom") return;
  const ww = w(node, "width");
  const hh = w(node, "height");
  const mpw = w(node, "megapixels");
  if (!ww || !hh || !mpw) return;
  const [a, b] = String(ratio).split(":").map(Number);
  const name = changed?.name;
  if ((name === "width" || name === "height") && !linked(node, name)) {
    const v = Number(changed.value) || 0;
    if (v <= 0) return;
    const other = name === "width" ? (v * b) / a : (v * a) / b;
    // keep inside the backend's megapixels range (0.1–16), or the prompt is rejected as
    // "bigger than max"; width / height below are then recomputed from the clamped value
    const lo = mpw.options?.min ?? 0.1;
    const hi = mpw.options?.max ?? 16;
    mpw.value = Math.min(hi, Math.max(lo, (v * other) / (1024 * 1024)));
  }
  const s = calc(node);
  if (!s) return;
  if (!linked(node, "width")) ww.value = s[0];
  if (!linked(node, "height")) hh.value = s[1];
}

// invert is a frontend-only button (no backend field): flips the ratio 16:9 <-> 9:16, or
// width <-> height in custom. keep has nothing to flip.
function keepIsCustom(node) {
  // keep with no source image (T2I, or I2I with nothing linked) means width x height
  const i2i = w(node, "mode")?.value !== false;
  return !(i2i && (active(node, "image1") || active(node, "samples")));
}

function doInvert(node) {
  const rw = w(node, "aspect_ratio");
  const ratio = rw?.value;
  if (ratio === "custom" || (ratio === "keep" && keepIsCustom(node))) {
    const ww = w(node, "width");
    const hh = w(node, "height");
    if (ww && hh) [ww.value, hh.value] = [hh.value, ww.value];
  } else if (ratio && ratio !== "keep") {
    const [a, b] = String(ratio).split(":");
    const flipped = `${b}:${a}`;
    const values = rw.options?.values;
    if (!values || values.includes(flipped)) rw.value = flipped;
  } else {
    return;
  }
  syncRatio(node);
  update(node);
}

// what the button will do, as its label
function invertLabel(node) {
  const ratio = w(node, "aspect_ratio")?.value;
  if (ratio === "custom" || (ratio === "keep" && keepIsCustom(node))) return "invert \u2194 width / height";
  if (!ratio || ratio === "keep") return "invert";
  const [a, b] = String(ratio).split(":");
  return `invert \u2192 ${b}:${a}`;
}

function linked(node, name) {
  return inLinked(node, node.inputs?.findIndex((i) => i.name === name) ?? -1);
}

function setText(b, text) {
  if (!b || b.label === text) return;
  b.label = text;
  b.name = text;
}

function mpText(s) {
  return `${s[0]} \u00D7 ${s[1]}  (${((s[0] * s[1]) / 1e6).toFixed(2)} MP)`;
}

function sizes(node) {
  const v = node.properties?.[P_SIZES];
  return Array.isArray(v) ? v : [null, null, null, null];
}

function sizeText(node, mode) {
  // mode: original / megapixels / long_edge / short_edge
  if (mode === "original") return "original";
  const e = val(node, "edge_length", 1024);
  const inp = pick("\u2190 input", "\u2190 輸入", "\u2190 输入", "\u2190 入力");
  const es = e == null ? inp : e;
  if (mode === "long_edge") return `${pick("long edge", "長邊", "长边", "長辺")} ${es}`;
  if (mode === "short_edge") return `${pick("short edge", "短邊", "短边", "短辺")} ${es}`;
  const mp = val(node, "megapixels", 1);
  return mp == null ? `${inp} MP` : `${mp.toFixed(2)} MP`;
}

// keep with a known source size (nothing linked: width x height)
function keepSize(node, sw, sh) {
  const m = Number(w(node, "multiple_of")?.value) || 32;
  const mode = w(node, "keep_size")?.value ?? "original";
  if (mode === "original") return [floor(sw, m), floor(sh, m)];
  if (mode === "long_edge" || mode === "short_edge") {
    const e = val(node, "edge_length", 1024) ?? 1024;
    const k = e / (mode === "long_edge" ? Math.max(sw, sh) : Math.min(sw, sh));
    return [snap(sw * k, m), snap(sh * k, m)];
  }
  const total = 1024 * 1024 * (val(node, "megapixels", 1) ?? 1);
  const ww = Math.sqrt((total * sw) / sh);
  return [snap(ww, m), snap(total / ww, m)];
}

const SIZE_WIDGETS = ["aspect_ratio", "megapixels", "upscale_method", "keep_proportion",
  "crop_position", "pad_color", "keep_size", "edge_length"];

// a link counts only when its upstream node runs (mode 2 = mute / never, 4 = bypass)
function active(node, name) {
  const link = inLink(node, node.inputs?.findIndex((i) => i.name === name) ?? -1);
  if (!link) return false;
  const up = node.graph?.getNodeById?.(link.origin_id);
  return !(up && isOff(up));
}

function upstreamSig(node) {
  return ["image1", "image2", "image3", "image4", "samples"].map((n) => (active(node, n) ? 1 : 0)).join("");
}

function t2iSize(node) {
  // no source image: keep has nothing to keep, so it behaves like custom (width x height)
  const s = calc(node);
  if (s) return s;
  const m = Number(w(node, "multiple_of")?.value) || 32;
  return [floor(val(node, "width", 2048) ?? 2048, m), floor(val(node, "height", 1152) ?? 1152, m)];
}

function statusText(node, keep, custom, keepMode, src, i2i) {
  if (!i2i || !src) {
    const s = t2iSize(node);
    const why = !i2i
      ? "T2I"
      : linked(node, "image1")
        ? `I2I \u00B7 ${pick("image1 off", "image1 停用", "image1 停用", "image1 無効")}`
        : `I2I \u00B7 ${pick("no image", "無圖片", "无图片", "画像なし")}`;
    const r = w(node, "aspect_ratio")?.value;
    const byRatio = r && r !== "keep" && r !== "custom";
    const how = byRatio ? `${r} \u00B7 ${sizeText(node, "megapixels")}` : "custom";
    return `${why} \u00B7 ${how} \u00B7 ${s[0]} \u00D7 ${s[1]}`;
  }
  const ratio = w(node, "aspect_ratio")?.value;
  if (custom) {
    const s = calc(node);
    return `I2I \u00B7 custom \u00B7 ${s[0]} \u00D7 ${s[1]}`;
  }
  if (keep) return `I2I \u00B7 keep \u00B7 ${sizeText(node, keepMode)}`;
  return `I2I \u00B7 ${ratio} \u00B7 ${sizeText(node, "megapixels")} \u00B7 ${w(node, "keep_proportion")?.value}`;
}

function update(node) {
  const ratio = w(node, "aspect_ratio")?.value;
  const custom = ratio === "custom";
  const keep = ratio === "keep";
  const i2i = w(node, "mode")?.value !== false;
  const img = active(node, "image1");
  const lat = active(node, "samples");
  const src = img || lat; // a source size comes from a running link
  const refs = IMAGES.slice(1).some((n) => active(node, n)); // reference images still use the settings
  const sized = i2i && src; // the size comes from the image / latent
  const settings = i2i && (src || refs); // the size widgets do something
  const keepMode = w(node, "keep_size")?.value ?? "original";
  const dis = (name, on) => {
    const x = w(node, name);
    if (x) x.disabled = on;
  };
  node._g13sig = upstreamSig(node);

  if (!settings) {
    // T2I, or I2I with nothing linked: size comes from the ratio + megapixels (+ invert), or from
    // width / height when the ratio is keep (nothing to keep) or custom; scaling options do nothing
    for (const name of SIZE_WIDGETS) dis(name, true);
    const byRatio = !keep && !custom;
    dis("aspect_ratio", false);
    dis("megapixels", !byRatio);
    dis("width", false); // ratio mode: typing one computes the other
    dis("height", false);
    dis("batch_size", false);
  } else {
    const sizeMode = custom ? "custom" : keep ? keepMode : "megapixels";
    const edge = sizeMode === "long_edge" || sizeMode === "short_edge";
    const fit = w(node, "keep_proportion")?.value;
    dis("aspect_ratio", false);
    dis("megapixels", sizeMode !== "megapixels");
    dis("edge_length", !edge);
    dis("keep_size", !keep);
    dis("width", keep); // ratio mode: typing one computes the other; custom: used directly
    dis("height", keep);
    dis("batch_size", lat);
    dis("upscale_method", keep && keepMode === "original");
    dis("keep_proportion", keep);
    dis("crop_position", keep || fit === "stretch" || fit === "resize");
    dis("pad_color", keep || fit !== "pad");
  }
  dis("multiple_of", false);

  setText(node._g13status, statusText(node, keep, custom, keepMode, src, i2i));
  if (node._g13invert) {
    setText(node._g13invert, invertLabel(node));
    node._g13invert.disabled = keep && !!settings; // keep with a source: nothing to flip
  }

  // size lines: no image1 / samples -> LATENT live (width x height); otherwise last run per linked input
  const last = sizes(node);
  let changed = false;
  IMAGES.forEach((name, i) => {
    const row = node._g13rows?.[i];
    if (!row) return;
    let show, text;
    if (i === 0 && !sized) {
      show = true; // latent size, live
      text = mpText(t2iSize(node));
    } else if (!settings) {
      show = false;
    } else {
      show = active(node, name) || (i === 0 && lat);
      text = Array.isArray(last[i]) ? mpText(last[i]) : "\u2014";
    }
    setText(row, `${i === 0 && !img ? "LATENT" : `IMAGE${i + 1}`}  ${text ?? ""}`);
    if (!!row.hidden !== !show) {
      row.hidden = !show;
      changed = true;
    }
  });
  if (changed) {
    const min = node.computeSize();
    node.setSize?.([Math.max(node.size[0], min[0]), min[1]]);
  }
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "gen13.latent_size",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!IDS.includes(nodeData.name)) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      for (const x of node.widgets ?? []) {
        const cb = x.callback;
        x.callback = function () {
          const out = cb?.apply(this, arguments);
          syncRatio(node, x);
          update(node);
          return out;
        };
      }
      const mk = (name) => {
        const b = node.addWidget("button", name, null, () => {}, { serialize: false });
        b.serialize = false;
        return b;
      };
      node._g13status = mk("status");
      node._g13rows = IMAGES.map((n) => mk(n.toUpperCase()));
      {
        const btn = node.addWidget("button", "g13_invert", null, () => doInvert(node), { serialize: false });
        btn.serialize = false;
        node._g13invert = btn;
        const i = node.widgets.indexOf(w(node, "aspect_ratio"));
        node.widgets.splice(node.widgets.indexOf(btn), 1);
        node.widgets.splice(i + 1, 0, btn);
      }
      update(node);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      // ratio mode: width / height on the node show what megapixels gives. A linked megapixels with no
      // value from a past run is unknown: recomputing from 1 MP would mark the workflow modified on open
      if (!(linked(this, "megapixels") && val(this, "megapixels", 1) == null)) syncRatio(this);
      update(this);
      return r;
    };

    const onConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index, connected) {
      const r = onConn?.apply(this, arguments);
      // an image input was (dis)connected: its last size no longer applies
      const name = type === 1 ? this.inputs?.[index]?.name : null; // 1 = input
      const i = IMAGES.indexOf(name);
      if (i >= 0 && !app.configuringGraph) { // loading a workflow replays links: keep saved sizes
        const v = sizes(this).slice();
        v[i] = null;
        this.properties = this.properties || {};
        this.properties[P_SIZES] = v;
      }
      update(this);
      return r;
    };

    // upstream mute / bypass has no event: compare a small signature on each draw, and on Nodes 2.0
    // (no draw hook) whenever any node's mode changes
    const onFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = onFg?.apply(this, arguments);
      if (this._g13status && this._g13sig !== upstreamSig(this)) update(this);
      return r;
    };
    onModeChange(() => {
      const root = app.graph?.rootGraph ?? app.graph;
      const graphs = [root, ...(root?._subgraphs?.values?.() ?? [])];
      for (const g of graphs) for (const n of g?._nodes ?? []) {
        if (IDS.includes(n.type) && n._g13status && n._g13sig !== upstreamSig(n)) update(n);
      }
    });

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      const v = output?.gen13_sizes;
      if (Array.isArray(v)) {
        this.properties = this.properties || {};
        this.properties[P_SIZES] = v.slice(0, 4).map((x) => (Array.isArray(x) && x.length === 2 ? x : null));
        const pr = output?.gen13_params;
        if (Array.isArray(pr) && pr[0] && typeof pr[0] === "object") this.properties.g13_params = pr[0];
        update(this);
      }
    };
  },
});
