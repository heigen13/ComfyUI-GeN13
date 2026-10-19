// ComfyUI-GeN13 - shared UI text helper for hints that the JS builds itself
//   (button hovers, the Remote Float step tooltip, placeholders).
//   Node, input and output tooltips come from Python (English) and
//   locales/<lang>/nodeDefs.json (zh-TW, zh, ja); this covers the rest.
//   The language follows the ComfyUI setting Comfy.Locale and is read on every
//   hover, so switching the language takes effect without reloading.
//   Each call site passes English and Traditional Chinese; other languages are
//   looked up here by the English text and fall back to English.
import { app } from "../../scripts/app.js";

const MORE = {
  zh: {
    "Reset: sets run to 0; the next output is start.": "归零:run 回到 0,下一次输出 start。",
    "Text: syncs to every clone in the group as you type.": "文字:打字时实时同步到同组所有分身。",
    "Cut: copies all content, then clears the box.": "剪切:复制全部内容后清空。",
    "Copy: copies all content.": "复制:复制全部内容。",
    "Paste: adds to the end on a new line.": "粘贴:换行后接在最后。",
    "Step: amount added or subtracted per ◀ ▶ press; the shown decimals follow it (at least one).": "步进:◀ ▶ 每按一次增减的量,显示的小数位数跟着走(最少一位)。",
    "Previous: goes to the previous box with content.": "上一框:跳到前一个有内容的框。",
    "Next: goes to the next box with content.": "下一框:跳到下一个有内容的框。",
    "Sync: replaces the box text with the latest upstream content.": "同步:以上游最新内容取代框内文字。",
    "Edit: AUTO, the box follows upstream and is read-only; outputs the upstream content.": "编辑:AUTO,框跟着上游、只读,输出上游内容。",
    "Edit: MANUAL, the box can be edited freely; outputs the box text.": "编辑:MANUAL,框可自由修改,输出框内文字。",
    "Enter text": "输入文字",
    "Collapse / expand": "折叠 / 展开",
    "Output this box": "选择此框输出",
    "Auto next: off; select stays as set.": "自动换框:关闭,select 维持不变。",
    "Auto next: moves to the next box with content after each queue, skipping empty boxes and wrapping to the first.": "自动换框:每次送出后跳到下一个有内容的框,空白框略过,到底回第一框。",
    "Trigger: adds 1 to pulse; the connected Counter resets on the next run.": "触发:pulse 加 1,下次运行时,接着的 Counter 会归零。",
  },
  ja: {
    "Reset: sets run to 0; the next output is start.": "リセット:run を 0 に戻し、次の出力は start になります。",
    "Text: syncs to every clone in the group as you type.": "テキスト:入力と同時にグループのすべての分身へ同期します。",
    "Cut: copies all content, then clears the box.": "切り取り:すべての内容をコピーしてから消去します。",
    "Copy: copies all content.": "コピー:すべての内容をコピーします。",
    "Paste: adds to the end on a new line.": "貼り付け:改行して末尾に追加します。",
    "Step: amount added or subtracted per ◀ ▶ press; the shown decimals follow it (at least one).": "ステップ:◀ ▶ 1 回ごとの増減量。表示する小数桁数もこれに合わせます(最低 1 桁)。",
    "Previous: goes to the previous box with content.": "前の枠:内容のある前の枠へ移動します。",
    "Next: goes to the next box with content.": "次の枠:内容のある次の枠へ移動します。",
    "Sync: replaces the box text with the latest upstream content.": "同期:枠のテキストを上流の最新内容に置き換えます。",
    "Edit: AUTO, the box follows upstream and is read-only; outputs the upstream content.": "編集:AUTO、枠は上流に追従して読み取り専用。上流の内容を出力します。",
    "Edit: MANUAL, the box can be edited freely; outputs the box text.": "編集:MANUAL、枠を自由に編集でき、枠のテキストを出力します。",
    "Enter text": "テキストを入力",
    "Collapse / expand": "折りたたむ / 展開",
    "Output this box": "この枠を出力",
    "Auto next: off; select stays as set.": "自動送り:オフ。select はそのままです。",
    "Auto next: moves to the next box with content after each queue, skipping empty boxes and wrapping to the first.": "自動送り:送信のたびに内容のある次の枠へ進み、空の枠はスキップ、最後まで行くと最初に戻ります。",
    "Trigger: adds 1 to pulse; the connected Counter resets on the next run.": "トリガー:pulse を 1 増やし、次の実行で接続先の Counter がリセットされます。",
  },
};

function locale() {
  try {
    return app.extensionManager?.setting?.get?.("Comfy.Locale")
      ?? app.ui?.settings?.getSettingValue?.("Comfy.Locale")
      ?? "en";
  } catch {
    return "en";
  }
}

// a text in English and Traditional Chinese; String(t) gives the current language
export function T(en, zhTW) {
  return {
    en,
    zh: zhTW,
    toString: () => {
      const l = locale();
      if (l === "zh-TW") return zhTW;
      return MORE[l]?.[en] ?? en;
    },
  };
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
