// Remote Text Switch (GeN13)
//   - mirrors: every Remote Text Switch whose channel text matches (trimmed) is one group, across the
//     workflow including subgraphs; value / auto_next / bypass / mute are synced (same rules as
//     Remote Int (GeN13), separate groups)
//   - target: the INT output of any mirror is followed downstream (through KJNodes Set -> Get and
//     reroutes) to the select_num input of a Text Switch (GeN13) chain head
//   - pick row: [prev] #07 title [next]. Title from the Text Switch box; untitled boxes show the
//     start of their text. prev / next jump between boxes that have text or a link (empty boxes
//     skipped, wrapping). No Text Switch found: prev / next step by 1 and the row says so.
//   - value is kept inside the target chain (1 .. its last box): typing or arrowing past the end
//     stops at the last box, so the remote and the Text Switch never disagree
//   - auto_next NEXT: once per queue for the whole group, after the run (or before, following
//     Comfy.WidgetControlMode), jump to the next box with content. Bypassed / muted: stays.
//   - bypassed / muted: the pick row is dimmed and locked (a bypassed remote is not in the prompt,
//     the Text Switch uses its own select meanwhile); it unlocks when the group is switched back on
//   - grey line at the bottom: channel · N mirrors · target count

import { app } from "../../scripts/app.js";
import { isOff, onModeChange } from "./g13_mode.js";
import { T, setTip, setWidgetTip } from "./g13_i18n.js";
import { applyWireLock, wireSuffix, wiredMirrors } from "./remote_link.js";

const NODE_ID = "RemoteTextSwitchGeN13";
const TS_ID = "TextSwitchGeN13";
const LIMIT = 9999;
const SYNCED = ["value", "auto_next"];
const ROW_SLOT = 34; // DOM margin 1 + pad 2 / 2 + 28px row

const stepped = new Set();
const firstSeen = new Set();

const CSS = `
.dom-widget:has(>.g13tr-wrap){pointer-events:none!important}
.g13tr-wrap{box-sizing:border-box;width:100%;height:100%;padding:2px 9px;pointer-events:none}
.g13tr-wrap>*{pointer-events:auto}
.g13tr-row{box-sizing:border-box;height:28px;display:flex;align-items:center;background:#2b2b2b;border:1px solid #1e1e1e;border-radius:6px;overflow:hidden;user-select:none}
.g13tr-row button{all:unset;box-sizing:border-box;flex:none;width:30px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#999}
.g13tr-row button:hover{color:#eee;background:#333}
.g13tr-row button:active{background:#3a3a3a}
.g13tr-row button svg{display:block}
.g13tr-row .g13tr-prev{border-right:1px solid #1e1e1e}
.g13tr-row .g13tr-next{border-left:1px solid #1e1e1e}
.g13tr-mid{flex:1;min-width:0;height:28px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 8px}
.g13tr-num{flex:none;height:18px;padding:0 6px;display:flex;align-items:center;border-radius:4px;background:#35d0ff;color:#0b2a33;font:12px/1 Inter,Helvetica,Arial,sans-serif}
.g13tr-row.g13tr-off .g13tr-num{background:#444;color:#aaa}
.g13tr-ttl{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#d0d0d0;font:12px/1 Inter,Helvetica,Arial,"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif}
.g13tr-ttl.g13tr-dim{color:#777}
.g13tr-row.g13tr-lock{opacity:.45;pointer-events:none}
`;

