// Show Any Lite (GeN13)
//   - one box (DOM widget). Default: one line (24px), text cut with … at the end; more lines are
//     noted as (+N lines). Hover shows the full text.
//   - drag the node taller: the box grows with it, text wraps and scrolls; drag back to the
//     minimum for one line again. The node size is saved with the workflow by ComfyUI itself.
//   - cut / copy / paste buttons (inline SVG, X C V order) at the right, cyan with a check for 1.2 s.
//     cut = copy all, then clear; paste = new line, then append at the end (empty box: no blank line).
//     cut / paste only while any is not linked (read-only display otherwise); copy always works.
//     one line: the buttons sit at the right end of the line. Taller: a 22px bar on top of the box
//     (chars · lines on the left, the buttons on the right) and the text uses the full width below it.
//   - the last shown text is kept in node.properties.g13_text, so it survives F5 / restart.
//   - any not linked: the box is a text field (textarea, one line until the node is dragged taller).
//     The box itself is the "content" widget (DOM widget, serialized), so what is typed is sent and
//     saved; the backend's forceInput "content" socket is removed (nothing to link there).
//     any linked: read-only display of the upstream content, as before.

import { app } from "../../scripts/app.js";

const NODE_ID = "ShowAnyLiteGeN13";
const ROW = 32; // DOM margin 1 + wrap pad 3 / 3 + 24px box
const DEF_W = 260;
const MULTI_AT = 34; // box taller than this = multi-line mode
const TIP_MAX = 2000;
const FLASH_MS = 1200;

const CSS = `
.dom-widget:has(>.g13sl-wrap){pointer-events:none!important}
.g13sl-wrap{box-sizing:border-box;width:100%;height:100%;padding:3px 9px;pointer-events:none}
.g13sl-box{pointer-events:auto;box-sizing:border-box;width:100%;height:100%;min-height:24px;display:flex;align-items:flex-start;gap:6px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:0 3px 0 10px;overflow:hidden}
.g13sl-tx{flex:1;min-width:0;height:22px;display:flex;align-items:center;font:12px/1 Inter,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#d8d8d8;white-space:nowrap;overflow:hidden;user-select:text}
.g13sl-tx span{overflow:hidden;text-overflow:ellipsis}
.g13sl-tx.g13sl-em{color:#555}
.g13sl-ta{all:unset;pointer-events:auto;display:block;box-sizing:border-box;width:100%;height:22px;font:12px/22px Inter,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#d8d8d8;caret-color:#35d0ff;white-space:pre;overflow:hidden;resize:none;cursor:text}
.g13sl-ta::placeholder{color:#555}
.g13sl-box.g13sl-multi .g13sl-ta{height:100%;padding:4px 0;line-height:1.5;white-space:pre-wrap;word-break:break-word;overflow-y:auto}
.g13sl-box.g13sl-edit{border-color:#3a3a3a}
.g13sl-box.g13sl-edit:focus-within{border-color:#35d0ff}
.g13sl-box.g13sl-multi .g13sl-tx{display:block;flex:1;min-height:0;height:auto;padding:4px 0;box-sizing:border-box;line-height:1.5;white-space:pre-wrap;word-break:break-word;overflow-y:auto}
.g13sl-box.g13sl-multi .g13sl-tx span{overflow:visible;text-overflow:clip}
.g13sl-cp{all:unset;pointer-events:auto;box-sizing:border-box;flex:none;width:20px;height:18px;margin-top:2px;display:flex;align-items:center;justify-content:center;border-radius:4px;color:#888;cursor:pointer}
.g13sl-cp:hover{color:#eee;background:#2a2a2a}
.g13sl-cp.g13sl-ok{color:#0b2a33;background:#35d0ff}
.g13sl-cp svg{display:block;flex:none}
.g13sl-cp:disabled{opacity:.3;cursor:default;background:none;color:#888}
.g13sl-tb{flex:none;display:flex;gap:2px;pointer-events:auto}
.g13sl-bar{display:none;flex:none;box-sizing:border-box;height:22px;margin:0 -3px 0 -10px;padding:0 3px 0 10px;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a2a}
.g13sl-cnt{font:11px/1 Inter,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#777;white-space:nowrap;overflow:hidden}
.g13sl-bar .g13sl-cp{margin-top:0}
.g13sl-box.g13sl-multi{flex-direction:column;align-items:stretch;gap:0}
.g13sl-box.g13sl-multi .g13sl-bar{display:flex}
`;

const ICON = {
  cut: '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="3" cy="9" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="9" cy="9" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.3 7.7L9.5 1.5M7.7 7.7L2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  paste: '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="1" width="4" height="2.2" rx=".8" fill="currentColor"/><path d="M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  copy: '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8.5 2.2V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  ok: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6.3L4.8 9 10 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function injectCss() {
  if (document.getElementById("g13sl-css")) return;
  const s = document.createElement("style");
  s.id = "g13sl-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

async function writeClip(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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
      return false;
    }
  }
}

