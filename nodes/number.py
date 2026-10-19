# -*- coding: utf-8 -*-
"""
Number (GeN13)
==============
輸入整數或小數,同時輸出硬性的 INT、FLOAT 與 STRING。
  - value:直接輸入或拖拉,整數小數皆可;round 設 0.000001(否則前端會依 step 捨入),step 0.001 讓欄位顯示三位小數。
  - number(選接):可接 INT、FLOAT 或 STRING,接上時以它為準;INT、FLOAT 原值直通,
    STRING 去掉前後空白與千分位逗號後轉成數字,轉不了時為 0。
  - control_after_generate:每次送出後改變 value(由前端處理),fixed / increment / decrement / randomize。
  - to_int:FLOAT 轉 INT 的方式,round 四捨五入、floor 無條件捨去、ceil 無條件進位。
  - format(選填):STRING 輸出的樣式。空白只輸出數值;含 {} 時每個 {} 換成數值;
    沒寫 {} 時數值接在最後。例:duration: → duration:11,{}秒 → 11秒。INT、FLOAT 不受影響。
  - 輸出:INT 一定是整數,FLOAT 一定是小數(Python float),STRING 去掉多餘的零(再套 format)。
前端(web/number.js)在節點下方顯示三個輸出的實際值,FLOAT 一律帶小數點。
"""

import math

TO_INT = ["round", "floor", "ceil"]
CONTROL = ["fixed", "increment", "decrement", "randomize"]
LIMIT = 1_000_000_000


def _to_int(v, mode):
    if mode == "floor":
        return int(math.floor(v))
    if mode == "ceil":
        return int(math.ceil(v))
    return int(math.floor(v + 0.5)) if v >= 0 else -int(math.floor(-v + 0.5))  # 四捨五入(非銀行家)


def _parse(x):
    """INT / FLOAT pass through untouched; text becomes a number, or 0 when it is not one"""
    if isinstance(x, bool):
        return int(x)
    if isinstance(x, (int, float)):
        return x
    s = str(x).strip().replace(",", "")
    try:
        return int(s)
    except ValueError:
        pass
    try:
        f = float(s)
    except ValueError:
        return 0
    return 0 if (math.isnan(f) or math.isinf(f)) else f


def _fmt(v):
    s = ("%.6f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _apply_format(s, fmt):
    f = str(fmt or "").strip()
    if not f:
        return s
    return f.replace("{}", s) if "{}" in f else f + s


class Number:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("FLOAT", {
                    "default": 0.0, "min": -LIMIT, "max": LIMIT, "step": 0.001, "round": 0.000001,
                    "tooltip": "Value: an integer or decimal, up to six decimal places. Not used when number is connected."}),
                "control_after_generate": (CONTROL, {
                    "default": "fixed",
                    "tooltip": "After generate: fixed keeps the value, increment adds 1, decrement subtracts 1, randomize picks a random integer."}),
                "to_int": (TO_INT, {
                    "default": "round",
                    "tooltip": "Rounding: round to nearest, floor rounds down, ceil rounds up."}),
            },
            "optional": {
                "number": ("INT,FLOAT,STRING", {
                    "forceInput": True,
                    "tooltip": "Number input: accepts INT, FLOAT or STRING and replaces value; text that cannot be converted gives 0."}),
                "format": ("STRING", {
                    "default": "", "multiline": False,
                    "tooltip": "Format: template for the STRING output; {} is replaced by the value. Without {}, the value is appended; empty outputs the value only."}),
            },
        }

    RETURN_TYPES = ("INT", "FLOAT", "STRING")
    RETURN_NAMES = ("INT", "FLOAT", "STRING")
    OUTPUT_TOOLTIPS = (
        "Integer: rounded as set in to_int.",
        "Decimal: the original value as FLOAT.",
        "Text: trailing zeros removed, such as 7.50 → 7.5; format applied if set.",
    )
    FUNCTION = "convert"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = ("Takes an integer or decimal and outputs it as INT, FLOAT and STRING, with a choice of rounding. "
                   "format styles the STRING: duration: → duration:11, {} sec → 11 sec.")

    def convert(self, value, to_int, number=None, format="", **kw):
        n = _parse(number) if number is not None else value
        v = float(n)
        i = n if isinstance(n, int) else _to_int(v, to_int)
        s = _apply_format(_fmt(v), format)
        return {"ui": {"gen13_num": [i, v, s]}, "result": (i, v, s)}


NODE_CLASS_MAPPINGS = {"NumberGeN13": Number}
NODE_DISPLAY_NAME_MAPPINGS = {"NumberGeN13": "Number (GeN13)"}
