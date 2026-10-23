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
                    "tooltip": "Channel: Remote Text Switch nodes with the same channel name share number, auto next and bypass."}),
                "value": ("INT", {
                    "default": 1, "min": 1, "max": LIMIT, "step": 1,
                    "tooltip": "Box number: counts across the whole Text Switch chain; connect to select_num."}),
                "auto_next": (AUTO, {
                    "default": "OFF",
                    "tooltip": "Auto next: NEXT moves to the next box with content after each queue, skipping empty boxes."}),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("select_num",)
    OUTPUT_TOOLTIPS = ("Box number: connect to select_num of Text Switch (GeN13); can pass through Set / Get.",)
    FUNCTION = "out"
    CATEGORY = "GeN13/text"
    DESCRIPTION = "Remote for Text Switch: shows the selected box's title, ◀ ▶ step through the boxes; clones with the same channel name stay in sync."

    def out(self, channel, value, **kw):
        return (int(value),)


NODE_CLASS_MAPPINGS = {"RemoteTextSwitchGeN13": RemoteTextSwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"RemoteTextSwitchGeN13": "Remote Text Switch (GeN13)"}
