// ComfyUI-GeN13 - widget values restored by name
//   ComfyUI saves widgets_values by position: once a node gains or loses a field in the middle, every
//   saved value after it lands one field off. Frontend 1.57+ already writes
//   widgets_values_named = { field: value } beside it (older frontends: written here in onSerialize),
//   but still restores by position. For every GeN13 node this puts the saved values back by name at
//   the very start of onConfigure, before any GeN13 onConfigure logic reads them (every one of those
//   calls the previous handler first), and a field missing from the saved map is new: it keeps its
//   default instead of the neighbour's value.
//   - workflows saved without widgets_values_named keep the plain position restore, untouched
//   - front-end state in node.properties (Text Switch titles, auto next, Remote step, private preview
//     settings...) is named already and left alone
//   - the API prompt (graphToPrompt) is built by name: templates need no re-export
import { app } from "../../scripts/app.js";

const KEY = "widgets_values_named";
const isG13 = (name) => /GeN13$/.test(String(name ?? ""));
const saved = (w) => !!w && typeof w.name === "string" && w.name !== "" && w.serialize !== false;
const clone = (v) => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v ?? null);
const same = (a, b) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
};

// { field: value } of the saved widgets; a name used twice on the node is left out (ambiguous)
function namedOf(node) {
  const out = {};
  const dup = new Set();
  for (const w of node.widgets ?? []) {
    if (!saved(w)) continue;
    if (Object.hasOwn(out, w.name)) dup.add(w.name);
    out[w.name] = clone(w.value);
  }
  for (const n of dup) delete out[n];
  return out;
}

function restore(node, info) {
  const named = info?.[KEY];
  const defs = node._g13defaults;
  delete node._g13defaults;
  if (!named || typeof named !== "object" || Array.isArray(named)) return;
  const ws = (node.widgets ?? []).filter(saved);
  const uses = new Map();
  for (const w of ws) uses.set(w.name, (uses.get(w.name) ?? 0) + 1);
  for (const w of ws) {
    if (uses.get(w.name) !== 1) continue;
    let v;
    if (Object.hasOwn(named, w.name)) v = named[w.name];
    else if (defs && Object.hasOwn(defs, w.name)) v = defs[w.name]; // field added after the save
    else continue;
    if (same(w.value, v)) continue;
    try {
      w.value = clone(v);
    } catch (e) {
      console.warn("[GeN13] named restore:", node.type, w.name, e);
    }
  }
}

app.registerExtension({
  name: "GeN13.NamedValues",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!isG13(nodeData?.name)) return;
    const proto = nodeType.prototype;

    // the widgets still hold their defaults here (the node is built, nothing applied yet)
    const configure = proto.configure;
    proto.configure = function (info) {
      if (info?.[KEY]) this._g13defaults = namedOf(this);
      return configure.apply(this, arguments);
    };

    // restore first, then hand over: the GeN13 handlers wrapped around this one run after it
    const onConfigure = proto.onConfigure;
    proto.onConfigure = function (info) {
      restore(this, info);
      return onConfigure?.apply(this, arguments);
    };

    // frontends before 1.57 write positions only: add the named copy (never overwrite the core one)
    const onSerialize = proto.onSerialize;
    proto.onSerialize = function (o) {
      onSerialize?.apply(this, arguments);
      if (o && Array.isArray(o.widgets_values) && !o[KEY] && this.widgets?.length) o[KEY] = namedOf(this);
    };
  },
});
