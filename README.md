<p align="center"><img src="docs/banner.jpg" alt="ComfyUI-GeN13" width="100%"></p>

<p align="center"><b>English</b> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a></p>

# ComfyUI-GeN13

Custom nodes for ComfyUI, built around image-to-video and portrait workflows: remote controls that keep one value in sync across a large graph, chainable prompt switching, image nodes that hide their preview, temporal color matching for generated video, portrait retouching, and a live resource monitor beside the Run button.

Every node's display name ends with **(GeN13)**: double-click the canvas and type `GeN13` to list them all.

## Highlights

### Monitor: your whole machine, at a glance

A live strip beside the Run button. RUN shows the running node, the elapsed time, the overall progress of the whole prompt and how many prompts are waiting, including prompts queued from a phone page, the API or another browser tab. Progress is estimated from earlier runs of the same workflow, so the bar moves steadily instead of jumping node by node, and the last bar stays after the run; click it to jump to a node run from this tab. CPU, RAM, GPU, VRAM and power each get a value, a trend line and a usage bar, and turn red before trouble: RAM and VRAM at 95%, the GPU at 83 °C. It is not a node, so nothing goes on the canvas. Show or hide each cell and set the refresh rate in Settings → GeN13 → Monitor.

<p align="center"><img src="docs/monitor.gif" alt="Monitor during a run" width="100%"></p>

<p align="center"><img src="docs/monitor.png" alt="Monitor in dark and light themes" width="100%"></p>

| GPU | What the monitor reads |
|---|---|
| NVIDIA (Windows, Linux) | Usage, core temperature, VRAM, power and power limit, through NVML (`nvidia-ml-py`) |
| AMD on Linux | Usage, temperature, VRAM, power and power limit, from the amdgpu driver; nothing to install |
| AMD or Intel on Windows | Usage and VRAM, from the same Windows counters as Task Manager; Windows does not publish their temperature or power |
| Apple silicon, CPU only | RUN, CPU and RAM |

A cell the machine cannot read is hidden, never shown empty.

### Remote: set it once, control it anywhere

Put a Remote Int / Float / String / Boolean next to every place that needs the same value. Clones that share a `channel` name stay in sync: value, step and bypass. Change any clone and every clone follows, even inside subgraphs. No more long wires across the whole graph, and no more scrolling back to one setting.

<p align="center"><img src="docs/remote.gif" alt="Remote demo" width="80%"></p>

<p align="center"><img src="docs/remote.png" alt="Remote nodes compared with a single Primitive" width="100%"></p>

### Text Switch: switch prompts, chain without limits

Type prompts straight into named boxes and output the one you pick. Chain nodes side by side for as many boxes as you need; numbering continues across the chain and the first node, or a Remote Text Switch anywhere on the canvas, picks the box. `auto next` steps to the next filled box on every queue, and only the selected box's upstream runs. The first node has a pick row, ‹ #07 title ›, so the selected box stays in view even in a long chain; ‹ › skip empty boxes. Click a selected #NN again to fold it, EXPAND ALL / COLLAPSE ALL act on the whole chain, right-click → Clear all boxes empties one node, and dragging the chain output onto empty canvas adds the next node already linked.

<p align="center"><img src="docs/textswitch.gif" alt="Text Switch demo" width="80%"></p>

<p align="center"><img src="docs/textswitch.png" alt="Text Switch chain with Remote Text Switch" width="100%"></p>

### Private image nodes: screen-share without showing your images

Load, Save and Preview Image Private cover the node preview with a mosaic, frosted glass, gradient, palette or solid color. Press and hold the preview to peek at the original. The image itself is never changed, so streaming or sharing your screen is safe.

<p align="center"><img src="docs/privacy.gif" alt="Privacy demo" width="80%"></p>

<p align="center"><img src="docs/privacy.jpg" alt="Privacy cover styles" width="100%"></p>

### Color Match Temporal: stop image-to-video color drift

Generated video often turns bluer or warmer as it plays. Color Match Temporal pulls every frame back to the first-frame image, smoothed over time so nothing flickers. The default `white balance` method fixes color cast only and keeps the video's own brightness. It measures drift on background pixels that did not move, so a big white shirt or a close-up cannot fool it, and after a scene cut each shot is matched to its own start. `skin_anchor` then shifts each frame so the skin matches the reference skin, which fixes skin redrawn redder after a cut to a close-up.

<p align="center"><img src="docs/colormatch.jpg" alt="Simulated color drift corrected by Color Match Temporal" width="100%"></p>

### Degrease: clean skin, untouched features

Removes the greasy, over-detailed look of generated portraits and video. Six effects, each from 0 (off) to 100 (full): deblemish, smooth, deshine, even tone, decontour and cool fair, which moves skin toward a lighter, cooler tone and keeps the lips' color. Eyes, lashes, brows and lips are protected, and only skin is touched.

<p align="center"><img src="docs/degrease.jpg" alt="Degrease effects from 0 to 100" width="100%"></p>

### Faster wiring

Drop a link on empty canvas and the GeN13 nodes that fit that slot are listed first, in both the search box and the link menu, and the link lands on the input it is meant for (Trigger → Counter `reset`, Remote Text Switch → Text Switch `select_num`). Right-click a built-in Load / Save / Preview Image or a Primitive to convert it in place to the Private or Remote version, settings and links kept. Both can be turned off in Settings → GeN13 → Links.

## Install

**ComfyUI Manager**: search for `GeN13` and install.

