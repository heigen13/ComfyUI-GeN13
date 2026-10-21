# -*- coding: utf-8 -*-
"""
Switch Any (GeN13)
==================
多路選號開關:任何型別都能接,select 選幾號就輸出第幾路。
  - select:輸出第幾路(input_1 起算);超過已接的最後一路時,停在最後一路。
    選到中間沒接線的空位時報錯並指出是哪一路。
  - input_1、input_2…:平常尾端不留空位,拖線到節點上方時前端才在最後一路下面長出空位,
    移開沒接就收回;中間拔線不重新編號,其他路的號碼不變。
  - 型別:第一條線接上就鎖定(前端),其他輸入與輸出只能接同型別;全部拔掉才解鎖。
  - 只有被選中的那一路會執行(lazy),其他路的上游不跑、不佔運算。
  - 輸出:output 為選中的那一路(原物件直通);index 為實際使用的號碼(超過時已改成最後一路),
    可接另一顆 Switch Any 的 select 讓兩顆連動。
  - 各輸入的名稱(前端雙擊輸入或右鍵命名)只存在 node.properties,不送進 prompt。
後端以 optional 的 _AnyInputs 接受任意 input_N 名稱,每一路都是 lazy 輸入;
前端(web/switch_any.js)管理輸入空位、型別鎖定與選中提示。
"""

import re

from .show_any import ANY

PREFIX = "input_"
_NUM = re.compile(r"^input_(\d+)$")


class _AnyInputs(dict):
    """optional inputs: input_1 is declared for the node definition, every input_N is accepted"""

    def __contains__(self, key):
        return bool(_NUM.match(str(key))) or dict.__contains__(self, key)

    def __getitem__(self, key):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        if _NUM.match(str(key)):
            return dict.__getitem__(self, PREFIX + "1")
        raise KeyError(key)


def _linked(kw):
    """numbers of the inputs present in the prompt (linked to a live node), ascending"""
    out = []
    for k in kw:
        m = _NUM.match(str(k))
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def _num(select, kw):
    nums = _linked(kw)
    if not nums:
        raise ValueError("Switch Any (GeN13): no input is connected.")
    n = max(1, int(select))
    if n > nums[-1]:
        n = nums[-1]
    if n not in nums:
        raise ValueError("Switch Any (GeN13): select %d, input_%d is not connected." % (int(select), n))
    return n


class SwitchAny:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "select": ("INT", {
                    "default": 1, "min": 1, "max": 999, "step": 1,
                    "tooltip": "Select: number of the input to output; above the last connected input, the last one is used."}),
            },
            "optional": _AnyInputs({
                PREFIX + "1": (ANY, {
                    "lazy": True,
                    "tooltip": "Input: any type; the first link sets the type for every input and the output."}),
            }),
        }

    RETURN_TYPES = (ANY, "INT")
    RETURN_NAMES = ("output", "index")
    OUTPUT_TOOLTIPS = (
        "Output: the selected input, passed on unchanged.",
        "Index: number of the input actually used; link it to another Switch Any select to switch both together.",
    )
    FUNCTION = "switch"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "Picks one of any number of inputs by number; any type, and only the selected input is run."

    def check_lazy_status(self, select, **kw):
        name = PREFIX + str(_num(select, kw))
        return [name] if kw.get(name) is None else []

    def switch(self, select, **kw):
        n = _num(select, kw)
        return (kw.get(PREFIX + str(n)), n)


NODE_CLASS_MAPPINGS = {"SwitchAnyGeN13": SwitchAny}
NODE_DISPLAY_NAME_MAPPINGS = {"SwitchAnyGeN13": "Switch Any (GeN13)"}
