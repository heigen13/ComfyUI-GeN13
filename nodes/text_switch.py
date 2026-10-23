# -*- coding: utf-8 -*-
"""
Text Switch (GeN13)
===================
在節點上直接打字、選一個框輸出;多顆可以橋接(chain)水平排開。
  - count:顯示幾個文字框(1–MAX_BOXES),多的隱藏。
  - select_num(選填 INT):接 Counter / Trigger 等 INT 直接指定選號(1 起算,照整條鏈的接續編號),
    接上後 select 不作用;只有第一顆的 select_num 有效。超出範圍時輸出空字串。
  - select:輸出哪一框。單顆時 #01~#count;橋接時由第一顆(head)總控整條鏈:
    編號緊接著前一顆的最後一框(第一顆 5 框 → 第二顆從 #06 起),串幾顆都可以。
    被橋接的節點(chain 有接線)自己的 select 不作用,選號來自上游。
  - chain 輸入/輸出:把上一顆的 chain 輸出接到下一顆的 chain 輸入即可橋接;
    chain 裡帶著全域選號、目前已選到的文字與編號偏移(= 上游所有框數的總和)。
  - STRING 輸出:每顆都有——選號在我或我上游時輸出該文字,選號在我下游時為空字串;
    平常接最後一顆的 STRING。
  - #01~#25 輸出:每框各一個輸出,直接把該框文字拉給下游(前端依 count 只顯示前幾個,
    端點標籤顯示該框標題)。
  - text_01~text_25:直接輸入,或從上游接線。接線的框為 lazy 輸入:只有被 select 選到、或其
    #NN 輸出有人接走的框才向上游要值,其餘分支不執行(例如兩組 LLM 改寫,只跑用到的那組)。
  - 選號落在沒有節點的範圍時輸出空字串(前端會把選號夾在整條鏈的有效範圍內)。
  - select 的值為 "#NN"(兩位數起,超過 99 自然變三位數),後端接受任何 "#數字",
    所以鏈長不受下拉清單限制;下拉清單只列整條鏈看得到的號碼(前端填)。
前端(web/text_switch.js):每框一條標題列(收合、編號、標題),EXPAND ALL / COLLAPSE ALL,
依鏈位置顯示接續的編號,橋接的節點 select 變暗並顯示 head 的選號,最下方預覽輸出。
"""

import re

MAX_BOXES = 25
CHAIN_TYPE = "G13_SWITCH"
_SEL_RE = re.compile(r"#\d+")


class _SelectList(list):
    """combo 清單:下拉只給前端當初始值,驗證時接受任何 "#數字"(鏈長不受限)。"""

    def __contains__(self, v):
        return bool(_SEL_RE.fullmatch(str(v)))


SELECT = _SelectList("#%02d" % i for i in range(1, MAX_BOXES + 1))


def _sel_num(select):
    try:
        return max(1, int(str(select).lstrip("#")))
    except ValueError:
        return 1


def _local_pick(chain, select, count, select_num=None):
    """(offset, global_select, local_box_or_0)"""
    count = max(1, min(MAX_BOXES, int(count)))
    if isinstance(chain, dict):
        offset = int(chain.get("offset", 0))
        gsel = int(chain.get("select", 1))
    else:
        offset = 0
        gsel = int(select_num) if select_num is not None else _sel_num(select)
    local = gsel - offset
    if 1 <= local <= count:
        return offset, gsel, local
    return offset, gsel, 0


def _consumed_boxes(prompt, unique_id):
    """boxes whose #NN output (slot index 2..21) feeds some node in the submitted prompt"""
    uid = str(unique_id)
    boxes = set()
    try:
        for nid, node in prompt.items():
            if str(nid) == uid:
                continue
            for v in (node.get("inputs") or {}).values():
                if isinstance(v, (list, tuple)) and len(v) == 2 and str(v[0]) == uid:
                    slot = int(v[1])
                    if slot >= 2:
                        boxes.add(slot - 1)
    except Exception:
        pass
    return boxes


def _linked(prompt, unique_id, name):
    try:
        v = prompt[str(unique_id)]["inputs"].get(name)
    except (KeyError, TypeError, IndexError):
        return False
    return isinstance(v, (list, tuple)) and len(v) > 0 and str(v[0]) in prompt


class TextSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        req = {
            "count": ("INT", {
                "default": 2, "min": 1, "max": MAX_BOXES, "step": 1,
                "tooltip": "Box count: number of text boxes shown; the rest are hidden."}),
            "select": (SELECT, {
                "default": "#01",
                "tooltip": "Select: the box to output. In a chain, the first node controls it, and numbering continues from the previous node's last box."}),
        }
        for i in range(1, MAX_BOXES + 1):
            req["text_%02d" % i] = ("STRING", {
                "default": "", "multiline": True, "lazy": True,
                "tooltip": "Text: type here or connect an upstream string. A connected upstream runs only when this box is selected."})
        return {"required": req,
                "optional": {
                    "chain": (CHAIN_TYPE, {
                        "tooltip": "Chain: connect the chain output of the previous Text Switch; numbering continues from its last box."}),
                    "select_num": ("INT", {
                        "forceInput": True, "min": 1, "max": 9999,
                        "tooltip": "Select input: an INT, such as from Counter or Trigger, sets the box number directly, starting at 1; overrides select."})},
                "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = (CHAIN_TYPE, "STRING") + ("STRING",) * MAX_BOXES
    RETURN_NAMES = ("chain", "STRING") + tuple("#%02d" % i for i in range(1, MAX_BOXES + 1))
    OUTPUT_TOOLTIPS = ("Chain: connect to the chain input of the next Text Switch.",
                       "Text: the selected box; empty when the selected box is in a later node of the chain.") + \
                      ("Text: this box's content, regardless of select.",) * MAX_BOXES
    FUNCTION = "switch"
    CATEGORY = "GeN13/text"
    DESCRIPTION = "Type text directly into the boxes and output the selected one. Chain any number of nodes side by side: numbering continues from the previous node, and the first node controls the chain."

    def check_lazy_status(self, count, select, chain=None, select_num=None, prompt=None, unique_id=None, **kw):
        _, _, local = _local_pick(chain, select, count, select_num)
        need = _consumed_boxes(prompt, unique_id)
        if local:
            need.add(local)
        # "already asked" lives on the node object, which ComfyUI keeps between prompts: scope it to
        # this run (the prompt dict is one object per queued prompt, kept alive by the history), or an
        # interrupted run would leave a stale flag and the next run would skip the box and output ""
        run_key, asked = getattr(self, "_asked", (None, set()))
        if run_key != id(prompt):
            asked = set()
        want = []
        for i in sorted(need):
            name = "text_%02d" % i
            if kw.get(name) is not None or not _linked(prompt, unique_id, name):
                continue
            # ask each linked box once; a bypassed upstream keeps returning None, so never loop
            if name in asked:
                continue
            want.append(name)
        if want:
            self._asked = (id(prompt), asked | set(want))
            return want
        self._asked = (None, set())
        return []

    def switch(self, count, select, chain=None, select_num=None, prompt=None, unique_id=None, **kw):
        offset, gsel, local = _local_pick(chain, select, count, select_num)
        if local:
            t = kw.get("text_%02d" % local)
            text = "" if t is None else str(t).strip()
        elif isinstance(chain, dict):
            text = str(chain.get("text") or "")
        else:
            text = ""
        # the next node's numbers start right after my last visible box
        out = {"select": gsel, "text": text, "offset": offset + max(1, min(MAX_BOXES, int(count)))}
        boxes = []
        for i in range(1, MAX_BOXES + 1):
            t = kw.get("text_%02d" % i)
            boxes.append("" if t is None else str(t).strip())
        result = (out, text) + tuple(boxes)
        # the node that owns the picked box reports it to the history (outputs.g13_prompt), so a
        # history viewer can show the prompt with its box number instead of parsing the graph
        if local and text:
            return {"ui": {"g13_prompt": [{"sel": gsel, "box": local, "text": text}]}, "result": result}
        return result


NODE_CLASS_MAPPINGS = {"TextSwitchGeN13": TextSwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"TextSwitchGeN13": "Text Switch (GeN13)"}
