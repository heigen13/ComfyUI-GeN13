// Show Any (GeN13)
//   - any input takes any type; the back end formats it (FLOAT up to 6 decimals, JSON for lists /
//     dicts, a one-line summary for IMAGE / MASK / LATENT) and outputs STRING, INT, FLOAT and the
//     untouched object (any).
//   - while any is linked, content is sent to the back end as "" (serializeValue), so writing the
//     shown text into the box never changes the prompt and never re-runs downstream nodes; the
//     workflow file still keeps the shown text.
//   - content: one text area (native multiline widget, restyled). Not linked = editable source;
//     any linked = read-only, filled with the upstream text after each run and saved with the
//     workflow, so it survives F5 / restart.
//   - a new node opens at 400 wide with an 8-line text area; it can be dragged bigger, never below
//     4 lines. Long text scrolls inside the box, the node does not grow by itself.
//   - bottom bar: chars · lines, then CUT / COPY / PASTE (X C V order). PASTE adds a line break and
//     appends at the end (no blank line when the box is empty or already ends with one), then
//     scrolls to the bottom. CUT and PASTE are off while any is linked; COPY always works.
//   - a pressed button turns cyan with a check for 1.2 s. Icons are inline SVG.
//   - edit (segmented AUTO / MANUAL, node.properties.g13_edit): AUTO = the box mirrors the upstream,
//     read-only while linked. MANUAL = the box is editable and STRING outputs the box; a new upstream
//     only sets node.properties.g13_up and the info line turns into UPSTREAM CHANGED; SYNC copies the
//     latest upstream into the box. In MANUAL the content is sent with MANUAL_MARK in front so the
//     back end knows; AUTO while linked still sends "".
//   - clipboard API needs a secure page (127.0.0.1 or https); otherwise COPY / CUT fall back to
//     execCommand and PASTE focuses the box so Ctrl+V works.

import { app } from "../../scripts/app.js";
import { T, setTip, countText, convertLabel } from "./g13_i18n.js";

const NODE_ID = "ShowAnyGeN13";
const LINE = 18; // 12px font, line-height 1.5
const PAD = 18; // textarea padding 8 + border 1, top and bottom
const MIN_LINES = 4;
const DEF_LINES = 8;
const DEF_W = 400;
const BAR_H = 32; // DOM margin 1 + wrap pad 3 + 24px bar
const FLASH_MS = 1200;
const MANUAL_MARK = "\u2063GEN13:MANUAL\u2063"; // same as show_any.py

const CSS = `
.g13st-ta{box-sizing:border-box!important;background:#1a1a1a!important;border:1px solid #2a2a2a!important;border-radius:6px!important;padding:8px 10px!important;font:12px/1.5 Inter,"Noto Sans TC","Microsoft JhengHei",sans-serif!important;color:#d8d8d8!important;resize:none!important;overflow-y:auto!important;white-space:pre-wrap!important;word-break:break-word!important}
.g13st-ta:focus{outline:none!important;border-color:#35d0ff66!important}
.g13st-ta.g13st-ro{color:#bdbdbd!important}
.dom-widget:has(>.g13st-wrap){pointer-events:none!important}
.g13st-wrap{box-sizing:border-box;width:100%;height:100%;padding:3px 9px;pointer-events:none}
.g13st-wrap>*{pointer-events:auto}
.g13st-bar{box-sizing:border-box;height:24px;display:flex;align-items:center;gap:6px;user-select:none}
.g13st-inf{flex:1;min-width:0;height:24px;display:flex;align-items:center;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.3px;color:#777;white-space:nowrap;overflow:hidden}
.g13st-bt{all:unset;box-sizing:border-box;flex:none;width:76px;height:24px;display:flex;align-items:center;justify-content:center;gap:5px;border-radius:12px;background:#222;border:1px solid #1a1a1a;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.6px;color:#bbb;cursor:pointer}
.g13st-bt:hover{color:#eee;border-color:#555}
.g13st-bt.g13st-ok{background:#35d0ff;border-color:#35d0ff;color:#0b2a33}
.g13st-bt.g13st-off{opacity:.35;pointer-events:none}
.g13st-bt svg{display:block;flex:none}
.g13st-bar.g13st-man .g13st-bt{width:64px}
.g13st-bt.g13st-sync{border-color:#35d0ff66;color:#35d0ff}
.g13st-bt.g13st-hide{display:none}
.g13st-inf.g13st-up{color:#35d0ff}
.g13st-inf.g13st-up::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:#35d0ff;margin-right:6px}
.g13st-ed{box-sizing:border-box;height:24px;display:flex;align-items:center;background:#222;border:1px solid #1a1a1a;border-radius:12px;padding:0 3px 0 12px;font:12px/1 Inter,Helvetica,Arial,sans-serif;color:#999;user-select:none}
.g13st-ed .g13st-lb{flex:1;display:flex;align-items:center;height:22px}
.g13st-seg{box-sizing:border-box;height:18px;display:flex;border:1px solid #444;border-radius:9px;overflow:hidden}
.g13st-seg button{all:unset;pointer-events:auto;box-sizing:border-box;width:62px;height:16px;display:flex;align-items:center;justify-content:center;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.6px;color:#888;cursor:pointer}
.g13st-seg button:hover{color:#ddd}
.g13st-seg button.g13st-on{background:#35d0ff;color:#0b2a33}
`;

