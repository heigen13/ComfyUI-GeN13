// Text Switch (GeN13)
//   - count shows that many boxes; the rest are hidden
//   - the select dropdown only lists the visible boxes; select above count drops to the last box
//   - every box has a header row (DOM widget, Nodes 1.0 and 2.0): [arrow] [#NN] [title]
//       arrow  : collapse / expand this box (text box hidden, node shrinks)
//       #NN    : click = select this box (highlighted when selected); also expands it
//       title  : free text, kept in node.properties.g13 (saved with the workflow, not in the API prompt)
//       linked : shown at the right end when the box is fed by a link
//   - a 6px spacer row above count keeps the slot block (chain / select_num) off the widgets
//   - EXPAND ALL / COLLAPSE ALL bar under select
//   - no dimming: every box stays editable; the selected one is marked by its header number
//   - STRING output: live only on the last node of a chain (no chain output linked). On every other
//     node its dot is dimmed and the pointer lookups answer "nothing" for it — the canvas-level
//     LGraphCanvas.isOverNodeOutput (what starts a link drag) and the node-level getOutputOnPos /
//     getSlotOnPos / getSlotInPosition — so no link can be dragged out of it (the front end ignores
//     onMouseDown's return value, and shrinking boundingRect moves the drawing); a connection
//     attempt is refused too (it would carry "" whenever the pick is downstream). Linking a chain input cuts the
//     upstream node's existing STRING links at that moment (user action only, never on load).
//   - a collapsed box opens when it gets selected (#NN click or the dropdown). That open is
//     "automatic": picking another box closes it again. A box the user opened himself (arrow,
//     EXPAND ALL) stays open. node._g13auto = local index of the box this node auto-opened.
//   - rule for linked boxes: a box fed by a link has nothing to type, so it is always exactly one
//     header row ("#02 title  linked"), whatever EXPAND / COLLAPSE says; its input dot sits on that
//     header row. EXPAND / COLLAPSE only open and close the text areas of unlinked boxes.
//   - a grey line at the bottom previews the output: #NN title · text ([#NN] when linked)
//   - box sizing, linked-box frame (canvas, Nodes 1.0 only) and count >= highest linked box
//     follow Text Concatenate (GeN13)
//   - outputs: chain, STRING, then one STRING output per box (#01..). Only the first `count` box
//     outputs are kept (trailing ones removed/re-added as count changes, so slot indices never
//     move); an output with a link keeps count from dropping below it. Output labels show the
//     box title ("#03 Studio").
//   - select_num (optional INT input, head only): when linked to a live node, the pick comes from
//     upstream at run time (Counter, Trigger, Int...). A bypassed or muted upstream drops out of the
//     prompt, so the backend falls back to select; the front end treats that link as absent too,
//     following virtual nodes (KJNodes Get / Set) back to the real source. The head's select and auto next are dimmed and left alone,
//     no box is marked (the value is unknown here) and the preview says so.
//   - select_num fed by a value known on the canvas (Remote Int / Text Switch Remote (GeN13), core
//     Int): the box is marked and previewed as usual, clicking #NN writes that number back into the
//     source node (a remote then syncs its mirrors). Fed by anything computed at run time (Counter,
//     math...): no box is marked and the preview says select <- select_num.
//   - fed by a Text Switch Remote (GeN13), the Text Switch is one more mirror of that remote: select,
//     #NN clicks and auto next stay live and write into the remote (which passes them on to its
//     mirrors); count changes keep the same box and renumber the remote. Fed by any other live INT,
//     select and auto next are dimmed.
//   - globalThis.G13TextSwitch: isHead / describe / stepBox / refresh, used by Text Switch Remote.
//   - chain: nodes linked chain(out) -> chain(in) form one switch. The head (no chain input) owns
//     select and lists every visible box of the whole chain; a chained node shows the head's pick in
//     its own select, dimmed. Box numbers run on from the previous node's last visible box (head
//     count 5 -> next node starts at #06), any number of nodes; the backend accepts any "#N", so the
//     dropdown is filled here, not from the node def. When a count changes (or a node joins / leaves
//     the chain) the head keeps the same BOX selected (node + local index), so the number shown may
//     change but the picked text does not. Clicking #NN on any node sets the head. Connecting a
//     chain input snaps the node to the right of its upstream, same width, same top, so a row of
//     switches lines up.
//   - auto next (row under select, front-end only, kept in node.properties.g13.adv, not in the API
//     prompt): OFF = select stays; NEXT = after each queued run the head steps to the next box that
//     has text or a link (empty boxes skipped, wraps to the first). The run that was sent is always
//     the box marked before it stepped. Follows Comfy.WidgetControlMode (after / before) like the
//     core control_after_generate. Chained nodes show the head's setting, dimmed.

import { app } from "../../scripts/app.js";
import { isOff } from "./g13_mode.js";
import { T, setTip, setWidgetTip } from "./g13_i18n.js";