function anyLinked(node) {
  const s = node.inputs?.find((i) => i.name === "any");
  return !!(s && s.link != null);
}

// text the copy button / Show Any swap should use: typed text when free, shown text when linked
function liteText(node) {
  return anyLinked(node) ? String(node.properties?.g13_text ?? "") : String(node._g13in ?? "");
}

function render(node) {
  const st = node._g13sl;
  if (!st) return;
  const multi = st.box.clientHeight > MULTI_AT;
  st.box.classList.toggle("g13sl-multi", multi);
  const free = !anyLinked(node);
  st.box.classList.toggle("g13sl-edit", free);
  // taller: buttons go up to the bar; one line: back to the end of the line
  const home = multi ? st.bar : st.box;
  if (st.tb.parentElement !== home) home.appendChild(st.tb);
  const cnt = countInfo(liteText(node));
  if (st.cnt.textContent !== cnt) st.cnt.textContent = cnt;
  if (st.cut) st.cut.disabled = !free;
  if (st.paste) st.paste.disabled = !free;
  st.ta.style.display = free ? "" : "none";
  st.span.style.display = free ? "none" : "";
  if (free) {
    st.tx.classList.remove("g13sl-em");
    st.ta.wrap = multi ? "soft" : "off";
    const t = String(node._g13in ?? "");
    if (st.ta.value !== t && document.activeElement !== st.ta) st.ta.value = t;
    st.box.title = "";
    return;
  }
  const v = String(node.properties?.g13_text ?? "");
  st.tx.classList.toggle("g13sl-em", !v);
  let shown;
  if (!v) shown = "(empty)";
  else if (multi) shown = v;
  else {
    const lines = v.split("\n");
    shown = lines[0] + (lines.length > 1 ? `  (+${lines.length - 1} ${lines.length === 2 ? "line" : "lines"})` : "");
  }
  if (st.span.textContent !== shown) st.span.textContent = shown;
  st.box.title = v.length > TIP_MAX ? v.slice(0, TIP_MAX) + "…" : v;
}

function setBtn(b, on, k = "copy") {
  b.classList.toggle("g13sl-ok", on);
  b.innerHTML = on ? ICON.ok : ICON[k];
}

function flashBtn(b, k) {
  setBtn(b, true, k);
  clearTimeout(b._t);
  b._t = setTimeout(() => setBtn(b, false, k), FLASH_MS);
}

// same rules as Show Any (GeN13): paste adds one line break, never a blank line
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
  return `${chars.toLocaleString("en-US")} chars · ${lines.toLocaleString("en-US")} ${lines === 1 ? "line" : "lines"}`;
}

async function readClip() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null; // not allowed here: caller focuses the box so Ctrl+V works
  }
}