const S = 'fill="none" stroke="currentColor" stroke-width="1.2"';
const ICON = {
  sync: `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1.5v6.5M3.2 5.4L6 8.2l2.8-2.8M2 10.5h8" ${S} stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cut: `<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="3" cy="9" r="1.8" ${S}/><circle cx="9" cy="9" r="1.8" ${S}/><path d="M4.3 7.7L9.5 1.5M7.7 7.7L2.5 1.5" ${S}/></svg>`,
  copy: `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" ${S}/><path d="M8.5 2.2V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h.2" ${S}/></svg>`,
  paste: `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="9" rx="1.5" ${S}/><rect x="4" y="1" width="4" height="2.2" rx=".8" ${S}/></svg>`,
  ok: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6.3L4.8 9 10 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const LABEL = { sync: ["SYNC", "SYNCED"], cut: ["CUT", "CUT"], copy: ["COPY", "COPIED"], paste: ["PASTE", "PASTED"] };

function injectCss() {
  if (document.getElementById("g13st-css")) return;
  const s = document.createElement("style");
  s.id = "g13st-css";
  s.textContent = CSS;
  document.head.appendChild(s);
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

function isManual(node) {
  return node.properties?.g13_edit === "MANUAL";
}

// CUT / PASTE / typing are blocked only while linked in AUTO
function locked(node) {
  return linked(node, "any") && !isManual(node);
}

function textOf(node) {
  return String(w(node, "content")?.value ?? "");
}

function setContent(node, v) {
  const cw = w(node, "content");
  if (!cw) return;
  cw.value = v;
  const ta = el(cw);
  if (ta && ta.value !== v) ta.value = v;
  cw.callback?.(v);
  update(node);
  node.setDirtyCanvas?.(true, true);
}

// appends below the existing text: one line break, never a blank line
function appendText(cur, add) {
  if (!add) return cur;
  if (!cur.trim()) return add; // empty or only spaces / blank lines: paste from the top
  return cur.endsWith("\n") ? cur + add : cur + "\n" + add;
}

function countInfo(v) {
  let chars = 0;
  for (const _ of v) chars++; // code points: emoji / CJK count once
  let lines = 0;
  if (v) {
    lines = 1;
    for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) === 10) lines++;
  }
  return countText(chars, lines);
}

async function writeClip(text, ta) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http on a LAN address: no clipboard API, fall back to a selection copy
    try {
      const t = document.createElement("textarea");
      t.value = text;
      t.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch {
      ta?.focus();
      return false;
    }
  }
}

function setBtn(b, key, on) {
  b.classList.toggle("g13st-ok", on);
  b.innerHTML = (on ? ICON.ok : ICON[key]) + `<span>${LABEL[key][on ? 1 : 0]}</span>`;
}

