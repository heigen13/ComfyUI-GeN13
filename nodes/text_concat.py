# -*- coding: utf-8 -*-
"""
Text Concatenate (GeN13)
========================
在節點上直接打字、依序串成一段文字。
  - count:顯示幾個文字框(1–MAX_BOXES),多的隱藏也不串。
  - on_01~on_20:各框的 ON / OFF(節點上顯示為 #01~#20),關掉的框不串,文字保留。
  - solo:選一個框只輸出它,不改動各框的 ON / OFF;切回 OFF 即恢復原本組合。
    solo 超過 count 時視為 OFF。
  - delimiter:分隔字串,可用 \\n 換行、\\t 定位。
  - 空的框自動略過,每框前後空白去掉,不會出現連續分隔。
  - 每個文字框也可從上游接線輸入(ComfyUI 新版前端的欄位本身可接線)。
  - 輸出:STRING(串好的結果)之後依序為 #01~#20,各框單獨輸出原文,不受開關與獨奏影響;
    前端只保留前 count 個(只增減尾端,接線索引不變)。
前端(web/text_concat.js)依 count 隱藏多的框、標暗不輸出的框,並在最下方預覽串好的結果。
"""

MAX_BOXES = 20
SOLO = ["OFF"] + ["#%02d" % i for i in range(1, MAX_BOXES + 1)]


def _delim(text):
    return (text or "").replace("\\n", "\n").replace("\\t", "\t")


class TextConcatenate:
    @classmethod
    def INPUT_TYPES(cls):
        req = {
            "count": ("INT", {
                "default": 2, "min": 1, "max": MAX_BOXES, "step": 1,
                "tooltip": "Box count: number of text boxes shown and joined; hidden boxes are not output."}),
            "solo": (SOLO, {
                "default": "OFF",
                "tooltip": "Solo: outputs only the chosen box without changing the box switches. OFF follows each box's switch."}),
            "delimiter": ("STRING", {
                "default": ", ", "multiline": False,
                "tooltip": "Delimiter: text inserted between boxes; \\n is a line break."}),
        }
        for i in range(1, MAX_BOXES + 1):
            req["on_%02d" % i] = ("BOOLEAN", {
                "default": True, "label_on": "ON", "label_off": "OFF",
                "tooltip": "Include: OFF leaves this box out of the joined text; its content is kept."})
            req["text_%02d" % i] = ("STRING", {
                "default": "", "multiline": True,
                "tooltip": "Text: type here or connect an upstream string. Empty boxes are skipped."})
        return {"required": req}

    RETURN_TYPES = ("STRING",) * (1 + MAX_BOXES)
    RETURN_NAMES = ("STRING",) + tuple("#%02d" % i for i in range(1, MAX_BOXES + 1))
    OUTPUT_TOOLTIPS = ("Text: the enabled boxes joined in order with the delimiter.",) + \
                      ("Text: this box's content, regardless of its switch and solo.",) * MAX_BOXES
    FUNCTION = "join"
    CATEGORY = "GeN13/text"
    DESCRIPTION = "Joins text typed directly into the boxes, with a box count, a switch per box and solo; empty boxes are skipped."

    def join(self, count, solo, delimiter, **kw):
        count = max(1, min(MAX_BOXES, int(count)))
        try:
            solo_i = int(str(solo).lstrip("#")) if solo != "OFF" else 0
        except ValueError:
            solo_i = 0
        if solo_i > count:
            solo_i = 0
        if solo_i:
            picks = [solo_i]
        else:
            picks = [i for i in range(1, count + 1) if kw.get("on_%02d" % i, True)]
        parts = []
        for i in picks:
            t = kw.get("text_%02d" % i)
            t = "" if t is None else str(t).strip()
            if t:
                parts.append(t)
        boxes = []
        for i in range(1, MAX_BOXES + 1):
            t = kw.get("text_%02d" % i)
            boxes.append("" if t is None else str(t).strip())
        return (_delim(delimiter).join(parts),) + tuple(boxes)


NODE_CLASS_MAPPINGS = {"TextConcatenateGeN13": TextConcatenate}
NODE_DISPLAY_NAME_MAPPINGS = {"TextConcatenateGeN13": "Text Concatenate (GeN13)"}
