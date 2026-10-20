// Text Concatenate (GeN13)
//   - switches are labelled #01..#20 (names stay on_01..), text boxes show #01.. as placeholder
//   - count shows that many on_NN / text_NN pairs; the rest are hidden (and ignored by the node)
//   - boxes that will not be joined (OFF, or not the solo pick) are dimmed
//   - solo larger than count falls back to OFF
//   - a grey line at the bottom previews the joined text; linked boxes show as [#NN]
//   - widget.hidden works for both normal and DOM (textarea) widgets in Nodes 1.0 and 2.0
//   - every text box asks for at least the height of all its text (getMinHeight, measured on the
//     real textarea's scrollHeight); the node grows to fit, and never shrinks on load. It only shrinks
//     when count is lowered. Extra node height is shared by the boxes, so dragging taller works.
//   - rule for linked boxes (same as Text Switch): a box fed by a link has nothing to type, so it
//     is exactly one row, its #NN ON/OFF row; the text area is sized 0 and the input dot sits on
//     that row (Nodes 1.0). count can't go below the highest linked box
//   - outputs: STRING, then one output per box (#01..), the raw text of that box (ON/OFF and solo
//     don't apply). Only the first `count` box outputs are kept (trailing ones removed / re-added,
//     so slot indices never move); a linked box output keeps count from dropping below it.
//     Nodes 1.0: each box output sits at the right end of its #NN ON/OFF row (no label)

import { app } from "../../scripts/app.js";
import { emptyText } from "./g13_i18n.js";

const NODE_ID = "TextConcatenateGeN13";
const MAX = 20;
const BOX_MIN = 36; // one empty line
const BOX_MAX = 1000;

// measure the real textarea: collapse it for an instant, read scrollHeight, restore.
// Uses the box's own font, width and wrapping, so typed and pasted text measure the same.
function textHeight(e) {
  if (!e || !e.isConnected || !e.clientWidth) return BOX_MIN;
  const h = e.style.height;
  const mh = e.style.minHeight;
  e.style.minHeight = "0px";
  e.style.height = "0px";
  const sh = e.scrollHeight;
  e.style.height = h;
  e.style.minHeight = mh;
  return Math.min(BOX_MAX, Math.max(BOX_MIN, Math.ceil(sh) + 6));
}

// grow the node so every visible box shows all of its text; shrink only when boxes were hidden
function fit(node, allowShrink) {
  node._g13shrink = node._g13shrink || !!allowShrink;
  if (node._g13fitting) return;
  node._g13fitting = true;
  requestAnimationFrame(() => {
    node._g13fitting = false;
    const shrink = node._g13shrink && !node._g13loading;
    node._g13shrink = false;
    const min = node.computeSize();
    if (node.size[1] < min[1] - 1 || (shrink && node.size[1] > min[1] + 1)) {
      node.setSize?.([node.size[0], min[1]]);
    }
    node.setDirtyCanvas?.(true, true);
  });
}