const NODE_ID = "TextSwitchGeN13";
const MAX = 25;
const BOX_MIN = 36; // one empty line
const BOX_MAX = 1000;
const HEAD_H = 28; // widget slot; DOM margin 1 + 2px pad top/bottom = 22px header
const GAP_H = 6; // spacer between the input slots and count
const SEL_MAX = 9999; // select is "#N"; two digits minimum, grows past #99 naturally
const CSS = `
.g13sw-h{box-sizing:border-box;height:22px;display:flex;align-items:center;background:#2b2b2b;border:1px solid #1e1e1e;border-radius:4px;overflow:hidden;font:12px/1 Inter,Helvetica,Arial,sans-serif;color:#c8c8c8;user-select:none}
.g13sw-h button{all:unset;box-sizing:border-box;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-right:1px solid #1e1e1e;color:#888}
.g13sw-h .g13sw-ar{width:22px}
.g13sw-h .g13sw-ar svg{display:block;transition:transform .12s ease-out}
.g13sw-h.g13sw-col .g13sw-ar svg{transform:rotate(-90deg)}
.g13sw-h .g13sw-no{width:34px}
.g13sw-h .g13sw-no:hover{color:#ddd}
.g13sw-h.g13sw-sel .g13sw-no{background:#35d0ff;color:#0b2a33}
.g13sw-h.g13sw-off .g13sw-no{color:#555;pointer-events:none}
.g13sw-h input{all:unset;box-sizing:border-box;flex:1;min-width:0;height:22px;padding:0 8px;color:#c8c8c8;font:12px/1 Inter,Helvetica,Arial,sans-serif;cursor:text}
.g13sw-h input::placeholder{color:#666}
.g13sw-h .g13sw-lk{display:none;height:22px;align-items:center;padding:0 8px;color:#777;border-left:1px solid #1e1e1e}
.g13sw-h.g13sw-linked .g13sw-lk{display:flex}
.g13sw-h.g13sw-linked .g13sw-ar{visibility:hidden;pointer-events:none}
.dom-widget:has(>.g13sw-wrap){pointer-events:none!important}
.g13sw-wrap{box-sizing:border-box;width:100%;height:100%;padding:2px 9px;pointer-events:none}
.g13sw-wrap>*{pointer-events:auto}
.g13sw-wrap.g13sw-row{padding:2px 20px}
.g13sw-bar{box-sizing:border-box;height:22px;display:flex;gap:6px;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.5px}
.g13sw-bar button{all:unset;box-sizing:border-box;flex:1;height:22px;display:flex;align-items:center;justify-content:center;background:#222;border:1px solid #1a1a1a;border-radius:11px;color:#bbb;cursor:pointer}
.g13sw-bar button:hover{color:#eee;border-color:#555}
.g13sw-adv{box-sizing:border-box;height:22px;display:flex;align-items:center;background:#222;border:1px solid #1a1a1a;border-radius:11px;padding:0 3px 0 12px;font:12px/1 Inter,Helvetica,Arial,sans-serif;color:#999;user-select:none}
.g13sw-adv .g13sw-lb{flex:1;display:flex;align-items:center;height:22px}
.g13sw-adv .g13sw-seg{box-sizing:border-box;height:16px;display:flex;border:1px solid #444;border-radius:8px;overflow:hidden}
.g13sw-adv .g13sw-seg button{all:unset;box-sizing:border-box;width:44px;height:14px;display:flex;align-items:center;justify-content:center;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.5px;color:#888;cursor:pointer}
.g13sw-adv .g13sw-seg button:hover{color:#ddd}
.g13sw-adv .g13sw-seg button.on{background:#35d0ff;color:#0b2a33}
.g13sw-adv.g13sw-dim .g13sw-seg{opacity:.45;pointer-events:none}
`;