function injectCss() {
  if (document.getElementById("g13tr-css")) return;
  const s = document.createElement("style");
  s.id = "g13tr-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

function chan(node) {
  return String(w(node, "channel")?.value ?? "").trim();
}

function nn(i) {
  return String(i).padStart(2, "0");
}

function controlBefore() {
  try {
    return app.extensionManager?.setting?.get?.("Comfy.WidgetControlMode") === "before";
  } catch {
    return false;
  }
}

function TS() {
  return globalThis.G13TextSwitch ?? null;
}

// every node of the workflow, root first, then subgraphs (each definition once)
function allNodes() {
  const out = [];
  const seen = new Set();
  const walk = (g) => {
    if (!g || seen.has(g)) return;
    seen.add(g);
    for (const n of g._nodes ?? g.nodes ?? []) {
      if (!n) continue;
      out.push(n);
      if (n.subgraph) walk(n.subgraph);
    }
  };
  walk(app.rootGraph ?? app.graph);
  return out;
}

function group(node) {
  const c = chan(node);
  return allNodes().filter((n) => n.type === NODE_ID && chan(n) === c);
}

function linkOf(g, id) {
  return g?.links?.[id] ?? g?.links?.get?.(id) ?? null;
}

// Text Switch chain heads reached from the INT output of any mirror of the group
function targets(node) {
  const ts = TS();
  const heads = [];
  const seen = new Set();
  let all = null;
  const walkOut = (n) => {
    const g = n.graph;
    for (const id of n.outputs?.[0]?.links ?? []) {
      const l = linkOf(g, id);
      const t = l ? g?.getNodeById?.(l.target_id) : null;
      if (!t || seen.has(t)) continue;
      seen.add(t);
      if (t.type === TS_ID) {
        if (t.inputs?.[l.target_slot]?.name === "select_num" && ts?.isHead(t) && !heads.includes(t)) heads.push(t);
        continue;
      }
      if (!t.isVirtualNode) continue;
      // a Set node passes on to every Get that reads it; reroutes pass on through their output
      all = all ?? allNodes();
      for (const gt of all) if (typeof gt.findSetter === "function" && gt.findSetter(gt.graph) === t) walkOut(gt);
      if (t.outputs?.length) walkOut(t);
    }
  };
  for (const m of group(node)) walkOut(m);
  return heads;
}

function setWidget(n, name, v) {
  const x = w(n, name);
  if (!x || x.value === v) return;
  x.value = v;
  n.setDirtyCanvas?.(true, true);
}

function broadcast(src, name) {
  if (src._g13sync) return;
  const v = w(src, name)?.value;
  for (const n of group(src)) {
    if (n === src) continue;
    n._g13sync = true;
    try {
      setWidget(n, name, v);
    } finally {
      n._g13sync = false;
    }
  }
  refreshGroup(src);
  for (const h of targets(src)) TS()?.refresh(h); // Text Switch shows the pick and the auto next state
}

// assign the mode directly: LGraphNode.changeMode() only knows modes 0-3 and silently refuses
// bypass (4), which left a mirror un-bypassed and made it switch the whole group back on its next draw
function setModeOf(n, m) {
  if (n.mode !== m) {
    n.mode = m;
    n.setDirtyCanvas?.(true, true);
    n.graph?.setDirtyCanvas?.(true, true);
  }
  n._g13mode = n.mode; // whatever actually stuck, so a refused change never echoes back
}

function broadcastMode(src) {
  const m = src.mode;
  for (const n of group(src)) if (n !== src) setModeOf(n, m);
  src._g13mode = m;
}

function adopt(node) {
  const other = group(node).find((n) => n !== node);
  if (!other) return;
  for (const name of SYNCED) setWidget(node, name, w(other, name)?.value);
  setModeOf(node, other.mode);
}

// highest number the first target accepts (LIMIT when there is no Text Switch)
function maxOf(node) {
  const head = targets(node)[0];
  const t = head ? TS()?.total?.(head) : 0;
  return t > 0 ? t : LIMIT;
}

function setValue(node, v) {
  const vw = w(node, "value");
  if (!vw) return;
  v = Math.max(1, Math.min(maxOf(node), Math.round(v)));
  if (vw.value !== v) {
    vw.value = v;
    node.setDirtyCanvas?.(true, true);
  }
  broadcast(node, "value");
}

// prev / next: boxes with content of the first target; plain +-1 without one
function stepValue(node, dir) {
  if (isOff(node)) return; // bypassed / muted, itself or its subgraph: not in use
  if (wiredMirrors(group(node)).length) return; // group driven by a wire: the pick is not ours
  const g = Math.round(Number(w(node, "value")?.value) || 1);
  const head = targets(node)[0];
  setValue(node, head ? TS().stepBox(head, g, dir) : g + dir);
}

// ---------- display ----------

function svgChevron(dir) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("width", "10");
  s.setAttribute("height", "10");
  s.setAttribute("viewBox", "0 0 10 10");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", dir < 0 ? "M6.5 1.5L3 5l3.5 3.5" : "M3.5 1.5L7 5 3.5 8.5");
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.5");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  s.appendChild(p);
  return s;
}

