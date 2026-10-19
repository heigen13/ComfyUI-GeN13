# -*- coding: utf-8 -*-
"""
Remote Video (GeN13)
====================
影片尺寸與長度遙控:取代 Scale Image to Total Pixels + Get Image Size + Float (duration) + CR Float To Integer。
同名 channel 的分身互相同步(與 Remote 系列同一套:改任一顆整組跟著變、bypass 同步、任一顆的輸入接線即帶整組)。
  - image(選填):首幀圖。aspect_ratio = keep 時照圖片比例,選其他比例時置中裁成該比例。
  - aspect_ratio:keep / 1:1 / 3:2 / 2:3 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9 / 9:21。
    keep 但沒接圖時以 9:16 計算。
  - megapixels:總像素量(百萬像素),寬高對齊 32;縮放演算法固定 lanczos(同 Resize (GeN13) 的 target_size / fit_image)。
  - seconds:影片長度,同時輸出 FLOAT 與 INT(四捨五入)。
  - frame_rule:模型與 FPS,length = 秒數 × FPS 取整後往上補到該模型的合法幀數
    (MiniMax H3 17n+5 最少 5 幀,同 H3 範本的 Math Expression;Wan 2.1 / 2.2 4n+1;LTX 8n+1)。
  - steps:取樣步數,原樣輸出。
"""
import math

from .latent_size import fit_image, target_size

RATIOS = ["keep", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21"]
MULTIPLE = 32
METHOD = "lanczos"
NO_IMAGE_RATIO = "9:16"

# 選項名稱 -> (fps, 倍數 m, 餘數 b):length 補到 m·k + b
FRAME_RULES = {
    "H3 · 24 fps (17n+5)": (24, 17, 5),
    "Wan · 16 fps (4n+1)": (16, 4, 1),
    "Wan · 24 fps (4n+1)": (24, 4, 1),
    "Wan · 30 fps (4n+1)": (30, 4, 1),
    "LTX · 24 fps (8n+1)": (24, 8, 1),
    "LTX · 25 fps (8n+1)": (25, 8, 1),
}
RULE_NAMES = list(FRAME_RULES)


def _round(x):
    return int(math.floor(float(x) + 0.5))


def length_of(seconds, rule):
    fps, m, b = FRAME_RULES.get(rule, FRAME_RULES[RULE_NAMES[0]])
    n = max(b, _round(float(seconds) * fps))
    return n + (b - n) % m


class RemoteVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "channel": ("STRING", {"default": "video", "multiline": False,
                                       "tooltip": "分身組:名稱相同的 Remote Video 同步全部欄位與 bypass。"}),
                "aspect_ratio": (RATIOS, {"default": "keep",
                                          "tooltip": "比例:keep 照首幀圖比例(沒接圖時 9:16),其他比例置中裁切。"}),
                "megapixels": ("FLOAT", {"default": 0.40, "min": 0.01, "max": 16.0, "step": 0.1, "round": 0.01,
                                         "tooltip": "像素量:百萬像素,◀ ▶ 每次 0.1,可打到小數兩位;寬高對齊 32。"}),
                "seconds": ("FLOAT", {"default": 15.0, "min": 0.0, "max": 3600.0, "step": 1.0, "round": 0.1,
                                      "tooltip": "秒數:影片長度,◀ ▶ 每次 1 秒,可打到小數一位。"}),
                "frame_rule": (RULE_NAMES, {"default": RULE_NAMES[0],
                                            "tooltip": "幀數規則:模型與 FPS,length 往上補到 MiniMax H3、Wan 2.1 / 2.2、LTX 的合法幀數。"}),
                "steps": ("INT", {"default": 8, "min": 1, "max": 10000, "step": 1,
                                  "tooltip": "步數:取樣步數,接 KSampler 或 MiniMax H3 Dual Clock Sampler 的 steps。"}),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "首幀圖:縮放到指定像素量後由 IMAGE 輸出。"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "FLOAT", "INT", "FLOAT", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "width", "height", "seconds", "seconds_int", "fps", "length", "steps")
    OUTPUT_TOOLTIPS = (
        "首幀:縮放後的圖;沒接圖時為空。",
        "寬:像素。",
        "高:像素。",
        "秒數:FLOAT。",
        "秒數:INT,四捨五入。",
        "FPS:FLOAT,frame_rule 選定的幀率,接 Video Combine 的 frame_rate。",
        "幀數:依 frame_rule 補齊的影片長度。",
        "步數:取樣步數。",
    )
    FUNCTION = "out"
    CATEGORY = "GeN13/video"
    DESCRIPTION = "影片遙控:首幀依比例與像素量縮放,輸出寬高與秒數;同名 channel 的分身互相同步。"

    def out(self, channel, aspect_ratio, megapixels, seconds, frame_rule=RULE_NAMES[0], steps=8, image=None, **kw):
        src = None if image is None else (int(image.shape[2]), int(image.shape[1]))
        ratio = aspect_ratio if (aspect_ratio != "keep" or src) else NO_IMAGE_RATIO
        w, h = target_size(ratio, megapixels, 0, 0, MULTIPLE, src=src)
        out_img = None
        if image is not None:
            out_img, _ = fit_image(image, None, w, h, "crop", "center", METHOD, "0,0,0")
        sec = float(seconds)
        note = f"{w} × {h}" + ("" if src else (f" · keep (no image) → {NO_IMAGE_RATIO}" if aspect_ratio == "keep" else ""))
        return {"ui": {"g13_size": [note]}, "result": (out_img, int(w), int(h), sec, _round(sec),
                                                     float(FRAME_RULES.get(frame_rule, FRAME_RULES[RULE_NAMES[0]])[0]),
                                                     length_of(sec, frame_rule), int(steps))}


NODE_CLASS_MAPPINGS = {"RemoteVideoGeN13": RemoteVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"RemoteVideoGeN13": "Remote Video (GeN13)"}
