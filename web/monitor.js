// ComfyUI-GeN13 - Resource Monitor
//   One strip beside the Run button: RUN (current node, steps, elapsed time, queue) and CPU / RAM /
//   GPU / VRAM / POWER, each with a 30-60 s line and a usage bar. Drawn on one canvas so every text
//   row is placed by its measured ink (labels and values share one centre line per row, the text
//   group sits centred above the bar). Data comes from nodes/monitor.py as "gen13.monitor"; the
//   page posts to /gen13/monitor every few seconds to keep it reading.
//   Settings: GeN13 > Monitor (on / off, refresh interval, each item). Hover a cell for details;
//   click RUN to bring the running node into view. Cells with no source on this machine are left out
//   (see "caps" in nodes/monitor.py). A prompt queued elsewhere (a phone page, the API,
//   another tab) is shown from the back end's "job" reading, with its own node title; no click.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { pick, cjkFont } from "./g13_i18n.js";
import { isLight } from "./g13_mode.js";

const ID = "GeN13.Monitor";
const CELL = 128, PAD = 12, SPW = 40, HIST = 60, TH = 8, BOT = 5, GAP = 6, H = 40 + TH;
const BAR_Y = H - BOT - TH;
const GB = 1024 ** 3;

const DARK = { ink: "#F0F0F0", lab: "#A0A0A0", sub: "#707070", track: "#383838", div: "#404040",
  CYAN: "#00E0C0", LIME: "#C0FF00", PINK: "#FF40C0", ORANGE: "#FFA000", RED: "#FF0000" };
const LIGHT = { ink: "#111111", lab: "#4A4A4A", sub: "#777777", track: "#D8D8D8", div: "#BDBDBD",
  CYAN: "#00A08C", LIME: "#5C9E00", PINK: "#D0208C", ORANGE: "#D07000", RED: "#E00000" };

const setting = (k, d) => {
  try {
    const v = app.extensionManager?.setting?.get?.(`${ID}.${k}`);
    return v === undefined || v === null ? d : v;
  } catch {
    return d;
  }
};

// ---- state ------------------------------------------------------------------------------------
let data = null;
const hist = { cpu: [], ram: [], gpu: [], vram: [], power: [] };
const run = { state: "idle", t0: 0, last: null, node: null, step: 0, max: 0, q: 0, note: "" };
let rem = null; // a prompt queued elsewhere: { id, title, step, max, t0 }

const pct = {
  cpu: (d) => d.cpu,
  ram: (d) => (d.ram_total ? (d.ram_used / d.ram_total) * 100 : null),
  gpu: (d) => d.gpu,
  vram: (d) => (d.vram_total ? (d.vram_used / d.vram_total) * 100 : null),
  power: (d) => (d.power != null && d.power_limit ? (d.power / d.power_limit) * 100 : null),
};

