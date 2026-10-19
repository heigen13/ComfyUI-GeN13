// Remote core (GeN13): mirror groups shared by Remote Float / String / Boolean (web/remote_values.js)
//   - a group = nodes of one type whose channel text matches (trimmed), across the whole workflow
//     including subgraphs; each type has its own groups
//   - every widget in `synced` is copied to all mirrors the moment it changes; multiline text also
//     syncs on every keystroke
//   - bypass / mute: switching one mirror switches the group (noticed on redraw of that node; a
//     mirror switched off screen passes it on once drawn). The mode is assigned directly:
//     LGraphNode.changeMode() refuses bypass (4).
//   - a mirror that joins a channel (channel edited, pasted, added) takes the group's values and
//     mode; loading a workflow never rewrites values
//   - grey line at the bottom: channel · N mirrors
//   - textBox (Remote String): the backend's `value` is a forceInput socket (no core text widget), and
//     the text box is a GeN13 DOM widget named `value` (same look as Show Any Lite, drawn the same in
//     Nodes 1.0 and 2.0): a 22px bar on top (chars · lines, then cut / copy / paste icons) and the text
//     below it. The box sits right after channel (same widgets_values order as before) and sends the
//     typed text; a wire into the value socket overrides it, as for any widget.
//     cut = copy all, then clear; paste = one line break, then append at the end (same as Show Any).
//     The box is read-only (dimmed, cut / paste off) while value is wired here or on a mirror.
// This file registers no extension of its own; ComfyUI loading it directly is harmless.

import { app } from "../../scripts/app.js";
import { T, setTip, setWidgetTip } from "./g13_i18n.js";
import { applyWireLock, wireSuffix } from "./remote_link.js";

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

function elOf(x) {
  return x?.element ?? x?.inputEl ?? null;
}

function chan(node) {
  return String(w(node, "channel")?.value ?? "").trim();
}

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

// step picker (Remote Float): front-end only, kept in node.properties.g13_step (not in the API prompt),
// synced across the group. Sets the core number widget's arrow step, rounding and shown decimals:
// at least one decimal (15.0, like the core Float node), otherwise as many as the step has.
const STEPS = ["1", "0.1", "0.01", "0.001", "0.0001"];
const STEP_DEFAULT = "0.01";

function applyStep(node, s, field = "value") {
  const vw = w(node, field);
  if (!vw || !vw.options) return;
  const v = Number(s) || Number(STEP_DEFAULT);
  const dec = Math.max(1, (s.split(".")[1] || "").length);
  vw.options.step = v * 10; // legacy litegraph: arrows move 0.1 × step
  vw.options.step2 = v;     // new frontend: arrows move step2
  vw.options.round = v;
  vw.options.precision = dec;
  const cur = Number(vw.value);
  if (isFinite(cur)) {
    const r = Number((Math.round(cur / v) * v).toFixed(dec));
    if (r !== cur) vw.value = r;
  }
  node.setDirtyCanvas?.(true, true);
}

