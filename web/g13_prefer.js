// ComfyUI-GeN13 - link search preferences and built-in node conversions
//   1. GeN13 nodes first when a link is released (search box and link-release menu)
//   2. right-click conversions on built-in nodes: Load Image -> Load Image Private, Save / Preview
//      Image -> Save / Preview Image Private, Primitive (Int / Float / String / Boolean, also the
//      legacy widget Primitive) -> matching Remote, its channel named after the input it feeds
//   Both can be switched off in Settings > GeN13 > Links; they are read on every use, so a change
//   takes effect at once. globalThis.G13_PREFER tells an older local copy (GeN13-LOCAL) to stand down.
import { app } from "../../scripts/app.js";
import { convertLabel } from "./g13_i18n.js";
import { outLinks, outLinked } from "./g13_mode.js";
import { swapNode, setW, wv, channelFor, NAMES, REMOTE_FOR, addMenu } from "./g13_convert.js";

globalThis.G13_PREFER = true;

const SID = "GeN13.Links";
function setting(k) {
  try {
    const v = app.extensionManager?.setting?.get?.(`${SID}.${k}`);
    return v === undefined || v === null ? true : !!v;
  } catch {
    return true;
  }
}

const LG = () => globalThis.LiteGraph;

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
    "RemoteTextSwitchGeN13.select_num": ["TextSwitchGeN13", "ShowAnyGeN13", "ShowAnyLiteGeN13"],
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
    const on = setting("PreferGeN13");
    const pref = on ? slotPrefer(id, type) ?? preferFor(id, type) : null;
    const table = LG()?.[id === "input" ? "slot_types_default_out" : "slot_types_default_in"];
    if (!table) return;
    const cur = table[type];
    if (cur !== menuSet[id][type]) menuBase[id][type] = cur; // first time, or rebuilt by ComfyUI since
    const base = menuBase[id][type] == null ? [] : [].concat(menuBase[id][type]);
    const names = (pref ?? []).filter((n) => LG()?.registered_node_types?.[n]);
    const next = [...names, ...base.filter((e) => !names.includes(typeof e === "string" ? e : e?.node))];
    if (!on && menuSet[id][type] !== undefined && table[type] === menuSet[id][type]) {
      table[type] = menuBase[id][type]; // switched off: give the menu its own list back
      menuSet[id][type] = undefined;
      return;
    }
    if (!on || !next.length) return;
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
      if (query || !filters || filters.length !== 1 || !setting("PreferGeN13")) return res;
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


// record the released slot (the search / menu open right after), then hand over
function watchRelease(canvas) {
  const lc = canvas?.linkConnector;
  if (!lc || lc._g13sort) return;
  lc._g13sort = true;
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
    } catch (e) {
      console.warn("[GeN13] link release", e);
    }
    return orig.apply(lc, arguments);
  };
}

// ---------------------------------------------------------------- built-in node conversions

const PRIMITIVES = {
  PrimitiveInt: "INT",
  PrimitiveFloat: "FLOAT",
  PrimitiveString: "STRING",
  PrimitiveStringMultiline: "STRING",
  PrimitiveBoolean: "BOOLEAN",
};
const BUILTIN = new Set(["LoadImage", "SaveImage", "PreviewImage", ...Object.keys(PRIMITIVES)]);

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

function builtinConversions(node) {
  if (!setting("BuiltinConvert")) return [];
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
  return list;
}

app.registerExtension({
  name: "gen13.prefer",
  settings: [
    { id: `${SID}.PreferGeN13`, category: ["GeN13", "Links", "PreferGeN13"], name: "List GeN13 nodes first in link search",
      tooltip: "Link search: when a link is dropped on empty canvas, GeN13 nodes that fit the slot head the search box and menu.",
      type: "boolean", defaultValue: true },
    { id: `${SID}.BuiltinConvert`, category: ["GeN13", "Links", "BuiltinConvert"], name: "Convert built-in nodes to GeN13 from the right-click menu",
      tooltip: "Right-click conversion: Load / Save / Preview Image to the Private versions, Primitive to the matching Remote.",
      type: "boolean", defaultValue: true },
  ],
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (BUILTIN.has(nodeData.name)) addMenu(nodeType, builtinConversions);
  },
  setup() {
    // the legacy widget Primitive is a front-end-only node: no beforeRegisterNodeDef for it
    addMenu(LG()?.registered_node_types?.PrimitiveNode, builtinConversions);
    const tryPatch = () => {
      watchRelease(app.canvas);
      boostSearch();
    };
    tryPatch();
    setTimeout(tryPatch, 1000);
    setTimeout(tryPatch, 4000);
  },
});
