# -*- coding: utf-8 -*-
"""
Resize
======
一顆決定送進 KSampler 的 latent 尺寸,同時縮放 IMAGE / MASK / LATENT。
  - mode:I2I(圖生圖)/ T2I(文生圖)。
    T2I:圖片一律送空值(None,下游當作沒接,如 Qwen Image 2.1 會略過),LATENT 為空 latent,
    尺寸規則同沒有來源圖:aspect_ratio 為 1:1 / 3:2 / 4:3 / 16:9 / 21:9 時依 megapixels 算寬高、
    keep / custom 時直接用 width × height(往下取 multiple_of 的倍數)。縮放演算法等欄位不作用。
    I2I 但收不到圖(沒接或上游被關掉)也照同一套尺寸規則,圖片同樣送空值。
  - 沒接的 image2~4 一律送空值,不送佔位圖。
    有接 vae 時依 VAE 的通道數與縮放倍率建立(Flux2 等 16 倍模型也正確);
    沒接 vae 時與核心 Empty Latent Image 同格式(4 通道、/8,帶 downscale_ratio_spacial),
    由核心 KSampler 依模型自動補成正確格式。
  - 接 image1(+ mask):縮放到目標尺寸;比例不同時 crop / resize / pad / pad_edge / stretch。
    再接 vae 就把縮放後的圖 encode 成 latent(圖生圖),IMAGE 輸出即實際 encode 的那張,
    可直接接參考圖,尺寸保證一致。
  - 接 samples:縮放既有 latent(noise_mask 一併縮放);同時接 image1 + vae 時改用圖片重新 encode。
    latent 的像素倍率取 samples 的 downscale_ratio_spacial,沒有就取 vae 的縮放倍率,都沒有才以 8 計算
    (VAEEncode 出來的 latent 不帶倍率,Flux.2、HunyuanImage 2.1 等非 8 倍 VAE 的模型務必一併接 vae)。
  - image2~4:套用同一組設定、依各自原圖比例縮放(例:keep + 1.0 MP 時每張約 1 MP、各自比例),
    給 Qwen Edit / Flux2 多參考圖用;latent、遮罩、寬高只依 image1。
  - aspect_ratio = keep:依 keep_size 決定尺寸;original 時只置中裁到 multiple_of 的倍數、不重新取樣
    (像素對齊),megapixels 依像素量,long_edge / short_edge 長邊或短邊等於 edge_length。
  - 演算法含 lanczos 與 nvidia_rtx_vsr(需 nvidia-vfx);latent 照選的演算法縮放(lanczos、nvidia_rtx_vsr 退回 bicubic),pad 以邊緣延伸補。

比例橫直都列;invert 只是前端按鈕(16:9 ↔ 9:16、custom 時對調 width / height),不是後端欄位。只依賴 torch。
"""

import math

import torch

import comfy.model_management
import comfy.utils

RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "custom"]
RESIZE_RATIOS = ["keep"] + RATIOS
MULTIPLES = ["8", "16", "32", "64"]
KEEP_SIZES = ["original", "megapixels", "long_edge", "short_edge"]
UPSCALE_METHODS = ["nearest-exact", "bilinear", "area", "bicubic", "bislerp"]
MAX_RES = 16384

WIDTH_TIP = "Width: actual output width in px."
HEIGHT_TIP = "Height: actual output height in px."


def _snap(v, m):
    return max(m, int(round(v / m)) * m)