function makeRow(node) {
  const row = document.createElement("div");
  row.className = "g13tr-row";
  const mk = (dir, cls, tip) => {
    const b = document.createElement("button");
    b.className = cls;
    setTip(b, tip);
    b.appendChild(svgChevron(dir));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      stepValue(node, dir);
    });
    return b;
  };
  const mid = document.createElement("div");
  mid.className = "g13tr-mid";
  const num = document.createElement("span");
  num.className = "g13tr-num";
  const ttl = document.createElement("span");
  ttl.className = "g13tr-ttl";
  mid.append(num, ttl);
  row.append(mk(-1, "g13tr-prev", T("Previous: goes to the previous box with content.", "上一框:跳到前一個有內容的框。")), mid, mk(1, "g13tr-next", T("Next: goes to the next box with content.", "下一框:跳到下一個有內容的框。")));
  row.addEventListener("pointerdown", (e) => e.stopPropagation());
  node._g13row = { row, num, ttl };
  return row;
}

function addDom(node, name, el, h) {
  const wrap = document.createElement("div");
  wrap.className = "g13tr-wrap";
  wrap.appendChild(el);
  const wd = node.addDOMWidget(name, "g13tr", wrap, {
    serialize: false,
    hideOnZoom: true,
    margin: 1,
    getMinHeight: () => h,
    getMaxHeight: () => h,
  });
  wd.serialize = false;
  wd.options = wd.options || {};
  wd.options.serialize = false;
  return wd;
}

function render(node) {
  const r = node._g13row;
  const g = Math.round(Number(w(node, "value")?.value) || 1);
  const heads = targets(node);
  const head = heads[0];
  let numText = `#${nn(g)}`;
  let ttlText;
  let dim = false;
  let off = false;
  if (!head) {
    ttlText = "no Text Switch";
    dim = off = true;
  } else {
    const d = TS().describe(head, g);
    if (!d.ok) {
      ttlText = "no box";
      dim = off = true;
    } else if (d.title) ttlText = d.title;
    else {
      ttlText = d.body || "(empty)";
      dim = true;
    }
  }
  const vw = w(node, "value");
  const m = maxOf(node);
  if (vw && vw.options && vw.options.max !== m) vw.options.max = m; // 核心數字欄的 ▶ 依 options.max 變暗:上限跟著鏈的總框數
  if (r) {
    if (r.num.textContent !== numText) r.num.textContent = numText;
    if (r.ttl.textContent !== ttlText) r.ttl.textContent = ttlText;
    r.ttl.classList.toggle("g13tr-dim", dim);
    r.row.classList.toggle("g13tr-off", off);
  }
  const grp = group(node);
  const ws = applyWireLock(node, grp);
  if (r) r.row.classList.toggle("g13tr-lock", isOff(node) || ws.wired > 0);
  const k = grp.length;
  const c = chan(node) || "(no channel)";
  const extra = heads.length > 1 ? `  ·  ${heads.length} switches` : "";
  const info = `${c}  ·  ${k} ${k === 1 ? "mirror" : "mirrors"}${extra}${wireSuffix(ws)}`;
  const b = node._g13info;
  if (b && b.label !== info) {
    b.label = info;
    b.name = info;
    node.setDirtyCanvas?.(true, true);
  }
}