const CLIP_CSS = `
.dom-widget:has(>.g13rs-wrap){pointer-events:none!important}
.g13rs-wrap{box-sizing:border-box;width:100%;height:100%;padding:3px 9px;pointer-events:none}
.g13rs-box{pointer-events:auto;box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:6px;overflow:hidden}
.g13rs-box:focus-within{border-color:#35d0ff}
.g13rs-box.g13rs-ro{border-color:#2a2a2a}
.g13rs-bar{flex:none;box-sizing:border-box;height:22px;display:flex;align-items:center;justify-content:space-between;padding:0 3px 0 10px;border-bottom:1px solid #2a2a2a}
.g13rs-cnt{font:11px/1 Inter,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#777;white-space:nowrap;overflow:hidden}
.g13rs-tb{flex:none;display:flex;gap:2px}
.g13rs-b{all:unset;box-sizing:border-box;width:20px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:4px;color:#888;cursor:pointer}
.g13rs-b:hover{color:#eee;background:#2a2a2a}
.g13rs-b.g13rs-ok{color:#0b2a33;background:#35d0ff}
.g13rs-b:disabled{opacity:.3;cursor:default;color:#888;background:none}
.g13rs-b svg{display:block;flex:none}
.g13rs-ta{all:unset;display:block;flex:1;min-height:0;box-sizing:border-box;width:100%;padding:4px 10px;font:12px/1.5 Inter,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#d8d8d8;caret-color:#35d0ff;white-space:pre-wrap;word-break:break-word;overflow-y:auto;resize:none;cursor:text}
.g13rs-ta::placeholder{color:#555}
.g13rs-box.g13rs-ro .g13rs-ta{color:#9a9a9a;cursor:default}
`;
const CLIP_ICON = {
  cut: '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="3" cy="9" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="9" cy="9" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.3 7.7L9.5 1.5M7.7 7.7L2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  copy: '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8.5 2.2V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  paste: '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="1" width="4" height="2.2" rx=".8" fill="currentColor"/><path d="M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  ok: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6.3L4.8 9 10 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

async function clipWrite(text) {
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

async function clipRead() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export function registerRemote({ nodeId, extName, synced = ["value"], stepPicker = false, setup = null, onDraw = null, stepDefault = null, textBox = false }) {
  const stepDef = STEPS.includes(stepDefault) ? stepDefault : STEP_DEFAULT; // default step for this node type
  const stepField = stepPicker === true ? "value" : stepPicker || null; // true = "value", or the name of the FLOAT widget
  const group = (node) => {
    const c = chan(node);
    return allNodes().filter((n) => n.type === nodeId && chan(n) === c);
  };

  const setWidget = (n, name, v) => {
    const x = w(n, name);
    if (!x) return;
    if (x.value !== v) x.value = v;
    const e = elOf(x); // DOM text areas: make sure the box shows it too
    if (e && "value" in e && e.value !== v && typeof v === "string") e.value = v;
    n.setDirtyCanvas?.(true, true);
  };

  const render = (node) => {
    const b = node._g13info;
    if (!b) return;
    const g = group(node);
    const k = g.length;
    const t = `${chan(node) || "(no channel)"}  ·  ${k} ${k === 1 ? "mirror" : "mirrors"}${wireSuffix(applyWireLock(node, g))}`;
    if (b.label !== t) {
      b.label = t;
      b.name = t;
      node.setDirtyCanvas?.(true, true);
    }
  };

  const renderAll = (c) => {
    for (const n of allNodes()) if (n.type === nodeId && (c === undefined || chan(n) === c)) render(n);
  };

  const broadcast = (src, name) => {
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
  };

  const setModeOf = (n, m) => {
    if (n.mode !== m) {
      n.mode = m;
      n.setDirtyCanvas?.(true, true);
      n.graph?.setDirtyCanvas?.(true, true);
    }
    n._g13mode = n.mode;
  };

  const broadcastMode = (src) => {
    const m = src.mode;
    for (const n of group(src)) if (n !== src) setModeOf(n, m);
    src._g13mode = src.mode;
  };

  const setStep = (node, s, fromSync) => {
    if (!STEPS.includes(s)) s = stepDef;
    node.properties = node.properties || {};
    node.properties.g13_step = s;
    const sw = w(node, "step");
    if (sw && sw.value !== s) sw.value = s;
    applyStep(node, s, stepField);
    if (!fromSync) for (const n of group(node)) if (n !== node) setStep(n, s, true);
  };

  const adopt = (node) => {
    const other = group(node).find((n) => n !== node);
    if (!other) return;
    for (const name of synced) setWidget(node, name, w(other, name)?.value);
    if (stepPicker) setStep(node, other.properties?.g13_step || stepDef, true);
    setModeOf(node, other.mode);
  };

  // textBox: the box is read-only while the group has `value` wired (own wire: upstream decides;
  // another mirror's wire: applyWireLock sets widget.disabled, caught by the accessor below)
  const boxRO = (node) => !!(node._g13box?.lock || node.inputs?.find((i) => i.name === "value")?.link != null);

  const renderBox = (node) => {
    const c = node._g13box;
    if (!c) return;
    const ro = boxRO(node);
    c.box.classList.toggle("g13rs-ro", ro);
    if (c.ta.readOnly !== ro) c.ta.readOnly = ro;
    if (c.cut.disabled !== ro) c.cut.disabled = ro;
    if (c.paste.disabled !== ro) c.paste.disabled = ro;
    const v = String(node._g13v ?? "");
    if (c.ta.value !== v && document.activeElement !== c.ta) c.ta.value = v;
    const cnt = countInfo(v);
    if (c.cnt.textContent !== cnt) c.cnt.textContent = cnt;
  };

  const BOX_MIN = 100; // bar + about three lines; the box takes any extra node height

  const setupBox = (node) => {
    if (w(node, "value")) return; // already has one
    const ch = w(node, "channel");
    const at = ch ? node.widgets.indexOf(ch) + 1 : 0;
    if (!document.getElementById("g13rs-css")) {
      const st = document.createElement("style");
      st.id = "g13rs-css";
      st.textContent = CLIP_CSS;
      document.head.appendChild(st);
    }
    node._g13v = "";

    const wrap = document.createElement("div");
    wrap.className = "g13rs-wrap";
    const box = document.createElement("div");
    box.className = "g13rs-box";
    const bar = document.createElement("div");
    bar.className = "g13rs-bar";
    const cnt = document.createElement("span");
    cnt.className = "g13rs-cnt";
    const tb = document.createElement("div");
    tb.className = "g13rs-tb";
    const ta = document.createElement("textarea");
    ta.className = "g13rs-ta";
    ta.spellcheck = false;
    ta.placeholder = "value";
    setTip(ta, T("Text: syncs to every clone in the group as you type.", "文字:打字時即時同步到同組所有分身。"));
    bar.append(cnt, tb);
    box.append(bar, ta);
    wrap.appendChild(box);
    box.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    box.addEventListener("wheel", (ev) => ev.stopPropagation()); // scroll the text, not the canvas

    const setText = (v) => {
      node._g13v = v;
      if (ta.value !== v) ta.value = v;
      broadcast(node, "value");
      renderBox(node);
      node.setDirtyCanvas?.(true, true);
      node.graph?.change?.();
    };
    ta.addEventListener("input", () => {
      node._g13v = ta.value;
      cnt.textContent = countInfo(ta.value);
      broadcast(node, "value");
      node.graph?.change?.();
    });

    const mk = (k, tip, act) => {
      const b = document.createElement("button");
      b.className = "g13rs-b";
      setTip(b, tip);
      b.innerHTML = CLIP_ICON[k];
      b.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (b.disabled || !(await act())) return;
        b.classList.add("g13rs-ok");
        b.innerHTML = CLIP_ICON.ok;
        clearTimeout(b._t);
        b._t = setTimeout(() => {
          b.classList.remove("g13rs-ok");
          b.innerHTML = CLIP_ICON[k];
        }, 1200);
      });
      return b;
    };
    const cut = mk("cut", T("Cut: copies all content, then clears the box.", "剪下:複製全部內容後清空。"), async () => {
      if (boxRO(node) || !(await clipWrite(String(node._g13v ?? "")))) return false;
      setText("");
      return true;
    });
    const copy = mk("copy", T("Copy: copies all content.", "複製:複製全部內容。"), () => clipWrite(String(node._g13v ?? "")));
    const paste = mk("paste", T("Paste: adds to the end on a new line.", "貼上:換行後接在最後。"), async () => {
      if (boxRO(node)) return false;
      const t = await clipRead();
      if (t == null) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        return false;
      }
      if (!t) return false;
      setText(appendText(String(node._g13v ?? ""), t));
      ta.scrollTop = ta.scrollHeight;
      return true;
    });
    tb.append(cut, copy, paste);
    node._g13box = { box, ta, cnt, cut, paste, lock: false };

    const wd = node.addDOMWidget("value", "g13rs", wrap, {
      hideOnZoom: true,
      margin: 1,
      getValue: () => String(node._g13v ?? ""),
      setValue: (v) => {
        node._g13v = String(v ?? "");
        renderBox(node);
      },
      getMinHeight: () => BOX_MIN,
    });
    // right after channel: same widgets_values order as the old core text widget
    const last = node.widgets.pop();
    node.widgets.splice(at, 0, last);
    // applyWireLock sets widget.disabled on the other mirrors; a disabled DOM widget would be hidden
    // by the frontend, so the flag only dims the box
    Object.defineProperty(wd, "disabled", {
      configurable: true,
      get: () => false,
      set: (v) => {
        node._g13box.lock = !!v;
        renderBox(node);
      },
    });
    // the real lock state for applyWireLock (reading .disabled always gives false, so an unlock
    // compared against it would look like "no change" and never be written)
    Object.defineProperty(wd, "g13lock", { configurable: true, get: () => !!node._g13box?.lock });
    renderBox(node);
  };

  app.registerExtension({
    name: extName,

    beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== nodeId) return;

      const onCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = onCreated?.apply(this, arguments);
        const node = this;
        if (textBox) setupBox(node); // before the callbacks below are wrapped
        for (const x of node.widgets ?? []) {
          const cb = x.callback;
          x.callback = function () {
            const out = cb?.apply(this, arguments);
            if (synced.includes(x.name)) broadcast(node, x.name);
            else if (x.name === "channel") {
              if (!app.configuringGraph) adopt(node);
              renderAll();
            }
            return out;
          };
          // multiline text: sync while typing, not only when the box loses focus
          const e = elOf(x);
          if (synced.includes(x.name) && e && e.tagName === "TEXTAREA") {
            e.addEventListener("input", () => {
              if (x.value !== e.value) x.value = e.value;
              broadcast(node, x.name);
            });
          }
        }
        if (stepPicker) {
          const sw = node.addWidget("combo", "step", stepDef, (v) => setStep(node, v), { values: STEPS, serialize: false });
          const fi = node.widgets.indexOf(w(node, stepField));
          if (fi >= 0 && node.widgets[node.widgets.length - 1] === sw) { node.widgets.pop(); node.widgets.splice(fi + 1, 0, sw); }
          sw.serialize = false;
          sw.options = sw.options || {};
          sw.options.serialize = false;
          setWidgetTip(sw, T("Step: amount added or subtracted per ◀ ▶ press; the shown decimals follow it (at least one).", "步進:◀ ▶ 每按一次增減的量,顯示的小數位數跟著走(最少一位)。"));
          applyStep(node, stepDef, stepField);
        }
        setup?.(node);
        const b = node.addWidget("button", "info", null, () => {}, { serialize: false });
        b.serialize = false;
        node._g13info = b;
        node._g13mode = node.mode;
        requestAnimationFrame(() => {
          if (!app.configuringGraph && !node._g13loaded) adopt(node);
          renderAll(chan(node));
        });
        return r;
      };

      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const r = onConfigure?.apply(this, arguments);
        this._g13loaded = true;
        this._g13mode = this.mode;
        if (textBox) {
          // saved before value became a socket: its input still claims a widget; make it a plain socket
          const vi = this.inputs?.find((i) => i.name === "value");
          if (vi && vi.widget) {
            try {
              vi.widget = undefined;
            } catch {}
          }
          renderBox(this);
        }
        if (stepPicker) setStep(this, this.properties?.g13_step || stepDef, true); // restore before the saved value is shown
        const pasted = !app.configuringGraph; // configure outside a workflow load = paste / duplicate
        requestAnimationFrame(() => {
          if (pasted) adopt(this);
          renderAll(chan(this));
        });
        return r;
      };

      const onRemoved = nodeType.prototype.onRemoved;
      nodeType.prototype.onRemoved = function () {
        const r = onRemoved?.apply(this, arguments);
        const c = chan(this);
        requestAnimationFrame(() => renderAll(c));
        return r;
      };

      // a wire into / out of the value input changes the whole group's lock state
      const onConn = nodeType.prototype.onConnectionsChange;
      nodeType.prototype.onConnectionsChange = function () {
        const r = onConn?.apply(this, arguments);
        if (this._g13info) requestAnimationFrame(() => renderAll(chan(this)));
        return r;
      };

      const onDrawFg = nodeType.prototype.onDrawForeground;
      nodeType.prototype.onDrawForeground = function () {
        const r = onDrawFg?.apply(this, arguments);
        if (this._g13mode !== undefined && this._g13mode !== this.mode) broadcastMode(this);
        if (textBox) renderBox(this);
        onDraw?.(this);
        return r;
      };
    },
  });
}
