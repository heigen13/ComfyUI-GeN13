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
    "Output this box; click again when selected to collapse / expand.": "选择此框输出;已选中时再按一次折叠 / 展开。",
    "Auto next: off; select stays as set.": "自动换框:关闭,select 维持不变。",
    "Auto next: moves to the next box with content after each queue, skipping empty boxes and wrapping to the first.": "自动换框:每次送出后跳到下一个有内容的框,空白框略过,到底回第一框。",
    "Trigger: adds 1 to pulse; the connected Counter resets on the next run.": "触发:pulse 加 1,下次运行时,接着的 Counter 会归零。",
    "Status: READY, waiting; press TRIGGER and the connected Counter resets on the next run.": "状态:READY,待命中;按 TRIGGER 后,下次运行时接着的 Counter 会归零。",
    "Status: ARMED, the button was pressed; the connected Counter resets on the next run.": "状态:ARMED,已按下;下次运行时接着的 Counter 会归零。",
    "Status: TRIGGERED BY INPUT, the input value changed on the last run and fired the trigger.": "状态:TRIGGERED BY INPUT,上次运行时 input 的值改变,已触发。",
    "Preview: SHOW opens the image panel; HIDE folds it away. Front end only, never in the prompt.": "预览:SHOW 显示图片面板,HIDE 收起;只存在前端,不写入 prompt。",
    "Privacy: ON covers the preview; hold the preview to see the real image.": "隐私:ON 时预览加上遮罩,按住预览可看原图。",
    "Cover style: mosaic, frosted glass, blurred gradient, palette gradient map, or one solid color.": "遮罩样式:马赛克、雾面玻璃、模糊渐变、色板渐变映射或单一纯色。",
    "Palette: colors of the gradient map, dark to light; CUSTOM uses your two colors.": "色板:渐变映射的配色,由暗到亮;CUSTOM 使用自定义的两色。",
    "Custom colors: the dark and light ends of the CUSTOM palette.": "自定义色:CUSTOM 色板的暗端与亮端两色。",
    "Solid color: AUTO uses the image's average color, or pick a fixed color.": "纯色:AUTO 取图片平均色,或指定固定颜色。",
    "Frost blur: blur radius as a % of the long edge; higher values blur more.": "雾化模糊:模糊半径,以长边百分比计;数值越高越模糊。",
    "Glass: texture in front of the frost; plain, reeded (vertical ribs) or hammered.": "玻璃:雾面前的纹理;plain 平板、reeded 长虹直纹、hammered 锤纹。",
    "Brightness: cover brightness in %; 100 is unchanged, higher values are brighter.": "亮度:遮罩亮度百分比,100 为不变;数值越高越亮。",
    "Auto: uses the image's average color.": "自动:取图片平均色。",
    "Upload: choose an image file; dropping an image on the node also works.": "上传:选择图片文件,也可直接把图片拖到节点上。",
    "choose file to upload": "选择文件上传",
    "edit custom colors": "编辑自定义色",
    "edit solid color": "编辑纯色",
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
    "Output this box; click again when selected to collapse / expand.": "この枠を出力;選択中にもう一度押すと折りたたむ / 展開。",
    "Auto next: off; select stays as set.": "自動送り:オフ。select はそのままです。",
    "Auto next: moves to the next box with content after each queue, skipping empty boxes and wrapping to the first.": "自動送り:送信のたびに内容のある次の枠へ進み、空の枠はスキップ、最後まで行くと最初に戻ります。",
    "Trigger: adds 1 to pulse; the connected Counter resets on the next run.": "トリガー:pulse を 1 増やし、次の実行で接続先の Counter がリセットされます。",
    "Status: READY, waiting; press TRIGGER and the connected Counter resets on the next run.": "状態:READY、待機中。TRIGGER を押すと次の実行で接続先の Counter がリセットされます。",
    "Status: ARMED, the button was pressed; the connected Counter resets on the next run.": "状態:ARMED、押されました。次の実行で接続先の Counter がリセットされます。",
    "Status: TRIGGERED BY INPUT, the input value changed on the last run and fired the trigger.": "状態:TRIGGERED BY INPUT、前回の実行で input の値が変わり、トリガーしました。",
    "Preview: SHOW opens the image panel; HIDE folds it away. Front end only, never in the prompt.": "プレビュー:SHOW で画像パネルを表示、HIDE で折りたたみ。フロントエンドのみで prompt には入りません。",
    "Privacy: ON covers the preview; hold the preview to see the real image.": "プライバシー:ON でプレビューを隠し、プレビューを押し続けると元画像を表示します。",
    "Cover style: mosaic, frosted glass, blurred gradient, palette gradient map, or one solid color.": "カバー:モザイク、すりガラス、ぼかしグラデーション、パレットのグラデーションマップ、単色。",
    "Palette: colors of the gradient map, dark to light; CUSTOM uses your two colors.": "パレット:グラデーションマップの配色(暗→明)。CUSTOM は指定した 2 色を使います。",
    "Custom colors: the dark and light ends of the CUSTOM palette.": "カスタム色:CUSTOM パレットの暗い端と明るい端の 2 色。",
    "Solid color: AUTO uses the image's average color, or pick a fixed color.": "単色:AUTO は画像の平均色、または固定色を指定します。",
    "Frost blur: blur radius as a % of the long edge; higher values blur more.": "すりガラスぼかし:半径を長辺に対する % で指定。値が大きいほど強くぼけます。",
    "Glass: texture in front of the frost; plain, reeded (vertical ribs) or hammered.": "ガラス:すりガラス手前の模様。plain は無地、reeded は縦リブ、hammered は槌目。",
    "Brightness: cover brightness in %; 100 is unchanged, higher values are brighter.": "明るさ:カバーの明るさ(%)。100 で変化なし、値が大きいほど明るくなります。",
    "Auto: uses the image's average color.": "自動:画像の平均色を使います。",
    "Upload: choose an image file; dropping an image on the node also works.": "アップロード:画像ファイルを選択。ノードへのドラッグ&ドロップでも可能です。",
    "choose file to upload": "アップロードするファイルを選択",
    "edit custom colors": "カスタム色を編集",
    "edit solid color": "単色を編集",
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

