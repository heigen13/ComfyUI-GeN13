# -*- coding: utf-8 -*-
"""
Counter (GeN13)
===============
計數器:每按一次 Queue,run 加 1,輸出依 mode 與範圍算出的數字(INT、FLOAT、STRING)。
  - run:第幾次,前端每次送出後加 1(bypass、mute 時不加);RESET 按鈕歸 0。
  - mode:
      increment / decrement                         一直加 / 一直減,不管 end。
      increment_to_end / decrement_to_end           加到 / 減到 end 就停住。
      increment_reset_after_end / decrement_reset_after_end  到 end 之後回到 start 重來。
    往下數的模式從 start 減到 end,start 要大於 end。
  - start / end / step:範圍與間距,step 只取大小,方向由 mode 決定。
  - hold:每個數字維持幾次才換下一個(兩層迴圈用)。
  - auto_reset:off / every hour / every day,到整點或隔天時回到 start。
  - reset(選接,任何型別):上游的值一改變就回到 start;沒改變照常往下數。
數值在後端執行當下計算(不是送出時),所以 Batch count 一次排很多次時,
reset、auto_reset、hold 仍然每一次都算對。歸零的位置(base)記在記憶體,重開 ComfyUI 後從 run 重新起算。
前端(web/counter.js):資訊列 next 值、進度、hold,RESET 按鈕與進度條。
"""

import json
import math
import time

try:
    import torch
except Exception:  # pragma: no cover
    torch = None


class AnyType(str):
    def __ne__(self, other):
        return False


ANY = AnyType("*")
MODES = ["increment", "decrement", "increment_to_end", "decrement_to_end",
         "increment_reset_after_end", "decrement_reset_after_end"]
AUTO = ["off", "every hour", "every day"]
LIMIT = 1_000_000_000
_MISSING = object()
_STATE = {}  # unique_id -> {"base", "last_run", "reset", "period"}


def _fmt(v):
    s = ("%.6f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _round_int(v):
    return int(math.floor(v + 0.5)) if v >= 0 else -int(math.floor(-v + 0.5))


def count_of(mode, start, end, step):
    """how many values a bounded mode walks through (1 when end is on the wrong side)"""
    step = abs(step) or 1.0
    span = (end - start) if mode.startswith("increment") else (start - end)
    if span < 0:
        return 1
    return int(math.floor(span / step + 1e-9)) + 1


def value_at(idx, mode, start, end, step):
    step = abs(step) or 1.0
    sign = 1 if mode.startswith("increment") else -1
    if mode in ("increment", "decrement"):
        i = idx
    else:
        n = count_of(mode, start, end, step)
        i = min(idx, n - 1) if mode.endswith("_to_end") else idx % n
    return round(start + sign * i * step, 9)


def _period(auto):
    if auto == "every hour":
        return time.strftime("%Y%m%d%H")
    if auto == "every day":
        return time.strftime("%Y%m%d")
    return None


def _key(v):
    """a cheap fingerprint of the reset input, to notice when it changes"""
    if v is None or isinstance(v, (bool, int, float, str)):
        return ("v", repr(v))
    if torch is not None and isinstance(v, torch.Tensor):
        flat = v.detach().flatten()
        sample = flat[:: max(1, flat.numel() // 256)].float().sum().item() if flat.numel() else 0.0
        return ("t", tuple(v.shape), round(sample, 6))
    if isinstance(v, dict) and torch is not None and isinstance(v.get("samples"), torch.Tensor):
        return ("l",) + _key(v["samples"])[1:]
    try:
        return ("j", json.dumps(v, sort_keys=True, default=str))
    except Exception:
        return ("r", repr(v))


class Counter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run": ("INT", {
                    "default": 0, "min": 0, "max": LIMIT, "step": 1,
                    "tooltip": "次數:每次送出後加 1,bypass 時不加。RESET 歸 0 即回到 start。"}),
                "mode": (MODES, {
                    "default": "increment_reset_after_end",
                    "tooltip": "模式:往上或往下數;to_end 到 end 停住,reset_after_end 到 end 後從 start 重來。"}),
                "start": ("FLOAT", {
                    "default": 0.0, "min": -LIMIT, "max": LIMIT, "step": 0.001, "round": 0.000001,
                    "tooltip": "起點:第一個輸出的數字,也是歸零後回到的數字。"}),
                "end": ("FLOAT", {
                    "default": 10.0, "min": -LIMIT, "max": LIMIT, "step": 0.001, "round": 0.000001,
                    "tooltip": "終點:to_end 與 reset_after_end 模式的最後一個數字。"}),
                "step": ("FLOAT", {
                    "default": 1.0, "min": 0.000001, "max": LIMIT, "step": 0.001, "round": 0.000001,
                    "tooltip": "間距:每次加減的量,只取大小,方向由 mode 決定。"}),
                "hold": ("INT", {
                    "default": 1, "min": 1, "max": 100000, "step": 1,
                    "tooltip": "維持:每個數字輸出幾次才換下一個,兩層迴圈時用。"}),
                "auto_reset": (AUTO, {
                    "default": "off",
                    "tooltip": "自動歸零:every hour 每到整點、every day 每到隔天回到 start。"}),
            },
            "optional": {
                "reset": (ANY, {
                    "forceInput": True,
                    "tooltip": "歸零觸發:上游的值一改變就回到 start;不變時照常往下數。"}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("INT", "FLOAT", "STRING")
    RETURN_NAMES = ("INT", "FLOAT", "STRING")
    OUTPUT_TOOLTIPS = ("整數:四捨五入。", "小數:計算值。", "文字:去掉多餘的零。")
    FUNCTION = "count"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "計數器:每次送出 run 加 1,依 mode 與範圍輸出數字;可用按鈕、上游改變或整點隔天歸零。"

    @classmethod
    def IS_CHANGED(cls, auto_reset="off", **kw):
        # a new hour / day must run again even when nothing else changed
        return _period(auto_reset) or ""

    def count(self, run, mode, start, end, step, hold, auto_reset, reset=None, unique_id=None):
        st = _STATE.setdefault(str(unique_id), {"base": 0, "last_run": None, "reset": _MISSING, "period": None})
        run = int(run)
        if st["last_run"] is not None and run < st["last_run"]:
            st["base"] = 0  # RESET pressed or run edited down: count from run again
        if run < st["base"]:
            st["base"] = 0
        if reset is not None:
            k = _key(reset)
            if st["reset"] is not _MISSING and k != st["reset"]:
                st["base"] = run
            st["reset"] = k
        p = _period(auto_reset)
        if p is not None and st["period"] is not None and p != st["period"]:
            st["base"] = run
        st["period"] = p
        st["last_run"] = run

        hold = max(1, int(hold))
        idx = max(0, run - st["base"]) // hold
        v = value_at(idx, mode, float(start), float(end), float(step))
        i = _round_int(v)
        return {"ui": {"gen13_counter": [run, st["base"], v]}, "result": (i, float(v), _fmt(v))}


NODE_CLASS_MAPPINGS = {"CounterGeN13": Counter}
NODE_DISPLAY_NAME_MAPPINGS = {"CounterGeN13": "Counter (GeN13)"}
