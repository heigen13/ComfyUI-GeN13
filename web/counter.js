// Counter (GeN13)
//   - run goes up by 1 after every queue (same timing as the core control_after_generate, follows
//     Comfy.WidgetControlMode before / after); muted or bypassed nodes do not count.
//   - the number itself is worked out by the back end when the run executes, from run, mode,
//     start, end, step, hold and the base it keeps for reset / auto_reset. The bar here shows the
//     next value using the last base the back end reported (node.properties.g13_base).
//   - bottom bar: next value · position / count · start -> end, hold progress, RESET button
//     (run -> 0), thin progress line. Icons are inline SVG.
//   - hold 2..8 shows small squares (one lights per run); hold 9+ shows "hold k / n" text so the bar
//     never grows past the node.
//   - every finished execution flashes the next value (cyan block fading out in 0.5 s), so a repeated
//     number during hold still shows that a run happened.

import { app } from "../../scripts/app.js";
import { isOff } from "./g13_mode.js";
import { T, setTip, setWidgetTip } from "./g13_i18n.js";

const NODE_ID = "CounterGeN13";
const BAR_H = 32;
const PG_H = 9;
const FLASH_MS = 1200;
const MAX_DOTS = 8;

const CSS = `
.dom-widget:has(>.g13ct-wrap){pointer-events:none!important}
.g13ct-wrap{box-sizing:border-box;width:100%;height:100%;padding:3px 9px;pointer-events:none}
.g13ct-wrap>*{pointer-events:auto}
.g13ct-bar{box-sizing:border-box;height:24px;display:flex;align-items:center;gap:6px;user-select:none}
.g13ct-inf{flex:1;min-width:0;height:24px;display:flex;align-items:center;gap:6px;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.3px;color:#888;white-space:nowrap;overflow:hidden}
.g13ct-inf>span{flex:none;display:flex;align-items:center;height:24px}
.g13ct-inf>.g13ct-nx{box-sizing:border-box;height:18px;padding:0 4px;margin:0 -4px;justify-content:center;border-radius:4px;color:#35d0ff;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.3px;font-variant-numeric:tabular-nums}
.g13ct-nx.g13ct-fl{animation:g13ctfl .5s ease-out}
@keyframes g13ctfl{0%{background:#35d0ff;color:#0b2a33}100%{background:transparent;color:#35d0ff}}
.g13ct-inf>.g13ct-dots{gap:3px}
.g13ct-dots i{box-sizing:border-box;width:8px;height:8px;border-radius:2px;background:#2a2a2a;border:1px solid #444}
.g13ct-dots i.on{background:#35d0ff;border-color:#35d0ff}
.g13ct-bt{all:unset;box-sizing:border-box;flex:none;width:84px;height:24px;display:flex;align-items:center;justify-content:center;gap:5px;border-radius:12px;background:#222;border:1px solid #1a1a1a;font:11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.6px;color:#bbb;cursor:pointer}
.g13ct-bt:hover{color:#eee;border-color:#555}
.g13ct-bt.g13ct-ok{background:#35d0ff;border-color:#35d0ff;color:#0b2a33}
.g13ct-bt svg{display:block;flex:none}
.g13ct-pg{position:relative;box-sizing:border-box;height:3px;margin-top:3px;background:#222;border-radius:2px;overflow:hidden}
.g13ct-pg i{position:absolute;left:0;top:0;bottom:0;background:#35d0ff;border-radius:2px;transition:width .15s ease-out}
`;

