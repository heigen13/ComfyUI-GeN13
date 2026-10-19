# -*- coding: utf-8 -*-
"""
Trigger (GeN13)
===============
觸發器:輸出一個整數,每次觸發就換一個新值;接到 Counter (GeN13) 的 reset,值一變 Counter 就回到 start。
  - pulse:觸發累計,節點上的 TRIGGER 按鈕每按一下加 1;經 API 送出時把 pulse 改成新數字也算觸發。
  - input(選接,任何型別):上游的值一改變,等於按了一次 TRIGGER(剛接上的第一次只記錄,不觸發)。
  - 輸出 INT = pulse + 上游改變次數,兩種觸發任一發生都會換新值;沒有觸發時值不變,下游照常。
上游改變次數記在記憶體,重開 ComfyUI 後從 0 起算(只影響輸出的絕對值,不影響「有沒有變」)。
一顆 Trigger 可同時接多顆 Counter;畫布很遠時可用 KJNodes 的 Set / Get 免拉長線。
前端(web/trigger.js):TRIGGER 大按鈕,狀態列 READY / ARMED(已按、等下一次執行)/ TRIGGERED BY INPUT。
"""

from .counter import ANY, _key

_STATE = {}  # unique_id -> {"last": key, "changes": int}
_MISSING = object()


class Trigger:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pulse": ("INT", {
                    "default": 0, "min": 0, "max": 2_000_000_000, "step": 1,
                    "tooltip": "Pulse: the TRIGGER button adds 1 per press; each change fires the trigger."}),
            },
            "optional": {
                "input": (ANY, {
                    "forceInput": True,
                    "tooltip": "Input: fires once whenever the upstream value changes, such as a Boolean switch."}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("INT",)
    OUTPUT_TOOLTIPS = ("Trigger value: a new value on each trigger; connect to the reset of Counter (GeN13).",)
    FUNCTION = "fire"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "Trigger: outputs a new value when its button is pressed or its input changes. Connect it to the reset of Counter (GeN13); one trigger can reset many."

    def fire(self, pulse, input=None, unique_id=None):
        st = _STATE.setdefault(str(unique_id), {"last": _MISSING, "changes": 0})
        by_input = False
        if input is not None:
            k = _key(input)
            if st["last"] is not _MISSING and k != st["last"]:
                st["changes"] += 1
                by_input = True
            st["last"] = k
        out = int(pulse) + st["changes"]
        return {"ui": {"gen13_trigger": [int(pulse), 1 if by_input else 0]}, "result": (out,)}


NODE_CLASS_MAPPINGS = {"TriggerGeN13": Trigger}
NODE_DISPLAY_NAME_MAPPINGS = {"TriggerGeN13": "Trigger (GeN13)"}
