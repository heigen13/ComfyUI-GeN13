# -*- coding: utf-8 -*-
"""
Load Image Private / Save Image Private / Preview Image Private
===============================================================
隱私預覽版的載入與存檔節點。預覽由 web/private_image.js 畫在節點上:
  - preview(SHOW / HIDE):一般收合。
  - privacy(ON / OFF):ON 時預覽顯示遮罩,按住預覽圖顯示原圖,放開恢復遮罩。
  - privacy_style:mosaic(長邊 8 格馬賽克)/ gradient(取色模糊漸層)/ solid(平均色)。
  以上三項只存在節點 properties,不進 API、不進 widgets_values,不影響工作流的欄位順序。

Load Image Private:
  - 不用核心的 image_upload 欄位(核心會在節點上直接畫出清楚原圖),改用節點上的上傳鈕與拖放。
  - 只走 Pillow + exif_transpose,不經 PyAV(避開 iOS 截圖 PNG 被轉 90° 的問題)。

Save Image Private:
  - 格式 PNG / JPG / BMP / PNG + JPG(同一流水號各存一張;PNG 含工作流,JPG 不含)。
  - 檔名 前綴_流水號.副檔名,流水號位數由 padding 決定,接續資料夾內同前綴的最大號。
  - 照樣回報輸出(ComfyUI 佇列面板與歷史紀錄看得到),但節點本身不畫核心預覽。

只依賴 torch、numpy、Pillow,不需額外安裝套件。
"""

import io
import json
import os
import random
import re

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence
from PIL.PngImagePlugin import PngInfo

import folder_paths
import node_helpers

from .image_io import list_input_images, load_image_file, file_signature

try:
    from comfy.cli_args import args as _cli_args
except Exception:  # noqa: BLE001
    _cli_args = None

FORMATS = ["PNG", "JPG", "BMP", "PNG + JPG"]
SAVE_EXTS = ("png", "jpg", "jpeg", "bmp")
THUMB_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}
THUMB_PX = 512
WIDTH_TIP = "寬度:影像寬度(px),批次以第一張為準。"
HEIGHT_TIP = "高度:影像高度(px),批次以第一張為準。"


_input_files = list_input_images


# --- Load Image Private ---------------------------------------------------------

