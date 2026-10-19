// ComfyUI-GeN13 - shared UI text helper for hints that the JS builds itself
//   (button hovers, the Remote Float step tooltip, placeholders).
//   Node, input and output tooltips come from Python (English) and
//   locales/zh-TW/nodeDefs.json (Traditional Chinese); this covers the rest.
//   The language follows the ComfyUI setting Comfy.Locale and is read on every
//   hover, so switching the language takes effect without reloading.
import { app } from "../../scripts/app.js";

function locale() {
  try {
    return app.extensionManager?.setting?.get?.("Comfy.Locale")
      ?? app.ui?.settings?.getSettingValue?.("Comfy.Locale")
      ?? "en";
  } catch {
    return "en";
  }
}

// a text in English and Traditional Chinese; String(t) gives the current one
export function T(en, zh) {
  return { en, zh, toString: () => (locale() === "zh-TW" ? zh : en) };
}

// hover text on a DOM element, refreshed each time the pointer enters
export function setTip(el, tip) {
  const apply = () => { el.title = String(tip); };
  apply();
  el.addEventListener("pointerenter", apply);
}

// tooltip on a LiteGraph widget, resolved each time it is shown
export function setWidgetTip(widget, tip) {
  Object.defineProperty(widget, "tooltip", {
    get: () => String(tip),
    set: () => {},
    configurable: true,
    enumerable: true,
  });
}
