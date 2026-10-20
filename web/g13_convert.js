// ComfyUI-GeN13 - right-click conversions and link-release shortcuts
//
// Conversions (node right-click menu): the new node takes the old node's place, settings and links.
//   - Load Image -> Load Image Private; Save Image / Preview Image -> Save / Preview Image Private
//   - Primitive (Int / Float / String / Boolean, also the legacy widget Primitive) -> matching Remote;
//     the channel is named after the input it feeds (steps, seed ...), made unique so it never joins
//     an existing group by accident
//   - Save Image Private <-> Preview Image Private (privacy settings kept)
//   - Load Image Private <-> Load Image Orient <-> Load Image SD (same image file)
//   - Text Concatenate <-> Text Switch (box texts kept; Text Switch -> Concatenate only for a single,
//     unchained node of 20 boxes or fewer)
//   Links are moved by slot name first, then by matching type; a slot the new node does not have is
//   dropped (for example the extra SD outputs when Load Image SD becomes Load Image Private).
//
// Link release:
//   - dragging a Text Switch chain output onto empty canvas adds the next Text Switch there, linked
//     (hold Shift for the normal search box)
//   - the search box opened by a released link lists the matching GeN13 nodes first when nothing is
//     typed yet (IMAGE, STRING, INT, FLOAT)

import { app } from "../../scripts/app.js";

// menu label in the ComfyUI language (en / zh-TW / zh / ja)
function convertLabel(name) {
  let l = "en";
  try {
    l = app.extensionManager?.setting?.get?.("Comfy.Locale") ?? "en";
  } catch {}
  const n = `${name} (GeN13)`;
  if (l === "zh-TW") return `轉換成 ${n}`;
  if (l === "zh") return `转换成 ${n}`;
  if (l === "ja") return `${n} に変換`;
  return `Convert to ${n}`;
}

const LG = () => globalThis.LiteGraph;

function getLink(graph, id) {
  return graph?.links?.[id] ?? graph?.links?.get?.(id) ?? null;
}
function wv(node, name) {
  return node.widgets?.find((x) => x.name === name);
}
function setW(node, name, value) {
  const w = wv(node, name);
  if (!w || value === undefined) return;
  w.value = value;
  try {
    w.callback?.(value, app.canvas, node);
  } catch {}
}

// the slot of `slots` a link on `slot` should move to: same name, else first free slot of the type
function pickSlot(slots, slot, used, nameMap) {
  const want = nameMap?.[slot.name] ?? slot.name;
  let k = slots.findIndex((s) => s.name === want);
  if (k >= 0) return k;
  k = slots.findIndex((s, i) => !used.has(i) && String(s.type) === String(slot.type));
  return k;
}

function swapNode(node, toType, opts = {}) {
  const graph = node.graph ?? app.graph;
  if (!LG() || !graph) return null;
  const nn = LG().createNode(toType);
  if (!nn) return null;
  nn.pos = [node.pos[0], node.pos[1]];
  if (node.color) nn.color = node.color;
  if (node.bgcolor) nn.bgcolor = node.bgcolor;
  graph.add(nn);

  for (const name of opts.widgets ?? []) setW(nn, name, wv(node, name)?.value);
  if (opts.props) {
    nn.properties = nn.properties || {};
    for (const [k, v] of Object.entries(node.properties ?? {})) if (opts.props(k)) nn.properties[k] = v == null ? v : JSON.parse(JSON.stringify(v));
  }
  opts.before?.(node, nn);

  // inputs
  const usedIn = new Set();
  (node.inputs ?? []).forEach((inp) => {
    if (inp.link == null) return;
    const l = getLink(graph, inp.link);
    const src = l ? graph.getNodeById(l.origin_id) : null;
    const k = pickSlot(nn.inputs ?? [], inp, usedIn, opts.inMap);
    if (!src || k < 0) return;
    usedIn.add(k);
    src.connectSlots(src.outputs[l.origin_slot], nn, nn.inputs[k]);
  });
  // outputs
  const outFor = new Map();
  (node.outputs ?? []).forEach((o) => {
    if (!o.links?.length) return;
    const k = pickSlot(nn.outputs ?? [], o, new Set(outFor.values()), opts.outMap);
    if (k < 0) return;
    outFor.set(o, k);
    for (const id of [...o.links]) {
      const l = getLink(graph, id);
      const dst = l ? graph.getNodeById(l.target_id) : null;
      if (dst) nn.connectSlots(nn.outputs[k], dst, dst.inputs[l.target_slot]);
    }
  });

  opts.after?.(node, nn);
  graph.remove(node);
  app.canvas?.selectNode?.(nn);
  graph.setDirtyCanvas?.(true, true);
  return nn;
}

