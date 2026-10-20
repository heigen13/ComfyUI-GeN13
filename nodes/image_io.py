# -*- coding: utf-8 -*-
"""
image_io — GeN13 載入圖片的共用程式
================================
Load Image Private / Load Image Orient / Load Image SD 三顆 Load 節點都用這裡的
load_image_file(),讀圖行為一致:
  - 只走 Pillow + exif_transpose,不經 PyAV(避開 iOS 截圖 PNG 被轉 90° 的問題)。
  - 多幀檔(GIF、APNG)輸出為批次,尺寸不同的幀略過。
  - 遮罩:alpha 通道反相(透明 = 1);P 模式帶 transparency 也算;沒有透明時全 0、全尺寸,
    所以同一批次裡有的幀有 alpha、有的沒有也能 stack。
  - 16 位元灰階(I、I;16)正規化到 0–1。
file_signature() 給 IS_CHANGED 用:路徑 + 修改時間 + 大小,不必整檔算雜湊。
"""

import os

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths
import node_helpers


def list_input_images():
    """input 資料夾內的圖片檔名(排序後),給 INPUT_TYPES 的下拉選單。"""
    d = folder_paths.get_input_directory()
    files = [f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))]
    return sorted(folder_paths.filter_files_content_types(files, ["image"]))


def frame_to_arrays(frame):
    """單一幀 → (rgb HxWx3 float32 0–1, mask HxW float32 透明=1)。"""
    frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
    if frame.mode == "I":
        frame = frame.point(lambda p: p * (1 / 255))
    if frame.mode in ("I;16", "I;16B", "I;16L"):
        g = np.array(frame).astype(np.float32) / 65535.0
        return np.repeat(g[..., None], 3, axis=2), np.zeros(g.shape, dtype=np.float32)
    if frame.mode == "P" and "transparency" in frame.info:
        frame = frame.convert("RGBA")
    rgb = np.array(frame.convert("RGB")).astype(np.float32) / 255.0
    if "A" in frame.getbands():
        mask = 1.0 - np.array(frame.getchannel("A")).astype(np.float32) / 255.0
    else:
        mask = np.zeros(rgb.shape[:2], dtype=np.float32)
    return rgb, mask


def load_image_file(path):
    """讀整個檔;回傳 (image [B,H,W,3], mask [B,H,W], width, height)。"""
    img = node_helpers.pillow(Image.open, path)
    images, masks = [], []
    w = h = None
    try:
        for frame in ImageSequence.Iterator(img):
            rgb, mask = frame_to_arrays(frame)
            if w is None:
                h, w = rgb.shape[:2]
            elif rgb.shape[:2] != (h, w):
                continue
            images.append(torch.from_numpy(rgb))
            masks.append(torch.from_numpy(mask))
    finally:
        img.close()  # 多格 GIF / APNG 讀完就釋放檔案,不等回收
    return torch.stack(images, 0), torch.stack(masks, 0), w, h


def file_signature(path):
    """IS_CHANGED 用:檔案沒換、沒改就沿用快取。"""
    try:
        st = os.stat(path)
    except OSError:
        return float("NaN")
    return "%s:%.3f:%d" % (path, st.st_mtime, st.st_size)
