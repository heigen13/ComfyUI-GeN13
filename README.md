<p align="center"><img src="docs/banner.jpg" alt="ComfyUI-GeN13" width="100%"></p>

# ComfyUI-GeN13

Custom nodes for ComfyUI, built around an image-to-video and portrait workflow: temporal color matching for generated video, portrait retouching, image loaders that hide their preview, text switching with chainable boxes, and "remote" nodes that keep one value in sync across a large graph.

Every node's display name ends with **(GeN13)**, so double-click the canvas and type `GeN13` to list them all.

[繁體中文說明](#繁體中文)

## Install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/heigen13/ComfyUI-GeN13
```

Restart ComfyUI. No extra Python packages are needed; everything uses what ComfyUI already ships (torch, numpy, Pillow).
Optional: the `nvidia_rtx_vsr` upscale method in **Resize** needs the `nvidia-vfx` package and an RTX GPU.

## Nodes

### Video / color

| Node | What it does |
|---|---|
| **Color Match Temporal** | Matches generated video frames to a reference image (usually the first frame) and smooths the correction over time, so slow color drift is removed without flicker. The default `white balance` method fixes only color cast and keeps the video's own brightness. It measures drift on background pixels that did not move, so a large white shirt or a close-up cannot fool it into tinting the whole frame. Scene cuts are detected and each shot is matched to its own start. Can also export a `.cube` LUT. |
| **Degrease** | Portrait retouch for generated video: smooth, deblemish, deshine, even tone and decontour, each 0 = off. Eyes and other facial features are protected automatically. |
| **Remote Video** | Scales the first frame to an aspect ratio and pixel budget, outputs width, height and duration; clones with the same channel stay in sync. |

### Image

| Node | What it does |
|---|---|
| **Load Image Private** | Load Image with a privacy cover on the node preview (mosaic, frosted glass, gradient, palette, solid). Hold the preview to reveal the original. Outputs width and height. Drag and drop or upload. |
| **Save Image Private** | Saves PNG, JPG, BMP or PNG + JPG with a custom prefix, padding and quality, with the same privacy preview. |
| **Preview Image Private** | Preview (temp, not saved to output) with the privacy cover. |
| **Load Latest Image Private** | Picks images from a folder by newest, oldest or name, with filename filters, subfolders and batch loading; files still being written are skipped. Same privacy preview. |
| **Load Image Orient** | Plain loader that decodes with Pillow only, so iOS screenshots are not rotated by the video decoder path. |
| **Load Image SD** | Loads an image and reads its A1111 / Forge generation parameters (prompt, negative, seed, steps, CFG, sampler, scheduler, size, clip skip) to recreate old images in ComfyUI. |

### Latent

| Node | What it does |
|---|---|
| **Resize** | One node for latent size: empty latent, image + VAE encode, or rescale an existing latent. Aspect presets with width / height / megapixels linked, invert button, crop / resize / pad / pad_edge / stretch, multiple-of 8 to 64. Resizes up to four images and a mask with the same settings. |

### Text

| Node | What it does |
|---|---|
| **Text Switch** | Type prompts in up to 25 boxes and output the selected one. Boxes have titles and can collapse. Chain several nodes side by side, numbering continues across the chain. `auto next` steps to the next non-empty box on every queue. `select_num` lets an INT drive the selection. |
| **Text Concatenate** | Type text in boxes and join them; per-box on/off and solo, empty boxes skipped. |
| **Prompt Cache** | Saves upstream text (for example an LLM-written script) to a file and replays it later without loading the upstream model. One rolling backup plus any number of favorites. |
| **Show Any** / **Show Any Lite** | Accept any type, display it, and pass it through. Cut / copy / paste buttons; text is saved with the workflow. |

### Utilities and remotes

| Node | What it does |
|---|---|
| **Remote Int / Float / String / Boolean** | Clones that share a `channel` name stay in sync (value, step, bypass), even inside subgraphs. Wire any one clone's value and that input drives the whole group. Put a remote wherever you work in a large graph instead of scrolling back to one setting. |
| **Remote Text Switch** | Remote for Text Switch: shows the selected box's number and title, ◀ ▶ skip empty boxes. |
| **Counter** | Counts up or down per queue with ranges, hold (repeat each value N times), reset button, reset input and auto reset every hour or day. Freezes while bypassed. |
| **Trigger** | Button or upstream change produces a new value; connect it to Counter's reset. |
| **Number** | One number out as INT, FLOAT and STRING, with a choice of rounding. |

## Notes

- Tooltips and descriptions are in English, with translations in Traditional Chinese (繁體中文), Simplified Chinese (中文) and Japanese (日本語), shown when the ComfyUI language is set to one of them.
- Built and tested on ComfyUI 0.40 with the classic canvas (Nodes 1.0). Nodes 2.0 is supported for the image previews.

## License

Copyright (C) 2026 GeN's Studio Inc.

Licensed under the GNU General Public License v3.0 (the same license as ComfyUI). You may use, modify and share these nodes, including for commercial work; if you distribute a modified version, it must also be released under GPL-3.0 with its source code. See [LICENSE](LICENSE).

---

## 繁體中文

ComfyUI 自訂節點包，圍繞圖生影片與人像工作流設計：影片時間軸校色、人像美顏、可遮住預覽的載圖節點、可串接的提示詞切換，以及在大型工作流各處同步同一個數值的遙控節點。

所有節點的顯示名稱都以 **(GeN13)** 結尾，在畫布上雙擊、輸入 `GeN13` 就能全部列出。

### 安裝

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/heigen13/ComfyUI-GeN13
```

重開 ComfyUI 即可，不需要另外安裝套件。**Resize** 的 `nvidia_rtx_vsr` 縮放需要 `nvidia-vfx` 套件與 RTX 顯卡（選用）。

### 節點一覽

- **Color Match Temporal**：影片色調對位參考圖，逐格計算並沿時間軸平滑，修正圖生影片的漸進色偏且不閃爍。預設 white balance 只修色偏、亮度照原片；以「沒動的背景像素」量漂移，大面積白衣服或特寫不會把整張推偏。自動偵測換鏡頭，每個鏡頭對自己的開頭。可輸出 .cube LUT。
- **Degrease**：人像去油膩與美顏：磨皮祛皺、祛斑祛痘、去油光、勻膚、減立體，0 為關閉，眼睛等五官自動保護。
- **Remote Video**：首幀依比例與像素量縮放，輸出寬高與秒數；同名 channel 的分身互相同步。
- **Load / Save / Preview Image Private**：節點預覽可切換隱私遮罩（馬賽克、毛玻璃、漸層、色盤、純色），按住預覽圖顯示原圖；輸出寬高。
- **Load Latest Image Private**：從資料夾依最新、最舊或檔名取圖，支援篩選、子資料夾、連續多張，寫入中的檔自動略過。
- **Load Image Orient**：只走 Pillow 的簡易載圖，iOS 截圖不會被轉向。
- **Load Image SD**：載入圖片並讀出 A1111 / Forge 生成參數，在 ComfyUI 重現舊圖。
- **Resize**：空 latent、圖片 encode、縮放既有 latent 一顆搞定；比例、寬高、像素量三欄連動，裁切、補邊、拉伸，可同時縮放四張圖與遮罩。
- **Text Switch**：最多 25 框提示詞選一輸出，框可命名、收合；多顆用 chain 水平串接、編號接續；auto next 每次送出自動換下一框；select_num 可用 INT 控制。
- **Text Concatenate**：框內打字串接，各框開關與獨奏，空框略過。
- **Prompt Cache**：把上游文字（如 LLM 腳本）存檔，之後不載入上游直接重用，保留一代備份與收藏。
- **Show Any / Show Any Lite**：任何型別都能接，顯示並直通輸出，有剪下、複製、貼上。
- **Remote Int / Float / String / Boolean**：同名 channel 的分身互相同步（含子圖），任一顆接線就由該上游控制整組。
- **Remote Text Switch**：Text Switch 遙控器，顯示選中框的編號與標題。
- **Counter**：每次送出計數，可設範圍、每個數字維持幾次、按鈕歸零、上游歸零、每小時或每天自動歸零；bypass 時停住。
- **Trigger**：按鈕或上游改變時輸出新值，接 Counter 的 reset。
- **Number**：一個數字同時輸出 INT、FLOAT、STRING。

### 備註

- 節點說明以英文為主，附繁體中文、簡體中文與日文翻譯：ComfyUI 語言設為其中一種時自動切換。

### 授權

Copyright (C) 2026 GeN's Studio Inc.

採用 GNU General Public License v3.0（與 ComfyUI 本體相同）。可以自由使用、修改、分享，也可以用於商業案子；但若散布修改過的版本，必須同樣以 GPL-3.0 公開原始碼。全文見 [LICENSE](LICENSE)。