function injectCss() {
  if (document.getElementById("g13sw-css")) return;
  const s = document.createElement("style");
  s.id = "g13sw-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

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

function nn(i) {
  return String(i).padStart(2, "0");
}

function lbl(g) {
  return `#${nn(g)}`;
}

function maxLinked(node) {
  let m = 0;
  for (let i = 1; i <= MAX; i++) if (linked(node, `text_${nn(i)}`)) m = i;
  return m;
}

function graphOf(node) {
  return node.graph ?? app.graph;
}

function nodeById(node, id) {
  return graphOf(node)?.getNodeById?.(id) ?? null;
}

function upstream(node) {
  const slot = node.inputs?.find((i) => i.name === "chain");
  if (!slot || slot.link == null) return null;
  const l = graphOf(node)?.links?.[slot.link] ?? graphOf(node)?.links?.get?.(slot.link);
  const up = l ? nodeById(node, l.origin_id) : null;
  return up && up.type === NODE_ID ? up : null;
}

// select_num has a usable link: linked, and the real source node is neither muted (2) nor bypassed (4).
// Virtual nodes in between (KJNodes Get / Set, reroutes) are walked through to the node that
// actually ends up in the prompt; a muted / bypassed virtual node in the path counts too.
function linkOf(g, id) {
  return g?.links?.[id] ?? g?.links?.get?.(id) ?? null;
}
// the real node feeding select_num, or null when unlinked / muted / bypassed anywhere on the path
function sourceOf(node) {
  const slot = node.inputs?.find((i) => i.name === "select_num");
  if (!slot || slot.link == null) return null;
  let g = graphOf(node);
  let l = linkOf(g, slot.link);
  for (let hop = 0; l && hop < 16; hop++) {
    const up = g?.getNodeById?.(l.origin_id);
    if (!up) return null;
    if (isOff(up)) return null;
    if (!up.isVirtualNode) return up;
    // Get node: its setter's input link; Set node / reroute: its own first input link
    const next = typeof up.getInputLink === "function" ? up.getInputLink(l.origin_slot ?? 0) : null;
    if (next) {
      const setter = up.findSetter?.(up.graph);
      if (setter && isOff(setter)) return null;
      g = setter?.graph ?? up.graph ?? g;
      l = next;
    } else {
      const inp = up.inputs?.[0];
      l = inp?.link != null ? linkOf(up.graph ?? g, inp.link) : null;
    }
  }
  return null;
}
function extLinked(node) {
  return !!sourceOf(node);
}

// sources whose number is known on the canvas (a plain "value" widget, no run-time math)
const STATIC_SRC = new Set(["RemoteIntGeN13", "RemoteTextSwitchGeN13", "PrimitiveInt"]);
function staticSource(node) {
  const s = sourceOf(node);
  return s && STATIC_SRC.has(s.type) && w(s, "value") ? s : null;
}
function remoteSource(node) {
  const s = staticSource(node);
  return s?.type === "RemoteTextSwitchGeN13" ? s : null;
}
function writeRemote(src, name, v) {
  const x = w(src, name);
  if (!x || x.value === v) return;
  x.value = v;
  x.callback?.(v); // the remote syncs its mirrors and refreshes this switch
  src.setDirtyCanvas?.(true, true);
}
function staticNum(node) {
  const s = staticSource(node);
  if (!s) return null;
  const v = Math.round(Number(w(s, "value").value));
  return Number.isFinite(v) ? Math.max(1, v) : null;
}

function downstream(node) {
  const out = node.outputs?.find((o) => o.name === "chain");
  const res = [];
  for (const id of out?.links ?? []) {
    const l = graphOf(node)?.links?.[id] ?? graphOf(node)?.links?.get?.(id);
    const t = l ? nodeById(node, l.target_id) : null;
    if (t && t.type === NODE_ID) res.push(t);
  }
  return res;
}

// head first, then each node down the chain (first chain link only when a chain output fans out)
function chainNodes(node) {
  const seen = new Set();
  let head = node;
  while (seen.size < 256) {
    seen.add(head);
    const up = upstream(head);
    if (!up || seen.has(up)) break;
    head = up;
  }
  const list = [];
  let cur = head;
  const seen2 = new Set();
  while (cur && !seen2.has(cur) && list.length < 256) {
    seen2.add(cur);
    list.push(cur);
    cur = downstream(cur)[0] ?? null;
  }
  return list;
}

const OUT_BASE = 2; // outputs: 0 chain, 1 STRING, 2.. boxes

function maxLinkedOut(node) {
  let m = 0;
  (node.outputs ?? []).forEach((o, k) => {
    if (k >= OUT_BASE && o.links?.length) m = k - OUT_BASE + 1;
  });
  return m;
}

// keep exactly `count` box outputs; only trailing outputs are added or removed
const BASE_OUT = [["chain", "G13_SWITCH"], ["STRING", "STRING"]];

function syncOutputs(node, count, offset, titles, off) {
  // a node restored from an older save may come with fewer (or renamed) outputs: the first two are
  // always chain / STRING, every later one is a box output named #NN
  if (!node.outputs) node.outputs = [];
  for (let k = 0; k < OUT_BASE; k++) {
    const [name, type] = BASE_OUT[k];
    const o = node.outputs[k];
    if (!o) node.addOutput(name, type);
    else if (o.name !== name || o.type !== type) {
      o.name = name;
      o.type = type;
      o.label = name;
    }
  }
  while (node.outputs.length > OUT_BASE + count) node.removeOutput(node.outputs.length - 1);
  while (node.outputs.length < OUT_BASE + count) {
    node.addOutput(`#${nn(node.outputs.length - OUT_BASE + 1)}`, "STRING");
  }
  for (let k = OUT_BASE; k < node.outputs.length; k++) {
    const o = node.outputs[k];
    const name = `#${nn(k - OUT_BASE + 1)}`;
    if (o.name !== name) o.name = name;
    if (o.type !== "STRING") o.type = "STRING";
  }
  for (let i = 1; i <= count; i++) {
    const o = node.outputs[OUT_BASE + i - 1];
    if (!o) continue;
    const t = String(titles[i - 1] || "").trim();
    const label = vueMode() ? `${off ? "\u2014" : "#" + nn(offset + i)}${t ? " " + t : ""}` : "\u200B";
    if (o.label !== label) o.label = label;
  }
}

// visible boxes of a node: its count, never below a linked box (in or out) so numbering is the same
// on every node of the chain even before update() has lifted that node's count widget
function countOf(node) {
  const c = Number(w(node, "count")?.value) || 1;
  return Math.max(1, Math.min(MAX, Math.max(c, maxLinked(node), maxLinkedOut(node))));
}

function numOf(v) {
  const n = Number(String(v ?? "#01").replace("#", "")) || 1;
  return Math.max(1, Math.min(SEL_MAX, n));
}

// a bypassed node: at run time ComfyUI hands its chain input straight to the next node (a bypassed
// head hands on nothing, so the next node runs as the head from #01 with its mirrored select), so its
// boxes drop out of the numbering, the same as unplugging it; they come back when the bypass is lifted
function skipped(chain, k) {
  return chain[k]?.mode === 4;
}
function boxesOf(chain, k) {
  return skipped(chain, k) ? 0 : countOf(chain[k]);
}

// offs[k] = global number before node k's first box; offs[chain.length] = total visible boxes
function offsetsOf(chain) {
  const offs = [0];
  chain.forEach((n, k) => offs.push(offs[k] + boxesOf(chain, k)));
  return offs;
}

// which node of the chain owns global number g: { k: chain index, i: local box } (k = -1 when past the end)
function ownerOf(chain, g) {
  const offs = offsetsOf(chain);
  for (let k = 0; k < chain.length; k++) if (g <= offs[k + 1]) return { k, i: g - offs[k] };
  return { k: -1, i: 0 };
}

function updateChain(node, allowShrink) {
  for (const n of chainNodes(node)) update(n, allowShrink, true);
}

// titles + collapsed flags live in node.properties.g13 so they are saved with the workflow
function props(node) {
  node.properties = node.properties || {};
  let p = node.properties.g13;
  if (!p || !Array.isArray(p.t) || !Array.isArray(p.c)) {
    p = node.properties.g13 = { t: Array(MAX).fill(""), c: Array(MAX).fill(false) };
  }
  while (p.t.length < MAX) p.t.push("");
  while (p.c.length < MAX) p.c.push(false);
  if (typeof p.adv !== "boolean") p.adv = false; // older saves have no advance: OFF
  return p;
}

function controlBefore() {
  try {
    return app.extensionManager?.setting?.get?.("Comfy.WidgetControlMode") === "before";
  } catch {
    return false;
  }
}

// head steps to the next visible box of the chain that has text or a link; empty boxes are skipped
function advanceNext(head) {
  const chain = chainNodes(head);
  const sw = w(head, "select");
  if (!sw) return;
  const offs = offsetsOf(chain);
  const list = [];
  chain.forEach((n, k) => {
    const c = boxesOf(chain, k);
    for (let i = 1; i <= c; i++) {
      const name = `text_${nn(i)}`;
      const has = linked(n, name) || String(w(n, name)?.value ?? "").trim() !== "";
      list.push({ g: offs[k] + i, has });
    }
  });
  if (!list.length) return;
  const cur = numOf(sw.value);
  const at = Math.max(0, list.findIndex((x) => x.g === cur));
  for (let s = 1; s <= list.length; s++) {
    const x = list[(at + s) % list.length];
    if (x.has) {
      if (sw.value !== lbl(x.g)) sw.value = lbl(x.g);
      break;
    }
  }
  updateChain(head, false);
}

// selecting a box shows it; a box opened this way closes again when another box gets selected,
// a box the user opened himself is left alone
function openSelected(chain, owner, i) {
  for (const n of chain) {
    if (n._g13auto && !(n === owner && n._g13auto === i)) {
      props(n).c[n._g13auto - 1] = true;
      n._g13auto = 0;
    }
  }
  if (!owner) return;
  const p = props(owner);
  if (p.c[i - 1]) {
    p.c[i - 1] = false;
    owner._g13auto = i;
  }
}

function selectBox(node, i) {
  const chain = chainNodes(node);
  const head = chain[0];
  const pos = Math.max(0, chain.indexOf(node));
  if (skipped(chain, pos)) return; // bypassed: its boxes have no number right now
  const g = offsetsOf(chain)[pos] + i;
  const src = extLinked(head) ? staticSource(head) : null;
  if (src) {
    // the pick lives in the source node: write it there (a remote passes it on to its mirrors)
    const vw = w(src, "value");
    vw.value = g;
    vw.callback?.(g);
    src.setDirtyCanvas?.(true, true);
  } else {
    const sw = w(head, "select");
    if (sw) sw.value = lbl(g);
  }
  openSelected(chain, node, i);
  updateChain(node, true);
}

function update(node, allowShrink, inChain) {
  const p = props(node);
  const cw = w(node, "count");
  const ml = Math.max(maxLinked(node), maxLinkedOut(node));
  if (cw && Number(cw.value) < ml) cw.value = ml; // a linked box (in or out) can't be hidden
  const count = countOf(node);

  const chain = chainNodes(node);
  const head = chain[0];
  const pos = Math.max(0, chain.indexOf(node));
  const offs = offsetsOf(chain);
  const offset = offs[pos];
  const total = offs[chain.length];
  const isHead = head === node;

  // the head's dropdown lists every visible box of the chain (numbers run on from node to node);
  // chained nodes mirror the head, dimmed
  const hw0 = w(head, "select");
  const visible = [];
  for (let g = 1; g <= total; g++) visible.push(lbl(g));
  if (hw0) {
    hw0.options = hw0.options || {};
    hw0.options.values = visible;
    const rsrc = remoteSource(head); // a Text Switch Remote owns the pick: this switch mirrors it
    let g = rsrc ? numOf(w(rsrc, "value").value) : numOf(hw0.value);
    // counts or chain membership changed: keep the same box (node + local index), renumbered
    const key = chain.map((n, k) => `${n.id}:${boxesOf(chain, k)}`).join(",");
    const pick = head._g13pick;
    const moved = head._g13key !== undefined && head._g13key !== key && pick;
    if (moved) {
      const k = chain.findIndex((n) => n.id === pick.id);
      if (k >= 0) g = boxesOf(chain, k) ? offs[k] + Math.min(pick.i, boxesOf(chain, k)) : Math.max(1, offs[k]);
    }
    if (rsrc) {
      // renumber the remote only for a real edit, never while a workflow is still loading
      const loading = head._g13loading || app.configuringGraph;
      if (moved && !loading && g !== numOf(w(rsrc, "value").value)) writeRemote(rsrc, "value", g);
      if (g >= 1 && g <= total && hw0.value !== lbl(g)) hw0.value = lbl(g);
    } else {
      g = Math.max(1, Math.min(g, total));
      if (hw0.value !== lbl(g)) hw0.value = lbl(g);
    }
    const o = ownerOf(chain, g);
    head._g13key = key;
    if (o.k >= 0) head._g13pick = { id: chain[o.k].id, i: o.i };
  }
  const ext = extLinked(head); // pick driven by an INT link at run time
  const known = ext ? staticNum(head) : null; // ... whose number is known right now
  node._g13ext = isHead ? ext : undefined; // only the head watches its own select_num on redraw
  node._g13known = isHead ? known : undefined;
  const gsel = known ?? numOf(hw0?.value);
  const sw = w(node, "select");
  if (sw && !isHead) {
    sw.options = sw.options || {};
    sw.options.values = [lbl(gsel)];
    sw.value = lbl(gsel);
    sw.disabled = true;
  } else if (sw) {
    sw.disabled = ext && !remoteSource(head);
  }
  const off = skipped(chain, pos); // bypassed after the head: its boxes are out of the numbering
  const sel = off || (ext && known == null) ? -1 : gsel - offset; // local box number, or out of range
  const ah = el(node._g13adv)?.firstElementChild;
  if (ah) {
    // fed by a Text Switch Remote: its auto_next is the one that acts, so show that (dimmed)
    const rs = ext ? remoteSource(head) : null;
    const on = rs ? w(rs, "auto_next")?.value === "NEXT" : !!props(head).adv;
    ah.classList.toggle("g13sw-dim", !isHead || (ext && !rs));
    const [bOff, bNext] = ah.querySelectorAll(".g13sw-seg button");
    bOff?.classList.toggle("on", !on);
    bNext?.classList.toggle("on", on);
  }
  syncOutputs(node, count, offset, p.t, off);
  const so = node.outputs?.[1];
  if (so) {
    const live = downstream(node).length === 0;
    node._g13strDead = !live;
    const c = live ? undefined : "#444";
    if (so.color_on !== c) so.color_on = c;
    if (so.color_off !== c) so.color_off = c;
  }

  let hid = !!allowShrink;
  for (let i = 1; i <= MAX; i++) {
    const tx = w(node, `text_${nn(i)}`);
    const hw = node._g13head?.[i - 1];
    const hide = i > count;
    const isLinked = linked(node, `text_${nn(i)}`);
    const col = hide || !!p.c[i - 1] || isLinked;
    if (hw && !!hw.hidden !== hide) {
      hw.hidden = hide;
      if (hide) hid = true;
    }
    if (tx && !!tx.hidden !== col) {
      tx.hidden = col;
      if (col) hid = true;
    }
    if (hide) continue;
    const h = el(hw)?.firstElementChild;
    if (h) {
      h.classList.toggle("g13sw-sel", i === sel);
      h.classList.toggle("g13sw-col", !!p.c[i - 1]);
      h.classList.toggle("g13sw-linked", isLinked);
      h.classList.toggle("g13sw-off", off);
      const no = h.querySelector(".g13sw-no");
      const label = off ? "\u2014" : `#${nn(offset + i)}`;
      if (no && no.textContent !== label) no.textContent = label;
      const ta = el(tx);
      if (ta && ta.placeholder !== label) ta.placeholder = label;
      // Nodes 2.0 shows the input slot and the text area with their raw names (text_01); label them
      const t2 = String(p.t[i - 1] || "").trim();
      const full = `${label}${t2 ? " " + t2 : ""}`;
      const slot = node.inputs?.find((x) => x.name === `text_${nn(i)}`);
      if (slot && slot.label !== full) slot.label = full;
      if (tx && tx.label !== label) tx.label = label;
      const inp = h.querySelector("input");
      if (inp && document.activeElement !== inp && inp.value !== p.t[i - 1]) inp.value = p.t[i - 1];
    }
    const e = el(tx);
    if (e) e.style.opacity = "1";
  }

  // preview: the chain's pick, same line on every node of the chain
  const { k, i: li } = ownerOf(chain, gsel);
  const owner = chain[k] ?? null;
  let out;
  if (ext && known == null) out = "select \u2190 select_num (INT)";
  else if (!owner) out = `#${nn(gsel)} \u00B7 (no node)`;
  else {
    const op = props(owner);
    const otx = w(owner, `text_${nn(li)}`);
    const title = String(op.t[li - 1] || "").trim();
    const body = linked(owner, `text_${nn(li)}`)
      ? `[#${nn(gsel)}]`
      : String(otx?.value ?? "").trim().replace(/\s*\n\s*/g, " ");
    out = `#${nn(gsel)}${title ? " " + title : ""} \u00B7 ${body || "(empty)"}`;
  }
  out = clipToWidth(out, previewWidth(node));
  setText(node._g13prev, out);

  fit(node, hid);
  if (!inChain && chain.length > 1) for (const n of chain) if (n !== node) update(n, false, true);
}

function svgArrow() {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("width", "8");
  s.setAttribute("height", "8");
  s.setAttribute("viewBox", "0 0 8 8");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M1 2.5l3 3 3-3");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#bbb");
  path.setAttribute("stroke-width", "1.4");
  s.appendChild(path);
  return s;
}

