// Load Latest Image Private (GeN13)
//   - shows a thumbnail of the image the node will load, with the original width x height
//   - the refresh button shows the file name and its position, click to refresh
//   - refreshes when a widget changes, after every run, and when a workflow loads
//   - preview / privacy controls come from private_image.js (same as the Private nodes):
//     preview SHOW / HIDE, privacy ON / OFF, privacy_style and its options, hold to reveal;
//     all kept in node.properties, never sent to the prompt or the API template
//   - the thumbnail is a DOM widget with its own <canvas>, so it shows in both the
//     classic canvas (Nodes 1.0) and Vue nodes (Nodes 2.0)
//
// The node stores only folder / sort / index, never a file name, so nothing can
// go missing on reload (no red "Missing Inputs" like Load Image (from Outputs)).

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { pick } from "./g13_i18n.js";
import { allNodes } from "./g13_mode.js";
import {
  attachPrivacy,
  clearPreviewImage,
  installPrivacyHooks,
  setPreviewImage,
  setPreviewSize,
} from "./private_image.js";

const NODE_ID = "LoadLatestImagePrivateGeN13";
const FIELDS = ["folder_path", "sort_by", "index", "filename_filter", "subfolders", "extensions"];
const LABEL_MAX = 24;

function widgetValue(node, name) {
  return node.widgets?.find((w) => w.name === name)?.value;
}

function shorten(text) {
  if (text.length <= LABEL_MAX) return text;
  const keep = LABEL_MAX - 3;
  return text.slice(0, Math.ceil(keep / 2)) + "..." + text.slice(text.length - Math.floor(keep / 2));
}

// server messages (English) -> the current language
const ERR = {
  "folder not found": ["找不到資料夾", "找不到文件夹", "フォルダーが見つかりません"],
  "preview: run once to enable this folder": ["預覽:執行一次後才開放此資料夾", "预览:运行一次后才开放此文件夹", "プレビュー:一度実行するとこのフォルダーが有効になります"],
  "no matching images": ["沒有符合的圖片", "没有符合的图片", "一致する画像がありません"],
  "index out of range": ["index 超出範圍", "index 超出范围", "index が範囲外です"],
  "no readable image": ["沒有可讀取的圖片", "没有可读取的图片", "読み込める画像がありません"],
  "preview unavailable": ["無法預覽", "无法预览", "プレビューできません"],
};
const errText = (e) => (ERR[e] ? pick(e, ...ERR[e]) : String(e ?? ""));
const refreshWord = () => pick("refresh", "重新整理", "刷新", "更新");

function setLabel(node, text) {
  const btn = node._g13btn;
  if (!btn) return;
  btn.label = text;
  btn.name = text;
  node.setDirtyCanvas(true, false);
}

async function refresh(node) {
  const seq = (node._g13seq = (node._g13seq ?? 0) + 1);
  const params = new URLSearchParams();
  for (const f of FIELDS) {
    const v = widgetValue(node, f);
    params.set(f, typeof v === "boolean" ? String(v) : String(v ?? ""));
  }
  let data;
  try {
    const resp = await api.fetchApi(`/gen13/latest_image?${params}`);
    data = await resp.json();
  } catch (err) {
    data = { ok: false, error: "preview unavailable" };
  }
  if (seq !== node._g13seq) return; // a newer request is running

  if (!data.ok) {
    node._g13key = null;
    setLabel(node, `${refreshWord()}: ${errText(data.error)}`);
    clearPreviewImage(node);
    return;
  }
  setLabel(node, `${refreshWord()}: ${shorten(data.filename)} (${data.position} / ${data.total})`);
  const size = [data.width, data.height];

  const key = `${data.path}|${data.mtime}`;
  if (key === node._g13key) {
    setPreviewSize(node, size); // same file, keep the thumbnail
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (seq !== node._g13seq) return;
    node._g13key = key;
    setPreviewImage(node, img, size);
  };
  img.onerror = () => {
    if (seq !== node._g13seq) return;
    node._g13key = null;
    clearPreviewImage(node);
  };
  img.src = api.apiURL(
    `/gen13/latest_image/thumb?path=${encodeURIComponent(data.path)}&t=${data.mtime}`
  );
}

function schedule(node, delay = 250) {
  clearTimeout(node._g13timer);
  node._g13timer = setTimeout(() => refresh(node), delay);
}

function refreshAll() {
  for (const node of allNodes(app.rootGraph ?? app.graph)) {
    if (node.comfyClass === NODE_ID) schedule(node, 300); // subgraphs included
  }
}

app.registerExtension({
  name: "gen13.load_latest_image",

  setup() {
    api.addEventListener("executed", refreshAll);
    api.addEventListener("execution_success", refreshAll);
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onCreated?.apply(this, arguments);
      const node = this;

      for (const name of FIELDS) {
        const w = node.widgets?.find((x) => x.name === name);
        if (!w) continue;
        const cb = w.callback;
        w.callback = function () {
          const r = cb?.apply(this, arguments);
          schedule(node, name === "folder_path" || name === "filename_filter" || name === "extensions" ? 600 : 150);
          return r;
        };
      }

      const btn = node.addWidget("button", "refresh", null, () => refresh(node), { serialize: false });
      btn.serialize = false; // not part of the prompt payload
      btn.label = refreshWord();
      node._g13btn = btn;

      attachPrivacy(node);
      schedule(node, 400);
    };

    installPrivacyHooks(nodeType);
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      schedule(this, 400);
      return r;
    };
  },
});
