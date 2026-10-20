// Number (GeN13)
//   - a grey line at the bottom shows the three outputs: INT 8 · FLOAT 7.50 · STRING 7.5
//     (STRING with the format applied, same rule as the backend: empty = the number, {} = the
//     number put in, no {} = the number appended)
//   - FLOAT always shows a decimal point, so it never looks like an integer
//   - live from the value widget; when number is linked it shows the last run (or "from input");
//     the last run is kept in node.properties.g13_last so it survives a reload
//   - control_after_generate (fixed / increment / decrement / randomize) changes value once per
//     queue, like the core Int node; it follows the "Widget control mode" setting (before / after).
//     increment / decrement step by 1, randomize picks an integer in 0..RANDOM_MAX.

import { app } from "../../scripts/app.js";
import { isOff, inLinked } from "./g13_mode.js";
import { pick } from "./g13_i18n.js";

const NODE_ID = "NumberGeN13";
const LIMIT = 1_000_000_000;
const RANDOM_MAX = 1_000_000_000;

function controlBefore() {
  try {
    return app.extensionManager?.setting?.get?.("Comfy.WidgetControlMode") === "before";
  } catch {
    return false;
  }
}

function applyControl(node) {
  const mode = w(node, "control_after_generate")?.value;
  const val = w(node, "value");
  if (!val || !mode || mode === "fixed" || linked(node, "number")) return;
  if (isOff(node)) return; // muted / bypassed, itself or its subgraph: keep the number
  let v = Number(val.value) || 0;
  if (mode === "increment") v += 1;
  else if (mode === "decrement") v -= 1;
  else if (mode === "randomize") v = Math.floor(Math.random() * (RANDOM_MAX + 1));
  v = Math.max(-LIMIT, Math.min(LIMIT, Math.round(v * 1e6) / 1e6));
  val.value = v;
  val.callback?.(v);
}

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

function linked(node, name) {
  return inLinked(node, node.inputs?.findIndex((i) => i.name === name) ?? -1);
}

function toInt(v, mode) {
  if (mode === "floor") return Math.floor(v);
  if (mode === "ceil") return Math.ceil(v);
  return v >= 0 ? Math.floor(v + 0.5) : -Math.floor(-v + 0.5);
}

function fmtFloat(v) {
  const s = v.toFixed(6).replace(/0+$/, "");
  const dec = s.split(".")[1]?.length ?? 0;
  return v.toFixed(Math.max(2, dec));
}

function fmtStr(v) {
  const s = v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

function applyFormat(node, s) {
  const f = String(w(node, "format")?.value ?? "").trim();
  if (!f) return s;
  return f.includes("{}") ? f.split("{}").join(s) : f + s;
}

function line(i, f, s) {
  return `INT ${i}  ·  FLOAT ${fmtFloat(f)}  ·  STRING ${s}`;
}

function setText(b, text) {
  if (!b || b.label === text) return;
  b.label = text;
  b.name = text;
}

function update(node) {
  const val = w(node, "value");
  const mode = w(node, "to_int")?.value ?? "round";
  const ln = linked(node, "number");
  if (val) val.disabled = ln;
  let text;
  if (ln) {
    const r = node.properties?.g13_last;
    text = typeof r === "number" ? line(toInt(r, mode), r, applyFormat(node, fmtStr(r))) : pick("from input", "來自輸入", "来自输入", "入力から");
  } else {
    const v = Number(val?.value) || 0;
    text = line(toInt(v, mode), v, applyFormat(node, fmtStr(v)));
  }
  setText(node._g13out, text);
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "gen13.number",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      for (const x of node.widgets ?? []) {
        const cb = x.callback;
        x.callback = function () {
          const out = cb?.apply(this, arguments);
          update(node);
          return out;
        };
      }
      const ctl = w(node, "control_after_generate");
      if (ctl) {
        ctl.label = "control after generate";
        let first = true; // "before" mode skips the very first queue, like the core control
        ctl.beforeQueued = () => {
          if (controlBefore()) {
            if (!first) applyControl(node);
            first = false;
          }
        };
        ctl.afterQueued = () => {
          if (!controlBefore()) applyControl(node);
        };
      }
      const b = node.addWidget("button", "output", null, () => {}, { serialize: false });
      b.serialize = false;
      node._g13out = b;
      update(node);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      update(this);
      return r;
    };

    const onConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index) {
      const r = onConn?.apply(this, arguments);
      if (this._g13out) {
        // the number input was (dis)connected: its last value no longer applies
        if (type === 1 && this.inputs?.[index]?.name === "number" && !app.configuringGraph) {
          this.properties = this.properties || {};
          delete this.properties.g13_last;
        }
        update(this);
      }
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      const v = output?.gen13_num;
      if (Array.isArray(v) && v.length >= 2) {
        this.properties = this.properties || {};
        this.properties.g13_last = Number(v[1]);
        update(this);
      }
    };
  },
});