function flash(node, key) {
  const b = node._g13st?.btn?.[key];
  if (!b) return;
  setBtn(b, key, true);
  clearTimeout(b._t);
  b._t = setTimeout(() => setBtn(b, key, false), FLASH_MS);
}

function update(node) {
  const st = node._g13st;
  if (!st) return;
  const isLinked = linked(node, "any");
  const man = isManual(node);
  const lock = isLinked && !man;
  const p = node.properties || {};
  const changed = man && isLinked && p.g13_up != null && p.g13_up !== p.g13_synced;
  const v = textOf(node);
  const info = changed ? "UPSTREAM CHANGED" : countInfo(v);
  if (st.inf.textContent !== info) st.inf.textContent = info;
  st.inf.classList.toggle("g13st-up", changed);
  st.btn.cut.classList.toggle("g13st-off", lock);
  st.btn.paste.classList.toggle("g13st-off", lock);
  const syncOn = man && isLinked;
  st.btn.sync.classList.toggle("g13st-hide", !syncOn);
  st.bar.classList.toggle("g13st-man", syncOn);
  st.segA?.classList.toggle("g13st-on", !man);
  st.segM?.classList.toggle("g13st-on", man);
  const ta = el(w(node, "content"));
  if (ta) {
    ta.readOnly = lock;
    ta.classList.toggle("g13st-ro", lock);
  }
}

function makeBar(node) {
  const bar = document.createElement("div");
  bar.className = "g13st-bar";
  const inf = document.createElement("div");
  inf.className = "g13st-inf";
  const btn = {};
  const mk = (key, tip, fn) => {
    const b = document.createElement("button");
    b.className = "g13st-bt";
    setTip(b, tip);
    setBtn(b, key, false);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    btn[key] = b;
    return b;
  };
  const ta = () => el(w(node, "content"));
  bar.append(
    inf,
    mk("sync", T("Sync: replaces the box text with the latest upstream content.", "同步:以上游最新內容取代框內文字。"), () => {
      const p = node.properties || (node.properties = {});
      if (p.g13_up == null) return;
      setContent(node, String(p.g13_up));
      p.g13_synced = p.g13_up;
      update(node);
      flash(node, "sync");
    }),
    mk("cut", T("Cut: copies all content, then clears the box.", "剪下:複製全部內容後清空。"), async () => {
      if (locked(node)) return;
      const v = textOf(node);
      if (!v) return;
      if (await writeClip(v, ta())) {
        setContent(node, "");
        flash(node, "cut");
      }
    }),
    mk("copy", T("Copy: copies all content.", "複製:複製全部內容。"), async () => {
      if (await writeClip(textOf(node), ta())) flash(node, "copy");
    }),
    mk("paste", T("Paste: adds to the end on a new line.", "貼上:換行後接在最後。"), async () => {
      if (locked(node)) return;
      let add = "";
      try {
        add = await navigator.clipboard.readText();
      } catch {
        ta()?.focus(); // no clipboard read on an insecure page: Ctrl+V into the box instead
        return;
      }
      if (!add) return;
      setContent(node, appendText(textOf(node), add));
      const t = ta();
      if (t) requestAnimationFrame(() => (t.scrollTop = t.scrollHeight));
      flash(node, "paste");
    })
  );
  btn.sync.classList.add("g13st-sync");
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
  return { bar, inf, btn };
}

function makeEdit(node) {
  const row = document.createElement("div");
  row.className = "g13st-ed";
  const lb = document.createElement("span");
  lb.className = "g13st-lb";
  lb.textContent = "edit";
  const seg = document.createElement("div");
  seg.className = "g13st-seg";
  const mk = (label, mode, tip) => {
    const b = document.createElement("button");
    b.textContent = label;
    setTip(b, tip);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = node.properties || (node.properties = {});
      if ((p.g13_edit || "AUTO") === mode) return;
      p.g13_edit = mode;
      if (mode === "AUTO") {
        // back to mirroring: the box shows the latest upstream again
        if (linked(node, "any") && p.g13_up != null) setContent(node, String(p.g13_up));
      }
      p.g13_synced = p.g13_up; // the box starts from the current upstream
      update(node);
      node.setDirtyCanvas?.(true, true);
    });
    return b;
  };
  const segA = mk("AUTO", "AUTO", T("Edit: AUTO, the box follows upstream and is read-only; outputs the upstream content.", "編輯:AUTO,框跟著上游、唯讀,輸出上游內容。"));
  const segM = mk("MANUAL", "MANUAL", T("Edit: MANUAL, the box can be edited freely; outputs the box text.", "編輯:MANUAL,框可自由修改,輸出框內文字。"));
  seg.append(segA, segM);
  row.append(lb, seg);
  row.addEventListener("pointerdown", (e) => e.stopPropagation());
  return { row, segA, segM };
}

