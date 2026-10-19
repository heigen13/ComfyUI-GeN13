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
                    "tooltip": "分身組:名稱相同的 Remote Int 同步數值、生成後動作與 bypass。"}),
                "value": ("INT", {
                    "default": 0, "min": -LIMIT, "max": LIMIT, "step": 1,
                    "tooltip": "數值:任一顆分身改值,同組其餘分身當下跟著變。"}),
                "control_after_generate": (CONTROL, {
                    "default": "fixed",
                    "tooltip": "生成後:整組每次送出只變一次,fixed 不變,increment 加 1,decrement 減 1,randomize 隨機。"}),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("INT",)
    OUTPUT_TOOLTIPS = ("整數:同組分身的共同數值。",)
    FUNCTION = "out"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "遙控整數:channel 名稱相同的節點互為分身,任一顆改值或切 bypass,其餘同步。"

    def out(self, channel, value, **kw):
        return (int(value),)


NODE_CLASS_MAPPINGS = {"RemoteIntGeN13": RemoteInt}
NODE_DISPLAY_NAME_MAPPINGS = {"RemoteIntGeN13": "Remote Int (GeN13)"}