function refreshGroup(node) {
  for (const n of group(node)) render(n);
}

function markPass(c) {
  stepped.add(c);
  queueMicrotask(() => stepped.delete(c));
}

function autoStep(node) {
  const c = chan(node);
  if (stepped.has(c)) return;
  if (isOff(node)) return; // a running mirror may still step
  markPass(c);
  if (w(node, "auto_next")?.value !== "NEXT") return;
  stepValue(node, 1);
}

app.registerExtension({
  name: "gen13.remote_text_switch",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      injectCss();
      for (const x of node.widgets ?? []) {
        const cb = x.callback;
        x.callback = function () {
          const out = cb?.apply(this, arguments);
          if (x.name === "value") {
            // typed or arrowed past the last box: stop at the last box
            const v = Math.round(Number(x.value) || 1);
            const m = maxOf(node);
            if (v > m) x.value = m;
          }
          if (SYNCED.includes(x.name)) broadcast(node, x.name);
          else if (x.name === "channel") {
            if (!app.configuringGraph) adopt(node);
            for (const n of allNodes()) if (n.type === NODE_ID) render(n);
          }
          return out;
        };
      }
      const an = w(node, "auto_next");
      if (an) {
        an.label = "auto next";
        an.beforeQueued = () => {
          if (!controlBefore()) return;
          const c = chan(node);
          if (stepped.has(c) || isOff(node)) return;
          if (!firstSeen.has(c)) {
            firstSeen.add(c);
            markPass(c);
            return;
          }
          autoStep(node);
        };
        an.afterQueued = () => {
          if (!controlBefore()) autoStep(node);
        };
      }
      const row = addDom(node, "g13_pick", makeRow(node), ROW_SLOT);
      const b = node.addWidget("button", "info", null, () => {}, { serialize: false });
      b.serialize = false;
      node._g13info = b;
      // order: channel, value, pick row, auto next, info
      const order = [w(node, "channel"), w(node, "value"), row, an, b].filter(Boolean);
      const rest = (node.widgets ?? []).filter((x) => !order.includes(x));
      node.widgets.splice(0, node.widgets.length, ...order, ...rest);
      node._g13mode = node.mode;
      requestAnimationFrame(() => {
        if (!app.configuringGraph && !node._g13loaded) adopt(node);
        render(node);
      });
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      this._g13loaded = true;
      this._g13mode = this.mode;
      const pasted = !app.configuringGraph;
      requestAnimationFrame(() => {
        if (pasted) adopt(this);
        render(this);
      });
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const r = onRemoved?.apply(this, arguments);
      const c = chan(this);
      requestAnimationFrame(() => {
        for (const n of allNodes()) if (n.type === NODE_ID && chan(n) === c) render(n);
      });
      return r;
    };

    const onConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = onConn?.apply(this, arguments);
      if (this._g13info) requestAnimationFrame(() => refreshGroup(this));
      return r;
    };

    // bypass / mute and Text Switch edits (titles, text, counts) raise no event here: check on draw
    const onDrawFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = onDrawFg?.apply(this, arguments);
      if (this._g13mode !== undefined && this._g13mode !== this.mode) {
        broadcastMode(this);
        refreshGroup(this); // lock / unlock every mirror's pick row right away
      }
      const now = performance.now();
      if (!this._g13t || now - this._g13t > 300) {
        this._g13t = now;
        render(this);
      }
      return r;
    };
    // Nodes 2.0 never draws through onDrawForeground: react to the mode setter directly
    onModeChange((n) => {
      if (n.type !== NODE_ID || n._g13mode === undefined || n._g13mode === n.mode) return;
      broadcastMode(n);
      refreshGroup(n);
    });
  },
});