const ICON = {
  reset: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.2 6a3.8 3.8 0 1 0 1.1-2.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 1.6v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ok: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6.3L4.8 9 10 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function injectCss() {
  if (document.getElementById("g13ct-css")) return;
  const s = document.createElement("style");
  s.id = "g13ct-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

function val(node, name, d = 0) {
  const v = Number(w(node, name)?.value);
  return Number.isFinite(v) ? v : d;
}

function controlBefore() {
  try {
    return app.extensionManager?.setting?.get?.("Comfy.WidgetControlMode") === "before";
  } catch {
    return false;
  }
}

function fmt(v) {
  const s = (Math.round(v * 1e6) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

// same rules as counter.py
function countOf(mode, start, end, step) {
  step = Math.abs(step) || 1;
  const span = mode.startsWith("increment") ? end - start : start - end;
  if (span < 0) return 1;
  return Math.floor(span / step + 1e-9) + 1;
}

function valueAt(idx, mode, start, end, step) {
  step = Math.abs(step) || 1;
  const sign = mode.startsWith("increment") ? 1 : -1;
  let i = idx;
  if (mode !== "increment" && mode !== "decrement") {
    const n = countOf(mode, start, end, step);
    i = mode.endsWith("_to_end") ? Math.min(idx, n - 1) : idx % n;
  }
  return Math.round((start + sign * i * step) * 1e9) / 1e9;
}

function base(node) {
  const b = Number(node.properties?.g13_base);
  return Number.isFinite(b) ? b : 0;
}

function update(node) {
  const st = node._g13ct;
  if (!st) return;
  const run = Math.max(0, Math.round(val(node, "run")));
  const mode = String(w(node, "mode")?.value ?? "increment");
  const start = val(node, "start");
  const end = val(node, "end", 10);
  const step = val(node, "step", 1);
  const hold = Math.max(1, Math.round(val(node, "hold", 1)));
  const b = run < base(node) ? 0 : base(node);
  const rel = Math.max(0, run - b);
  const idx = Math.floor(rel / hold);
  const next = valueAt(idx, mode, start, end, step);
  const bounded = mode !== "increment" && mode !== "decrement";
  let txt;
  let pct = 0;
  if (bounded) {
    const n = countOf(mode, start, end, step);
    const pos = Math.min(n, (mode.endsWith("_to_end") ? Math.min(idx, n - 1) : idx % n) + 1);
    txt = `${pos} / ${n} · ${fmt(start)} → ${fmt(end)}`;
    pct = n > 1 ? ((pos - 1) / (n - 1)) * 100 : 100;
  } else {
    txt = `step ${mode === "increment" ? "+" : "−"}${fmt(Math.abs(step) || 1)}`;
  }
  const k = rel % hold; // which run of this number comes next (0-based)
  st.inf.textContent = "";
  const span = (cls, t) => {
    const e = document.createElement("span");
    if (cls) e.className = cls;
    if (t != null) e.textContent = t;
    st.inf.appendChild(e);
    return e;
  };
  span("", "next");
  st.nx = span("g13ct-nx", fmt(next));
  span("", `· ${txt}`);
  if (hold > 1 && hold <= MAX_DOTS) {
    const d = span("g13ct-dots");
    for (let i = 0; i < hold; i++) {
      const sq = document.createElement("i");
      if (i <= k) sq.className = "on"; // same as the preview: the next run's square is lit
      d.appendChild(sq);
    }
  } else if (hold > MAX_DOTS) {
    span("", `· hold ${k + 1} / ${hold}`);
  }
  st.pg.style.width = `${pct}%`;
}

function setBtn(b, on) {
  b.classList.toggle("g13ct-ok", on);
  b.innerHTML = (on ? ICON.ok : ICON.reset) + "<span>RESET</span>";
}

function stepRun(node) {
  if (isOff(node)) return; // muted / bypassed, itself or its subgraph: keep the count
  const rw = w(node, "run");
  if (!rw) return;
  const v = Math.max(0, Math.round(Number(rw.value) || 0)) + 1;
  rw.value = v;
  rw.callback?.(v);
  update(node);
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "gen13.counter",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      injectCss();
      node.properties = node.properties || {};

      for (const x of node.widgets ?? []) {
        const cb = x.callback;
        x.callback = function () {
          const out = cb?.apply(this, arguments);
          update(node);
          return out;
        };
      }

      const wrap = document.createElement("div");
      wrap.className = "g13ct-wrap";
      const bar = document.createElement("div");
      bar.className = "g13ct-bar";
      const inf = document.createElement("div");
      inf.className = "g13ct-inf";
      const btn = document.createElement("button");
      btn.className = "g13ct-bt";
      setTip(btn, T("Reset: sets run to 0; the next output is start.", "歸零:run 回到 0,下一次輸出 start。"));
      setBtn(btn, false);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rw = w(node, "run");
        if (rw) {
          rw.value = 0;
          rw.callback?.(0);
        }
        node.properties.g13_base = 0;
        update(node);
        node.setDirtyCanvas?.(true, true);
        setBtn(btn, true);
        clearTimeout(btn._t);
        btn._t = setTimeout(() => setBtn(btn, false), FLASH_MS);
      });
      bar.append(inf, btn);
      const pgw = document.createElement("div");
      pgw.className = "g13ct-pg";
      const pg = document.createElement("i");
      pgw.appendChild(pg);
      wrap.append(bar, pgw);
      wrap.addEventListener("pointerdown", (e) => e.stopPropagation());

      const bw = node.addDOMWidget("g13_counter_bar", "g13ct", wrap, {
        serialize: false,
        hideOnZoom: true,
        margin: 1,
        getMinHeight: () => BAR_H + PG_H,
        getMaxHeight: () => BAR_H + PG_H,
      });
      bw.serialize = false;
      bw.options = bw.options || {};
      bw.options.serialize = false;
      node._g13ct = { inf, pg };

      // same timing as the core control_after_generate
      let first = true;
      bw.beforeQueued = () => {
        if (controlBefore()) {
          if (!first) stepRun(node);
          first = false;
        }
      };
      bw.afterQueued = () => {
        if (!controlBefore()) stepRun(node);
      };

      // the DOM bar is the last widget and nothing re-measures the node after it: size it now so a
      // new node is not 12 px short (status line on the bottom edge, node growing after a reload)
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
      const v = output?.gen13_counter;
      if (Array.isArray(v) && v.length >= 2) {
        this.properties = this.properties || {};
        this.properties.g13_base = Number(v[1]) || 0;
        update(this);
        const nx = this._g13ct?.nx; // a run finished: flash the number even when it repeats
        if (nx) {
          nx.classList.remove("g13ct-fl");
          void nx.offsetWidth;
          nx.classList.add("g13ct-fl");
        }
      }
    };
  },
});