// preview text is clipped by measured pixel width, not by character count (CJK is twice as wide)
let _measureCtx = null;
function clipToWidth(text, maxPx) {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  const ctx = _measureCtx;
  if (!ctx) return text.length > 48 ? text.slice(0, 47) + "…" : text;
  ctx.font = `${globalThis.LiteGraph?.NODE_SUBTEXT_SIZE ?? 12}px Inter, Arial, sans-serif`;
  if (ctx.measureText(text).width <= maxPx) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

function previewWidth(node) {
  // button widget: 15px node margin each side, arrows / padding inside the pill
  return Math.max(40, (node.size?.[0] ?? 300) - 2 * 15 - 2 * 20);
}

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

function linked(node, name) {
  const slot = node.inputs?.find((i) => i.name === name);
  return !!(slot && slot.link != null);
}

function el(widget) {
  return widget?.element ?? widget?.inputEl ?? null;
}

function setText(b, text) {
  if (!b || b.label === text) return;
  b.label = text;
  b.name = text;
}

function maxLinked(node) {
  let m = 0;
  for (let i = 1; i <= MAX; i++) if (linked(node, `text_${String(i).padStart(2, "0")}`)) m = i;
  return m;
}

function vueMode() {
  return !!globalThis.LiteGraph?.vueNodesMode;
}

const OUT_BASE = 1; // outputs: 0 STRING, 1.. boxes

// Nodes 1.0: a linked box's input dot shares its row with the on_NN widget socket, which comes first
// in the input list and takes the mouse-down. The canvas then starts a new link from on_NN; here that
// start is turned into "pick up the box's existing link" (what the stock behaviour is for a linked
// socket). Patched on the canvas's LinkConnector, so it works on frontends where the slot hit test is
// no longer a canvas method.
let _canvasPatched = false;
function patchCanvas() {
  if (_canvasPatched) return;
  const lc = app.canvas?.linkConnector;
  if (!lc || typeof lc.dragNewFromInput !== "function") return;
  _canvasPatched = true;
  const orig = lc.dragNewFromInput;
  lc.dragNewFromInput = function (network, node, input, ...rest) {
    if (node?.type === NODE_ID && !vueMode()) {
      const m = /^on_(\d\d)$/.exec(input?.name ?? "");
      const tx = m ? node.inputs?.find((s) => s.name === `text_${m[1]}`) : null;
      if (tx && tx.link != null) return this.moveInputLink(network, node, tx);
    }
    return orig.call(this, network, node, input, ...rest);
  };
}

function maxLinkedOut(node) {
  let m = 0;
  (node.outputs ?? []).forEach((o, k) => {
    if (k >= OUT_BASE && o.links?.length) m = k - OUT_BASE + 1;
  });
  return m;
}

// keep exactly `count` box outputs; only trailing outputs are added or removed
function syncOutputs(node, count) {
  if (!node.outputs) node.outputs = [];
  const o0 = node.outputs[0];
  if (!o0) node.addOutput("STRING", "STRING");
  else if (o0.name !== "STRING" || o0.type !== "STRING") {
    o0.name = "STRING";
    o0.type = "STRING";
    o0.label = "STRING";
  }
  while (node.outputs.length > OUT_BASE + count) node.removeOutput(node.outputs.length - 1);
  while (node.outputs.length < OUT_BASE + count) {
    node.addOutput(`#${String(node.outputs.length - OUT_BASE + 1).padStart(2, "0")}`, "STRING");
  }
  for (let k = OUT_BASE; k < node.outputs.length; k++) {
    const o = node.outputs[k];
    const name = `#${String(k - OUT_BASE + 1).padStart(2, "0")}`;
    if (o.name !== name) o.name = name;
    if (o.type !== "STRING") o.type = "STRING";
    const label = vueMode() ? name : "\u200B";
    if (o.label !== label) o.label = label;
  }
}

function update(node, allowShrink) {
  const cw = w(node, "count");
  const ml = Math.max(maxLinked(node), maxLinkedOut(node));
  if (cw && Number(cw.value) < ml) cw.value = ml; // a linked box can't be hidden
  const count = Math.max(1, Math.min(MAX, Number(cw?.value) || 1));
  syncOutputs(node, count);
  const soloW = w(node, "solo");
  if (soloW && soloW.value !== "OFF" && Number(String(soloW.value).replace("#", "")) > count) soloW.value = "OFF";
  const solo = soloW && soloW.value !== "OFF" ? Number(String(soloW.value).replace("#", "")) : 0;
  const delim = String(w(node, "delimiter")?.value ?? "").replace(/\\n/g, " ⏎ ").replace(/\\t/g, " ⇥ ");

  const parts = [];
  let hid = !!allowShrink;
  for (let i = 1; i <= MAX; i++) {
    const nn = String(i).padStart(2, "0");
    const on = w(node, `on_${nn}`);
    const tx = w(node, `text_${nn}`);
    const hide = i > count;
    for (const x of [on, tx]) {
      if (x && !!x.hidden !== hide) {
        x.hidden = hide;
        if (hide) hid = true;
      }
    }
    if (hide) continue;
    const active = solo ? i === solo : !!on?.value;
    const e = el(tx);
    if (e) e.style.opacity = active ? "1" : "0.35";
    if (on) on.disabled = !!solo; // solo overrides the switches without changing them
    if (!active) continue;
    if (linked(node, `text_${nn}`)) parts.push(`[#${nn}]`);
    else {
      const t = String(tx?.value ?? "").trim();
      if (t) parts.push(t.replace(/\s*\n\s*/g, " "));
    }
  }
  let out = parts.join(delim);
  if (!out) out = emptyText();
  else out = clipToWidth(out, previewWidth(node));
  setText(node._g13prev, out);

  fit(node, hid);
}

app.registerExtension({
  name: "gen13.text_concat",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      patchCanvas();
      for (const x of node.widgets ?? []) {
        const cb = x.callback;
        x.callback = function () {
          const out = cb?.apply(this, arguments);
          update(node);
          return out;
        };
        const m = /^(on|text)_(\d\d)$/.exec(x.name);
        if (m) x.label = `#${m[2]}`; // Nodes 2.0 shows the raw name (text_01) without a label
        const e = el(x);
        if (e && e.tagName === "TEXTAREA") {
          if (m) e.placeholder = `#${m[2]}`;
          e.style.overflowY = "hidden";
          x.options = x.options || {};
          const gone = () => x.hidden || linked(node, x.name);
          x.options.getMinHeight = () => (gone() ? 0 : textHeight(e));
          x.options.getMaxHeight = () => (gone() ? 0 : BOX_MAX);
          e.addEventListener("input", () => update(node));
          e.addEventListener("paste", () => setTimeout(() => update(node), 0));
        }
      }
      const b = node.addWidget("button", "preview", null, () => {}, { serialize: false });
      b.serialize = false;
      node._g13prev = b;
      requestAnimationFrame(() => update(node));
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      // text is restored after layout: fit twice so wrapped lines are measured at the real width;
      // while loading the saved node size is kept (grow only)
      this._g13loading = true;
      requestAnimationFrame(() => update(this));
      setTimeout(() => {
        this._g13loading = false;
        update(this, true); // height follows content after load / paste (linked boxes are 0 high)
      }, 300);
      return r;
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = onResize?.apply(this, arguments);
      // width changes re-wrap the text; height always follows the content
      if (this._g13w !== size?.[0]) {
        this._g13w = size?.[0];
        update(this);
      }
      return r;
    };

    // Nodes 1.0: a linked box's input dot sits on its #NN ON/OFF row (the text area is 0 high);
    // every box output sits at the right end of that row. Slots with a fixed `pos` are left out of
    // the default vertical stack, so before the stock arrange() box outputs are parked in the
    // STRING row, and after it moved to their rows.
    const arrange = nodeType.prototype.arrange;
    nodeType.prototype.arrange = function () {
      if (vueMode()) return arrange?.apply(this, arguments);
      const x = this.size[0] + 1 - 10; // same column as STRING
      const outs = this.outputs ?? [];
      for (let k = OUT_BASE; k < outs.length; k++) outs[k].pos = [x, 14];
      const r = arrange?.apply(this, arguments);
      for (let i = 1; i <= MAX; i++) {
        const nn = String(i).padStart(2, "0");
        const on = w(this, `on_${nn}`);
        if (!on || on.hidden || typeof on.y !== "number") continue;
        const o = outs[OUT_BASE + i - 1];
        if (o) {
          const oy = on.y + 10; // centre of the 20px toggle row
          o.pos = [x, oy];
          if (o.boundingRect) {
            o.boundingRect[0] = this.pos[0] + x - 10;
            o.boundingRect[1] = this.pos[1] + oy - 10;
            o.boundingRect[2] = 20;
            o.boundingRect[3] = 20;
          }
        }
        if (!linked(this, `text_${nn}`)) continue;
        const inp = this.inputs?.find((s) => s.name === `text_${nn}`);
        if (!inp) continue;
        const y = on.y + 10; // centre of the 20px toggle row
        inp.pos = [10, y];
        if (inp.boundingRect) {
          inp.boundingRect[0] = this.pos[0];
          inp.boundingRect[1] = this.pos[1] + y - 10;
          inp.boundingRect[3] = 20;
        }
        // on_NN 的接點與綠點同列且排在前面,會先吃掉點擊 → 由 patchCanvas 的命中測試先找文字接點
      }
      return r;
    };

    // the stock computeSize counts every output as a top row; box outputs are not rows
    const computeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function (out) {
      const size = computeSize.apply(this, arguments);
      if (!vueMode() && this.outputs && this.outputs.length > OUT_BASE) {
        const rows = Math.max(1, OUT_BASE) - Math.max(1, this.outputs.length);
        size[1] += rows * (globalThis.LiteGraph?.NODE_SLOT_HEIGHT ?? 20);
      }
      return size;
    };

    const onConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = onConn?.apply(this, arguments);
      if (this._g13prev) update(this, true);
      return r;
    };
  },
});
