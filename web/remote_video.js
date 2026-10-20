// Remote Video (GeN13): aspect ratio / megapixels / seconds with an optional first-frame image
//   - mirrors, bypass sync and wires driving the whole group: web/remote_core.js + web/remote_link.js
//     (a wire into one mirror's image input feeds every mirror of the group)
//   - seconds: arrows move 1 s, typed values keep one decimal (no step picker)
//   - two grey lines: picture (size · ratio · megapixels; keep + image shows the real size after a run)
//     and time (seconds × fps = frames)
import { app } from "../../scripts/app.js";
import { registerRemote } from "./remote_core.js";
import { inLinked } from "./g13_mode.js";

const NODE_ID = "RemoteVideoGeN13";
const SYNCED = ["aspect_ratio", "megapixels", "seconds", "frame_rule", "steps"];
const MULTIPLE = 32;
const NO_IMAGE_RATIO = "9:16";
// same table as nodes/remote_video.py FRAME_RULES: [fps, m, b]
const RULES = {
  "H3 · 24 fps (17n+5)": [24, 17, 5],
  "Wan · 16 fps (4n+1)": [16, 4, 1],
  "Wan · 24 fps (4n+1)": [24, 4, 1],
  "Wan · 30 fps (4n+1)": [30, 4, 1],
  "LTX · 24 fps (8n+1)": [24, 8, 1],
  "LTX · 25 fps (8n+1)": [25, 8, 1],
};

function lengthOf(sec, rule) {
  const [fps, m, b] = RULES[rule] || RULES["H3 · 24 fps (17n+5)"];
  const n = Math.max(b, Math.floor(Number(sec) * fps + 0.5));
  return n + ((((b - n) % m) + m) % m);
}

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

function val(node, name) {
  return w(node, name)?.value;
}

function snap(v) {
  return Math.max(MULTIPLE, Math.round(v / MULTIPLE) * MULTIPLE);
}

// same as nodes/latent_size.py target_size() for a ratio
function sizeOf(ratio, mp) {
  const [a, b] = ratio.split(":").map(Number);
  const total = 1024 * 1024 * Number(mp);
  const wd = Math.sqrt((total * a) / b);
  return [snap(wd), snap(total / wd)];
}

function imageLinked(node) {
  return inLinked(node, node.inputs?.findIndex((x) => x.name === "image") ?? -1);
}

function setup(node) {
  const mw = w(node, "megapixels");
  if (mw?.options) {
    mw.options.step2 = 0.1;  // arrows move 0.1 MP
    mw.options.step = 1;     // legacy litegraph: 0.1 × step
    mw.options.round = 0.01; // typed values keep two decimals (0.45)
    mw.options.precision = 2;
  }
  const sw = w(node, "seconds");
  if (sw?.options) {
    sw.options.step2 = 1;    // new frontend: arrows move step2
    sw.options.step = 10;    // legacy litegraph: arrows move 0.1 × step
    sw.options.round = 0.1;
    sw.options.precision = 1;
  }
  const mk = (name) => {
    const b = node.addWidget("button", name, null, () => {}, { serialize: false });
    b.serialize = false;
    return b;
  };
  node._g13sum = [mk("size"), mk("time")]; // line 1: picture, line 2: time
}

function setLabel(node, b, t) {
  if (b.label !== t) {
    b.label = t;
    b.name = t;
    node.setDirtyCanvas?.(true, true);
  }
}

function onDraw(node) {
  const [sz, tm] = node._g13sum || [];
  if (!sz || !tm) return;
  if (node._g13ran && node._g13key !== `${val(node, "aspect_ratio")}|${val(node, "megapixels")}`) node._g13ran = null;
  const S = "  \u00B7  ";
  const r = val(node, "aspect_ratio") || "keep";
  const mp = `${(Number(val(node, "megapixels")) || 0).toFixed(2)} MP`;
  const sec = Number(val(node, "seconds")) || 0;
  const fps = (RULES[val(node, "frame_rule")] || RULES["H3 · 24 fps (17n+5)"])[0];
  let line1;
  if (r === "keep" && imageLinked(node)) line1 = node._g13ran ? [node._g13ran, "keep", mp].join(S) : ["keep · image", mp].join(S);
  else if (r === "keep") line1 = [sizeOf(NO_IMAGE_RATIO, mp.split(" ")[0]).join(" × "), `keep → ${NO_IMAGE_RATIO}`, mp].join(S);
  else line1 = [sizeOf(r, mp.split(" ")[0]).join(" × "), r, mp].join(S);
  const line2 = `${sec.toFixed(1)} s  \u00D7  ${fps} fps  =  ${lengthOf(sec, val(node, "frame_rule"))} frames${S}${val(node, "steps")} steps`;
  setLabel(node, sz, line1);
  setLabel(node, tm, line2);
}

registerRemote({ nodeId: NODE_ID, extName: "gen13.remote_video", synced: SYNCED, setup, onDraw });

// real size from the last run (keep + image): shown until the ratio / megapixels change
app.registerExtension({
  name: "gen13.remote_video_size",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    const onExec = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (msg) {
      const r = onExec?.apply(this, arguments);
      const s = msg?.g13_size?.[0];
      if (s) this._g13ran = s.split(" · ")[0];
      this._g13key = `${val(this, "aspect_ratio")}|${val(this, "megapixels")}`;
      return r;
    };
    const onDrawFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      if (this._g13ran && this._g13key !== `${val(this, "aspect_ratio")}|${val(this, "megapixels")}`) this._g13ran = null;
      return onDrawFg?.apply(this, arguments);
    };
  },
});