function makeHeader(node, i) {
  const h = document.createElement("div");
  h.className = "g13sw-h";
  const ar = document.createElement("button");
  ar.className = "g13sw-ar";
  setTip(ar, T("Collapse / expand", "收合 / 展開"));
  ar.appendChild(svgArrow());
  ar.addEventListener("click", (e) => {
    e.stopPropagation();
    const p = props(node);
    p.c[i - 1] = !p.c[i - 1];
    if (node._g13auto === i) node._g13auto = 0; // opened / closed by hand: no longer automatic
    update(node, true);
  });
  const no = document.createElement("button");
  no.className = "g13sw-no";
  no.textContent = `#${nn(i)}`;
  setTip(no, T("Output this box", "選擇此框輸出"));
  no.addEventListener("click", (e) => {
    e.stopPropagation();
    selectBox(node, i);
  });
  const inp = document.createElement("input");
  inp.type = "text";
  inp.placeholder = "title";
  inp.spellcheck = false;
  inp.addEventListener("input", () => {
    props(node).t[i - 1] = inp.value;
    update(node);
    node.graph?.setDirtyCanvas?.(true, true);
  });
  for (const x of [h, inp]) x.addEventListener("pointerdown", (e) => e.stopPropagation());
  const lk = document.createElement("span");
  lk.className = "g13sw-lk";
  lk.textContent = "linked";
  h.append(ar, no, inp, lk);
  return h;
}

