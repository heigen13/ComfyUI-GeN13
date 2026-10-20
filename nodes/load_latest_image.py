# -*- coding: utf-8 -*-
"""
Load Latest Image
=================
從指定資料夾依排序取圖,取代 comfy-load-last-image 的 Load Most Recent Image
(該 repo 已無法存取、不再更新)。

與舊節點的差異:
  - 排序可選:最新修改、最舊修改、檔名 A-Z、檔名 Z-A(檔名採自然排序,img2 排在 img10 前)。
  - 檔名篩選:萬用字元,例如 ComfyUI_*、*_upscale*;可用 ; 分隔多組。
  - 可含子資料夾。
  - 一次載入多張成批次(count),尺寸不同時縮放到第一張的尺寸。
  - 寫入中或損壞的檔自動略過、改取下一張(ComfyUI 正在存檔時不會讀到半張)。
  - 只走 Pillow + exif_transpose,不經 PyAV(避開 iOS 截圖 PNG 被轉 90° 的問題)。
  - 無透明通道時 mask 為全 0(與核心 Load Image 一致;舊節點給全 1 等於整張被遮)。
  - 多輸出:檔名、完整路徑、符合條件的總張數、寬、高。
  - 舊節點 *.png 與 *.PNG 在 Windows 重複抓到同一檔的問題,本節點以副檔名比對,不會發生。

節點預覽:web/load_latest_image.js 在節點上顯示目前會抓到的那張縮圖與檔名,
  欄位改變、每次生成完成、或按 refresh 時更新。

快取:IS_CHANGED 回傳選中檔案的路徑、修改時間與大小,資料夾有新圖就重跑,沒變就沿用快取。
資料夾掃描結果也有快取:資料夾(含子資料夾)的修改時間沒變就沿用上次的清單,幾千張時不必每次重掃。
只依賴 torch、numpy、Pillow,不需額外安裝套件。
"""

import fnmatch
import os
import re
import threading
import time

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths

DEFAULT_FOLDER = folder_paths.get_output_directory()
DEFAULT_EXT = "png,jpg,jpeg,webp,bmp,tif,tiff"
SORT_MODES = ["newest first", "oldest first", "name A-Z", "name Z-A"]
SETTLE_SEC = 1.0          # 修改時間在此秒數內的檔視為可能仍在寫入,讀取失敗時略過
MAX_COUNT = 64


def _natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def _parse_ext(text):
    exts = set()
    for e in (text or "").replace(";", ",").split(","):
        e = e.strip().lower().lstrip(".").lstrip("*").lstrip(".")
        if e:
            exts.add("." + e)
    return exts


def _parse_patterns(text):
    pats = [p.strip() for p in (text or "").split(";") if p.strip()]
    return pats or ["*"]


def _scan(folder, exts, patterns, subfolders):
    """回傳 ([(path, mtime, size, relname)], 掃過的資料夾 [(dir, mtime_ns)])。"""
    out, dirs = [], []
    stack = [folder]
    while stack:
        d = stack.pop()
        try:
            dirs.append((d, os.stat(d).st_mtime_ns))
            it = os.scandir(d)
        except OSError:
            continue
        with it:
            for e in it:
                try:
                    if e.is_dir(follow_symlinks=False):
                        if subfolders:
                            stack.append(e.path)
                        continue
                    if not e.is_file():
                        continue
                    if os.path.splitext(e.name)[1].lower() not in exts:
                        continue
                    if not any(fnmatch.fnmatch(e.name.lower(), p.lower()) for p in patterns):
                        continue
                    st = e.stat()
                    out.append((e.path, st.st_mtime, st.st_size,
                                os.path.relpath(e.path, folder)))
                except OSError:
                    continue
    return out, dirs


# 掃描快取:同一組(資料夾、副檔名、篩選、子資料夾)只要所有掃過的資料夾修改時間都沒變,
# 就沿用上次清單(資料夾有新增、刪除、改名檔案時修改時間一定會變)。
_SCAN_CACHE = {}
_SCAN_LOCK = threading.Lock()
_SCAN_CACHE_MAX = 16