const CELLS = [
  { key: "cpu", label: "CPU", col: "CYAN", unit: "%", val: (d) => d.cpu, fmt: (v) => v.toFixed(0), sub: () => "",
    warn: (d) => d.cpu >= 95,
    tip: () => pick("CPU: usage of all cores; the line shows the last %s s.", "CPU:所有核心的使用率,折線為最近 %s 秒。", "CPU:所有核心的使用率,折线为最近 %s 秒。", "CPU:全コアの使用率。折れ線は直近 %s 秒です。") },
  { key: "ram", label: "RAM", col: "LIME", unit: "GB", val: (d) => (d.ram_used == null ? null : d.ram_used / GB), fmt: (v) => v.toFixed(1),
    sub: (d) => `/ ${Math.round(d.ram_total / GB)} GB`, warn: (d) => d.ram_used / d.ram_total >= 0.95,
    tip: () => pick("RAM: system memory in use / installed; red from 95%.", "RAM:系統記憶體已用 / 總量,95% 起轉紅。", "RAM:系统内存已用 / 总量,95% 起转红。", "RAM:使用中 / 搭載のシステムメモリ。95% から赤。") },
  { key: "gpu", label: "GPU", col: "PINK", unit: "%", val: (d) => d.gpu, fmt: (v) => v.toFixed(0),
    sub: (d) => (d.temp != null ? `${d.temp.toFixed(0)}°C` : ""), warn: (d) => d.temp != null && d.temp >= 83, cap: "gpu",
    tip: (d) => (d?.caps?.temp === false
      ? pick("GPU: %n usage.", "GPU:%n 使用率。", "GPU:%n 使用率。", "GPU:%n の使用率。")
      : pick("GPU: %n usage; °C is the core temperature, red from 83 °C.", "GPU:%n 使用率,°C 為核心溫度,83 °C 起轉紅。", "GPU:%n 使用率,°C 为核心温度,83 °C 起转红。", "GPU:%n の使用率。°C はコア温度、83 °C から赤。")).replace("%n", d?.gpu_name || "GPU") },
  { key: "vram", label: "VRAM", col: "ORANGE", unit: "GB", val: (d) => (d.vram_used == null ? null : d.vram_used / GB), fmt: (v) => v.toFixed(1),
    sub: (d) => `/ ${Math.round(d.vram_total / GB)} GB`, warn: (d) => d.vram_used / d.vram_total >= 0.95, cap: "vram",
    tip: () => pick("VRAM: whole-card memory in use, other programs included; red from 95%.", "VRAM:整張顯卡已用記憶體,含其他程式,95% 起轉紅。", "VRAM:整张显卡已用显存,含其他程序,95% 起转红。", "VRAM:カード全体の使用メモリ(他のプログラムを含む)。95% から赤。") },
  { key: "power", label: "POWER", col: "CYAN", unit: "W", val: (d) => d.power, fmt: (v) => v.toFixed(0),
    sub: (d) => (d.power_limit ? `/ ${Math.round(d.power_limit)} W` : ""), warn: () => false, cap: "power",
    tip: () => pick("Power: board power draw / the limit the card enforces now.", "功耗:顯卡目前耗電 / 目前生效的功耗上限。", "功耗:显卡当前耗电 / 当前生效的功耗上限。", "電力:ボードの消費電力 / 現在有効な電力上限。") },
];
const SHOW = { run: "ShowRun", cpu: "ShowCpu", ram: "ShowRam", gpu: "ShowGpu", vram: "ShowVram", power: "ShowPower" };

// ---- canvas -----------------------------------------------------------------------------------
const wrap = document.createElement("div");
wrap.className = "g13mon";
wrap.style.cssText = "display:flex;align-items:center;flex:0 0 auto;line-height:0";
const cv = document.createElement("canvas");
wrap.appendChild(cv);
const ctx = cv.getContext("2d");
let M = null, dpr = 1, layout = [], hover = null;

const FONT = '"Inter", Arial, sans-serif';
function setF(px) {
  ctx.font = `500 ${px}px ${FONT}`;
}
function measure(t, px, ls) {
  setF(px);
  ctx.letterSpacing = `${ls}px`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(t);
  ctx.letterSpacing = "0px";
  return m;
}
function metrics() {
  const capL = measure("GPUVRAMPOWER", 10, 2).actualBoundingBoxAscent;
  const capV = measure("0123456789", 15, 0).actualBoundingBoxAscent;
  const top = (BAR_Y - (capL + GAP + capV)) / 2;
  const snap = (y) => Math.round(y * dpr) / dpr;
  const labBase = snap(top + capL), valBase = snap(top + capL + GAP + capV);
  M = { capL, capV, labBase, valBase, labMid: labBase - capL / 2, grpTop: labBase - capL, grpBot: valBase,
    dw: measure("0", 15, 0).width, pw: measure(".", 15, 0).width, cw: measure(":", 15, 0).width };
}
const isNum = (ch) => ch >= "0" && ch <= "9";
function advance(ch) {
  if (isNum(ch)) return M.dw;
  if (ch === "." || ch === " ") return M.pw;
  if (ch === ":") return M.cw;
  return measure(ch, 15, 0).width;
}
function numW(t) {
  let w = 0;
  for (const ch of t) w += advance(ch);
  return w;
}
// fixed-width digits so a changing value never shifts sideways
function num(t, x, color) {
  setF(15);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = color;
  for (const ch of t) {
    const w = advance(ch);
    setF(15);
    ctx.fillText(ch, x + (w - ctx.measureText(ch).width) / 2, M.valBase);
    x += w;
  }
  return x;
}
// small caps text on the label row; text with CJK (a node title) is set in the CJK face and placed
// by its own ink so it shares the label row's centre line
function caps(t, x, color, maxW, alignRight, base) {
  const cjk = /[　-鿿가-힯＀-￯]/.test(t);
  const face = cjk ? `500 10px ${FONT.replace('"Inter"', `"Inter",${cjkFont() || '"Microsoft JhengHei","PingFang TC","Noto Sans TC"'}`)}` : `500 10px ${FONT}`;
  const ls = cjk ? 1 : 2;
  ctx.font = face;
  ctx.letterSpacing = `${ls}px`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let s = t;
  const width = (v) => ctx.measureText(v).width - ls;
  if (maxW && width(s) > maxW) {
    while (s.length > 1 && width(s + "…") > maxW) s = s.slice(0, -1);
    s += "…";
  }
  const m = ctx.measureText(s);
  const y = base ?? (cjk ? M.labMid + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 : M.labBase);
  const w = m.width - ls;
  ctx.fillStyle = color;
  ctx.fillText(s, alignRight ? x - w : x, Math.round(y * dpr) / dpr);
  ctx.letterSpacing = "0px";
  return w;
}

