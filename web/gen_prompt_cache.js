// Prompt Cache (GeN13)
//   - keeps the read_file dropdown in sync with the cache folder
//   - adds the "Save favorite" button to the node
//
// Combo options are baked into the node definition the backend serves, so a
// file written during a run is missing from the list until the definition is
// fetched again. This refetches it after every run and after a favorite is
// created, and offers a manual entry in the node's right-click menu.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { allNodes } from "./g13_mode.js";

const NODE_ID = "GenPromptCacheGeN13";

// ComfyUI toast (new frontend); falls back to the console so nothing blocks the canvas
function notify(severity, detail) {
  const toast = app.extensionManager?.toast;
  if (toast?.add) {
    toast.add({ severity, summary: "Prompt Cache", detail, life: 5000 });
  } else {
    (severity === "error" ? console.error : console.log)(`[Prompt Cache] ${detail}`);
  }
}
const LIST_WIDGET = "read_file";
const NAME_WIDGET = "save_as";

async function refreshReadFileList() {
  // subgraphs included; nothing to refresh (and no /object_info request) without a Prompt Cache
  const nodes = allNodes(app.rootGraph ?? app.graph).filter((n) => n.comfyClass === NODE_ID);
  if (!nodes.length) return;
  let values;
  try {
    const resp = await api.fetchApi(`/object_info/${NODE_ID}`);
    const info = await resp.json();
    values = info?.[NODE_ID]?.input?.required?.[LIST_WIDGET]?.[0];
  } catch (err) {
    console.warn("[Prompt Cache] could not refresh file list:", err);
    return;
  }
  if (!Array.isArray(values) || values.length === 0) return;

  for (const node of nodes) {
    const widget = node.widgets?.find((w) => w.name === LIST_WIDGET);
    if (!widget) continue;
    widget.options = widget.options ?? {};
    widget.options.values = values;
    if (!values.includes(widget.value)) widget.value = values[0];
  }
  app.graph?.setDirtyCanvas(true, false);
}

async function saveFavorite(node) {
  const saveAs = node.widgets?.find((w) => w.name === NAME_WIDGET)?.value ?? "";
  try {
    const resp = await api.fetchApi("/gen13/prompt_cache/favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ save_as: saveAs }),
    });
    const data = await resp.json();
    if (!data.ok) {
      notify("error", data.error);
      return;
    }
    await refreshReadFileList();
    notify("success", `favorite saved: ${data.file}`);
  } catch (err) {
    console.error("[Prompt Cache] favorite failed:", err);
    notify("error", "favorite failed, see the browser console.");
  }
}

app.registerExtension({
  name: "gen13.prompt_cache",

  setup() {
    api.addEventListener("execution_success", refreshReadFileList);
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onCreated?.apply(this, arguments);
      // serialize: false keeps the button out of the prompt / API export
      this.addWidget("button", "Save favorite", null, () => saveFavorite(this), { serialize: false });
    };

    const onMenu = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      onMenu?.apply(this, arguments);
      options.push(
        { content: "Save favorite", callback: () => saveFavorite(this) },
        { content: "Refresh cache file list", callback: () => refreshReadFileList() },
      );
    };
  },
});
