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
