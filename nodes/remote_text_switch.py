# -*- coding: utf-8 -*-
"""
Remote Text Switch (GeN13)
==========================
Text Switch (GeN13) 的遙控器:INT 接到 Text Switch 的 select_num(中間可經過 Set / Get)。
  - channel:分身組名稱。同名的 Remote Text Switch 互為分身,數值、auto next 與 bypass 同步;
    與 Remote Int (GeN13) 的 channel 各自獨立。
  - value:選號,照 Text Switch 整條鏈的接續編號(#01 起)。
  - auto_next:OFF 不變;NEXT 每次送出後整組跳到下一個有內容的框,空白框略過,到底回第一框。
前端(web/remote_text_switch.js)顯示選中框的編號與標題,◀ ▶ 在有內容的框之間切換。
後端只把 value 原樣輸出。
"""

LIMIT = 9999
AUTO = ["OFF", "NEXT"]


class RemoteTextSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "channel": ("STRING", {
                    "default": "switch", "multiline": False,
                    "tooltip": "分身組:名稱相同的 Remote Text Switch 同步選號、auto next 與 bypass。"}),
                "value": ("INT", {
                    "default": 1, "min": 1, "max": LIMIT, "step": 1,
                    "tooltip": "選號:Text Switch 整條鏈的接續編號,接 select_num 使用。"}),
                "auto_next": (AUTO, {
                    "default": "OFF",
                    "tooltip": "自動換框:NEXT 每次送出後跳到下一個有內容的框,空白框略過。"}),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("INT",)
    OUTPUT_TOOLTIPS = ("選號:接 Text Switch (GeN13) 的 select_num,可經過 Set / Get。",)
    FUNCTION = "out"
    CATEGORY = "GeN13/text"
    DESCRIPTION = "Text Switch 遙控器:顯示選中框的標題,◀ ▶ 切換;同名 channel 的分身互相同步。"

    def out(self, channel, value, **kw):
        return (int(value),)


NODE_CLASS_MAPPINGS = {"RemoteTextSwitchGeN13": RemoteTextSwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"RemoteTextSwitchGeN13": "Remote Text Switch (GeN13)"}