function makeAdvance(node) {
  const row = document.createElement("div");
  row.className = "g13sw-adv";
  const lb = document.createElement("span");
  lb.className = "g13sw-lb";
  lb.textContent = "auto next";
  const seg = document.createElement("div");
  seg.className = "g13sw-seg";
  const mk = (label, val, tip) => {
    const b = document.createElement("button");
    b.textContent = label;
    setTip(b, tip);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const head = chainNodes(node)[0];
      const rsrc = extLinked(head) ? remoteSource(head) : null;
      if (rsrc) writeRemote(rsrc, "auto_next", val ? "NEXT" : "OFF"); // the remote's setting is the one that acts
      else props(head).adv = val;
      updateChain(node, false);
      head.graph?.setDirtyCanvas?.(true, true);
    });
    return b;
  };
  seg.append(
    mk("OFF", false, T("Auto next: off; select stays as set.", "自動換框:關閉,select 維持不變。")),
    mk("NEXT", true, T("Auto next: moves to the next box with content after each queue, skipping empty boxes and wrapping to the first.", "自動換框:每次送出後跳到下一個有內容的框,空白框略過,到底回第一框。"))
  );
  row.addEventListener("pointerdown", (e) => e.stopPropagation());
  row.append(lb, seg);
  return row;
}