class LoadImagePrivate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (_input_files(), {
                    "tooltip": "圖片:input 資料夾內的檔案,以節點上的上傳鈕或拖放加入。"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "MASK", "width", "height")
    OUTPUT_TOOLTIPS = ("影像:多幀檔輸出為批次。", "遮罩:透明區域為 1,無透明通道時全 0。",
                       WIDTH_TIP, HEIGHT_TIP)
    FUNCTION = "load"
    CATEGORY = "GeN13/image"
    DESCRIPTION = "載入圖片,節點預覽可切換隱私遮罩(馬賽克、漸層、純色),按住預覽圖顯示原圖。"

    def load(self, image):
        img, mask, w, h = load_image_file(folder_paths.get_annotated_filepath(image))
        return (img, mask, w, h)

    @classmethod
    def IS_CHANGED(cls, image):
        return file_signature(folder_paths.get_annotated_filepath(image))

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


# --- Save Image Private ---------------------------------------------------------

def _next_counter(folder, name):
    pat = re.compile(r"^%s_(\d+)\.(?:%s)$" % (re.escape(name), "|".join(SAVE_EXTS)), re.IGNORECASE)
    top = 0
    try:
        for f in os.listdir(folder):
            m = pat.match(f)
            if m:
                top = max(top, int(m.group(1)))
    except OSError:
        pass
    return top + 1


def _metadata_off():
    return bool(getattr(_cli_args, "disable_metadata", False)) if _cli_args else False


class SaveImagePrivate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "影像:要存檔的單張或批次。"}),
                "save": ("BOOLEAN", {
                    "default": True, "label_on": "SAVE", "label_off": "PREVIEW",
                    "tooltip": "存檔:SAVE 存入 output,PREVIEW 只暫存預覽(同 Preview Image)。"}),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI",
                    "tooltip": "檔名前綴:可含子資料夾,例如 PRIVATE/img。"}),
                "format": (FORMATS, {
                    "default": "PNG",
                    "tooltip": "格式:PNG + JPG 同一流水號各存一張,PNG 含工作流,JPG 不含。"}),
                "padding": ("INT", {
                    "default": 5, "min": 1, "max": 10, "step": 1,
                    "tooltip": "流水號位數:不足補零,4 為 0001。"}),
                "jpg_quality": ("INT", {
                    "default": 95, "min": 1, "max": 100, "step": 1,
                    "tooltip": "JPG 品質:數值越高畫質越好、檔案越大。"}),
                "png_compression": ("INT", {
                    "default": 4, "min": 0, "max": 9, "step": 1,
                    "tooltip": "PNG 壓縮:無失真,數值越高檔案越小、存檔越慢。"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "width", "height")
    OUTPUT_TOOLTIPS = ("影像:原樣傳出,可接後續節點。", WIDTH_TIP, HEIGHT_TIP)
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "GeN13/image"
    DESCRIPTION = "存檔為 PNG、JPG、BMP 或 PNG + JPG,節點預覽可切換隱私遮罩,按住預覽圖顯示原圖。"

    def save(self, images, save, filename_prefix, format, padding, jpg_quality, png_compression,
             prompt=None, extra_pnginfo=None):
        if not save:  # PREVIEW: temp only, same as Preview Image Private
            results = _save_temp(images, prompt, extra_pnginfo)
            return {"ui": {"images": results},
                    "result": (images, int(images.shape[2]), int(images.shape[1]))}
        out_dir = folder_paths.get_output_directory()
        full, name, _, sub, _ = folder_paths.get_save_image_path(
            filename_prefix, out_dir, images[0].shape[1], images[0].shape[0])
        os.makedirs(full, exist_ok=True)

        want_png = format in ("PNG", "PNG + JPG")
        want_jpg = format in ("JPG", "PNG + JPG")
        want_bmp = format == "BMP"
        exts = [e for e, on in (("png", want_png), ("jpg", want_jpg), ("bmp", want_bmp)) if on]

        meta = None
        if want_png and not _metadata_off():
            meta = PngInfo()
            if prompt is not None:
                meta.add_text("prompt", json.dumps(prompt))
            if extra_pnginfo is not None:
                for k in extra_pnginfo:
                    meta.add_text(k, json.dumps(extra_pnginfo[k]))

        counter = _next_counter(full, name)
        results = []
        for image in images:
            arr = np.clip(255.0 * image.cpu().numpy(), 0, 255).astype(np.uint8)
            im = Image.fromarray(arr)
            while True:
                base = "%s_%0*d" % (name, padding, counter)
                if not any(os.path.exists(os.path.join(full, base + "." + e)) for e in exts):
                    break
                counter += 1
            files = []
            if want_png:
                im.save(os.path.join(full, base + ".png"), pnginfo=meta, compress_level=png_compression)
                files.append(base + ".png")
            if want_jpg:
                im.convert("RGB").save(os.path.join(full, base + ".jpg"), quality=jpg_quality,
                                       subsampling=0 if jpg_quality >= 90 else 2, optimize=True)
                files.append(base + ".jpg")
            if want_bmp:
                im.convert("RGB").save(os.path.join(full, base + ".bmp"))
                files.append(base + ".bmp")
            results.append({"filename": files[0], "subfolder": sub, "type": "output"})
            counter += 1

        print("[Save Image Private (GeN13)] %s%s" % (
            results[0]["filename"], "" if len(results) == 1 else " +%d" % (len(results) - 1)))
        return {"ui": {"images": results},
                "result": (images, int(images.shape[2]), int(images.shape[1]))}


def _save_temp(images, prompt=None, extra_pnginfo=None):
    """存到 temp 資料夾(ComfyUI 重開即清),回傳 ui images 清單。"""
    temp_dir = folder_paths.get_temp_directory()
    prefix = "ComfyUI_temp_" + "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5))
    full, name, counter, sub, _ = folder_paths.get_save_image_path(
        prefix, temp_dir, images[0].shape[1], images[0].shape[0])
    os.makedirs(full, exist_ok=True)
    meta = None
    if not _metadata_off():
        meta = PngInfo()
        if prompt is not None:
            meta.add_text("prompt", json.dumps(prompt))
        if extra_pnginfo is not None:
            for k in extra_pnginfo:
                meta.add_text(k, json.dumps(extra_pnginfo[k]))
    results = []
    for image in images:
        arr = np.clip(255.0 * image.cpu().numpy(), 0, 255).astype(np.uint8)
        fname = "%s_%05d_.png" % (name, counter)
        Image.fromarray(arr).save(os.path.join(full, fname), pnginfo=meta, compress_level=1)
        results.append({"filename": fname, "subfolder": sub, "type": "temp"})
        counter += 1
    return results


# --- Preview Image Private --------------------------------------------------------

class PreviewImagePrivate:
    """同核心 Preview Image:存到 temp 資料夾(ComfyUI 重開即清),節點預覽可加隱私遮罩。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"images": ("IMAGE", {"tooltip": "影像:要預覽的單張或批次。"})},
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "width", "height")
    OUTPUT_TOOLTIPS = ("影像:原樣傳出,可接後續節點。", WIDTH_TIP, HEIGHT_TIP)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "GeN13/image"
    DESCRIPTION = "預覽圖片(暫存,不存入 output),節點預覽可切換隱私遮罩,按住預覽圖顯示原圖。"

    def preview(self, images, prompt=None, extra_pnginfo=None):
        results = _save_temp(images, prompt, extra_pnginfo)
        return {"ui": {"images": results},
                "result": (images, int(images.shape[2]), int(images.shape[1]))}


# --- 預覽縮圖(web/private_image.js 呼叫) ---------------------------------------
# /gen13/private/thumb?type=input|output|temp&filename=&subfolder=
# 只回傳該類資料夾內的圖片檔(擋 ..、絕對路徑)。

def _resolve(kind, filename, subfolder):
    if kind not in ("input", "output", "temp"):
        raise PermissionError("bad type")
    base = folder_paths.get_directory_by_type(kind)
    if not base or not filename:
        raise FileNotFoundError("missing")
    if filename.endswith("]") and " [" in filename:  # "name.png [input]" 標註
        filename = filename[:filename.rindex(" [")]
    base = os.path.realpath(base)
    path = os.path.realpath(os.path.join(base, subfolder or "", filename))
    if os.path.commonpath([base, path]) != base:
        raise PermissionError("outside")
    if os.path.splitext(path)[1].lower() not in THUMB_EXTS or not os.path.isfile(path):
        raise FileNotFoundError("missing")
    return path


def _thumb(path):
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(next(ImageSequence.Iterator(im)))
        size = im.size
        if im.mode in ("I;16", "I;16B", "I;16L", "I"):
            im = im.point(lambda p: p * (1 / 256)).convert("L")
        if "A" in im.getbands() or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (32, 32, 32))
            bg.paste(rgba, mask=rgba.getchannel("A"))
            im = bg
        im = im.convert("RGB")
        im.thumbnail((THUMB_PX, THUMB_PX), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=88)
        return buf.getvalue(), size


try:
    import asyncio
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.get("/gen13/private/thumb")
    async def _private_thumb_route(request):
        q = request.rel_url.query
        try:
            path = _resolve(q.get("type", "input"), q.get("filename", ""), q.get("subfolder", ""))
            body, (w, h) = await asyncio.get_running_loop().run_in_executor(None, _thumb, path)
        except Exception:
            return web.Response(status=404)
        return web.Response(body=body, content_type="image/jpeg",
                            headers={"Cache-Control": "no-store",
                                     "X-Image-Width": str(w), "X-Image-Height": str(h)})
except Exception as err:  # noqa: BLE001
    print("[Image Private (GeN13)] preview endpoint unavailable:", err)


NODE_CLASS_MAPPINGS = {
    "LoadImagePrivateGeN13": LoadImagePrivate,
    "SaveImagePrivateGeN13": SaveImagePrivate,
    "PreviewImagePrivateGeN13": PreviewImagePrivate,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImagePrivateGeN13": "Load Image Private (GeN13)",
    "SaveImagePrivateGeN13": "Save Image Private (GeN13)",
    "PreviewImagePrivateGeN13": "Preview Image Private (GeN13)",
}