// ---------------------------------------------------------------- conversions

const PRIVATE = ["LoadImagePrivateGeN13", "SaveImagePrivateGeN13", "PreviewImagePrivateGeN13"];
const isPrivProp = (k) => k.startsWith("g13_");
// privacy widgets read their property only when created: set them too so the node shows the copied settings
const PRIV_W = ["preview", "privacy", "privacy_style", "palette", "frost_blur", "glass", "brightness"];
const NAMES = {
  LoadImagePrivateGeN13: "Load Image Private",
  SaveImagePrivateGeN13: "Save Image Private",
  PreviewImagePrivateGeN13: "Preview Image Private",
  LoadImageOrientGeN13: "Load Image Orient",
  LoadImageSDGeN13: "Load Image SD",
  RemoteIntGeN13: "Remote Int",
  RemoteFloatGeN13: "Remote Float",
  RemoteStringGeN13: "Remote String",
  RemoteBooleanGeN13: "Remote Boolean",
  TextSwitchGeN13: "Text Switch",
  TextConcatenateGeN13: "Text Concatenate",
};

const REMOTE_FOR = { INT: "RemoteIntGeN13", FLOAT: "RemoteFloatGeN13", STRING: "RemoteStringGeN13", BOOLEAN: "RemoteBooleanGeN13" };
const PRIMITIVES = {
  PrimitiveInt: "INT",
  PrimitiveFloat: "FLOAT",
  PrimitiveString: "STRING",
  PrimitiveStringMultiline: "STRING",
  PrimitiveBoolean: "BOOLEAN",
};

// channel named after the first input the primitive feeds, unique among remotes of that type
function channelFor(node, remoteType) {
  const graph = node.graph ?? app.graph;
  let base = "remote";
  for (const id of node.outputs?.[0]?.links ?? []) {
    const l = getLink(graph, id);
    const dst = l ? graph.getNodeById(l.target_id) : null;
    const nm = dst?.inputs?.[l.target_slot]?.widget?.name ?? dst?.inputs?.[l.target_slot]?.name;
    if (nm) {
      base = nm;
      break;
    }
  }
  const taken = new Set();
  const root = graph.rootGraph ?? graph;
  const graphs = [root, ...(root._subgraphs?.values?.() ?? [])];
  for (const g of graphs) for (const n of g?._nodes ?? []) if (n.type === remoteType) taken.add(String(wv(n, "channel")?.value ?? "").trim());
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}

function primitiveToRemote(node, type) {
  const rt = REMOTE_FOR[type];
  if (!rt) return;
  const vw = node.type === "PrimitiveNode" ? node.widgets?.[0] : wv(node, "value");
  const value = vw?.value;
  const ctrl = node.widgets?.find((x) => x.name === "control_after_generate")?.value;
  const channel = channelFor(node, rt);
  swapNode(node, rt, {
    before: (_, nn) => {
      setW(nn, "channel", channel);
      setW(nn, "value", value);
      if (ctrl !== undefined) setW(nn, "control_after_generate", ctrl);
    },
    after: (_, nn) => {
      // the remote output is the first (only) output whatever the primitive called it
      const graph = nn.graph ?? app.graph;
      const o = node.outputs?.[0];
      if (!o?.links?.length || nn.outputs?.[0]?.links?.length) return;
      for (const id of [...o.links]) {
        const l = getLink(graph, id);
        const dst = l ? graph.getNodeById(l.target_id) : null;
        if (dst) nn.connectSlots(nn.outputs[0], dst, dst.inputs[l.target_slot]);
      }
    },
  });
}

function boxCount(node) {
  return Math.max(1, Number(wv(node, "count")?.value) || 1);
}
function textSwitchChained(node) {
  const up = node.inputs?.find((s) => s.name === "chain")?.link != null;
  const down = node.outputs?.find((s) => s.name === "chain")?.links?.length > 0;
  return up || down;
}

function textsOf(node, n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(wv(node, `text_${String(i).padStart(2, "0")}`)?.value ?? "");
  return out;
}