// right-click: swap between Show Any and Show Any Lite in place, keeping the links, the shown
// text, position and colors (same code in show_any.js and show_any_lite.js)
function g13GetLink(graph, id) {
  return graph?.links?.[id] ?? graph?.links?.get?.(id) ?? null;
}

function g13SwapShowAny(node, toType) {
  const LG = globalThis.LiteGraph;
  const graph = node.graph ?? app.graph;
  if (!LG || !graph) return;
  const nn = LG.createNode(toType);
  if (!nn) return;
  nn.pos = [node.pos[0], node.pos[1]];
  if (node.color) nn.color = node.color;
  if (node.bgcolor) nn.bgcolor = node.bgcolor;
  graph.add(nn);

  // shown text: full keeps it in the content widget, lite in properties.g13_text
  const fromFull = node.type === "ShowAnyGeN13";
  const text = fromFull
    ? String(node.widgets?.find((x) => x.name === "content")?.value ?? "")
    : String(node.properties?.g13_text ?? "");
  nn.properties = nn.properties || {};
  if (toType === "ShowAnyGeN13") {
    const cw = nn.widgets?.find((x) => x.name === "content");
    if (cw) cw.value = text;
  } else {
    nn.properties.g13_text = text;
  }

  // input: the "any" link
  const inp = node.inputs?.find((s) => s.name === "any");
  if (inp && inp.link != null) {
    const l = g13GetLink(graph, inp.link);
    const src = l ? graph.getNodeById(l.origin_id) : null;
    const to = nn.inputs?.findIndex((s) => s.name === "any") ?? -1;
    if (src && to >= 0) src.connectSlots(src.outputs[l.origin_slot], nn, nn.inputs[to]);
  }
  // outputs: STRING (0) and any (1) are in the same order on both nodes
  (node.outputs ?? []).forEach((o, k) => {
    for (const id of [...(o.links ?? [])]) {
      const l = g13GetLink(graph, id);
      const dst = l ? graph.getNodeById(l.target_id) : null;
      if (dst && k < (nn.outputs?.length ?? 0)) nn.connectSlots(nn.outputs[k], dst, dst.inputs[l.target_slot]);
    }
  });

  graph.remove(node);
  app.canvas?.selectNode?.(nn);
  graph.setDirtyCanvas?.(true, true);
}

// a link dropped on the text box lands on the "content" widget input: move it to "any", the same as
// other text nodes where a linked box shows the upstream text
function rerouteContent(node) {
  const ci = node.inputs?.findIndex((s) => s.name === "content") ?? -1;
  const ai = node.inputs?.findIndex((s) => s.name === "any") ?? -1;
  if (ci < 0 || ai < 0 || node.inputs[ci].link == null) return;
  const g = node.graph;
  const id = node.inputs[ci].link;
  const l = g?.links?.[id] ?? g?.links?.get?.(id);
  const src = l ? g.getNodeById?.(l.origin_id) : null;
  node.disconnectInput(ci);
  if (src && src.outputs?.[l.origin_slot]) src.connectSlots(src.outputs[l.origin_slot], node, node.inputs[ai]);
}

// the box takes no link at all (same as Show Any Lite): drop its input socket, so a link released
// anywhere on the node goes to "any"; an older save with a link on the box is moved to "any" first
function dropContentSocket(node) {
  rerouteContent(node);
  const ci = node.inputs?.findIndex((s) => s.name === "content") ?? -1;
  if (ci >= 0 && node.inputs[ci].link == null) node.removeInput(ci);
}

