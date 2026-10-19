# -*- coding: utf-8 -*-
"""
Show Any Lite (GeN13)
=====================
Show Any 的精簡版:預設只佔一行,拖高節點即多行顯示;任何型別都能接,原物件直通。
  - any(選接):任何型別,顯示規則同 Show Any (GeN13)(FLOAT 最多 6 位小數、JSON 排版、IMAGE 尺寸摘要)。
  - content:沒接 any 時框內可直接打字,STRING 與 any 都輸出這段文字;接上 any 時忽略。
    前端以框本身(DOM widget,名稱 content)送出,不另設欄位;舊工作流沒帶 content 時為空字串。
  - 輸出:STRING 顯示的文字;any 原物件不經轉換直接往下傳(沒接 any 時為框內文字)。
前端(web/show_any_lite.js):一行時結尾以 … 截斷、多行標註 (+N lines),滑鼠停留顯示全文;
拖高後換行顯示,內容超出可捲動;右側小複製鈕;最後一次內容記在 node.properties.g13_text。
"""

from .show_any import ANY, _display


class ShowAnyLite:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "any": (ANY, {
                    "tooltip": "Input: any type. Text, numbers and JSON are shown as is; IMAGE and other tensors show a size summary."}),
                "content": ("STRING", {
                    "forceInput": True, "default": "",
                    "tooltip": "Content: used as the output when any is not connected; type directly in the box."}),
            },
        }

    INPUT_IS_LIST = True
    RETURN_TYPES = ("STRING", ANY)
    RETURN_NAMES = ("STRING", "any")
    OUTPUT_IS_LIST = (True, True)
    OUTPUT_TOOLTIPS = (
        "Text: as shown in the box.",
        "Passthrough: the upstream object, unchanged.",
    )
    OUTPUT_NODE = True
    FUNCTION = "show"
    CATEGORY = "GeN13/utils"
    DESCRIPTION = "Compact Show Any: one line by default, drag it taller for more lines; type directly when nothing is connected. Outputs STRING plus the original object."

    def show(self, any=None, content=None):
        if any is None:
            c = content[0] if isinstance(content, (list, tuple)) and content else content
            c = "" if c is None else str(c)
            return {"ui": {"gen13_text": [c]}, "result": ([c], [c])}
        src = list(any) if isinstance(any, (list, tuple)) else [any]
        shown = [_display(v) for v in src]
        return {"ui": {"gen13_text": shown}, "result": (shown, src)}


NODE_CLASS_MAPPINGS = {"ShowAnyLiteGeN13": ShowAnyLite}
NODE_DISPLAY_NAME_MAPPINGS = {"ShowAnyLiteGeN13": "Show Any Lite (GeN13)"}
