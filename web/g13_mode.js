// ComfyUI-GeN13 - is a node really switched off?
//   A node counts as off when it is muted (2) or bypassed (4) itself, or when it sits inside a
//   subgraph whose every instance is muted / bypassed (directly or further up). Used by the nodes
//   that step on queue (Counter, Remote Int, Text Switch auto next) so a bypassed subgraph freezes
//   them the same way bypassing the node itself does. Older frontends without subgraphs: only the
//   node's own mode is checked.

const OFF = (m) => m === 2 || m === 4;

function holdersOf(graph) {
  const root = graph?.rootGraph;
  if (!root) return [];
  const graphs = [root, ...(root._subgraphs?.values?.() ?? [])];
  const out = [];
  for (const g of graphs) {
    for (const n of g?._nodes ?? g?.nodes ?? []) if (n?.subgraph === graph) out.push(n);
  }
  return out;
}

function graphOff(graph, seen) {
  if (!graph || graph.isRootGraph !== false || seen.has(graph)) return false;
  seen.add(graph);
  const holders = holdersOf(graph);
  if (!holders.length) return false;
  return holders.every((h) => OFF(h.mode) || graphOff(h.graph, new Set(seen)));
}

export function isOff(node) {
  if (!node) return true;
  if (OFF(node.mode)) return true;
  try {
    return graphOff(node.graph, new Set());
  } catch {
    return false;
  }
}

// Mode changes raise no event on the node, and on Nodes 2.0 (Vue nodes) onDrawForeground is never
// called, so hooks that compare the mode on draw would never fire there. watchMode wraps the `mode`
// setter once on LGraphNode.prototype and calls every listener with (node, oldMode) after a change.
const modeListeners = new Set();
let modePatched = false;
function patchModeSetter() {
  if (modePatched) return;
  const LGN = globalThis.LGraphNode ?? globalThis.LiteGraph?.LGraphNode;
  const d = LGN && Object.getOwnPropertyDescriptor(LGN.prototype, "mode");
  if (!d?.set || !d?.get) return;
  modePatched = true;
  Object.defineProperty(LGN.prototype, "mode", {
    configurable: true,
    enumerable: d.enumerable,
    get: d.get,
    set(v) {
      const old = d.get.call(this);
      d.set.call(this, v);
      if (old === v) return;
      for (const f of modeListeners) {
        try {
          f(this, old);
        } catch (e) {
          console.warn("[GeN13] mode listener", e);
        }
      }
    },
  });
}
export function onModeChange(fn) {
  patchModeSetter();
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

// every node of the workflow, subgraphs included (root: app.rootGraph ?? app.graph)
export function allNodes(root) {
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
  walk(root);
  return out;
}

// light color palette in use (the frontend puts .dark-theme on <html> only for dark palettes)
export function isLight() {
  return !document.documentElement.classList.contains("dark-theme");
}

// ---- links without the deprecated slot getters --------------------------------------------------
// Frontend 1.55 warns on input.link / output.links and may drop them; these read the same facts
// through node.getInputLink / isInputConnected and the graph's link map, and fall back to the old
// fields on frontends that predate the new methods.
const slotIndex = (list, s) => (typeof s === "number" ? s : list?.indexOf(s) ?? -1);

// the link object feeding input `s` (index or slot), or null
export function inLink(node, s) {
  const i = slotIndex(node?.inputs, s);
  if (i < 0 || !node.graph) return null; // not in a graph yet (onNodeCreated): no links, and the new getters throw
  if (typeof node.getInputLink === "function") return node.getInputLink(i) ?? null;
  const id = node.inputs[i]?.link;
  if (id == null) return null;
  const g = node.graph;
  return g?.links?.get?.(id) ?? g?.links?.[id] ?? null;
}

// is input `s` (index or slot) connected
export function inLinked(node, s) {
  const i = slotIndex(node?.inputs, s);
  if (i < 0 || !node.graph) return false;
  if (typeof node.isInputConnected === "function") return !!node.isInputConnected(i);
  return node.inputs[i]?.link != null;
}

// the link objects leaving output `s` (index or slot)
export function outLinks(node, s) {
  const i = slotIndex(node?.outputs, s);
  const g = node?.graph;
  if (i < 0 || !g) return [];
  if (typeof node.isOutputConnected !== "function") {
    const ids = node.outputs[i]?.links ?? [];
    return ids.map((id) => g?.links?.get?.(id) ?? g?.links?.[id]).filter(Boolean);
  }
  if (!node.isOutputConnected(i) || !g?.links) return [];
  const all = typeof g.links.values === "function" ? g.links.values() : Object.values(g.links);
  const out = [];
  for (const l of all) {
    if (l && String(l.origin_id) === String(node.id) && l.origin_slot === i) out.push(l);
  }
  return out;
}

// is output `s` (index or slot) connected
export function outLinked(node, s) {
  const i = slotIndex(node?.outputs, s);
  if (i < 0 || !node.graph) return false;
  if (typeof node.isOutputConnected === "function") return !!node.isOutputConnected(i);
  return (node.outputs[i]?.links?.length ?? 0) > 0;
}