function makeBar(node) {
  const bar = document.createElement("div");
  bar.className = "g13sw-bar";
  const mk = (label, collapsed) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = props(node);
      for (let i = 0; i < MAX; i++) p.c[i] = collapsed;
      node._g13auto = 0;
      update(node, true);
    });
    return b;
  };
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
  bar.append(mk("EXPAND ALL", false), mk("COLLAPSE ALL", true));
  return bar;
}

function vueMode() {
  return !!globalThis.LiteGraph?.vueNodesMode;
}

function addDom(node, name, element, height, cls) {
  // DOM widgets get (computedHeight - 2*margin) px of element height; the default margin is 10,
  // which forced a 22px header to overflow its 24px slot. margin 1 + inner padding keeps the
  // 10px side inset of the text boxes while the slot height stays honest.
  const wrap = document.createElement("div");
  wrap.className = "g13sw-wrap" + (cls ? " " + cls : "");
  wrap.appendChild(element);
  const wd = node.addDOMWidget(name, "g13sw", wrap, {
    serialize: false,
    hideOnZoom: true,
    margin: 1,
    getMinHeight: () => (wd.hidden ? 0 : height),
    getMaxHeight: () => (wd.hidden ? 0 : height),
  });
  wd.serialize = false;
  wd.options = wd.options || {};
  wd.options.serialize = false;
  return wd;
}

