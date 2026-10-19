# -*- coding: utf-8 -*-
"""
Remote Int (GeN13)
==================
同一個整數放在畫布好幾處當遙控器:channel 名稱相同的 Remote Int 是同一組分身。
  - channel:分身組名稱。同一工作流(含子圖)內名稱相同的節點,任一顆改值,其餘當下跟著變。
  - value:整數。每顆分身都輸出同一個值,接哪一顆都一樣。
  - control_after_generate:整組共用,每次送出只變一次(由前端處理);bypass / mute 時停住。
  - bypass / mute:整組同步,在任一顆切換,其餘分身一起切換。
同步全部在前端(web/remote_int.js),後端只是把 value 原樣輸出。
"""

LIMIT = 1_000_000_000
CONTROL = ["fixed", "increment", "decrement", "randomize"]


class RemoteInt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "channel": ("STRING", {
                    "default": "remote", "multiline": False,
                    "tooltip": "Channel: Remote Int nodes with the same channel name share value, after-generate action and bypass."}),
                "value": ("INT", {
                    "default": 0, "min": -LIMIT, "max": LIMIT, "step": 1,
                    "tooltip": "Value: change it on any clone and the rest of the group follows at once."}),
                "control_after_generate": (CONTROL, {
                    "default": "fixed",
                    "tooltip": "After generate: the group changes once per queue. fixed keeps the value, increment adds 1, decrement subtracts 1, randomize picks a random value."}),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("INT",)
    OUTPUT_TOOLTIPS = ("Integer: the value shared by the group.",)
    FUNCTION = "out"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "Remote integer: nodes with the same channel name are clones; changing the value or bypass on one updates them all."

    def out(self, channel, value, **kw):
        return (int(value),)


NODE_CLASS_MAPPINGS = {"RemoteIntGeN13": RemoteInt}
NODE_DISPLAY_NAME_MAPPINGS = {"RemoteIntGeN13": "Remote Int (GeN13)"}