def _floor(v, m):
    return max(m, int(v) // m * m)


def target_size(aspect_ratio, megapixels, width, height, multiple, src=None,
                keep_size="megapixels", edge_length=1024):
    """回傳對齊 multiple 的 (w, h)。src=(w, h) 供 keep 使用。"""
    if aspect_ratio == "custom":  # custom 直接用 width / height(往下取倍數,不超出)
        return _floor(width, multiple), _floor(height, multiple)
    if aspect_ratio == "keep" and src and keep_size == "original":
        return _floor(src[0], multiple), _floor(src[1], multiple)
    if aspect_ratio == "keep" and src and keep_size in ("long_edge", "short_edge"):
        sw, sh = src
        edge = max(sw, sh) if keep_size == "long_edge" else min(sw, sh)
        k = float(edge_length) / edge
        return _snap(sw * k, multiple), _snap(sh * k, multiple)
    if aspect_ratio == "keep" and src:
        a, b = src
    else:
        a, b = (float(x) for x in (aspect_ratio if aspect_ratio != "keep" else "1:1").split(":"))
    total = 1024 * 1024 * float(megapixels)
    w = math.sqrt(total * a / b)
    h = total / w
    return _snap(w, multiple), _snap(h, multiple)


def _empty_latent(batch, w, h, vae=None):
    """空 latent。接了圖片 VAE 就用它的通道數與倍率;否則 4 通道 /8,交給 KSampler 補。"""
    dev = comfy.model_management.intermediate_device()
    dt = comfy.model_management.intermediate_dtype()
    if vae is not None:
        try:
            if int(getattr(vae, "latent_dim", 2)) == 2:
                c = int(vae.spacial_compression_encode())
                ch = int(vae.latent_channels)
                return {"samples": torch.zeros([batch, ch, h // c, w // c], device=dev, dtype=dt),
                        "downscale_ratio_spacial": c}
        except Exception:  # noqa: BLE001
            pass
    return {"samples": torch.zeros([batch, 4, h // 8, w // 8], device=dev, dtype=dt),
            "downscale_ratio_spacial": 8}


def _center_crop(img, w, h):
    """img: B,H,W,C;裁到 (w, h) 以內,不足的一邊保持原樣。"""
    H, W = img.shape[1], img.shape[2]
    y = max(0, (H - h) // 2)
    x = max(0, (W - w) // 2)
    return img[:, y:y + min(h, H), x:x + min(w, W), :]


IMAGE_METHODS = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos", "nvidia_rtx_vsr"]
FIT_MODES = ["crop", "resize", "pad", "pad_edge", "stretch"]
POSITIONS = ["center", "top", "bottom", "left", "right"]


def _parse_color(text):
    t = (text or "").strip()
    try:
        if t.startswith("#") and len(t) == 7:
            return [int(t[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
        vals = [float(v) for v in t.replace(";", ",").split(",") if v.strip()]
        if len(vals) == 1:
            vals = vals * 3
        return [max(0.0, min(255.0, v)) / 255.0 for v in vals[:3]]
    except ValueError:
        return [0.0, 0.0, 0.0]


def _offset(free, pos, axis):
    """free 為多出的像素;axis 'x' 或 'y';回傳起點。"""
    if axis == "x":
        return 0 if pos == "left" else free if pos == "right" else free // 2
    return 0 if pos == "top" else free if pos == "bottom" else free // 2


def _vsr(img, w, h):
    """NVIDIA RTX Video Super Resolution(需 nvidia-vfx 套件與 RTX 顯卡)。img: B,H,W,3。"""
    try:
        import nvvfx
    except ImportError as err:
        raise ImportError("Resize: nvidia_rtx_vsr needs the nvidia-vfx package "
                          "and an NVIDIA RTX GPU") from err
    vw, vh = max(8, round(w / 8) * 8), max(8, round(h / 8) * 8)
    frames = []
    with nvvfx.VideoSuperRes(nvvfx.effects.QualityLevel.ULTRA) as sr:
        sr.output_width, sr.output_height = vw, vh
        sr.load()
        chw = img[..., :3].movedim(-1, 1).cuda().contiguous()
        for j in range(chw.shape[0]):
            frames.append(torch.from_dlpack(sr.run(chw[j]).image).clone())
    out = torch.stack(frames, 0).cpu()
    if (vw, vh) != (w, h):
        out = comfy.utils.common_upscale(out, w, h, "bicubic", "disabled")
    return out.movedim(1, -1).clamp(0, 1)


def _scale_img(img, w, h, method):
    if img.shape[2] == w and img.shape[1] == h:
        return img
    if method == "nvidia_rtx_vsr":
        out = _vsr(img, w, h)
        if img.shape[-1] > 3:  # alpha 等多出的通道以 bicubic 跟著縮,不丟掉
            extra = comfy.utils.common_upscale(img[..., 3:].movedim(-1, 1), w, h, "bicubic", "disabled").movedim(1, -1)
            out = torch.cat([out, extra.to(out.dtype)], dim=-1)
        return out
    return comfy.utils.common_upscale(img.movedim(-1, 1), w, h, method, "disabled").movedim(1, -1)


def _scale_mask(mask, w, h):
    if mask.shape[-1] == w and mask.shape[-2] == h:
        return mask
    return comfy.utils.common_upscale(mask.unsqueeze(1), w, h, "bilinear", "disabled").squeeze(1)


def fit_image(img, mask, w, h, mode, pos, method, pad_color):
    """img: B,H,W,C;mask: B,H,W 或 None。回傳 (image, mask) 皆為 (w, h)。"""
    H, W = img.shape[1], img.shape[2]
    if mask is not None:
        mask = mask.reshape(-1, mask.shape[-2], mask.shape[-1])
        if mask.shape[-2:] != (H, W):
            mask = _scale_mask(mask, W, H)
    if mode == "crop":
        if W * h > H * w:  # 原圖較寬
            cw, ch = round(H * w / h), H
        else:
            cw, ch = W, round(W * h / w)
        x, y = _offset(W - cw, pos, "x"), _offset(H - ch, pos, "y")
        img = img[:, y:y + ch, x:x + cw, :]
        if mask is not None:
            mask = mask[:, y:y + ch, x:x + cw]
        return _scale_img(img, w, h, method), (None if mask is None else _scale_mask(mask, w, h))
    if mode == "stretch":
        return _scale_img(img, w, h, method), (None if mask is None else _scale_mask(mask, w, h))
    # pad / pad_edge:等比縮進框內,其餘補邊
    k = min(w / W, h / H)
    nw, nh = max(1, round(W * k)), max(1, round(H * k))
    img = _scale_img(img, nw, nh, method)
    mask = None if mask is None else _scale_mask(mask, nw, nh)
    x, y = _offset(w - nw, pos, "x"), _offset(h - nh, pos, "y")
    pads = (x, w - nw - x, y, h - nh - y)  # left, right, top, bottom
    t = img.movedim(-1, 1)
    if mode == "pad_edge":
        t = torch.nn.functional.pad(t, pads, mode="replicate")
    else:
        rgb = _parse_color(pad_color) + [1.0] * max(0, t.shape[1] - 3)
        canvas = torch.tensor(rgb[:t.shape[1]], dtype=t.dtype, device=t.device).view(1, -1, 1, 1).expand(t.shape[0], -1, h, w).clone()
        canvas[:, :, y:y + nh, x:x + nw] = t
        t = canvas
    if mask is None:
        mask = torch.zeros((img.shape[0], nh, nw), dtype=torch.float32, device=img.device)
    mask = torch.nn.functional.pad(mask.unsqueeze(1), pads, value=1.0).squeeze(1)  # 補出來的區域遮罩為 1
    return t.movedim(1, -1), mask


def fit_latent(s, lw, lh, mode, pos, method):
    """latent 縮放:crop / stretch;pad 類在 latent 一律以邊緣延伸補(latent 的 0 不是黑色)。"""
    method = method if method in UPSCALE_METHODS else "bicubic"
    H, W = s.shape[-2], s.shape[-1]
    if mode == "crop":
        if W * lh > H * lw:
            cw, ch = max(1, round(H * lw / lh)), H
        else:
            cw, ch = W, max(1, round(W * lh / lw))
        x, y = _offset(W - cw, pos, "x"), _offset(H - ch, pos, "y")
        s = s[..., y:y + ch, x:x + cw]
        return comfy.utils.common_upscale(s, lw, lh, method, "disabled")
    if mode == "stretch":
        return comfy.utils.common_upscale(s, lw, lh, method, "disabled")
    k = min(lw / W, lh / H)
    nw, nh = max(1, round(W * k)), max(1, round(H * k))
    s = comfy.utils.common_upscale(s, nw, nh, method, "disabled")
    x, y = _offset(lw - nw, pos, "x"), _offset(lh - nh, pos, "y")
    shape = s.shape
    flat = s.reshape(shape[0], -1, shape[-2], shape[-1])
    flat = torch.nn.functional.pad(flat, (x, lw - nw - x, y, lh - nh - y), mode="replicate")
    return flat.reshape(shape[:-2] + (lh, lw))


class Resize:
    """決定 latent 尺寸:空 latent、圖片 encode、或縮放既有 latent;IMAGE / MASK 一併縮放。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": ("BOOLEAN", {
                    "default": True, "label_on": "I2I", "label_off": "T2I",
                    "tooltip": "Mode: I2I (image to image) scales from the input image. T2I (text to image) outputs no image; size comes from the ratio or width and height."}),
                "aspect_ratio": (RESIZE_RATIOS, {
                    "default": "keep",
                    "tooltip": "Aspect ratio: keep follows the source image; custom uses width and height. In T2I, keep acts as custom."}),
                "megapixels": ("FLOAT", {
                    "default": 1.0, "min": 0.1, "max": 16.0, "step": 0.05,
                    "tooltip": "Megapixels: total pixel count; 1.0 is about 1024×1024. Updates when width or height is typed. Not used with custom."}),
                "width": ("INT", {
                    "default": 2048, "min": 16, "max": MAX_RES, "step": 8,
                    "tooltip": "Width: output width; with a ratio selected, typing one side sets the other. Can be connected."}),
                "height": ("INT", {
                    "default": 1152, "min": 16, "max": MAX_RES, "step": 8,
                    "tooltip": "Height: output height; with a ratio selected, typing one side sets the other. Can be connected."}),
                "multiple_of": (MULTIPLES, {
                    "default": "32",
                    "tooltip": "Multiple of: width and height are rounded down to this. Qwen Image 2.1 uses 32, Flux 16, SD 8."}),
                "batch_size": ("INT", {
                    "default": 1, "min": 1, "max": 64,
                    "tooltip": "Batch size: number of empty latents or encoded images. Not used when samples is connected."}),
                "upscale_method": (IMAGE_METHODS, {
                    "default": "lanczos",
                    "tooltip": "Scaling method: lanczos is the sharpest; nvidia_rtx_vsr needs an RTX GPU. Latents use bicubic for these two."}),
                "keep_proportion": (FIT_MODES, {
                    "default": "crop",
                    "tooltip": "When ratios differ: crop trims, resize fits inside, pad fills with color, pad_edge extends the edges, stretch distorts."}),
                "crop_position": (POSITIONS, {
                    "default": "center",
                    "tooltip": "Position: the area kept when cropping, or where the image sits when padding."}),
                "pad_color": ("STRING", {
                    "default": "0, 0, 0",
                    "tooltip": "Pad color: used by pad, as R, G, B (0–255) or #RRGGBB."}),
                "keep_size": (KEEP_SIZES, {
                    "default": "original",
                    "tooltip": "Keep size: original crops to the multiple without resampling; megapixels targets a pixel count; long_edge / short_edge use edge_length."}),
                "edge_length": ("INT", {
                    "default": 1024, "min": 16, "max": MAX_RES, "step": 8,
                    "tooltip": "Edge length: length in px of the long or short edge, when keep_size is long_edge or short_edge."}),
            },
            "optional": {
                "image1": ("IMAGE", {"tooltip": "Main image: sets the latent, mask, width and height; with vae connected, it is encoded into the latent."}),
                "image2": ("IMAGE", {"tooltip": "Reference image: scaled with the same settings, keeping its own aspect ratio."}),
                "image3": ("IMAGE", {"tooltip": "Reference image: scaled with the same settings, keeping its own aspect ratio."}),
                "image4": ("IMAGE", {"tooltip": "Reference image: scaled with the same settings, keeping its own aspect ratio."}),
                "mask": ("MASK", {"tooltip": "Mask: scaled together with image1; padded areas are 1."}),
                "samples": ("LATENT", {"tooltip": "Latent: an existing latent to resize; with image1 and vae connected, the image is encoded instead. Flux.2 and HunyuanImage 2.1 need vae."}),
                "vae": ("VAE", {"tooltip": "VAE: encodes image1 when connected; without an image, it builds an empty latent in the model's format."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "MASK", "LATENT", "INT", "INT")
    RETURN_NAMES = ("IMAGE1", "IMAGE2", "IMAGE3", "IMAGE4", "MASK", "LATENT", "width", "height")
    OUTPUT_TOOLTIPS = (
        "Main image: the scaled image1, exactly what was encoded. Empty in T2I or without an image.",
        "Reference image: the scaled image2. Empty in T2I or when not connected.",
        "Reference image: the scaled image3. Empty in T2I or when not connected.",
        "Reference image: the scaled image4. Empty in T2I or when not connected.",
        "Mask: the scaled mask, following image1; all 0 without a mask, padded areas are 1.",
        "Latent: the encoded image1 with vae, the resized samples, or otherwise an empty latent.",
        WIDTH_TIP, HEIGHT_TIP,
    )
    FUNCTION = "make"
    CATEGORY = "GeN13/latent"
    DESCRIPTION = "Sets the latent size in one node: an empty latent, an encoded image, or a resized existing latent. Images and masks are scaled along, with crop, pad or stretch."

    def make(self, mode, aspect_ratio, megapixels, width, height, multiple_of, batch_size,
             upscale_method, keep_proportion, crop_position, pad_color, keep_size, edge_length,
             image1=None, image2=None, image3=None, image4=None, mask=None, samples=None, vae=None):
        m = int(multiple_of)
        # 實際用到的數值(欄位可能接線),回報給前端狀態列
        params = [{"width": int(width), "height": int(height), "edge_length": int(edge_length),
                   "megapixels": float(megapixels)}]
        ratio = samples.get("downscale_ratio_spacial") if samples is not None else None
        if vae is not None:
            try:  # 對齊倍數至少要等於 VAE 的縮放倍率(如 Flux2 為 16)
                vr = int(vae.spacial_compression_encode())
                ratio = ratio or vr
                m = max(m, vr)
            except Exception:  # noqa: BLE001
                pass
        if samples is not None and ratio is None:
            print("[ComfyUI-GeN13] Resize: samples carries no scale factor and vae is not connected, assuming 8x; "
                  "connect vae for models whose VAE is not 8x, such as Flux.2 and HunyuanImage 2.1")
        ratio = int(ratio or 8)
        if samples is not None:
            m = max(m, ratio)
        image = image1
        extras = (image2, image3, image4)

        if image is not None:
            src = (image.shape[2], image.shape[1])
        elif samples is not None:
            st = samples["samples"]
            src = (st.shape[-1] * ratio, st.shape[-2] * ratio)
        else:
            src = (width, height)  # 沒接東西:keep 以 width / height 為原比例

        def plan(sw, sh, linked):
            """依來源尺寸算目標 (w, h, mode, original);image2~4 用同一組設定、各自比例。"""
            tw, th = target_size(aspect_ratio, megapixels, width, height, m, src=(sw, sh),
                                 keep_size=keep_size, edge_length=edge_length)
            orig = aspect_ratio == "keep" and keep_size == "original" and linked
            md = "stretch" if aspect_ratio == "keep" else keep_proportion
            if md == "resize":  # 維持原比例完整縮進 (w, h),不裁不補;尺寸取倍數且不超出框
                k = min(tw / sw, th / sh)
                tw = max(m, int(sw * k) // m * m)
                th = max(m, int(sh * k) // m * m)
                md = "stretch"
            return tw, th, md, orig

        def fit(img, mk, tw, th, md, orig):
            if orig and img.shape[1] >= th and img.shape[2] >= tw:
                oi = _center_crop(img, tw, th)  # 只裁到倍數,不重新取樣(像素對齊)
                om = None
                if mk is not None:
                    mk = mk.reshape(-1, mk.shape[-2], mk.shape[-1])
                    if mk.shape[-2:] != img.shape[1:3]:
                        mk = _scale_mask(mk, img.shape[2], img.shape[1])
                    om = _center_crop(mk.unsqueeze(-1), tw, th).squeeze(-1)
                return oi, om
            return fit_image(img, mk, tw, th, md, crop_position, upscale_method, pad_color)

        if not mode or (image is None and samples is None):
            # T2I(或 I2I 但收不到圖):依比例 + 像素量,keep 沒有來源可守就等同 custom(width × height)
            ratio = "custom" if aspect_ratio == "keep" else aspect_ratio
            w, h = target_size(ratio, megapixels, width, height, m)
            out_mask = torch.zeros([1, h, w], dtype=torch.float32)
            latent = _empty_latent(batch_size, w, h, vae)
            others = [None, None, None]
            if mode:  # I2I 沒有主圖時,有接的參考圖仍照設定送出(T2I 一律不送)
                for j, x in enumerate(extras):
                    if x is not None:
                        ew, eh, emd, eorig = plan(x.shape[2], x.shape[1], True)
                        others[j] = fit(x, None, ew, eh, emd, eorig)[0]
            ui = [[w, h]] + [None if o is None else [o.shape[2], o.shape[1]] for o in others]
            return {"ui": {"gen13_size": [w, h], "gen13_sizes": ui, "gen13_params": params},
                    "result": (None,) + tuple(others) + (out_mask, latent, w, h)}

        w, h, fmode, original = plan(src[0], src[1], image is not None or samples is not None)

        # IMAGE1 / MASK
        if image is not None:
            out_img, out_mask = fit(image, mask, w, h, fmode, original)
        else:  # 只接 samples:沒有圖可送
            out_img, out_mask = None, None
        if out_mask is None:
            out_mask = torch.zeros([out_img.shape[0] if out_img is not None else 1, h, w], dtype=torch.float32)
        elif out_img is not None and out_mask.shape[0] != out_img.shape[0]:  # 遮罩批次數跟著圖片
            out_mask = out_mask[torch.arange(out_img.shape[0]) % out_mask.shape[0]]

        # IMAGE2~4:同一組設定,依各自原圖比例
        others = []
        for x in extras:
            if x is None:
                others.append(None)  # 沒接:送空值,下游當作沒接
                continue
            ew, eh, emode, eorig = plan(x.shape[2], x.shape[1], True)
            others.append(fit(x, None, ew, eh, emode, eorig)[0])

        # LATENT(依 image1)
        if image is not None and vae is not None:
            t = vae.encode(out_img[..., :3])
            if t.shape[0] == 1 and batch_size > 1:
                t = t.repeat((batch_size,) + (1,) * (t.ndim - 1))
                out_img = out_img.repeat(batch_size, 1, 1, 1)
                out_mask = out_mask.repeat(batch_size, 1, 1)
            latent = {"samples": t}
            try:  # 帶上倍率:接到下一顆沒接 vae 的 Resize 時,Flux.2、HunyuanImage 2.1 的 16 倍才不會被當成 8 倍
                latent["downscale_ratio_spacial"] = int(vae.spacial_compression_encode())
            except Exception:  # noqa: BLE001
                pass
        elif samples is not None:
            latent = samples.copy()
            lmode = "crop" if original else fmode
            latent["samples"] = fit_latent(samples["samples"], w // ratio, h // ratio, lmode,
                                           crop_position, upscale_method)
            if "noise_mask" in latent:
                nm = latent["noise_mask"]
                nm = nm.reshape((-1, nm.shape[-2], nm.shape[-1]))
                _, nm2 = fit_image(torch.zeros([nm.shape[0], nm.shape[-2], nm.shape[-1], 3]), nm,
                                   w, h, lmode, crop_position, "bilinear", "0")
                latent["noise_mask"] = nm2.unsqueeze(1)
        else:
            latent = _empty_latent(batch_size, w, h, vae)
        ui = [[w, h]] + [None if x is None else [o.shape[2], o.shape[1]] for x, o in zip(extras, others)]
        return {"ui": {"gen13_size": [w, h], "gen13_sizes": ui, "gen13_params": params},
                "result": (out_img,) + tuple(others) + (out_mask, latent, w, h)}


NODE_CLASS_MAPPINGS = {"ResizeGeN13": Resize}
NODE_DISPLAY_NAME_MAPPINGS = {"ResizeGeN13": "Resize (GeN13)"}