app.registerExtension({
  name: "gen13.show_any",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const getMenu = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      const r = getMenu?.apply(this, arguments);
      options.unshift({ content: convertLabel("Show Any Lite"), callback: () => g13SwapShowAny(this, "ShowAnyLiteGeN13") }, null);
      return r;
    };

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      injectCss();

      const cw = w(node, "content");
      const ta = el(cw);
      if (cw) {
        cw.options = cw.options || {};
        cw.options.getMinHeight = () => MIN_LINES * LINE + PAD;
        if (ta && ta.tagName === "TEXTAREA") {
          ta.classList.add("g13st-ta");
          ta.spellcheck = false;
          ta.placeholder = "content";
          let raf = 0;
          ta.addEventListener("input", () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => update(node));
          });
          ta.addEventListener("paste", () => setTimeout(() => update(node), 0));
        }
        // linked: the box only mirrors the upstream text for display and saving; send a constant
        cw.serializeValue = function () {
          if (!linked(node, "any")) return this.value;
          return isManual(node) ? MANUAL_MARK + String(this.value ?? "") : "";
        };
        const cb = cw.callback;
        cw.callback = function () {
          const out = cb?.apply(this, arguments);
          update(node);
          return out;
        };
      }

      // the box accepts any type when a link is dropped on it (INT, FLOAT, IMAGE ...); the link is then
      // moved to "any" by rerouteContent, so content itself never stays linked
      const cin = node.inputs?.find((s) => s.name === "content");
      if (cin) cin.type = "*";

      requestAnimationFrame(() => dropContentSocket(node));

      const { bar, inf, btn } = makeBar(node);
      const wrap = document.createElement("div");
      wrap.className = "g13st-wrap";
      wrap.appendChild(bar);
      const bw = node.addDOMWidget("g13_bar", "g13st", wrap, {
        serialize: false,
        hideOnZoom: true,
        margin: 1,
        getMinHeight: () => BAR_H,
        getMaxHeight: () => BAR_H,
      });
      bw.serialize = false;
      bw.options = bw.options || {};
      bw.options.serialize = false;
      const ed = makeEdit(node);
      const ewrap = document.createElement("div");
      ewrap.className = "g13st-wrap";
      ewrap.appendChild(ed.row);
      const ew = node.addDOMWidget("g13_edit", "g13st", ewrap, {
        serialize: false,
        hideOnZoom: true,
        margin: 1,
        getMinHeight: () => BAR_H,
        getMaxHeight: () => BAR_H,
      });
      ew.serialize = false;
      ew.options = ew.options || {};
      ew.options.serialize = false;
      node._g13st = { inf, btn, bar, segA: ed.segA, segM: ed.segM };

      // a new node opens with an 8-line box; a loaded node keeps its saved size
      requestAnimationFrame(() => {
        if (!node._g13loaded) {
          const min = node.computeSize();
          const extra = (DEF_LINES - MIN_LINES) * LINE;
          node.setSize?.([Math.max(DEF_W, min[0]), min[1] + extra]);
          node.setDirtyCanvas?.(true, true);
        }
        update(node);
      });
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      this._g13loaded = true;
      setTimeout(() => dropContentSocket(this), 0); // older saves keep the box socket (and maybe a link)
      requestAnimationFrame(() => update(this));
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      const v = output?.gen13_text;
      if (!Array.isArray(v)) return;
      // linked: remember the upstream; AUTO shows it, MANUAL keeps the edited box
      if (linked(this, "any")) {
        const s = v.map((x) => String(x ?? "")).join("\n\n");
        const p = this.properties || (this.properties = {});
        p.g13_up = s;
        if (!isManual(this)) {
          if (textOf(this) !== s) setContent(this, s);
          p.g13_synced = s;
        } else if (p.g13_synced == null) {
          p.g13_synced = s;
        }
      }
      update(this);
    };

    const onConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = onConn?.apply(this, arguments);
      if (this.inputs?.find((x) => x.name === "content")?.link != null) setTimeout(() => rerouteContent(this), 0);
      update(this);
      return r;
    };
  },
});