function toTextSwitch(node) {
  const n = boxCount(node);
  const texts = textsOf(node, n);
  swapNode(node, "TextSwitchGeN13", {
    before: (_, nn) => {
      setW(nn, "count", n);
      texts.forEach((t, i) => setW(nn, `text_${String(i + 1).padStart(2, "0")}`, t));
    },
  });
}
function toConcatenate(node) {
  const n = boxCount(node);
  const texts = textsOf(node, n);
  swapNode(node, "TextConcatenateGeN13", {
    before: (_, nn) => {
      setW(nn, "count", n);
      texts.forEach((t, i) => setW(nn, `text_${String(i + 1).padStart(2, "0")}`, t));
    },
  });
}

// type -> [ [label, action] ... ]
function conversionsFor(node) {
  const t = node.type;
  const to = (target) => convertLabel(NAMES[target]);
  const list = [];
  if (t === "LoadImage") list.push([to("LoadImagePrivateGeN13"), () => swapNode(node, "LoadImagePrivateGeN13", { widgets: ["image"] })]);
  if (t === "SaveImage") list.push([to("SaveImagePrivateGeN13"), () => swapNode(node, "SaveImagePrivateGeN13", { widgets: ["filename_prefix"] })]);
  if (t === "PreviewImage") list.push([to("PreviewImagePrivateGeN13"), () => swapNode(node, "PreviewImagePrivateGeN13")]);
  if (t in PRIMITIVES) list.push([to(REMOTE_FOR[PRIMITIVES[t]]), () => primitiveToRemote(node, PRIMITIVES[t])]);
  if (t === "PrimitiveNode") {
    const ty = String(node.outputs?.[0]?.type ?? "");
    if (REMOTE_FOR[ty]) list.push([to(REMOTE_FOR[ty]), () => primitiveToRemote(node, ty)]);
  }
  if (t === "SaveImagePrivateGeN13") list.push([to("PreviewImagePrivateGeN13"), () => swapNode(node, "PreviewImagePrivateGeN13", { props: isPrivProp, widgets: PRIV_W })]);
  if (t === "PreviewImagePrivateGeN13") list.push([to("SaveImagePrivateGeN13"), () => swapNode(node, "SaveImagePrivateGeN13", { props: isPrivProp, widgets: PRIV_W })]);
  const loaders = ["LoadImagePrivateGeN13", "LoadImageOrientGeN13", "LoadImageSDGeN13"];
  if (loaders.includes(t)) {
    for (const target of loaders) {
      if (target === t) continue;
      const props = t === "LoadImagePrivateGeN13" && target !== "LoadImagePrivateGeN13" ? undefined : isPrivProp;
      list.push([to(target), () => swapNode(node, target, { widgets: ["image"], props })]);
    }
  }
  if (t === "TextConcatenateGeN13") list.push([to("TextSwitchGeN13"), () => toTextSwitch(node)]);
  if (t === "TextSwitchGeN13" && !textSwitchChained(node) && boxCount(node) <= 20) list.push([to("TextConcatenateGeN13"), () => toConcatenate(node)]);
  return list;
}

const MENU_TYPES = new Set([
  "LoadImage", "SaveImage", "PreviewImage", "PrimitiveNode", ...Object.keys(PRIMITIVES),
  "SaveImagePrivateGeN13", "PreviewImagePrivateGeN13", "LoadImagePrivateGeN13", "LoadImageOrientGeN13",
  "LoadImageSDGeN13", "TextConcatenateGeN13", "TextSwitchGeN13",
]);

// ---------------------------------------------------------------- link release

// next Text Switch when a chain output is dropped on empty canvas
function patchLinkConnector(canvas) {
  const lc = canvas?.linkConnector;
  if (!lc || lc._g13patched) return;
  lc._g13patched = true;
  const orig = lc.dropOnNothing.bind(lc);
  lc.dropOnNothing = function (event) {
    try {
      boostSearch();
      const links = this.renderLinks ?? [];
      const first = links[0];
      if (
        !event?.shiftKey &&
        links.length === 1 &&
        this.state?.connectingTo === "input" &&
        String(first?.fromSlot?.type) === "G13_SWITCH" &&
        first?.node?.type === "TextSwitchGeN13"
      ) {
        const graph = first.node.graph ?? app.graph;
        const nn = LG().createNode("TextSwitchGeN13");
        if (nn) {
          nn.pos = [event.canvasX, event.canvasY - 20];
          graph.add(nn);
          first.node.connectSlots(first.fromSlot, nn, nn.inputs.find((s) => s.name === "chain"));
          graph.setDirtyCanvas?.(true, true);
          return;
        }
      }
    } catch (e) {
      console.warn("[GeN13] link release", e);
    }
    return orig(event);
  };
}

