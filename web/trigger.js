// Trigger (GeN13)
//   - TRIGGER button: pulse + 1. The output changes, so a Counter (GeN13) wired to it resets on the
//     next run.
//   - status line: READY (grey) / ARMED · NEXT RUN RESETS (cyan, blinking dot) from the press until a
//     run with that pulse has executed / TRIGGERED BY INPUT (cyan, 2 s) when the upstream input
//     changed. The armed pulse is kept in node.properties.g13_armed so it survives F5.

import { app } from "../../scripts/app.js";
import { T, setTip } from "./g13_i18n.js";
import { forwardWheel } from "./g13_mode.js";

const NODE_ID = "TriggerGeN13";
const BTN_H = 46; // margin 1 + pad 6 / 6 + 32px button
const ST_H = 26; // margin 1 + pad 3 / 3 + 18px line
const INPUT_MS = 2000;

const CSS = `
.dom-widget:has(>.g13tg-wrap){pointer-events:none!important}
.g13tg-wrap{box-sizing:border-box;width:100%;height:100%;padding:6px 9px;pointer-events:none}
.g13tg-wrap.g13tg-slim{padding:3px 9px}
.g13tg-wrap>*{pointer-events:auto}
.g13tg-big{all:unset;pointer-events:auto;box-sizing:border-box;width:100%;height:32px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:16px;background:#222;border:1px solid #35d0ff66;color:#35d0ff;font:12px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:1.2px;cursor:pointer;user-select:none}
.g13tg-big:hover{border-color:#35d0ff;background:#262b2e}
.g13tg-big:active{transform:scale(.98)}
.g13tg-big svg{display:block;flex:none}
.g13tg-st{box-sizing:border-box;height:18px;display:flex;align-items:center;gap:6px;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.6px;color:#777;user-select:none}
.g13tg-st i{flex:none;width:6px;height:6px;border-radius:50%;background:#555}
.g13tg-st.g13tg-on{color:#35d0ff}
.g13tg-st.g13tg-on i{background:#35d0ff}
.g13tg-st.g13tg-armed i{animation:g13tgbl 1s ease-in-out infinite}
@keyframes g13tgbl{50%{opacity:.25}}
/* light theme (Comfy.ColorPalette light): the dark look above stays as is */
:root:not(.dark-theme) .g13tg-big{background:#d4d4d4;border-color:#0a8fb866;color:#0a8fb8}
:root:not(.dark-theme) .g13tg-big:hover{border-color:#0a8fb8;background:#cfe3ea}
:root:not(.dark-theme) .g13tg-st{color:#666}
:root:not(.dark-theme) .g13tg-st i{background:#aaa}
:root:not(.dark-theme) .g13tg-st.g13tg-on{color:#0a8fb8}
:root:not(.dark-theme) .g13tg-st.g13tg-on i{background:#0a8fb8}
`;

const ICON = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.2 6a3.8 3.8 0 1 0 1.1-2.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 1.6v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function injectCss() {
  if (document.getElementById("g13tg-css")) return;
  const s = document.createElement("style");
  s.id = "g13tg-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

function addDom(node, name, el, h, slim) {
  const wrap = document.createElement("div");
  wrap.className = "g13tg-wrap" + (slim ? " g13tg-slim" : "");
  wrap.appendChild(el);
  wrap.addEventListener("pointerdown", (e) => e.stopPropagation());
  forwardWheel(wrap);
  const wd = node.addDOMWidget(name, "g13tg", wrap, {
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

function update(node) {
  const st = node._g13tg;
  if (!st) return;
  const pulse = Number(w(node, "pulse")?.value) || 0;
  const armed = node.properties?.g13_armed != null && Number(node.properties.g13_armed) === pulse;
  const byInput = Date.now() < (st.inputUntil || 0);
  let text = "READY";
  if (armed) text = "ARMED · NEXT RUN RESETS";
  else if (byInput) text = "TRIGGERED BY INPUT";
  st.state = armed ? "armed" : byInput ? "input" : "ready"; // read by the status line's hover text
  st.line.classList.toggle("g13tg-on", armed || byInput);
  st.line.classList.toggle("g13tg-armed", armed);
  if (st.text.textContent !== text) st.text.textContent = text;
}

app.registerExtension({
  name: "gen13.trigger",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      injectCss();
      node.properties = node.properties || {};

      const pw = w(node, "pulse");
      if (pw) {
        const cb = pw.callback;
        pw.callback = function () {
          const out = cb?.apply(this, arguments);
          update(node);
          return out;
        };
      }

      const btn = document.createElement("button");
      btn.className = "g13tg-big";
      setTip(btn, T("Trigger: adds 1 to pulse; the connected Counter resets on the next run.", "觸發:pulse 加 1,下次執行時,接著的 Counter 會歸零。"));
      btn.innerHTML = ICON + "<span>TRIGGER</span>";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const p = w(node, "pulse");
        if (!p) return;
        const v = (Number(p.value) || 0) + 1;
        p.value = v;
        p.callback?.(v);
        node.properties.g13_armed = v;
        update(node);
        node.setDirtyCanvas?.(true, true);
      });
      addDom(node, "g13_trigger_btn", btn, BTN_H, false);

      const line = document.createElement("div");
      line.className = "g13tg-st";
      const dot = document.createElement("i");
      const text = document.createElement("span");
      line.append(dot, text);
      const TIPS = {
        ready: T("Status: READY, waiting; press TRIGGER and the connected Counter resets on the next run.", "狀態:READY,待命中;按 TRIGGER 後,下次執行時接著的 Counter 會歸零。"),
        armed: T("Status: ARMED, the button was pressed; the connected Counter resets on the next run.", "狀態:ARMED,已按下;下次執行時接著的 Counter 會歸零。"),
        input: T("Status: TRIGGERED BY INPUT, the input value changed on the last run and fired the trigger.", "狀態:TRIGGERED BY INPUT,上次執行時 input 的值改變,已觸發。"),
      };
      setTip(line, { toString: () => String(TIPS[node._g13tg?.state] ?? TIPS.ready) });
      addDom(node, "g13_trigger_status", line, ST_H, true);

      node._g13tg = { line, text, inputUntil: 0 };
      // the DOM rows are the last widgets and nothing re-measures the node after them
      node.setSize([node.size[0], node.computeSize()[1]]); // a loaded node gets its saved size right after
      requestAnimationFrame(() => update(node));
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      requestAnimationFrame(() => update(this));
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      const v = output?.gen13_trigger;
      if (!Array.isArray(v)) return;
      this.properties = this.properties || {};
      // the run that carried the armed pulse has executed: disarm
      if (this.properties.g13_armed != null && Number(v[0]) >= Number(this.properties.g13_armed)) {
        this.properties.g13_armed = null;
      }
      const st = this._g13tg;
      if (st && Number(v[1])) {
        st.inputUntil = Date.now() + INPUT_MS;
        clearTimeout(st.t);
        st.t = setTimeout(() => update(this), INPUT_MS + 50);
      }
      update(this);
    };
  },
});