// helpers for Text Switch Remote (GeN13): numbers are the chain's global box numbers (1..)
globalThis.G13TextSwitch = {
  isHead(n) {
    return n?.type === NODE_ID && chainNodes(n)[0] === n;
  },
  // { num, ok, title, body } for box `g` of the chain headed by `head`
  describe(head, g) {
    const chain = chainNodes(head);
    const o = ownerOf(chain, g);
    if (o.k < 0) return { num: g, ok: false, title: "", body: "" };
    const owner = chain[o.k];
    const name = `text_${nn(o.i)}`;
    const title = String(props(owner).t[o.i - 1] || "").trim();
    const body = linked(owner, name) ? "[linked]" : String(w(owner, name)?.value ?? "").trim().replace(/\s*\n\s*/g, " ");
    return { num: g, ok: true, title, body };
  },
  // next (dir 1) / previous (dir -1) box that has text or a link, wrapping; g itself when none
  stepBox(head, g, dir) {
    const chain = chainNodes(head);
    const offs = offsetsOf(chain);
    const list = [];
    chain.forEach((n, k) => {
      for (let i = 1; i <= boxesOf(chain, k); i++) {
        const name = `text_${nn(i)}`;
        if (linked(n, name) || String(w(n, name)?.value ?? "").trim() !== "") list.push(offs[k] + i);
      }
    });
    if (!list.length) return g;
    if (dir > 0) return list.find((x) => x > g) ?? list[0];
    return [...list].reverse().find((x) => x < g) ?? list[list.length - 1];
  },
  refresh(head) {
    if (head?.type === NODE_ID) updateChain(head, false);
  },
  // number of visible boxes in the whole chain (the highest valid number)
  total(head) {
    const chain = chainNodes(head);
    return offsetsOf(chain)[chain.length];
  },
};

// canvas level: a link drag starts from LGraphCanvas.isOverNodeOutput; a dead STRING is never "over"
let _canvasPatched = false;
function patchCanvas() {
  if (_canvasPatched) return;
  const C = globalThis.LGraphCanvas ?? app.canvas?.constructor;
  const orig = C?.prototype?.isOverNodeOutput;
  if (typeof orig !== "function") return;
  _canvasPatched = true;
  C.prototype.isOverNodeOutput = function (node) {
    const r = orig.apply(this, arguments);
    return r === 1 && node?.type === NODE_ID && node._g13strDead ? -1 : r;
  };
}