// ---- RUN -------------------------------------------------------------------------------------
function nodeChain(id) {
  if (id == null) return [];
  const out = [];
  let g = app.rootGraph ?? app.graph;
  for (const p of String(id).split(":")) {
    const n = g?.getNodeById?.(p) ?? g?.getNodeById?.(Number(p));
    if (!n) break;
    out.push(n);
    g = n.subgraph;
  }
  return out;
}
function nodeTitle(id, fallback) {
  const c = nodeChain(id);
  const n = c[c.length - 1];
  return String(n?.title || n?.type || fallback || "").toUpperCase();
}
function mmss(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}
const now = () => performance.now();

function drawRun(x0, w, P) {
  const x1 = x0 + w;
  let label = "", col = P.ink, labCol = P.sub, valCol = P.ink, sec = 0, frac = 0, steps = "";
  if (run.state !== "run" && rem) {
    label = String(rem.title || "…").toUpperCase();
    sec = (now() - rem.t0) / 1000;
    if (rem.max > 1) {
      steps = `${rem.step} / ${rem.max}`;
      frac = rem.step / rem.max;
    }
  } else if (run.state === "run") {
    label = nodeTitle(run.node) || "…";
    sec = (now() - run.t0) / 1000;
    if (run.max > 1) {
      steps = `${run.step} / ${run.max}`;
      frac = run.step / run.max;
    }
  } else if (run.state === "error") {
    label = `ERROR · ${run.note}`;
    labCol = valCol = col = P.RED;
    sec = run.last ?? 0;
    frac = run.max > 1 ? run.step / run.max : 1;
    if (run.max > 1) steps = `${run.step} / ${run.max}`;
  } else {
    label = run.note || (run.last != null ? "IDLE · LAST RUN" : "IDLE");
    sec = run.last ?? 0;
  }
  const qn = Math.max(0, run.q - (run.state === "run" || rem ? 1 : 0));
  const q = qn > 0 ? `QUEUE ${qn}` : "";
  const kw = caps("RUN", x0 + PAD, P.lab);
  let qw = 0;
  if (q) qw = caps(q, x1 - PAD, P.lab, 0, true);
  caps(label, x0 + PAD + kw + 8, labCol, x1 - PAD - (qw ? qw + 12 : 0) - (x0 + PAD + kw + 8));
  num(run.last == null && run.state === "idle" && !rem ? "--:--.-" : mmss(sec), x0 + PAD, valCol);
  if (steps) num(steps, x1 - PAD - numW(steps), P.lab);
  const bw = w - PAD * 2;
  ctx.fillStyle = P.track;
  ctx.fillRect(x0 + PAD, BAR_Y, bw, TH);
  ctx.fillStyle = col;
  ctx.fillRect(x0 + PAD, BAR_Y, Math.round(bw * Math.min(1, frac)), TH);
}

