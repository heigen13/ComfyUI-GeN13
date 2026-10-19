# -*- coding: utf-8 -*-
"""
Show Any (GeN13)
================
萬用檢查站:任何型別都能接,顯示內容並輸出文字與原物件;內容隨工作流保存。
  - any(選接,任何型別):接上時顯示上游內容(唯讀)。
      STRING 原樣;INT 原樣;FLOAT 最多 6 位小數(0.1 + 0.2 顯示 0.3);BOOLEAN 為 true / false;
      清單、字典排版成 JSON;IMAGE / MASK / LATENT 顯示一行摘要(寬 × 高、張數、色版)。
  - content:沒接 any 時,框內文字就是輸出,可直接打字或貼上;
    接上 any 時,前端把顯示內容寫回這個框(存檔用),送出執行時固定送空字串,不影響下游快取。
  - 輸出:
      STRING  顯示的文字(與框內相同)。
      any     原物件不經轉換直接往下傳(router),數字、IMAGE 等原值直通;沒接 any 時為框內文字。
    文字轉數字請接 Number (GeN13) 的 number 輸入。
  - edit(前端兩段切換,存在 node.properties):AUTO 框跟著上游、唯讀,輸出上游內容;
    MANUAL 框可自由改,STRING 輸出改為框內文字,上游再變也不覆蓋(SYNC 按鈕把上游最新內容拉進框)。
    MANUAL 時前端送出的 content 前面加上 MANUAL_MARK,後端據此判斷;AUTO 接線時送空字串。
  - 收到清單(多段)時每段各自顯示,段落之間空一行,兩個輸出都維持清單。
前端(web/show_any.js):預設寬 400、文字區 8 行,最小 4 行;資訊列(字數、行數)與
CUT / COPY / PASTE,PASTE 為換行後接在最後;接線時 CUT、PASTE 停用。
"""

import json
import math

try:
    import torch
except Exception:  # pragma: no cover
    torch = None


class AnyType(str):
    """matches every socket type"""

    def __ne__(self, other):
        return False


ANY = AnyType("*")
DOT = " · "
X = " × "
COLOR = {1: "GRAY", 3: "RGB", 4: "RGBA"}


def _fmt_float(v):
    if math.isnan(v) or math.isinf(v):
        return str(v)
    s = ("%.6f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _is_tensor(v):
    return torch is not None and isinstance(v, torch.Tensor)


def _dims(shape):
    return X.join(str(int(x)) for x in shape)


def _tensor_summary(t):
    # same order as ComfyUI's own labels: width x height first
    shape = tuple(int(x) for x in t.shape)
    if len(shape) == 4 and shape[-1] in COLOR:
        b, h, w, c = shape
        return "IMAGE" + DOT + "%d%s%d" % (w, X, h) + DOT + "batch %d" % b + DOT + COLOR[c]
    if len(shape) == 3:
        b, h, w = shape
        return "MASK" + DOT + "%d%s%d" % (w, X, h) + DOT + "batch %d" % b
    return "TENSOR" + DOT + _dims(shape)


def _latent_summary(s):
    # latent units, not pixels: the pixel scale differs per model
    shape = tuple(int(x) for x in s.shape)
    if len(shape) == 4:
        b, c, h, w = shape
        return "LATENT" + DOT + "%d%s%d" % (w, X, h) + DOT + "batch %d" % b + DOT + "%d ch" % c
    if len(shape) == 5:
        b, c, f, h, w = shape
        return ("LATENT" + DOT + "%d%s%d" % (w, X, h) + DOT + "%d frames" % f + DOT
                + "batch %d" % b + DOT + "%d ch" % c)
    return "LATENT" + DOT + _dims(shape)


def _json_default(o):
    if _is_tensor(o):
        return _tensor_summary(o)
    if hasattr(o, "item"):
        try:
            return o.item()
        except Exception:
            pass
    return str(o)


def _display(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return _fmt_float(v)
    if isinstance(v, str):
        return v
    if _is_tensor(v):
        return _tensor_summary(v)
    if isinstance(v, dict) and _is_tensor(v.get("samples")):
        return _latent_summary(v["samples"])
    if isinstance(v, (dict, list, tuple)):
        try:
            return json.dumps(v, ensure_ascii=False, indent=2, default=_json_default)
        except Exception:
            return repr(v)
    return str(v)


MANUAL_MARK = "\u2063GEN13:MANUAL\u2063"


class ShowAny:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "content": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "Content: used as the output when any is not connected; shows the upstream content when it is."}),
            },
            "optional": {
                "any": (ANY, {
                    "forceInput": True,
                    "tooltip": "Input: any type. Text, numbers and JSON are shown as is; IMAGE and other tensors show a size summary."}),
            },
        }

    INPUT_IS_LIST = True
    RETURN_TYPES = ("STRING", ANY)
    RETURN_NAMES = ("STRING", "any")
    OUTPUT_IS_LIST = (True, True)
    OUTPUT_TOOLTIPS = (
        "Text: as shown in the box; FLOAT up to 6 decimal places, lists and dicts as JSON.",
        "Passthrough: the upstream object, unchanged.",
    )
    OUTPUT_NODE = True
    FUNCTION = "show"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "Accepts any type: shows the content and outputs it as STRING plus the original object. Supports cut, copy and paste; the content is saved with the workflow."

    def show(self, content, any=None):
        c = content[0] if isinstance(content, (list, tuple)) and content else content
        c = "" if c is None else str(c)
        if any is not None:
            src = list(any) if isinstance(any, (list, tuple)) else [any]
            if c.startswith(MANUAL_MARK):
                # MANUAL: show the upstream (for SYNC / change notice), output the edited box
                shown = [_display(v) for v in src]
                return {"ui": {"gen13_text": shown}, "result": ([c[len(MANUAL_MARK):]], src)}
        else:
            src = list(content) if isinstance(content, (list, tuple)) else [content]
            src = ["" if v is None else str(v) for v in src]
        shown = [_display(v) for v in src]
        return {"ui": {"gen13_text": shown}, "result": (shown, src)}


NODE_CLASS_MAPPINGS = {"ShowAnyGeN13": ShowAny}
NODE_DISPLAY_NAME_MAPPINGS = {"ShowAnyGeN13": "Show Any (GeN13)"}
