# -*- coding: utf-8 -*-
"""
ComfyUI-GeN13
=============
GeN13 自訂節點包。新增節點:在 nodes 資料夾放一個 .py(含 NODE_CLASS_MAPPINGS),
再在下方照同樣格式加一段 import。顯示名稱一律以 (GeN13) 結尾。
單一節點載入失敗只印錯誤,不影響其他節點。
"""
import traceback

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"


def _add(module):
    NODE_CLASS_MAPPINGS.update(getattr(module, "NODE_CLASS_MAPPINGS", {}))
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(module, "NODE_DISPLAY_NAME_MAPPINGS", {}))


def _failed(name):
    print("[ComfyUI-GeN13] failed to load %s" % name)
    traceback.print_exc()


try:
    from .nodes import color_match_temporal
    _add(color_match_temporal)
except Exception:
    _failed("color_match_temporal")
try:
    from .nodes import gen_prompt_cache
    _add(gen_prompt_cache)
except Exception:
    _failed("gen_prompt_cache")
try:
    from .nodes import load_image_orient
    _add(load_image_orient)
except Exception:
    _failed("load_image_orient")
try:
    from .nodes import load_image_sd
    _add(load_image_sd)
except Exception:
    _failed("load_image_sd")
try:
    from .nodes import degrease
    _add(degrease)
except Exception:
    _failed("degrease")
try:
    from .nodes import load_latest_image
    _add(load_latest_image)
except Exception:
    _failed("load_latest_image")
try:
    from .nodes import private_image
    _add(private_image)
except Exception:
    _failed("private_image")
try:
    from .nodes import latent_size
    _add(latent_size)
except Exception:
    _failed("latent_size")
try:
    from .nodes import text_concat
    _add(text_concat)
except Exception:
    _failed("text_concat")
try:
    from .nodes import number
    _add(number)
except Exception:
    _failed("number")
try:
    from .nodes import text_switch
    _add(text_switch)
except Exception:
    _failed("text_switch")
try:
    from .nodes import show_any
    _add(show_any)
except Exception:
    _failed("show_any")
try:
    from .nodes import show_any_lite
    _add(show_any_lite)
except Exception:
    _failed("show_any_lite")
try:
    from .nodes import counter
    _add(counter)
except Exception:
    _failed("counter")
try:
    from .nodes import trigger
    _add(trigger)
except Exception:
    _failed("trigger")
try:
    from .nodes import remote_int
    _add(remote_int)
except Exception:
    _failed("remote_int")
try:
    from .nodes import remote_text_switch
    _add(remote_text_switch)
except Exception:
    _failed("remote_text_switch")
try:
    from .nodes import remote_values
    _add(remote_values)
except Exception:
    _failed("remote_values")
try:
    from .nodes import remote_video
    _add(remote_video)
except Exception:
    _failed("remote_video")
try:
    from .nodes import switch_any
    _add(switch_any)
except Exception:
    _failed("switch_any")
try:
    from .nodes import monitor
    _add(monitor)
except Exception:
    _failed("monitor")

print("[ComfyUI-GeN13] %d nodes: %s" % (len(NODE_CLASS_MAPPINGS),
      ", ".join(NODE_DISPLAY_NAME_MAPPINGS.get(k, k) for k in NODE_CLASS_MAPPINGS)))

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
