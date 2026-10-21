// Switch Any (GeN13)
//   - inputs input_1, input_2 ...: no empty slot at the end; while a link is dragged over the node a
//     spare one grows below the last, and leaving without dropping takes it away again. Unlinking one
//     in the middle leaves its slot, so the other numbers never move. Nothing linked: input_1 stays.
//   - type lock: the first link (an input, or the output when no input is linked) sets the type of
//     every input and the output, so a different type cannot be linked; unlinking everything frees it
//   - the selected input is marked with a cyan bar (canvas, Nodes 1.0) and the output label reads
//     "<TYPE> #n" (both renderers); above the last linked input the last one is used, as in Python.
//     A pick on an empty slot in the middle reads "#n EMPTY" (the run would stop there).
//   - select fed by a link: the number comes from the source widget "value" (Remote Int, core Int)
//     or from the pick of an upstream Switch Any (its index output); anything else shows "#?"
//   - outputs: output (the pick) and index (INT, the number used), so two Switch Any switch together
//   - names: double-click an input (or right-click > Name input) to give it a name; the slot then
//     reads "#n name" and the output "<TYPE> #n name". Kept in node.properties.g13_names, never in
//     the prompt; a name stays with its number, so unlinking the last input and linking it again
//     (or undo) brings the name back.
import { app } from "../../scripts/app.js";
import { inLink, inLinked, outLinks, isLight, allNodes, liveValue } from "./g13_mode.js";
import { pick } from "./g13_i18n.js";

const NODE_ID = "SwitchAnyGeN13";
const RX = /^input_(\d+)$/;
const ACCENT = "#35d0ff";

// [{ i: slot index, n: number, s: slot }] of the input_N slots
function slotsOf(node) {
  const out = [];
  (node.inputs ?? []).forEach((s, i) => {
    const m = String(s?.name ?? "").match(RX);
    if (m) out.push({ i, n: +m[1], s });
  });
  return out.sort((a, b) => a.n - b.n);
}

const namesOf = (node) => {
  const p = node.properties || (node.properties = {});
  if (!p.g13_names || typeof p.g13_names !== "object") p.g13_names = {};
  return p.g13_names;
};
const nameOf = (node, n) => String(namesOf(node)[n] ?? "").trim();

const linkedNums = (node) => slotsOf(node).filter((x) => inLinked(node, x.i)).map((x) => x.n);

// the type set by the links, or "*" when free
function lockedType(node) {
  for (const x of slotsOf(node)) {
    const l = inLink(node, x.i);
    if (!l) continue;
    const src = node.graph?.getNodeById?.(l.origin_id);
    const t = src?.outputs?.[l.origin_slot]?.type ?? l.type;
    if (t && t !== "*" && t !== 0) return t;
  }
  for (const l of outLinks(node, 0)) {
    const dst = node.graph?.getNodeById?.(l.target_id);
    const t = dst?.inputs?.[l.target_slot]?.type ?? l.type;
    if (t && t !== "*" && t !== 0) return t;
  }
  return "*";
}

// keep input_1 .. input_(last linked + 1): add what is missing, drop unlinked extras at the end
// the select widget only offers 1 .. last linked input, and a higher value is pulled down at once.
// Not while a workflow is still being configured (the links come back after the widget values);
// the normalize() queued from onConfigure runs after that and clamps with every link in place.
function limitSelect(node) {
  const w = node.widgets?.find((x) => x.name === "select");
  if (!w) return;
  const nums = linkedNums(node);
  const max = Math.max(1, nums.length ? nums[nums.length - 1] : 1);
  w.options = w.options || {};
  w.options.max = max;
  if (!app.configuringGraph && +w.value > max) {
    w.value = max;
    w.callback?.(max);
  }
}

// the spare input after the last linked one exists only while a link is dragged over this node
// (node._g13hover, set by the tick in setup); with nothing linked, input_1 always stays