function drawCell(c, x0, P) {
  const d = data;
  const x1 = x0 + CELL;
  const v = d ? c.val(d) : null;
  const ok = v != null && Number.isFinite(v);
  const warn = ok && c.warn(d);
  const col = warn ? P.RED : P[c.col];
  caps(c.label, x0 + PAD, P.lab);
  const sub = ok ? c.sub(d) : "";
  if (sub) caps(sub, x1 - PAD, warn && c.key === "gpu" ? P.RED : P.sub, 0, true); // label row: name left, total / temperature right
  const xe = num(ok ? c.fmt(v) : "--", x0 + PAD, warn ? P.RED : P.ink);
  caps(c.unit, xe + 4, P.lab, 0, false, M.valBase);
  const h = hist[c.key];
  const sx = x1 - PAD - SPW, y0 = M.labBase + 4, y1 = M.grpBot; // value row only, under the label row's right text
  if (h.length > 1) {
    const X = (j) => sx + (SPW * (j + HIST - h.length)) / (HIST - 1);
    ctx.beginPath();
    h.forEach((p, j) => {
      const y = y1 - ((y1 - y0) * p) / 100;
      j ? ctx.lineTo(X(j), y) : ctx.moveTo(X(j), y);
    });
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.lineTo(X(h.length - 1), y1);
    ctx.lineTo(X(0), y1);
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const bw = CELL - PAD * 2;
  const p = ok ? pct[c.key](d) : null;
  ctx.fillStyle = P.track;
  ctx.fillRect(x0 + PAD, BAR_Y, bw, TH);
  if (p != null) {
    ctx.fillStyle = col;
    ctx.fillRect(x0 + PAD, BAR_Y, Math.round(bw * Math.max(0, Math.min(1, p / 100))), TH);
  }
}

// a cell with no source on this machine (no GPU counters on a Mac, no power reading on Windows
// without NVIDIA) is left out instead of showing "--"
function visibleCells() {
  const caps = data?.caps;
  return CELLS.filter((c) => setting(SHOW[c.key], true) && (!c.cap || !caps || caps[c.cap] !== false));
}

function draw() {
  if (!wrap.isConnected) return;
  const d2 = window.devicePixelRatio || 1;
  if (d2 !== dpr || !M) {
    dpr = d2;
    metrics();
  }
  const showRun = setting(SHOW.run, true);
  const cells = visibleCells();
  const W = (showRun ? CELL * 2 : 0) + cells.length * CELL;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
  }
  const P = isLight() ? LIGHT : DARK;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  layout = [];
  let x = 0;
  if (showRun) {
    drawRun(x, CELL * 2, P);
    layout.push({ key: "run", x0: x, x1: x + CELL * 2 });
    x += CELL * 2;
  }
  for (const c of cells) {
    if (x > 0) {
      ctx.fillStyle = P.div;
      ctx.fillRect(x, 6, 1, H - 12);
    }
    drawCell(c, x, P);
    layout.push({ key: c.key, x0: x, x1: x + CELL, c });
    x += CELL;
  }
}

// ---- hover, click -----------------------------------------------------------------------------
function cellAt(ev) {
  const r = cv.getBoundingClientRect();
  const x = ev.clientX - r.left;
  return layout.find((l) => x >= l.x0 && x < l.x1) ?? null;
}
cv.addEventListener("pointermove", (ev) => {
  const l = cellAt(ev);
  const key = l?.key ?? null;
  const target = key === "run" ? runTarget() : null;
  cv.style.cursor = target ? "pointer" : "default";
  if (key === hover) return;
  hover = key;
  if (!l) cv.title = "";
  else if (key === "run")
    cv.title = pick("Run: elapsed time of the running prompt from any device; click to show a node run from this page.", "執行:正在執行的佇列耗時,含其他裝置送出的;本頁送出的可點一下移到該節點。", "执行:正在执行的队列耗时,含其他设备提交的;本页提交的可点一下移到该节点。", "実行:実行中のキューの経過時間(他の端末からの分も含む)。このページから実行した分はクリックでノードへ移動します。");
  else cv.title = l.c.tip(data).replace("%s", String(Math.round(HIST * (data?.rate ?? 1))));
});
cv.addEventListener("pointerleave", () => {
  hover = null;
});
function runTarget() {
  if (run.node == null || (rem && run.state !== "run")) return null; // a node id from another device's prompt means nothing here
  const c = nodeChain(run.node);
  const g = app.canvas?.graph;
  return c.find((n) => n.graph === g) ?? null;
}
cv.addEventListener("click", (ev) => {
  if (cellAt(ev)?.key !== "run") return;
  const n = runTarget();
  if (!n) return;
  app.canvas.centerOnNode?.(n);
  app.canvas.setDirty?.(true, true);
});

// ---- data -------------------------------------------------------------------------------------
function onJob(j) {
  if (!j) return;
  if (typeof j.queue === "number") run.q = j.queue;
  const other = j.id != null && j.client !== api.clientId;
  if (other && run.state !== "run") {
    if (!rem || rem.id !== j.id) {
      rem = { id: j.id, t0: now() - (j.elapsed || 0) * 1000 };
      run.note = "";
    }
    Object.assign(rem, { title: j.title, step: j.step || 0, max: j.max || 0 });
  } else if (rem) {
    run.last = (now() - rem.t0) / 1000; // finished (or our own run took over): keep its time
    rem = null;
  }
}
function onData(d) {
  data = d;
  onJob(d.job);
  for (const k of Object.keys(hist)) {
    const p = pct[k](d);
    if (p == null || !Number.isFinite(p)) continue;
    hist[k].push(Math.max(0, Math.min(100, p)));
    if (hist[k].length > HIST) hist[k].shift();
  }
  draw();
}

