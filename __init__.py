# -*- coding: utf-8 -*-
"""
ComfyUI-GeN13
=============
GeN13 自訂節點包。新增節點:在 nodes 資料夾放一個 .py(含 NODE_CLASS_MAPPINGS),
再把模組名加進下方 MODULES。顯示名稱一律以 (GeN13) 結尾。
單一節點載入失敗只印錯誤,不影響其他節點。
"""
import importlib
import traceback

MODULES = [
    "color_match_temporal",
    "gen_prompt_cache",
    "load_image_orient",
    "load_image_sd",
    "degrease",
    "load_latest_image",
    "private_image",
    "latent_size",
    "text_concat",
    "number",
    "text_switch",
    "show_any",
    "show_any_lite",
    "counter",
    "trigger",
    "remote_int",
    "remote_text_switch",
    "remote_values",
    "remote_video",
]

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

for _name in MODULES:
    try:
        _m = importlib.import_module("." + _name, __name__ + ".nodes")
        NODE_CLASS_MAPPINGS.update(getattr(_m, "NODE_CLASS_MAPPINGS", {}))
        NODE_DISPLAY_NAME_MAPPINGS.update(getattr(_m, "NODE_DISPLAY_NAME_MAPPINGS", {}))
    except Exception:
        print("[ComfyUI-GeN13] failed to load %s" % _name)
        traceback.print_exc()

print("[ComfyUI-GeN13] %d nodes: %s" % (len(NODE_CLASS_MAPPINGS),
      ", ".join(NODE_DISPLAY_NAME_MAPPINGS.get(k, k) for k in NODE_CLASS_MAPPINGS)))

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