function normalize(node) {
  if (!node.graph) return;
  const nums = linkedNums(node);
  const last = nums.length ? nums[nums.length - 1] : 0;
  const want = last > 0 && !node._g13hover ? last : last + 1;
  const type = lockedType(node);
  const have = new Set(slotsOf(node).map((x) => x.n));
  for (let n = 1; n <= want; n++) if (!have.has(n)) node.addInput(`input_${n}`, type);
  for (const x of slotsOf(node).reverse()) {
    if (x.n > want && !inLinked(node, x.i)) node.removeInput(x.i);
  }
  for (const x of slotsOf(node)) {
    x.s.type = type;
    const nm = nameOf(node, x.n);
    x.s.label = nm ? `#${x.n} ${nm}` : `#${x.n}`;
    x.s.localized_name = x.s.label;
  }
  // removing slots does not shrink the node: give back the freed rows
  const h = node.computeSize?.()[1];
  if (h && node.size[1] > h + 1 && node._g13fit !== false) node.setSize([node.size[0], h]);
  if (node.outputs?.[0]) node.outputs[0].type = type;
  limitSelect(node);
  refresh(node);
}

function selectSlot(node) {
  return (node.inputs ?? []).findIndex((s) => s?.name === "select");
}

// the number the run will use, or null when it is only known at run time
function selectValue(node) {
  const w = node.widgets?.find((x) => x.name === "select");
  const si = selectSlot(node);
  if (si >= 0 && inLinked(node, si)) {
    const l = inLink(node, si);
    const src = node.graph?.getNodeById?.(l?.origin_id);
    // another Switch Any's index output: its pick, worked out the same way
    if (src?.type === NODE_ID && src.mode !== 2 && src.mode !== 4) return l.origin_slot === 1 ? current(src)?.n ?? null : null;
    const lv = liveValue(node, "select");
    if (!lv.known) return null;
    const v = Number(lv.value);
    return Number.isFinite(v) ? Math.round(v) || 1 : null;
  }
  return Math.round(+(w?.value ?? 1)) || 1;
}

// { n, empty } of the input the run will use, or null when unknown / nothing linked
function current(node) {
  const nums = linkedNums(node);
  if (!nums.length) return null;
  const v = selectValue(node);
  if (v == null) return { n: null, empty: false };
  let n = Math.max(1, v);
  if (n > nums[nums.length - 1]) n = nums[nums.length - 1];
  return { n, empty: !nums.includes(n) };
}

function refresh(node) {
  const out = node.outputs?.[0];
  if (out) {
    const t = out.type && out.type !== "*" ? String(out.type) : "output";
    const c = current(node);
    let tag = "";
    if (c && c.n == null) tag = " #?";
    else if (c) {
      const nm = c.empty ? "" : nameOf(node, c.n);
      tag = ` #${c.n}${c.empty ? " EMPTY" : ""}${nm ? " " + nm : ""}`;
    }
    out.label = t + tag;
    out.localized_name = t + tag;
  }
  node.setDirtyCanvas?.(true, true);
}

function drawMark(node, ctx) {
  if (node.flags?.collapsed) return;
  const c = current(node);
  if (!c || c.n == null) return;
  const x = slotsOf(node).find((s) => s.n === c.n);
  if (!x || typeof node.getInputPos !== "function") return;
  const p = node.getInputPos(x.i);
  const y = p[1] - node.pos[1];
  const h = (globalThis.LiteGraph?.NODE_SLOT_HEIGHT ?? 20) - 4;
  ctx.save();
  ctx.fillStyle = c.empty ? (isLight() ? "#c0392b" : "#ff5a5a") : ACCENT;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  const w = Math.max(40, node.size[0] * 0.5 - 6);
  if (ctx.roundRect) ctx.roundRect(3, y - h / 2, w, h, 4);
  else ctx.rect(3, y - h / 2, w, h);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillRect(3, y - h / 2, 3, h);
  ctx.restore();
}

