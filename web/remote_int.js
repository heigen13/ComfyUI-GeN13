// Remote Int (GeN13)
//   - every Remote Int whose channel text matches (trimmed) is one group of mirrors, across the
//     whole workflow including subgraphs
//   - value / control_after_generate: changing either on any mirror sets every other mirror at once
//   - bypass / mute: switching one mirror switches the whole group (noticed on redraw of the node
//     that was switched, so it also catches the bypass shortcut and the context menu; a mirror
//     switched while off screen, e.g. by a group bypasser, passes it on once it is drawn)
//   - control_after_generate steps once per queue for the whole group: the first mirror reached
//     in the synchronous afterQueued (or beforeQueued) pass steps and broadcasts, the rest of that
//     pass is skipped; follows Comfy.WidgetControlMode like the core control. Bypassed / muted: stays.
//   - a mirror that joins a channel (channel edited, pasted, added) takes the group's value and
//     setting; loading a workflow never rewrites values
//   - grey line at the bottom: channel · N mirrors

import { app } from "../../scripts/app.js";
import { applyWireLock, wireSuffix, wiredMirrors } from "./remote_link.js";

const NODE_ID = "RemoteIntGeN13";
const LIMIT = 1_000_000_000;
const RANDOM_MAX = 1_000_000_000;
const SYNCED = ["value", "control_after_generate"];

const stepped = new Set(); // channels already handled in the current queue pass
const firstSeen = new Set(); // "before" mode: channels that already skipped their first queue

function w(node, name) {
  return node.widgets?.find((x) => x.name === name);
}

function chan(node) {
  return String(w(node, "channel")?.value ?? "").trim();
}

function controlBefore() {
  try {
    return app.extensionManager?.setting?.get?.("Comfy.WidgetControlMode") === "before";
  } catch {
    return false;
  }
}

function rootGraph() {
  return app.rootGraph ?? app.graph;
}

// every Remote Int in the workflow, root first, then subgraphs (each subgraph definition once)
function allRemotes() {
  const out = [];
  const seenG = new Set();
  const walk = (g) => {
    if (!g || seenG.has(g)) return;
    seenG.add(g);
    for (const n of g._nodes ?? g.nodes ?? []) {
      if (n?.type === NODE_ID) out.push(n);
      if (n?.subgraph) walk(n.subgraph);
    }
  };
  walk(rootGraph());
  return out;
}

function group(node) {
  const c = chan(node);
  return allRemotes().filter((n) => chan(n) === c);
}

function setWidget(n, name, v) {
  const x = w(n, name);
  if (!x || x.value === v) return;
  x.value = v;
  n.setDirtyCanvas?.(true, true);
}

// copy one widget value from `src` to every other mirror
function broadcast(src, name) {
  if (src._g13sync) return;
  const v = w(src, name)?.value;
  for (const n of group(src)) {
    if (n === src) continue;
    n._g13sync = true;
    try {
      setWidget(n, name, v);
    } finally {
      n._g13sync = false;
    }
  }
  refreshAll(chan(src));
}

// assign the mode directly: LGraphNode.changeMode() only knows modes 0-3 and silently refuses
// bypass (4), which left a mirror un-bypassed and made it switch the whole group back on its next draw
function setModeOf(n, m) {
  if (n.mode !== m) {
    n.mode = m;
    n.setDirtyCanvas?.(true, true);
    n.graph?.setDirtyCanvas?.(true, true);
  }
  n._g13mode = n.mode; // whatever actually stuck, so a refused change never echoes back
}

function broadcastMode(src) {
  const m = src.mode;
  for (const n of group(src)) if (n !== src) setModeOf(n, m);
  src._g13mode = m;
}

// a mirror entering a channel adopts what the group already has
function adopt(node) {
  const other = group(node).find((n) => n !== node);
  if (!other) return;
  for (const name of SYNCED) setWidget(node, name, w(other, name)?.value);
  setModeOf(node, other.mode);
}

function label(node, state) {
  const c = chan(node) || "(no channel)";
  const k = group(node).length;
  return `${c}  ·  ${k} ${k === 1 ? "mirror" : "mirrors"}${wireSuffix(state)}`;
}

function refresh(node) {
  const b = node._g13info;
  if (!b) return;
  const t = label(node, applyWireLock(node, group(node)));
  if (b.label !== t) {
    b.label = t;
    b.name = t;
    node.setDirtyCanvas?.(true, true);
  }
}

function refreshAll(c) {
  for (const n of allRemotes()) if (c === undefined || chan(n) === c) refresh(n);
}

function markPass(c) {
  stepped.add(c);
  queueMicrotask(() => stepped.delete(c)); // the queue pass is synchronous; clear right after it
}

function step(node) {
  const c = chan(node);
  if (stepped.has(c)) return;
  markPass(c);
  if (node.mode === 2 || node.mode === 4) return; // muted / bypassed: the number stays
  if (wiredMirrors(group(node)).length) return; // group driven by a wire: the number is not ours to step
  const mode = w(node, "control_after_generate")?.value;
  const val = w(node, "value");
  if (!val || !mode || mode === "fixed") return;
  let v = Math.round(Number(val.value) || 0);
  if (mode === "increment") v += 1;
  else if (mode === "decrement") v -= 1;
  else if (mode === "randomize") v = Math.floor(Math.random() * (RANDOM_MAX + 1));
  v = Math.max(-LIMIT, Math.min(LIMIT, v));
  val.value = v;
  node.setDirtyCanvas?.(true, true);
  broadcast(node, "value");
}

app.registerExtension({
  name: "gen13.remote_int",

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
          if (SYNCED.includes(x.name)) broadcast(node, x.name);
          else if (x.name === "channel") {
            if (!app.configuringGraph) adopt(node);
            refreshAll();
          }
          return out;
        };
      }
      const ctl = w(node, "control_after_generate");
      if (ctl) {
        ctl.label = "control after generate";
        ctl.beforeQueued = () => {
          if (!controlBefore()) return;
          const c = chan(node);
          if (stepped.has(c)) return;
          if (!firstSeen.has(c)) {
            firstSeen.add(c); // "before" mode skips the very first queue, like the core control
            markPass(c);
            return;
          }
          step(node);
        };
        ctl.afterQueued = () => {
          if (!controlBefore()) step(node);
        };
      }
      const b = node.addWidget("button", "info", null, () => {}, { serialize: false });
      b.serialize = false;
      node._g13info = b;
      node._g13mode = node.mode;
      requestAnimationFrame(() => {
        // pasted / newly added mirror: match the group (a loaded workflow is already consistent)
        if (!app.configuringGraph && !node._g13loaded) adopt(node);
        refreshAll();
      });
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      this._g13loaded = true;
      this._g13mode = this.mode;
      const pasted = !app.configuringGraph; // configure outside a workflow load = paste / duplicate
      requestAnimationFrame(() => {
        if (pasted) adopt(this);
        refreshAll();
      });
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const r = onRemoved?.apply(this, arguments);
      const c = chan(this);
      requestAnimationFrame(() => refreshAll(c));
      return r;
    };

    // a wire into / out of the value input changes the whole group's lock state
    const onConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = onConn?.apply(this, arguments);
      if (this._g13info) requestAnimationFrame(() => refreshAll(chan(this)));
      return r;
    };

    // bypass / mute raise no event on the node: the switched node is on screen, so catch it on draw
    const onDrawFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = onDrawFg?.apply(this, arguments);
      if (this._g13mode !== undefined && this._g13mode !== this.mode) broadcastMode(this);
      return r;
    };
  },
});
