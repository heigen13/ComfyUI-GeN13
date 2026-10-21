// ComfyUI-GeN13 - right-click conversions and link-release shortcuts
//
// Conversions (node right-click menu, GeN13 nodes only): the new node takes the old node's place,
// settings and links.
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
//   - a link dropped on a GeN13 node body, or added through the search box / menu, goes to the slot it
//     is meant for (Trigger -> Counter.reset, STRING -> Remote String.value ...), and a GeN13 node
//     feeding an input of the same name uses that output (seed -> Load Image SD.seed)

import { app } from "../../scripts/app.js";
import { convertLabel } from "./g13_i18n.js";
import { inLink, inLinked, outLinks, outLinked } from "./g13_mode.js";

// menu label in the ComfyUI language (en / zh-TW / zh / ja)
const LG = () => globalThis.LiteGraph;

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
  (node.inputs ?? []).forEach((inp, ii) => {
    const l = inLink(node, ii);
    if (!l) return;
    const src = l ? graph.getNodeById(l.origin_id) : null;
    const k = pickSlot(nn.inputs ?? [], inp, usedIn, opts.inMap);
    if (!src || k < 0) return;
    usedIn.add(k);
    src.connectSlots(src.outputs[l.origin_slot], nn, nn.inputs[k]);
  });
  // outputs
  const outFor = new Map();
  (node.outputs ?? []).forEach((o, oi) => {
    const ls = outLinks(node, oi);
    if (!ls.length) return;
    const k = pickSlot(nn.outputs ?? [], o, new Set(outFor.values()), opts.outMap);
    if (k < 0) return;
    outFor.set(o, k);
    for (const l of ls) {
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

// channel named after the first input the primitive feeds, unique among remotes of that type
function channelFor(node, remoteType) {
  const graph = node.graph ?? app.graph;
  let base = "remote";
  for (const l of outLinks(node, 0)) {
    const dst = graph.getNodeById(l.target_id);
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

function boxCount(node) {
  return Math.max(1, Number(wv(node, "count")?.value) || 1);
}
function textSwitchChained(node) {
  const up = inLinked(node, node.inputs?.findIndex((s) => s.name === "chain") ?? -1);
  const down = outLinked(node, node.outputs?.findIndex((s) => s.name === "chain") ?? -1);
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

// GeN13 nodes only: the public pack adds nothing to other packs' or built-in nodes' menus
const MENU_TYPES = new Set([
  "SaveImagePrivateGeN13", "PreviewImagePrivateGeN13", "LoadImagePrivateGeN13", "LoadImageOrientGeN13",
  "LoadImageSDGeN13", "TextConcatenateGeN13", "TextSwitchGeN13",
]);

// ---------------------------------------------------------------- link release

// next Text Switch when a chain output is dropped on empty canvas
function patchLinkConnector(canvas) {
  const lc = canvas?.linkConnector;
  if (!lc || lc._g13patched) return;
  lc._g13patched = true;
  const orig = lc.dropOnNothing;
  lc.dropOnNothing = function (event) {
    try {
      const links = this.renderLinks ?? [];
      const first = links[0];
      released = first
        ? {
            key: `${first.node?.type}.${first.fromSlot?.name}`,
            name: String(first.fromSlot?.name ?? ""),
            type: String(first.fromSlot?.type ?? ""),
            at: Date.now(),
          }
        : null;
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
    return orig.apply(lc, [event]);
  };
}

// the slot of the last link dropped on empty canvas: the context menu opens after the link is gone,
// so the slot name is kept here for targetOutput
let released = null;

// which slot a link takes on a GeN13 node: the frontend picks the first free slot of the type, widgets
// included, so INT into Counter landed on run, STRING into Remote String on channel ...
const TYPES = (t) => String(t ?? "").toLowerCase().split(",").map((x) => x.trim());
const fits = (a, b) => {
  const x = TYPES(a);
  const y = TYPES(b);
  return x.includes("*") || y.includes("*") || x.some((t) => y.includes(t));
};
const TARGET_IN = {
  CounterGeN13: () => "reset",
  TriggerGeN13: () => "input",
  ShowAnyGeN13: () => "any",
  ShowAnyLiteGeN13: () => "any",
  NumberGeN13: (t) => (["INT", "FLOAT", "STRING"].includes(t) ? "number" : null),
  TextSwitchGeN13: (t) => (t === "INT" ? "select_num" : null),
  RemoteStringGeN13: (t) => (t === "STRING" ? "value" : null),
  GenPromptCacheGeN13: (t) => (t === "STRING" ? "text" : null),
  TextConcatenateGeN13: (t) => (t === "STRING" ? /^text_\d+$/ : null),
};
function targetInput(node, type) {
  const rule = TARGET_IN[node?.comfyClass ?? node?.type];
  const want = rule?.(String(type ?? ""));
  if (!want) return -1;
  const ins = node.inputs ?? [];
  for (let i = 0; i < ins.length; i++) {
    const s = ins[i];
    const hit = typeof want === "string" ? s.name === want : want.test(s.name);
    if (hit && !s.hidden && fits(type, s.type) && !inLinked(node, i)) return i;
  }
  return -1;
}
// a GeN13 node feeding an input uses the output of the same name (seed, steps, width ...)
const OUT_ALIAS = { noise_seed: "seed", text: "positive", frame_rate: "fps" };
function draggedName() {
  const first = app.canvas?.linkConnector?.renderLinks?.[0];
  if (first) return String(first.fromSlot?.name ?? "");
  const r = released; // context menu: the link is gone by now
  return r && Date.now() - r.at < 10000 ? r.name : "";
}
function targetOutput(node, type) {
  const name = draggedName().toLowerCase();
  if (!name) return -1;
  const want = [name, OUT_ALIAS[name]].filter(Boolean);
  const outs = node.outputs ?? [];
  for (const w of want) {
    const i = outs.findIndex((s) => String(s.name).toLowerCase() === w && fits(type, s.type));
    if (i >= 0) return i;
  }
  return -1;
}
function targetSlots(nodeType) {
  const P = nodeType.prototype;
  const byType = P.findInputByType;
  if (typeof byType === "function") {
    P.findInputByType = function (type) {
      const i = targetInput(this, type);
      return i >= 0 ? { index: i, slot: this.inputs[i] } : byType.apply(this, arguments);
    };
  }
  const outByType = P.findOutputByType;
  if (typeof outByType === "function") {
    P.findOutputByType = function (type) {
      const i = targetOutput(this, type);
      return i >= 0 ? { index: i, slot: this.outputs[i] } : outByType.apply(this, arguments);
    };
  }
  const bySlot = P.findSlotByType;
  if (typeof bySlot === "function") {
    P.findSlotByType = function (input, type, returnObj) {
      const i = input ? targetInput(this, type) : targetOutput(this, type);
      if (i >= 0) return returnObj ? (input ? this.inputs : this.outputs)[i] : i;
      return bySlot.apply(this, arguments);
    };
  }
}

// ---------------------------------------------------------------- register

app.registerExtension({
  name: "gen13.convert",
  setup() {
    const tryPatch = () => patchLinkConnector(app.canvas);
    tryPatch();
    setTimeout(tryPatch, 1000);
    setTimeout(tryPatch, 4000);
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (MENU_TYPES.has(nodeData.name)) addMenu(nodeType);
    if (Object.values(REMOTE_FOR).includes(nodeData.name)) autoChannel(nodeType, nodeData.name);
    if (nodeData.name?.endsWith("GeN13")) targetSlots(nodeType);
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
    this._g13loadedOnce = true;
    return onConfigure?.apply(this, arguments);
  };
  const onConn = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function (side, slot, connected) {
    const r = onConn?.apply(this, arguments);
    // a workflow load replays links (inside a subgraph even before onConfigure): never rename then
    if (app.configuringGraph) return r;
    if (this._g13fresh && connected && side === LG()?.OUTPUT) {
      this._g13fresh = false;
      const node = this;
      setTimeout(() => {
        if (app.configuringGraph || node._g13loadedOnce) return;
        const cw = wv(node, "channel");
        if (cw && String(cw.value).trim() === "remote") setW(node, "channel", channelFor(node, type));
      }, 0);
    }
    return r;
  };
}

export { swapNode, setW, wv, channelFor, NAMES, REMOTE_FOR, addMenu };

function addMenu(nodeType, extra) {
  if (!nodeType?.prototype || nodeType.prototype._g13convert) return;
  nodeType.prototype._g13convert = true;
  const onMenu = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
    const r = onMenu?.apply(this, arguments);
    const items = extra ? extra(this) : conversionsFor(this);
    // no null separator: other packs scan options[i].content and break on null (comfyui-wd14-tagger)
    if (items.length) options.unshift(...items.map(([content, callback]) => ({ content, callback })));
    return r;
  };
}