// GeN13 nodes first in the search box opened by a released link (empty query + one type filter)
const PREFER = {
  input: {
    IMAGE: ["SaveImagePrivateGeN13", "PreviewImagePrivateGeN13", "DegreaseGeN13", "ColorMatchTemporalGeN13"],
    STRING: ["ShowAnyGeN13", "ShowAnyLiteGeN13", "TextSwitchGeN13", "GenPromptCacheGeN13"],
  },
  output: {
    INT: ["RemoteIntGeN13", "CounterGeN13", "NumberGeN13"],
    FLOAT: ["RemoteFloatGeN13", "NumberGeN13", "CounterGeN13"],
    STRING: ["RemoteStringGeN13", "TextSwitchGeN13", "ShowAnyGeN13"],
    BOOLEAN: ["RemoteBooleanGeN13"],
  },
};
function boostSearch() {
  let store;
  try {
    const pinia = document.querySelector("#vue-app")?.__vue_app__?.config?.globalProperties?.$pinia;
    store = pinia?._s?.get?.("nodeDef");
  } catch {}
  const svc = store?.nodeSearchService;
  if (!svc || svc._g13boost) return;
  svc._g13boost = true;
  const orig = svc.searchNode.bind(svc);
  svc.searchNode = function (query, filters, ...rest) {
    const res = orig(query, filters, ...rest);
    try {
      if (query || !filters || filters.length !== 1) return res;
      const f = filters[0];
      const pref = PREFER[f?.filterDef?.id]?.[String(f?.value)];
      if (!pref) return res;
      const rank = (n) => {
        const i = pref.indexOf(n.name);
        return i < 0 ? pref.length : i;
      };
      // the result list is capped (64), so the preferred nodes may not be in it yet: add the ones that match
      const byName = store.nodeDefsByName ?? {};
      const have = new Set(res.map((n) => n.name));
      const extra = pref
        .filter((name) => !have.has(name) && byName[name])
        .map((name) => byName[name])
        .filter((def) => {
          try {
            return f.filterDef.matches(def, f.value);
          } catch {
            return false;
          }
        });
      const head = [...res.filter((n) => pref.includes(n.name)), ...extra].sort((a, b) => rank(a) - rank(b));
      return [...head, ...res.filter((n) => !pref.includes(n.name))];
    } catch {
      return res;
    }
  };
}

// ---------------------------------------------------------------- register

app.registerExtension({
  name: "gen13.convert",
  setup() {
    const tryPatch = () => {
      patchLinkConnector(app.canvas);
      boostSearch();
    };
    tryPatch();
    // the legacy widget Primitive is a front-end-only node: no beforeRegisterNodeDef for it
    addMenu(LG()?.registered_node_types?.PrimitiveNode);
    setTimeout(tryPatch, 1000);
    setTimeout(tryPatch, 4000);
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (MENU_TYPES.has(nodeData.name)) addMenu(nodeType);
    if (Object.values(REMOTE_FOR).includes(nodeData.name)) autoChannel(nodeType, nodeData.name);
  },
});

// a new Remote still on the default channel takes the name of the first input it is wired to (steps,
// seed ...), so two new remotes never share "remote" and sync by accident; saved nodes are left alone
function autoChannel(nodeType, type) {
  const onCreated = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    const r = onCreated?.apply(this, arguments);
    this._g13fresh = true;
    return r;
  };
  const onConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    this._g13fresh = false;
    return onConfigure?.apply(this, arguments);
  };
  const onConn = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function (side, slot, connected) {
    const r = onConn?.apply(this, arguments);
    if (this._g13fresh && connected && side === LG()?.OUTPUT) {
      this._g13fresh = false;
      const cw = wv(this, "channel");
      if (cw && String(cw.value).trim() === "remote") {
        const node = this;
        setTimeout(() => setW(node, "channel", channelFor(node, type)), 0);
      }
    }
    return r;
  };
}

function addMenu(nodeType) {
  if (!nodeType?.prototype || nodeType.prototype._g13convert) return;
  nodeType.prototype._g13convert = true;
  const onMenu = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
    const r = onMenu?.apply(this, arguments);
    const items = conversionsFor(this);
    if (items.length) options.unshift(...items.map(([content, callback]) => ({ content, callback })), null);
    return r;
  };
}