function rename(node, n, e) {
  const title = pick(`Name of input #${n}`, `輸入 #${n} 名稱`, `输入 #${n} 名称`, `入力 #${n} の名前`);
  const done = (v) => {
    const t = String(v ?? "").trim();
    const names = namesOf(node);
    if (t) names[n] = t;
    else delete names[n];
    normalize(node);
  };
  const c = app.canvas;
  if (typeof c?.prompt === "function") c.prompt(title, nameOf(node, n), done, e);
}

// the input_N slot under a point in node space, or null
function slotAt(node, pos) {
  if (typeof node.getInputPos !== "function") return null;
  const h = (globalThis.LiteGraph?.NODE_SLOT_HEIGHT ?? 20) / 2;
  if (pos[0] > node.size[0] * 0.6) return null;
  for (const x of slotsOf(node)) {
    const y = node.getInputPos(x.i)[1] - node.pos[1];
    if (Math.abs(pos[1] - y) <= h) return x;
  }
  return null;
}

app.registerExtension({
  name: "gen13.switch_any",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    const proto = nodeType.prototype;

    const onCreated = proto.onNodeCreated;
    proto.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      const w = node.widgets?.find((x) => x.name === "select");
      if (w) {
        const cb = w.callback;
        w.callback = function () {
          const o = cb?.apply(this, arguments);
          refresh(node);
          return o;
        };
      }
      requestAnimationFrame(() => normalize(node));
      return r;
    };

    const onConfigure = proto.onConfigure;
    proto.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      setTimeout(() => normalize(this), 0); // links are in place once the whole graph is loaded
      return r;
    };

    const onConn = proto.onConnectionsChange;
    proto.onConnectionsChange = function () {
      const r = onConn?.apply(this, arguments);
      setTimeout(() => normalize(this), 0);
      return r;
    };

    const onDbl = proto.onDblClick;
    proto.onDblClick = function (e, pos) {
      const x = pos && slotAt(this, pos);
      if (x) {
        rename(this, x.n, e);
        return true;
      }
      return onDbl?.apply(this, arguments);
    };

    const getMenu = proto.getExtraMenuOptions;
    proto.getExtraMenuOptions = function (canvas, options) {
      const r = getMenu?.apply(this, arguments);
      const items = slotsOf(this).map((x) => {
        const nm = nameOf(this, x.n);
        return { content: `#${x.n}${nm ? " " + nm : ""}`, callback: (v, o, ev) => rename(this, x.n, ev) };
      });
      options.unshift({
        content: pick("Name input", "命名輸入", "命名输入", "入力に名前を付ける"),
        has_submenu: true,
        submenu: { options: items },
      });
      return r;
    };

    const onDraw = proto.onDrawForeground;
    proto.onDrawForeground = function (ctx) {
      const r = onDraw?.apply(this, arguments);
      drawMark(this, ctx);
      return r;
    };
  },

  // a select fed by Remote Int / Int changes without touching this node, and undo / paste / deleting
  // an upstream node restore or drop links without a connection event: re-check every node regularly
  setup() {
    const tick = () => {
      let dragging = false;
      try {
        const lc = app.canvas?.linkConnector;
        dragging = !!(lc?.isConnecting && lc.state?.connectingTo === "input");
        const gm = app.canvas?.graph_mouse;
        for (const n of allNodes(app.rootGraph ?? app.graph)) {
          if (n?.type === NODE_ID) {
            const th = globalThis.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
            const over = dragging && n.graph === app.canvas?.graph && gm &&
              gm[0] >= n.pos[0] - 10 && gm[0] <= n.pos[0] + n.size[0] + 10 &&
              gm[1] >= n.pos[1] - th && gm[1] <= n.pos[1] + n.size[1] + 24;
            if (!!n._g13hover !== !!over) {
              n._g13hover = !!over;
              normalize(n);
            }
          }
          if (n?.type !== NODE_ID) continue;
          limitSelect(n);
          const key = JSON.stringify([current(n), linkedNums(n)]);
          if (n._g13swKey !== key) {
            n._g13swKey = key;
            refresh(n);
          }
        }
      } catch {}
      setTimeout(tick, dragging ? 40 : 300); // fast while a link is dragged (hover spare)
    };
    tick();
  },
});