function finish(note) {
  if (run.state === "run") run.last = (now() - run.t0) / 1000;
  run.state = "idle";
  run.note = note || "";
  run.step = run.max = 0;
  draw();
}
function eventNode(d) {
  if (d && typeof d === "object") return d.display_node ?? d.node ?? null;
  return d ?? null;
}
function listen() {
  api.addEventListener("gen13.monitor", (e) => onData(e.detail));
  api.addEventListener("execution_start", () => {
    Object.assign(run, { state: "run", t0: now(), node: null, step: 0, max: 0, note: "" });
    draw();
  });
  api.addEventListener("executing", (e) => {
    const n = eventNode(e.detail);
    if (n == null) {
      if (run.state === "run") finish();
      return;
    }
    if (run.state !== "run") Object.assign(run, { state: "run", t0: now(), note: "" }); // page opened mid-run
    if (run.node !== n) Object.assign(run, { node: n, step: 0, max: 0 });
    draw();
  });
  api.addEventListener("progress", (e) => {
    const { value, max, node } = e.detail ?? {};
    if (run.state !== "run") return;
    if (node != null) run.node = node;
    run.step = value ?? 0;
    run.max = max ?? 0;
    draw();
  });
  api.addEventListener("execution_success", () => finish());
  api.addEventListener("execution_interrupted", () => finish("INTERRUPTED"));
  api.addEventListener("execution_error", (e) => {
    const d = e.detail ?? {};
    if (run.state === "run") run.last = (now() - run.t0) / 1000;
    run.state = "error";
    run.note = nodeTitle(d.node_id, d.node_type) || "NODE";
    draw();
  });
  api.addEventListener("status", (e) => {
    const q = e.detail?.exec_info?.queue_remaining;
    if (typeof q === "number") {
      run.q = q;
      draw();
    }
  });
}

// ---- placement, keep-alive --------------------------------------------------------------------
function mount() {
  if (!setting("Enabled", true)) {
    wrap.remove();
    return;
  }
  const host = app.menu?.settingsGroup?.element;
  if (host?.isConnected) {
    if (wrap.nextElementSibling !== host) host.before(wrap);
  } else if (!wrap.isConnected) {
    document.getElementById("queue-button")?.after(wrap);
  }
  draw();
}
async function ping() {
  if (!setting("Enabled", true) || document.hidden) return;
  try {
    await api.fetchApi("/gen13/monitor", { method: "POST", body: JSON.stringify({ rate: setting("Rate", 0.5) }) });
  } catch {}
}
const redraw = () => draw();

listen(); // at load: the backend may already be sending when the page opens

app.registerExtension({
  name: "GeN13.Monitor",
  settings: [
    { id: `${ID}.Enabled`, category: ["GeN13", "Monitor", "Enabled"], name: "Show the resource monitor",
      tooltip: "Resource monitor: the RUN / CPU / RAM / GPU / VRAM / POWER strip beside the Run button.",
      type: "boolean", defaultValue: true, onChange: () => { mount(); ping(); } },
    { id: `${ID}.Rate`, category: ["GeN13", "Monitor", "Rate"], name: "Refresh interval (seconds)",
      tooltip: "Refresh interval: seconds between readings; the line keeps the last 60 readings.",
      type: "slider", attrs: { min: 0.25, max: 5, step: 0.25 }, defaultValue: 0.5, onChange: () => ping() },
    ...Object.entries(SHOW).map(([k, s]) => ({
      id: `${ID}.${s}`, category: ["GeN13", "Monitor", s], name: `Show ${k === "run" ? "RUN" : k.toUpperCase()}`,
      type: "boolean", defaultValue: true, onChange: redraw })),
  ],
  async setup() {
    try {
      await document.fonts?.load?.(`500 15px ${FONT}`);
    } catch {}
    mount();
    ping();
    setInterval(mount, 2000); // the menu can be rebuilt (layout or setting changes): put the strip back
    setInterval(ping, 5000);
    setInterval(() => {
      if (run.state === "run") draw();
    }, 100);
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) ping();
    });
  },
});