app.registerExtension({
  name: "gen13.text_switch",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      injectCss();
      patchCanvas();
      props(node);
      for (const x of node.widgets ?? []) {
        const cb = x.callback;
        x.callback = function () {
          const out = cb?.apply(this, arguments);
          if (x.name === "select") {
            const chain = chainNodes(node);
            const rsrc = chain[0] === node ? remoteSource(node) : null;
            if (rsrc) writeRemote(rsrc, "value", numOf(x.value)); // picked here: the remote follows
            const o = ownerOf(chain, numOf(x.value));
            openSelected(chain, chain[o.k] ?? null, o.i); // picking a collapsed box opens it
          }
          update(node, true);
          return out;
        };
        const m = /^text_(\d\d)$/.exec(x.name);
        const e = el(x);
        if (e && e.tagName === "TEXTAREA") {
          if (m) e.placeholder = `#${m[1]}`;
          e.style.overflowY = "hidden";
          x.options = x.options || {};
          const gone = () => x.hidden || linked(node, x.name);
          x.options.getMinHeight = () => (gone() ? 0 : textHeight(e));
          x.options.getMaxHeight = () => (gone() ? 0 : BOX_MAX);
          e.addEventListener("input", () => update(node));
          e.addEventListener("paste", () => setTimeout(() => update(node), 0));
        }
      }
      // extra widgets: bar after select, one header before each text box, preview at the end
      const gap = addDom(node, "g13_gap", document.createElement("div"), GAP_H);
      const adv = addDom(node, "g13_adv", makeAdvance(node), HEAD_H);
      node._g13adv = adv;
      // same timing as the core control_after_generate; only the head of a chain steps
      let first = true; // "before" mode skips the very first queue
      const step = () => {
        if (chainNodes(node)[0] !== node || !props(node).adv) return;
        if (extLinked(node)) return; // an INT link owns the pick
        // every node of the chain muted / bypassed (itself or its subgraph): no box was used. A bypassed
        // head alone still steps: the next node runs in its place with the mirrored select
        if (chainNodes(node).every((n) => isOff(n))) return;
        advanceNext(node);
      };
      adv.beforeQueued = () => {
        if (controlBefore()) {
          if (!first) step();
          first = false;
        }
      };
      adv.afterQueued = () => {
        if (!controlBefore()) step();
      };
      const bar = addDom(node, "g13_bar", makeBar(node), HEAD_H);
      node._g13head = [];
      for (let i = 1; i <= MAX; i++) node._g13head.push(addDom(node, `g13_head_${nn(i)}`, makeHeader(node, i), HEAD_H, "g13sw-row"));
      const b = node.addWidget("button", "preview", null, () => {}, { serialize: false });
      b.serialize = false;
      node._g13prev = b;

      const order = [gap, w(node, "count"), w(node, "select"), adv, bar];
      for (let i = 1; i <= MAX; i++) order.push(node._g13head[i - 1], w(node, `text_${nn(i)}`));
      order.push(b);
      const rest = (node.widgets ?? []).filter((x) => !order.includes(x));
      node.widgets.splice(0, node.widgets.length, ...order.filter(Boolean), ...rest);

      requestAnimationFrame(() => update(node));
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      this._g13loading = true;
      props(this);
      requestAnimationFrame(() => update(this));
      setTimeout(() => {
        this._g13loading = false;
        update(this, true); // height follows content after load / paste (linked boxes are 0 high)
      }, 300);
      return r;
    };

    // bypassing / muting the node feeding select_num raises no event here: notice it on redraw
    const onDrawFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = onDrawFg?.apply(this, arguments);
      if (this._g13prev && this._g13ext !== undefined) {
        const ext = extLinked(this);
        const known = ext ? staticNum(this) : null;
        if (ext !== this._g13ext || known !== this._g13known) updateChain(this, false);
      }
      // bypass toggled on this node raises no event either: renumber the chain when the mode changes
      if (this._g13prev && this._g13mode !== this.mode) {
        const first = this._g13mode === undefined;
        this._g13mode = this.mode;
        if (!first) updateChain(this, false);
      }
      return r;
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = onResize?.apply(this, arguments);
      if (this._g13w !== size?.[0]) {
        this._g13w = size?.[0];
        update(this);
      }
      return r;
    };

    // Nodes 1.0: a box output sits beside its header row instead of the top-right stack.
    // Slots with a fixed `pos` are left out of the default vertical stack, but their position
    // still feeds the slot bounds that decide where widgets start, so before the stock arrange()
    // they are parked inside the chain row, and after it moved to the header rows.
    const arrange = nodeType.prototype.arrange;
    nodeType.prototype.arrange = function () {
      if (vueMode() || !this.outputs) return arrange?.apply(this, arguments);
      const wd = this.size[0];
      const x = wd + 1 - 10; // same column as chain / STRING
      for (let k = OUT_BASE; k < this.outputs.length; k++) this.outputs[k].pos = [x, 14];
      const r = arrange?.apply(this, arguments);
      for (let k = OUT_BASE; k < this.outputs.length; k++) {
        const o = this.outputs[k];
        const hw = this._g13head?.[k - OUT_BASE];
        if (!hw || hw.hidden || typeof hw.y !== "number") continue;
        const y = hw.y + 1 + 2 + 11; // DOM margin 1 + pad 2 + half of the 22px header
        o.pos = [x, y];
        if (o.boundingRect) {
          o.boundingRect[0] = this.pos[0] + x - 10;
          o.boundingRect[1] = this.pos[1] + y - 10;
          o.boundingRect[2] = 20;
          o.boundingRect[3] = 20;
        }
        // the box's input dot (widget-backed slot) moves from the text area to the same header row
        const inp = this.inputs?.find((s) => s.name === `text_${nn(k - OUT_BASE + 1)}`);
        if (inp) {
          inp.pos = [10, y];
          if (inp.boundingRect) {
            inp.boundingRect[0] = this.pos[0];
            inp.boundingRect[1] = this.pos[1] + y - 10;
            inp.boundingRect[3] = 20;
          }
        }
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

    // a dimmed STRING (not the last node of the chain) is not found under the pointer
    const notDead = (node, r) => {
      if (!r || !node._g13strDead) return r;
      const so = node.outputs?.[1];
      return r === so || r.output === so ? undefined : r;
    };
    for (const fn of ["getOutputOnPos", "getSlotOnPos", "getSlotInPosition"]) {
      const orig = nodeType.prototype[fn];
      if (typeof orig !== "function") continue;
      nodeType.prototype[fn] = function () {
        return notDead(this, orig.apply(this, arguments));
      };
    }

    // a dimmed STRING (not the last node of the chain) refuses new links
    const onConnectOutput = nodeType.prototype.onConnectOutput;
    nodeType.prototype.onConnectOutput = function (outputIndex) {
      if (outputIndex === 1 && this._g13strDead) return false;
      return onConnectOutput ? onConnectOutput.apply(this, arguments) : true;
    };

    const onConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index, connected, linkInfo, slot) {
      const r = onConn?.apply(this, arguments);
      if (!this._g13prev) return r;
      // configure() replays every linked input as "connected": no snapping, no cutting on load / paste / undo
      if (app.configuringGraph || this._g13loading) return r;
      const isChainIn = slot?.name === "chain" && type === 1; // LiteGraph.INPUT
      if (isChainIn && connected) {
        // snap next to the upstream node: same width, same top, 30px gap
        const up = upstream(this);
        if (up && up !== this) {
          this.setSize?.([up.size[0], this.size[1]]);
          this.pos = [up.pos[0] + up.size[0] + 30, up.pos[1]];
          if (up.outputs?.[1]?.links?.length) up.disconnectOutput(1); // its STRING is dead from now on
        }
        this._g13prevChain = chainNodes(this);
      } else if (isChainIn && !connected) {
        // the old head must redraw its dropdown without this node (the link is already gone here,
        // so a chain restored by load has to be rebuilt from the upstream side)
        const old = this._g13prevChain ?? (linkInfo ? chainNodes(nodeById(this, linkInfo.origin_id) ?? this) : []);
        for (const n of old) if (n !== this) update(n, false, true);
        this._g13prevChain = null;
      }
      updateChain(this, true);
      return r;
    };
  },
});
