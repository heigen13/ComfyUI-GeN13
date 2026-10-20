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
//   - the search box and the context menu opened by a released link list the matching GeN13 nodes
//     first (by type; by slot for Trigger / Counter and for common inputs such as seed, steps, cfg)
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
      if (!outLinked(node, 0) || outLinked(nn, 0)) return;
      for (const l of outLinks(node, 0)) {
        const dst = graph.getNodeById(l.target_id);
        if (dst) nn.connectSlots(nn.outputs[0], dst, dst.inputs[l.target_slot]);
      }
    },
  });
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
  const orig = lc.dropOnNothing;
  lc.dropOnNothing = function (event) {
    try {
      boostSearch();
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
      if (released && links.length === 1) menuFirst(this.state?.connectingTo === "input" ? "input" : "output", released.type);
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

// GeN13 nodes first in the search box opened by a released link (empty query + one type filter)
// input.X  = chip "Input: X",  dragged from an output: nodes taking X (widget inputs count too)
// output.X = chip "Output: X", dragged from an input: nodes giving X; "*" is an ANY slot
const PREFER = {
  input: {
    IMAGE: ["SaveImagePrivateGeN13", "PreviewImagePrivateGeN13", "ResizeGeN13", "DegreaseGeN13", "ColorMatchTemporalGeN13", "RemoteVideoGeN13"],
    MASK: ["ResizeGeN13"],
    LATENT: ["ResizeGeN13"],
    STRING: ["ShowAnyGeN13", "ShowAnyLiteGeN13", "TextSwitchGeN13", "TextConcatenateGeN13", "GenPromptCacheGeN13", "RemoteStringGeN13", "NumberGeN13"],
    INT: ["NumberGeN13", "ShowAnyGeN13", "ShowAnyLiteGeN13", "TextSwitchGeN13", "TriggerGeN13"],
    FLOAT: ["NumberGeN13", "ShowAnyGeN13", "ShowAnyLiteGeN13"],
    BOOLEAN: ["TriggerGeN13", "ShowAnyGeN13", "ShowAnyLiteGeN13"],
    "*": ["ShowAnyGeN13", "ShowAnyLiteGeN13", "TriggerGeN13", "CounterGeN13"],
  },
  output: {
    IMAGE: ["LoadImagePrivateGeN13", "LoadLatestImagePrivateGeN13", "LoadImageOrientGeN13", "LoadImageSDGeN13", "ResizeGeN13", "RemoteVideoGeN13"],
    MASK: ["LoadImagePrivateGeN13", "LoadLatestImagePrivateGeN13", "LoadImageOrientGeN13", "LoadImageSDGeN13", "ResizeGeN13"],
    LATENT: ["ResizeGeN13"],
    INT: ["RemoteIntGeN13", "CounterGeN13", "NumberGeN13", "RemoteTextSwitchGeN13", "TriggerGeN13"],
    FLOAT: ["RemoteFloatGeN13", "NumberGeN13", "CounterGeN13"],
    STRING: ["RemoteStringGeN13", "TextSwitchGeN13", "TextConcatenateGeN13", "GenPromptCacheGeN13", "ShowAnyGeN13"],
    BOOLEAN: ["RemoteBooleanGeN13"],
    "INT,FLOAT,STRING": ["CounterGeN13", "NumberGeN13", "RemoteIntGeN13", "RemoteFloatGeN13", "RemoteStringGeN13"],
    "*": ["RemoteBooleanGeN13", "RemoteIntGeN13", "RemoteStringGeN13", "CounterGeN13", "NumberGeN13"],
  },
};
// one slot's own list, ahead of the type lists: Trigger -> Counter.reset and Remote Text Switch ->
// Text Switch.select_num are the pairs they are made for
const PREFER_SLOT = {
  input: {
    "TriggerGeN13.INT": ["CounterGeN13", "ShowAnyGeN13", "ShowAnyLiteGeN13"],
    "RemoteTextSwitchGeN13.INT": ["TextSwitchGeN13", "ShowAnyGeN13", "ShowAnyLiteGeN13"],
  },
  output: {
    "TextSwitchGeN13.select_num": ["RemoteTextSwitchGeN13", "CounterGeN13", "TriggerGeN13", "RemoteIntGeN13", "NumberGeN13"],
    "CounterGeN13.reset": ["TriggerGeN13", "RemoteBooleanGeN13", "RemoteIntGeN13", "RemoteStringGeN13", "NumberGeN13"],
    // "*.name": an input of that name on any node (built-in KSampler, EmptyLatentImage, CLIPTextEncode ...)
    "*.seed": ["RemoteIntGeN13", "CounterGeN13", "NumberGeN13", "LoadImageSDGeN13"],
    "*.noise_seed": ["RemoteIntGeN13", "CounterGeN13", "NumberGeN13", "LoadImageSDGeN13"],
    "*.steps": ["RemoteIntGeN13", "LoadImageSDGeN13", "RemoteVideoGeN13", "CounterGeN13"],
    "*.cfg": ["RemoteFloatGeN13", "LoadImageSDGeN13", "NumberGeN13", "CounterGeN13"],
    "*.denoise": ["RemoteFloatGeN13", "NumberGeN13", "CounterGeN13"],
    "*.sampler_name": ["LoadImageSDGeN13"],
    "*.scheduler": ["LoadImageSDGeN13"],
    "*.width": ["RemoteIntGeN13", "ResizeGeN13", "RemoteVideoGeN13", "LoadImagePrivateGeN13", "LoadLatestImagePrivateGeN13", "LoadImageSDGeN13"],
    "*.height": ["RemoteIntGeN13", "ResizeGeN13", "RemoteVideoGeN13", "LoadImagePrivateGeN13", "LoadLatestImagePrivateGeN13", "LoadImageSDGeN13"],
    "*.length": ["RemoteVideoGeN13", "RemoteIntGeN13", "CounterGeN13"],
    "*.batch_size": ["RemoteIntGeN13", "CounterGeN13"],
    "*.fps": ["RemoteVideoGeN13", "RemoteFloatGeN13"],
    "*.frame_rate": ["RemoteVideoGeN13", "RemoteFloatGeN13"],
    "*.text": ["RemoteStringGeN13", "TextSwitchGeN13", "TextConcatenateGeN13", "GenPromptCacheGeN13", "LoadImageSDGeN13"],
  },
};
let released = null; // the slot of the last link dropped on empty canvas
function slotPrefer(id, value) {
  const r = released;
  if (!r || Date.now() - r.at > 10000 || r.type !== String(value ?? "")) return null;
  return PREFER_SLOT[id]?.[r.key] ?? PREFER_SLOT[id]?.[`*.${r.name}`] ?? null;
}

// the link-release context menu lists LiteGraph.slot_types_default_out / _in[type]: put the same GeN13
// list in front for this release (the menu's own entries follow; rebuilt from its base every time)
const menuBase = { input: {}, output: {} };
const menuSet = { input: {}, output: {} };
function menuFirst(id, type) {
  try {
    const pref = slotPrefer(id, type) ?? preferFor(id, type);
    const table = LG()?.[id === "input" ? "slot_types_default_out" : "slot_types_default_in"];
    if (!table) return;
    const cur = table[type];
    if (cur !== menuSet[id][type]) menuBase[id][type] = cur; // first time, or rebuilt by ComfyUI since
    const base = menuBase[id][type] == null ? [] : [].concat(menuBase[id][type]);
    const names = (pref ?? []).filter((n) => LG()?.registered_node_types?.[n]);
    const next = [...names, ...base.filter((e) => !names.includes(typeof e === "string" ? e : e?.node))];
    if (!next.length) return;
    table[type] = next;
    menuSet[id][type] = next;
  } catch (e) {
    console.warn("[GeN13] link menu", e);
  }
}
// a multi-type slot ("INT,FLOAT,STRING") uses its own list if there is one, else the lists of its types merged
function preferFor(id, value) {
  const table = PREFER[id];
  if (!table) return null;
  const key = String(value ?? "").replace(/\s+/g, "");
  if (table[key]) return table[key];
  const merged = [];
  for (const t of key.split(",")) for (const name of table[t] ?? []) if (!merged.includes(name)) merged.push(name);
  return merged.length ? merged : null;
}
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

function boostSearch() {
  let store;
  try {
    const pinia = document.querySelector("#vue-app")?.__vue_app__?.config?.globalProperties?.$pinia;
    store = pinia?._s?.get?.("nodeDef");
  } catch {}
  const svc = store?.nodeSearchService;
  if (!svc || svc._g13boost) return;
  svc._g13boost = true;
  const orig = svc.searchNode;
  svc.searchNode = function (query, filters, ...rest) {
    const res = orig.apply(svc, [query, filters, ...rest]);
    try {
      if (query || !filters || filters.length !== 1) return res;
      const f = filters[0];
      const pref = slotPrefer(f?.filterDef?.id, f?.value) ?? preferFor(f?.filterDef?.id, f?.value);
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
            // same two passes as the search itself: the type, then the ANY ("*") wildcard
            return f.filterDef.matches(def, f.value) || f.filterDef.matches(def, f.value, { wildcard: "*" });
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