def _scan_cached(folder, exts, patterns, subfolders):
    key = (os.path.normcase(folder), tuple(sorted(exts)), tuple(patterns), bool(subfolders))
    with _SCAN_LOCK:
        hit = _SCAN_CACHE.get(key)
    if hit is not None:
        files, dirs = hit
        try:
            if all(os.stat(d).st_mtime_ns == m for d, m in dirs):
                # the folder's mtime does not change when a file is overwritten in place (re-saved
                # from an editor under the same name): refresh each file's mtime / size before sorting
                fresh = []
                for path, _, _, rel in files:
                    st = os.stat(path)
                    fresh.append((path, st.st_mtime, st.st_size, rel))
                return fresh
        except OSError:
            pass
    files, dirs = _scan(folder, exts, patterns, subfolders)
    with _SCAN_LOCK:
        if len(_SCAN_CACHE) >= _SCAN_CACHE_MAX:
            _SCAN_CACHE.pop(next(iter(_SCAN_CACHE)))
        _SCAN_CACHE[key] = (files, dirs)
    return list(files)


def _sort(files, sort_by):
    if sort_by == "oldest first":
        files.sort(key=lambda f: (f[1], _natural_key(f[3])))
    elif sort_by == "name A-Z":
        files.sort(key=lambda f: _natural_key(f[3]))
    elif sort_by == "name Z-A":
        files.sort(key=lambda f: _natural_key(f[3]), reverse=True)
    else:  # newest first
        # 同一時間存的多張:檔名大的(流水號新的)在前
        files.sort(key=lambda f: (f[1], _natural_key(f[3])), reverse=True)
    return files


def _list(folder_path, sort_by, filename_filter, subfolders, extensions):
    folder = (folder_path or "").strip().strip('"')
    if not folder or not os.path.isdir(folder):
        raise ValueError("Load Latest Image Private: folder not found: %s" % folder)
    files = _scan_cached(folder, _parse_ext(extensions), _parse_patterns(filename_filter), subfolders)
    return folder, _sort(files, sort_by)


def _sig(path):
    """檔案簽章:路徑 + 修改時間 + 大小(重新 stat,不用掃描快取裡的舊值)。"""
    try:
        st = os.stat(path)
    except OSError:
        return path + ":missing"
    return "%s:%.3f:%d" % (path, st.st_mtime, st.st_size)


def _load_one(path):
    """讀整張圖;回傳 (image HxWx3, mask HxW)。多幀檔(GIF、APNG)只取第一幀。"""
    with Image.open(path) as img:
        img.load()
        frame = next(ImageSequence.Iterator(img))
        frame = ImageOps.exif_transpose(frame)
        if frame.mode == "I":
            frame = frame.point(lambda p: p * (1 / 255))
        if frame.mode in ("I;16", "I;16B", "I;16L"):
            arr16 = np.array(frame).astype(np.float32) / 65535.0
            rgb = np.repeat(arr16[..., None], 3, axis=2)
            return rgb, np.zeros(arr16.shape, dtype=np.float32)
        if frame.mode == "P" and "transparency" in frame.info:
            frame = frame.convert("RGBA")
        if "A" in frame.getbands():
            a = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - a
        else:
            mask = None
        rgb = np.array(frame.convert("RGB")).astype(np.float32) / 255.0
        if mask is None:
            mask = np.zeros(rgb.shape[:2], dtype=np.float32)
        return rgb, mask


def _resize(rgb, mask, w, h):
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    im = im.resize((w, h), Image.LANCZOS)
    mk = Image.fromarray(mask.astype(np.float32), mode="F").resize((w, h), Image.BILINEAR)
    return np.array(im).astype(np.float32) / 255.0, np.array(mk).astype(np.float32)


class LoadLatestImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {
                    "default": DEFAULT_FOLDER, "multiline": False,
                    "tooltip": "Folder: full path of the folder to load from."}),
                "sort_by": (SORT_MODES, {
                    "default": "newest first",
                    "tooltip": "Sort by: newest first puts the most recently saved file first; name sorts file names in natural order."}),
                "index": ("INT", {
                    "default": 0, "min": 0, "max": 99999, "step": 1,
                    "tooltip": "Index: position in the sort order; 0 is the first image, 1 the second, and so on."}),
                "count": ("INT", {
                    "default": 1, "min": 1, "max": MAX_COUNT, "step": 1,
                    "tooltip": "Count: images loaded in a row from index, as one batch. Different sizes are scaled to the first image."}),
                "filename_filter": ("STRING", {
                    "default": "*", "multiline": False,
                    "tooltip": "Filename filter: wildcards such as ComfyUI_*; separate multiple patterns with ;."}),
                "subfolders": ("BOOLEAN", {
                    "default": False, "label_on": "INCLUDE", "label_off": "EXCLUDE",
                    "tooltip": "Subfolders: INCLUDE also searches every subfolder below."}),
                "extensions": ("STRING", {
                    "default": DEFAULT_EXT, "multiline": False,
                    "tooltip": "Extensions: comma-separated, not case-sensitive."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING", "STRING", "INT")
    RETURN_NAMES = ("IMAGE", "MASK", "width", "height", "filename", "path", "total")
    OUTPUT_TOOLTIPS = (
        "Image: a single image or a batch.",
        "Mask: 1 in transparent areas; all 0 when the image has no alpha channel.",
        "Width: output image width in px.",
        "Height: output image height in px.",
        "Filename: name of the first image, without path.",
        "Path: full path of the first image.",
        "Total: number of matching files.",
    )
    FUNCTION = "load"
    CATEGORY = "GeN13/image"
    DESCRIPTION = "Loads images from a folder in sort order (newest, oldest or by name), with filename filters, subfolders and batch loading; files still being written or damaged are skipped."

    def load(self, folder_path, sort_by, index, count, filename_filter, subfolders, extensions):
        folder, files = _list(folder_path, sort_by, filename_filter, subfolders, extensions)
        _remember_folder(folder)          # 執行過的資料夾,節點預覽才能讀
        total = len(files)
        if total == 0:
            raise ValueError("Load Latest Image Private: no matching images in %s" % folder)
        if index >= total:
            raise ValueError("Load Latest Image Private: index %d out of range (%d images)" % (index, total))

        images, masks, picked = [], [], []
        w = h = None
        i = index
        now = time.time()
        while i < total and len(images) < count:
            path = files[i][0]
            i += 1
            try:
                rgb, mask = _load_one(path)
            except Exception as ex:
                fresh = now - files[i - 1][1] < SETTLE_SEC
                print("[Load Latest Image Private (GeN13)] skip %s (%s): %s"
                      % (os.path.basename(path), "writing" if fresh else "unreadable", ex))
                continue
            if w is None:
                h, w = rgb.shape[:2]
            elif rgb.shape[:2] != (h, w):
                rgb, mask = _resize(rgb, mask, w, h)
            images.append(torch.from_numpy(rgb))
            masks.append(torch.from_numpy(mask))
            picked.append(path)

        if not images:
            raise ValueError("Load Latest Image Private: no readable image from index %d" % index)
        if len(images) < count:
            print("[Load Latest Image Private (GeN13)] requested %d, loaded %d" % (count, len(images)))

        print("[Load Latest Image Private (GeN13)] %s%s"
              % (os.path.basename(picked[0]), "" if len(picked) == 1 else " +%d" % (len(picked) - 1)))
        return (torch.stack(images, 0), torch.stack(masks, 0), w, h,
                os.path.basename(picked[0]), picked[0], total)

    @classmethod
    def IS_CHANGED(cls, folder_path, sort_by, index, count, filename_filter, subfolders, extensions):
        try:
            _, files = _list(folder_path, sort_by, filename_filter, subfolders, extensions)
        except Exception:
            return float("NaN")
        # 多取幾張:選中的檔若讀取失敗會往後遞補,後面的檔變了也要重跑
        sel = files[index:index + count + 4]
        return "|".join(_sig(p) for p, _, _, _ in sel) + "#%d" % len(files)

    @classmethod
    def VALIDATE_INPUTS(cls, folder_path):
        folder = (folder_path or "").strip().strip('"')
        if not folder:
            return "folder_path is empty"
        if not os.path.isdir(folder):
            return "folder not found: %s" % folder
        return True


# --- 節點上的縮圖預覽(web/load_latest_image.js 呼叫) ---------------------------
# /gen13/latest_image       :依節點目前的欄位,回傳會抓到的那張(檔名、路徑、總數、修改時間)
# /gen13/latest_image/thumb :回傳該檔的 JPEG 縮圖(長邊 THUMB_PX)
# 這兩個網址是不需執行工作流的 GET:連得到 ComfyUI 的人都能呼叫,所以只准讀
#   output / input / temp(含子資料夾),以及這顆節點已經實際執行過的資料夾;
# 縮圖網址另外只接受 /gen13/latest_image 剛回報過的路徑。
# (能送出工作流的人本來就能讀任何檔,執行過的資料夾不再額外擋。)

THUMB_PX = 512
_RUN_FOLDERS = set()    # load() 實際執行過的資料夾(realpath)
_RUN_LOCK = threading.Lock()


def _real(path):
    return os.path.normcase(os.path.realpath(path))


def _remember_folder(folder):
    with _RUN_LOCK:
        _RUN_FOLDERS.add(_real(folder))


def _preview_roots():
    roots = []
    for fn in ("get_output_directory", "get_input_directory", "get_temp_directory"):
        try:
            roots.append(_real(getattr(folder_paths, fn)()))
        except Exception:
            pass
    with _RUN_LOCK:
        roots.extend(_RUN_FOLDERS)
    return roots


def _preview_allowed(path):
    """path 在 output / input / temp 或執行過的資料夾之內(不同磁碟、.. 跳出都算不在)。"""
    rp = _real(path)
    for root in _preview_roots():
        try:
            if os.path.commonpath([rp, root]) == root:
                return True
        except ValueError:      # 不同磁碟代號
            continue
    return False
_PEEKED = {}            # path -> 最後一次由 _peek 回報的時間
_PEEKED_MAX = 256
_PEEKED_LOCK = threading.Lock()


def _allow_thumb(path):
    with _PEEKED_LOCK:
        if len(_PEEKED) >= _PEEKED_MAX:
            oldest = min(_PEEKED, key=_PEEKED.get)
            _PEEKED.pop(oldest, None)
        _PEEKED[path] = time.time()


def _thumb_allowed(path):
    with _PEEKED_LOCK:
        return path in _PEEKED


def _peek(q):
    """依查詢參數找出執行時會抓到的第一張(略過讀不到的檔)。"""
    sort_by = q.get("sort_by", "newest first")
    if sort_by not in SORT_MODES:
        sort_by = "newest first"
    try:
        index = max(0, int(q.get("index", "0")))
    except ValueError:
        index = 0
    folder = (q.get("folder_path", "") or "").strip().strip('"')
    if not folder or not os.path.isdir(folder):
        return {"ok": False, "error": "folder not found", "total": 0}
    if not _preview_allowed(folder):
        return {"ok": False, "error": "preview: run once to enable this folder", "total": 0}
    folder, files = _list(folder, sort_by, q.get("filename_filter", "*"),
                          q.get("subfolders", "false").lower() == "true",
                          q.get("extensions", DEFAULT_EXT))
    total = len(files)
    if total == 0:
        return {"ok": False, "error": "no matching images", "total": 0}
    if index >= total:
        return {"ok": False, "error": "index out of range", "total": total}
    for n in range(index, total):
        path, mtime = files[n][0], files[n][1]
        try:
            with Image.open(path) as im:
                im.verify()  # verify 必須在開檔後第一個呼叫,之後要重開才能讀
            with Image.open(path) as im:
                w, h = im.size
                if im.getexif().get(0x0112, 1) in (5, 6, 7, 8):  # EXIF 轉 90° 時寬高對調
                    w, h = h, w
        except Exception:
            continue
        _allow_thumb(path)
        return {"ok": True, "filename": os.path.basename(path), "path": path,
                "position": n + 1, "total": total, "mtime": mtime, "width": w, "height": h}
    return {"ok": False, "error": "no readable image", "total": total}


def _thumb(path):
    import io
    if not _thumb_allowed(path) or not _preview_allowed(path) or not os.path.isfile(path):
        raise PermissionError("not allowed")
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(next(ImageSequence.Iterator(im)))
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
        return buf.getvalue(), im.size


try:
    import asyncio
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.get("/gen13/latest_image")
    async def _latest_route(request):
        q = dict(request.rel_url.query)
        try:
            data = await asyncio.get_running_loop().run_in_executor(None, _peek, q)
        except Exception as err:  # noqa: BLE001 - 顯示在節點上
            data = {"ok": False, "error": str(err)}
        return web.json_response(data)

    @PromptServer.instance.routes.get("/gen13/latest_image/thumb")
    async def _thumb_route(request):
        path = request.rel_url.query.get("path", "")
        try:
            body, _ = await asyncio.get_running_loop().run_in_executor(None, _thumb, path)
        except Exception:
            return web.Response(status=404)
        return web.Response(body=body, content_type="image/jpeg",
                            headers={"Cache-Control": "no-store"})
except Exception as err:  # noqa: BLE001
    print("[Load Latest Image Private (GeN13)] preview endpoint unavailable:", err)


NODE_CLASS_MAPPINGS = {"LoadLatestImagePrivateGeN13": LoadLatestImage}
NODE_DISPLAY_NAME_MAPPINGS = {"LoadLatestImagePrivateGeN13": "Load Latest Image Private (GeN13)"}
