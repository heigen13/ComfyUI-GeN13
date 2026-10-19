# -*- coding: utf-8 -*-
"""
Remote Float / Remote String / Remote Boolean (GeN13)
=====================================================
與 Remote Int (GeN13) 同一套分身機制,換成小數、文字、開關:
  - channel:分身組名稱。同型別、同名的節點互為分身,任一顆改值,其餘當下跟著變;
    不同型別各自分組(Remote Float 的 res 不會跟 Remote Int 的 res 同步)。
  - value:每顆分身都輸出同一個值,接哪一顆都一樣。
  - bypass / mute:整組同步。
同步全部在前端(web/remote_values.js + web/remote_core.js),後端只把 value 原樣輸出。
Remote String 的 value 為 forceInput(左上角固定接點),文字框由前端 DOM 框提供,同名 value 送出。
"""

LIMIT = 1_000_000_000

_CHANNEL_TIP = "分身組:同型別、名稱相同的節點同步數值與 bypass。"


class RemoteFloat:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "channel": ("STRING", {"default": "remote", "multiline": False, "tooltip": _CHANNEL_TIP}),
            "value": ("FLOAT", {
                "default": 0.0, "min": -LIMIT, "max": LIMIT, "step": 0.01, "round": 0.0001,
                "tooltip": "數值:小數,最多四位;任一顆分身改值,同組其餘分身當下跟著變。"}),
        }}

    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("FLOAT",)
    OUTPUT_TOOLTIPS = ("小數:同組分身的共同數值。",)
    FUNCTION = "out"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "遙控小數:channel 名稱相同的節點互為分身,任一顆改值或切 bypass,其餘同步。"

    def out(self, channel, value, **kw):
        return (float(value),)


class RemoteString:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "channel": ("STRING", {"default": "remote", "multiline": False, "tooltip": _CHANNEL_TIP}),
            },
            "optional": {
                "value": ("STRING", {
                    "forceInput": True, "default": "",
                    "tooltip": "文字:框內打字或接線輸入,即時同步到同組所有分身。"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("STRING",)
    OUTPUT_TOOLTIPS = ("文字:同組分身的共同內容。",)
    FUNCTION = "out"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "遙控文字:channel 名稱相同的節點互為分身,任一顆改字或切 bypass,其餘同步。"

    def out(self, channel, value="", **kw):
        return ("" if value is None else str(value),)


class RemoteBoolean:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "channel": ("STRING", {"default": "remote", "multiline": False, "tooltip": _CHANNEL_TIP}),
            "value": ("BOOLEAN", {
                "default": False, "label_on": "ON", "label_off": "OFF",
                "tooltip": "開關:任一顆分身切換,同組其餘分身當下跟著切。"}),
        }}

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("BOOLEAN",)
    OUTPUT_TOOLTIPS = ("開關:同組分身的共同狀態。",)
    FUNCTION = "out"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "遙控開關:channel 名稱相同的節點互為分身,任一顆切換或切 bypass,其餘同步。"

    def out(self, channel, value, **kw):
        return (bool(value),)


NODE_CLASS_MAPPINGS = {
    "RemoteFloatGeN13": RemoteFloat,
    "RemoteStringGeN13": RemoteString,
    "RemoteBooleanGeN13": RemoteBoolean,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "RemoteFloatGeN13": "Remote Float (GeN13)",
    "RemoteStringGeN13": "Remote String (GeN13)",
    "RemoteBooleanGeN13": "Remote Boolean (GeN13)",
}
