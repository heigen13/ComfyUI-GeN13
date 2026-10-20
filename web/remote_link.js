// Remote link (GeN13): a wire into one mirror drives the whole mirror group
//   Remote Int / Float / String / Boolean, Remote Text Switch and Remote Video sync their widgets
//   across mirrors in the front end only, so a wire into one mirror's input used to reach that mirror
//   alone. Now, per input name:
//   - prompt: when any mirror of a group has an input wired, every mirror of that group is sent with
//     the same wire for that input (app.graphToPrompt output rewritten; ids are already flattened for
//     subgraphs), so the upstream value reaches all of them at run time
//   - canvas: on the other mirrors that widget is disabled while the group has it wired; a wired
//     `value` also locks control after generate and auto next. Grey line: "← wired" / "N wires".
//   - two mirrors wiring the same input from different places: the first one found wins
import { app } from "../../scripts/app.js";
import { pick } from "./g13_i18n.js";

export const REMOTE_TYPES = ["RemoteIntGeN13", "RemoteFloatGeN13", "RemoteStringGeN13", "RemoteBooleanGeN13",
  "RemoteTextSwitchGeN13", "RemoteVideoGeN13"];
const FOLLOW_VALUE = ["control_after_generate", "auto_next"]; // locked together with a wired `value`

function linkedNames(node) {
  const s = new Set();
  for (const i of node.inputs ?? []) if (i.link != null && i.name && i.name !== "channel") s.add(i.name);
  return s;
}

// mirrors of the group whose `value` input is wired (used to stop auto stepping)
export function wiredMirrors(groupNodes) {
  return groupNodes.filter((n) => linkedNames(n).has("value"));
}

// disable / enable the widgets of `node` that another mirror of the group has wired
export function applyWireLock(node, groupNodes) {
  const own = linkedNames(node);
  const groupWired = new Set();
  let wiredCount = 0;
  for (const n of groupNodes) {
    const s = linkedNames(n);
    if (s.size) wiredCount++;
    for (const x of s) groupWired.add(x);
  }
  for (const x of node.widgets ?? []) {
    if (!x.name || x.name === "channel") continue;
    const src = FOLLOW_VALUE.includes(x.name) ? "value" : x.name;
    if (!groupWired.has(src) && x.disabled === undefined) continue; // never touched: leave as is
    const lock = groupWired.has(src) && !own.has(src);
    if ((x.g13lock ?? x.disabled) !== lock) x.disabled = lock; // g13lock: Remote String box
    const e = x.element ?? x.inputEl;
    if (e && "disabled" in e && e.disabled !== lock) e.disabled = lock;
  }
  return { wired: wiredCount, lock: false };
}

export function wireSuffix(state) {
  if (!state.wired) return "";
  const n = state.wired;
  return n > 1
    ? `  ·  ${pick(`${n} wires`, `${n} 條接線`, `${n} 条接线`, `接続 ${n} 本`)}`
    : `  ·  ${pick("← wired", "← 已接線", "← 已接线", "← 接続中")}`;
}

// ---------- prompt rewrite ----------
let installed = false;
export function installPromptHook() {
  if (installed) return;
  installed = true;
  const orig = app.graphToPrompt;
  if (typeof orig !== "function") return;
  app.graphToPrompt = async function () {
    const res = await orig.apply(this, arguments);
    try {
      const out = res?.output;
      if (out) {
        const groups = new Map(); // "type\u0000channel" -> [inputs, ...]
        for (const id of Object.keys(out)) {
          const n = out[id];
          if (!n || !REMOTE_TYPES.includes(n.class_type) || !n.inputs) continue;
          const c = n.inputs.channel;
          if (typeof c !== "string") continue; // channel itself wired: group cannot be told apart
          const k = n.class_type + "\u0000" + c.trim();
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(n.inputs);
        }
        for (const members of groups.values()) {
          if (members.length < 2) continue;
          const keys = new Set();
          for (const m of members) for (const key of Object.keys(m)) if (key !== "channel") keys.add(key);
          for (const key of keys) {
            const src = members.find((m) => Array.isArray(m[key]));
            if (!src) continue;
            for (const m of members) if (m !== src) m[key] = src[key].slice();
          }
        }
      }
    } catch (e) {
      console.warn("[GeN13] remote wire rewrite skipped:", e);
    }
    return res;
  };
}
installPromptHook();