**Manual**:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/heigen13/ComfyUI-GeN13
pip install -r ComfyUI-GeN13/requirements.txt
```

Restart ComfyUI. ComfyUI Manager also installs the one extra package, `nvidia-ml-py` (NVIDIA's NVML library, which the monitor uses to read GPU usage, temperature and power on NVIDIA cards). For a manual install, run the `pip` line above with ComfyUI's own Python (portable build: `python_embeded\python.exe -m pip`). Everything else uses what ComfyUI already ships (torch, numpy, Pillow, psutil).
Optional: the `nvidia_rtx_vsr` upscale method in **Resize** needs the `nvidia-vfx` package and an RTX GPU.

**Example workflows**: four ready-made workflows (Text Switch chain, Remote two-pass txt2img, portrait retouch, video color match) are in the ComfyUI Templates panel under ComfyUI-GeN13, or in [`example_workflows`](example_workflows).

## All nodes

### Video / color

| Node | What it does |
|---|---|
| **Color Match Temporal** | Matches generated video frames to a reference image (usually the first frame), smoothed over time. `white balance` fixes color cast only; `mkl` and `reinhard` also match brightness. Detects scene cuts. `skin_anchor` pulls skin back to the reference skin tone. Can export a `.cube` LUT. |
| **Degrease** | Portrait retouch for images and video: deblemish, smooth, deshine, even tone, decontour and cool fair, each 0 = off. Facial features are protected and only skin is touched. |
| **Remote Video** | Scales the first frame to an aspect ratio and megapixels, outputs width, height, seconds, FPS and a valid frame count for MiniMax H3, Wan 2.1 / 2.2 or LTX. Clones with the same channel stay in sync. |

### Image

| Node | What it does |
|---|---|
| **Load Image Private** | Load Image with a privacy cover on the node preview. Hold the preview to reveal the original. Outputs width and height. Drag and drop or upload. |
| **Save Image Private** | Saves PNG, JPG, BMP or PNG + JPG with a custom prefix, padding and quality, with the same privacy preview. |
| **Preview Image Private** | Preview (temporary, not saved to output) with the privacy cover. |
| **Load Latest Image Private** | Picks images from a folder by newest, oldest or name, with filename filters, subfolders and batch loading; files still being written are skipped. |
| **Load Image Orient** | Plain loader that decodes with Pillow only, so iOS screenshots are not rotated. |
| **Load Image SD** | Loads an image and reads its A1111 / Forge generation parameters (prompt, negative, seed, steps, CFG, sampler, scheduler, size, clip skip) to recreate old images in ComfyUI. |

### Latent

| Node | What it does |
|---|---|
| **Resize** | One node for latent size: empty latent, image + VAE encode, or rescale an existing latent. Aspect presets with width, height and megapixels linked, crop / resize / pad / pad_edge / stretch, multiple of 8 to 64. Resizes up to four images and a mask with the same settings. |

### Text

| Node | What it does |
|---|---|
| **Text Switch** | Up to 25 named, collapsible prompt boxes per node; chain nodes for more. A pick row ‹ › on the first node, `auto next` and `select_num` (INT input) drive the selection. Right-click → Clear all boxes. |
| **Text Concatenate** | Type text in boxes and join them; per-box on/off and solo, empty boxes skipped. |
| **Prompt Cache** | Saves upstream text (for example an LLM-written script) to a file and replays it later without loading the upstream model. One rolling backup plus any number of favorites. |
| **Show Any** / **Show Any Lite** | Accept any type, display it and pass it through. Cut / copy / paste buttons; text is saved with the workflow. |

### Utilities and remotes

| Node | What it does |
|---|---|
| **Remote Int / Float / String / Boolean** | Clones that share a `channel` name stay in sync (value, step, bypass), even inside subgraphs. Wire any one clone and that input drives the whole group. |
| **Remote Text Switch** | Remote for Text Switch: shows the selected box's number and title; ‹ › skip empty boxes. Its `select_num` output goes to Text Switch's `select_num`; `auto next` is the same OFF / NEXT switch as on Text Switch. |
| **Counter** | Counts up or down per queue with ranges, hold (repeat each value N times), reset button, reset input and auto reset every hour or day. Freezes while bypassed. |
| **Trigger** | A button or an upstream change produces a new value; connect it to Counter's reset. |
| **Number** | One number out as INT, FLOAT and STRING, with a choice of rounding. |
| **Switch Any** | Picks one of any number of inputs by number, any type. Only the selected input runs; an `index` output lets two switches follow each other. Inputs can be renamed. |

## Notes

- Tooltips and descriptions are in English, with translations in Traditional Chinese, Simplified Chinese and Japanese, shown when the ComfyUI language is set to one of them.
- Built and tested on ComfyUI 0.40 with the classic canvas (Nodes 1.0). Nodes 2.0 is supported for the image previews.
- The Remote and Text Switch pictures are diagrams; the privacy, color match and degrease examples are real node output, and the monitor pictures are the real strip drawn with sample readings.

## Support

GeN13 is free. If these nodes save you time, you can buy me a coffee on Ko-fi.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/gen13)

## Disclaimer

GeN13 is provided as is, without warranty of any kind (see sections 15 and 16 of the GPL-3.0). You are responsible for how you use it and for following the laws where you live. Do not use it to create or edit content that is illegal, infringes copyright or likeness rights, or depicts real people without their consent. The privacy cover only hides the on-screen preview; it does not encrypt or protect the image files.

## License

Copyright (C) 2026 GeN's Studio Inc.

Licensed under the GNU General Public License v3.0 (the same license as ComfyUI). You may use, modify and share these nodes, including for commercial work; if you distribute a modified version, it must also be released under GPL-3.0 with its source code. See [LICENSE](LICENSE).

Artwork in `docs/` © 2026 GeN's Studio Inc.