// the current UI language: "en", "zh-TW", "zh" or "ja" (anything else counts as English)
export function lang() {
  const l = locale();
  return l === "zh-TW" || l === "zh" || l === "ja" ? l : "en";
}

// pick the text for the current language; used for status text built from numbers
export function pick(en, zhTW, zh, ja) {
  const l = lang();
  if (l === "zh-TW") return zhTW;
  if (l === "zh") return zh;
  if (l === "ja") return ja;
  return en;
}

// CSS font stack for CJK words in status lines, so they use a CJK face instead of the Latin one
export function cjkFont() {
  const l = lang();
  if (l === "zh-TW") return '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
  if (l === "zh") return '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif';
  if (l === "ja") return '"Yu Gothic UI","Meiryo","Hiragino Sans","Noto Sans JP",sans-serif';
  return "";
}

// "1,234 chars · 3 lines" in the current language
export function countText(chars, lines) {
  const c = chars.toLocaleString("en-US");
  const n = lines.toLocaleString("en-US");
  return pick(`${c} chars · ${n} ${lines === 1 ? "line" : "lines"}`, `${c} 字 · ${n} 行`, `${c} 字 · ${n} 行`, `${c} 文字 · ${n} 行`);
}

// shown in place of an empty text
export function emptyText() {
  return pick("(empty)", "（空白）", "（空白）", "（空）");
}

// grey info line of the Remote nodes: "channel · N clones"
export function cloneText(channel, k) {
  const c = channel || pick("(no channel)", "（無頻道）", "（无频道）", "（チャンネルなし）");
  return `${c}  ·  ${pick(`${k} ${k === 1 ? "mirror" : "mirrors"}`, `${k} 個分身`, `${k} 个分身`, `分身 ${k}`)}`;
}

// right-click menu entry "Convert to <name> (GeN13)" in the current language
export function convertLabel(name) {
  const n = `${name} (GeN13)`;
  return pick(`Convert to ${n}`, `轉換成 ${n}`, `转换成 ${n}`, `${n} に変換`);
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

// label of a LiteGraph widget (e.g. a button), resolved each time it is drawn
export function setWidgetLabel(widget, text) {
  Object.defineProperty(widget, "label", {
    get: () => String(text),
    set: () => {},
    configurable: true,
    enumerable: true,
  });
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