// typed text changed by a button: keep the box, the stored value and the canvas in step
function setTyped(node, v) {
  node._g13in = v;
  const ta = node._g13sl?.ta;
  if (ta && ta.value !== v) ta.value = v;
  if (node._g13sl?.cnt) node._g13sl.cnt.textContent = countInfo(v);
  node.setDirtyCanvas?.(true, true);
  node.graph?.change?.();
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
    : liteText(node);
  nn.properties = nn.properties || {};
  if (toType !== "ShowAnyGeN13") nn.properties.g13_text = text;
  // both nodes have a "content" widget: full = its text box, lite = the typed text
  const cw = nn.widgets?.find((x) => x.name === "content");
  if (cw) cw.value = text;

  // input: the "any" link
  const inp = node.inputs?.find((s) => s.name === "any");
  if (inp && inp.link != null) {
    const l = g13GetLink(graph, inp.link);
    const src = l ? graph.getNodeById(l.origin_id) : null;
    const to = nn.inputs?.findIndex((s) => s.name === "any") ?? -1;
    if (src && to >= 0) src.connect(l.origin_slot, nn, to);
  }
  // outputs: STRING (0) and any (1) are in the same order on both nodes
  (node.outputs ?? []).forEach((o, k) => {
    for (const id of [...(o.links ?? [])]) {
      const l = g13GetLink(graph, id);
      const dst = l ? graph.getNodeById(l.target_id) : null;
      if (dst && k < (nn.outputs?.length ?? 0)) nn.connect(k, dst, l.target_slot);
    }
  });

  graph.remove(node);
  app.canvas?.selectNode?.(nn);
  graph.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "gen13.show_any_lite",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const getMenu = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      const r = getMenu?.apply(this, arguments);
      options.unshift({ content: "Convert to Show Any (GeN13)", callback: () => g13SwapShowAny(this, "ShowAnyGeN13") }, null);
      return r;
    };

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      injectCss();
      node.properties = node.properties || {};

      const wrap = document.createElement("div");
      wrap.className = "g13sl-wrap";
      const box = document.createElement("div");
      box.className = "g13sl-box";
      const tx = document.createElement("div");
      tx.className = "g13sl-tx";
      const span = document.createElement("span");
      const ta = document.createElement("textarea");
      ta.className = "g13sl-ta";
      ta.rows = 1;
      ta.spellcheck = false;
      ta.placeholder = "輸入文字";
      ta.addEventListener("input", () => {
        node._g13in = ta.value;
        const c = node._g13sl?.cnt;
        if (c) c.textContent = countInfo(ta.value);
        node.setDirtyCanvas?.(true, false);
      });
      tx.append(span, ta);
      const mk = (k, tip, act) => {
        const b = document.createElement("button");
        b.className = "g13sl-cp";
        b.title = tip;
        setBtn(b, false, k);
        b.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (b.disabled) return;
          if (await act()) flashBtn(b, k);
        });
        return b;
      };
      const cut = mk("cut", "剪下:複製全部內容後清空。", async () => {
        if (anyLinked(node)) return false;
        if (!(await writeClip(String(node._g13in ?? "")))) return false;
        setTyped(node, "");
        return true;
      });
      const cp = mk("copy", "複製:複製全部內容。", () => writeClip(liteText(node)));
      const paste = mk("paste", "貼上:換行後接在最後。", async () => {
        if (anyLinked(node)) return false;
        const t = await readClip();
        if (t == null) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
          return false;
        }
        if (!t) return false;
        const cur = String(node._g13in ?? "");
        setTyped(node, appendText(cur, t));
        ta.scrollTop = ta.scrollHeight;
        return true;
      });
      const tb = document.createElement("div");
      tb.className = "g13sl-tb";
      tb.append(cut, cp, paste);
      const bar = document.createElement("div");
      bar.className = "g13sl-bar";
      const cnt = document.createElement("span");
      cnt.className = "g13sl-cnt";
      bar.appendChild(cnt);
      box.append(bar, tx, tb);
      wrap.appendChild(box);
      box.addEventListener("pointerdown", (e) => e.stopPropagation());
      box.addEventListener("wheel", (e) => {
        if (box.classList.contains("g13sl-multi")) e.stopPropagation(); // scroll the text, not the canvas
      });

      // the backend's "content" is forceInput (no auto widget): drop its socket, the box sends it
      const ci = node.inputs?.findIndex((s) => s.name === "content") ?? -1;
      if (ci >= 0) node.removeInput(ci);
      node._g13in = "";
      const wd = node.addDOMWidget("content", "g13sl", wrap, {
        hideOnZoom: true,
        margin: 1,
        getValue: () => String(node._g13in ?? ""),
        setValue: (v) => {
          node._g13in = String(v ?? "");
          render(node);
        },
        getMinHeight: () => ROW,
        // max = the room the user dragged open; one line until the node is made taller
        getMaxHeight: () => Math.max(ROW, node._g13slRoom || ROW),
      });
      node._g13sl = { box, tx, span, ta, wd, cut, paste, tb, bar, cnt };

      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => render(node));
        ro.observe(box);
      }

      // a new node opens one line high and 260 wide; a loaded node keeps its saved size
      requestAnimationFrame(() => {
        if (!node._g13loaded) {
          const min = node.computeSize();
          node.setSize?.([Math.max(DEF_W, min[0]), min[1]]);
          node.setDirtyCanvas?.(true, true);
        }
        render(node);
      });
      return r;
    };

    // dragging the node taller opens room for the box; shorter closes it back to one line
    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = onResize?.apply(this, arguments);
      const wd = this._g13sl?.wd;
      if (wd && typeof wd.y === "number" && size) {
        const room = Math.floor(size[1] - wd.y - 4);
        if (room !== this._g13slRoom) {
          this._g13slRoom = room;
          this.setDirtyCanvas?.(true, true);
        }
      }
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      this._g13loaded = true;
      // a saved node: its saved height decides the room once the widget has a position
      requestAnimationFrame(() => {
        this.onResize?.(this.size);
        render(this);
      });
      return r;
    };

    // linking / unlinking any switches between the text field and the read-only display
    const onConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = onConn?.apply(this, arguments);
      render(this);
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      const v = output?.gen13_text;
      if (!Array.isArray(v)) return;
      this.properties = this.properties || {};
      this.properties.g13_text = v.map((x) => String(x ?? "")).join("\n\n");
      render(this);
    };
  },
});
