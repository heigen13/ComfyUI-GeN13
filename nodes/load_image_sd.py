# Load Image (SD)
# 載入 A1111 / Forge 生成的圖片,讀出 PNG(或 JPG / WebP EXIF)裡的生成參數,
# 直接輸出提示詞、種子、步數、CFG、取樣器、排程器、尺寸、Clip skip,
# 用來在 ComfyUI 重現舊圖,不需要拖圖匯入、也不需要手動抄參數。
# 只用 Pillow + numpy + torch(ComfyUI 本身就有),不需安裝任何套件。

import re

from PIL import Image

import folder_paths
import node_helpers
import comfy.samplers

from .image_io import list_input_images, load_image_file, file_signature

SAMPLERS = comfy.samplers.KSampler.SAMPLERS
SCHEDULERS = comfy.samplers.KSampler.SCHEDULERS


class AnyType(str):
    """萬用型別:可接任何輸入(與 Inspire / Impact 的 any_typ 相同做法)。"""
    def __ne__(self, other):
        return False


# scheduler 輸出用萬用型別:Inspire / Impact 的排程器清單比核心多(AYS、GITS 等),
# 清單型別必須完全相同才能接線,改用萬用型別後核心 KSampler 與 KSampler (inspire) 皆可接。
SCHEDULER_OUT = AnyType("*")

# A1111 取樣器名稱 → ComfyUI 取樣器名稱(長名稱放前面,先比對長的)
SAMPLER_MAP = [
    ("DPM++ 2M SDE Heun", "dpmpp_2m_sde_heun_gpu"),
    ("DPM++ 2M SDE", "dpmpp_2m_sde_gpu"),
    ("DPM++ 3M SDE", "dpmpp_3m_sde_gpu"),
    ("DPM++ 2S a", "dpmpp_2s_ancestral"),
    ("DPM++ 2M", "dpmpp_2m"),
    ("DPM++ SDE", "dpmpp_sde_gpu"),
    ("DPM2 a", "dpm_2_ancestral"),
    ("DPM2", "dpm_2"),
    ("DPM fast", "dpm_fast"),
    ("DPM adaptive", "dpm_adaptive"),
    ("Euler a", "euler_ancestral"),
    ("Euler", "euler"),
    ("Heun", "heun"),
    ("LMS", "lms"),
    ("LCM", "lcm"),
    ("DDIM", "ddim"),
    ("DDPM", "ddpm"),
    ("UniPC", "uni_pc"),
    ("DEIS", "deis"),
    ("iPNDM", "ipndm"),
]

# A1111 排程器名稱(舊格式寫在取樣器尾巴,新格式寫在 Schedule type)→ ComfyUI 排程器名稱
SCHEDULER_MAP = [
    ("SGM Uniform", "sgm_uniform"),
    ("Karras", "karras"),
    ("Exponential", "exponential"),
    ("KL Optimal", "kl_optimal"),
    ("Simple", "simple"),
    ("Normal", "normal"),
    ("Beta", "beta"),
    ("Uniform", "normal"),
    ("Automatic", "normal"),
]


def _read_text(img):
    """取出 A1111 參數文字:PNG 的 parameters 區塊,或 JPG / WebP 的 EXIF UserComment。"""
    txt = img.info.get("parameters")
    if isinstance(txt, str) and txt.strip():
        return txt
    try:
        exif = img.getexif()
        raw = exif.get_ifd(0x8769).get(0x9286) or exif.get(0x9286)
        if isinstance(raw, bytes):
            if raw[:8] == b"UNICODE\x00":
                body = raw[8:]
                # A1111 寫 UTF-16BE;部分工具寫 UTF-16LE,以 NUL 位置判斷
                enc = "utf-16-be" if body[:1] == b"\x00" else "utf-16-le"
                return body.decode(enc, errors="ignore").strip("\x00")
            if raw[:8] == b"ASCII\x00\x00\x00":
                return raw[8:].decode("utf-8", errors="ignore").strip("\x00")
            return raw.decode("utf-8", errors="ignore").strip("\x00")
        if isinstance(raw, str):
            return raw
    except Exception:
        pass
    return ""


def _parse(text):
    """把 A1111 參數文字拆成 positive / negative / 參數字典。"""
    pos, neg, kv = "", "", {}
    if not text:
        return pos, neg, kv
    lines = text.replace("\r\n", "\n").split("\n")
    # 最後一行若以 Steps: 開頭就是參數列(可能有多行設定,往回找第一個 Steps: 行)
    idx = None
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip().startswith("Steps:"):
            idx = i
            break
    param_line = ""
    if idx is not None:
        param_line = " ".join(l.strip() for l in lines[idx:])
        body = lines[:idx]
    else:
        body = lines
    p_lines, n_lines, in_neg = [], [], False
    for l in body:
        if l.startswith("Negative prompt:"):
            in_neg = True
            n_lines.append(l[len("Negative prompt:"):].lstrip())
        elif in_neg:
            n_lines.append(l)
        else:
            p_lines.append(l)
    pos = "\n".join(p_lines).strip()
    neg = "\n".join(n_lines).strip()
    # 參數列:Key: value, Key: "quoted, value", ...
    for m in re.finditer(r'\s*([\w \-/\.\(\)]+?):\s*("(?:\\.|[^"\\])*"|[^,]*)(?:,|$)', param_line):
        k = m.group(1).strip()
        v = m.group(2).strip()
        if v.startswith('"') and v.endswith('"'):
            v = v[1:-1]
        if k:
            kv[k] = v
    return pos, neg, kv


def _map_sampler(name, schedule_type):
    """回傳 (sampler, scheduler, 訊息)。"""
    note = []
    sampler, rest = None, ""
    s = (name or "").strip()
    for a, c in SAMPLER_MAP:
        if s == a or s.startswith(a + " "):
            sampler, rest = c, s[len(a):].strip()
            break
    if sampler is None:
        if s:
            note.append("sampler not mapped: '%s' -> euler" % s)
        sampler = "euler"
    if sampler not in SAMPLERS:
        note.append("sampler '%s' not available -> euler" % sampler)
        sampler = "euler"
    sched_src = (schedule_type or rest or "").strip()
    scheduler = "normal"
    for a, c in SCHEDULER_MAP:
        if sched_src.lower() == a.lower():
            scheduler = c
            break
    else:
        if sched_src:
            note.append("scheduler not mapped: '%s' -> normal" % sched_src)
    if sampler == "ddim" and not sched_src:
        scheduler = "ddim_uniform"
    if scheduler not in SCHEDULERS:
        note.append("scheduler '%s' not available -> normal" % scheduler)
        scheduler = "normal"
    return sampler, scheduler, note


def _int(v, d):
    try:
        return int(float(str(v).strip()))
    except Exception:
        return d


def _float(v, d):
    try:
        return float(str(v).strip())
    except Exception:
        return d


class LoadImageSD:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {
            "image": (list_input_images(), {"image_upload": True,
                                      "tooltip": "來源圖片:A1111 / Forge 生成的 PNG(或含參數的 JPG / WebP)。"}),
        }}

    CATEGORY = "GeN13/image"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING", "STRING", "INT", "INT", "FLOAT",
                    SAMPLERS, SCHEDULER_OUT, "INT", "STRING")
    RETURN_NAMES = ("IMAGE", "MASK", "width", "height", "positive", "negative", "seed", "steps",
                    "cfg", "sampler_name", "scheduler", "clip_skip", "info")
    OUTPUT_TOOLTIPS = (
        "影像:載入的圖片,多幀檔輸出為批次。",
        "遮罩:透明區域為 1,無透明通道時全 0。",
        "寬度:參數中的 Size,缺少時取圖片寬度。",
        "高度:參數中的 Size,缺少時取圖片高度。",
        "正面提示詞:參數中的提示詞原文。",
        "負面提示詞:參數中 Negative prompt 的原文。",
        "種子:參數中的 Seed。",
        "步數:參數中的 Steps。",
        "CFG:參數中的 CFG scale。",
        "取樣器:A1111 名稱換算成 ComfyUI 名稱。",
        "排程器:A1111 排程(Karras 等)換算成 ComfyUI 名稱。",
        "Clip skip:換算成 CLIP Set Last Layer 用的負值(1 → -1, 2 → -2)。",
        "參數全文:原始參數文字,另附換算備註。",
    )
    FUNCTION = "load"
    DESCRIPTION = "載入圖片並讀出 A1111 / Forge 生成參數,用於在 ComfyUI 重現舊圖。"

    def load(self, image):
        image_path = folder_paths.get_annotated_filepath(image)
        with node_helpers.pillow(Image.open, image_path) as img:
            text = _read_text(img)

        # 影像:與 Load Image Private 共用讀圖程式(Pillow + exif_transpose,不經 PyAV)
        image_t, mask_t, w, h = load_image_file(image_path)

        pos, neg, kv = _parse(text)
        notes = []
        if not text:
            notes.append("no A1111 parameters found in image")

        seed = _int(kv.get("Seed"), 0)
        steps = _int(kv.get("Steps"), 20)
        cfg = _float(kv.get("CFG scale"), 7.0)
        sampler, scheduler, n = _map_sampler(kv.get("Sampler", ""), kv.get("Schedule type", ""))
        notes += n

        width, height = w, h
        size = kv.get("Size", "")
        m = re.match(r"\s*(\d+)\s*x\s*(\d+)", size)
        if m:
            width, height = int(m.group(1)), int(m.group(2))

        cs = _int(kv.get("Clip skip"), 1)
        clip_skip = -max(1, cs)

        for k in ("Hires upscale", "Hires steps", "Denoising strength", "ADetailer model",
                  "Eta noise seed delta", "ENSD", "Token merging ratio", "Lora hashes", "TI hashes"):
            if k in kv:
                notes.append("not applied: %s: %s" % (k, kv[k]))
        if "RNG" in kv:
            notes.append("RNG recorded: %s (use KSampler (inspire) noise_mode)" % kv["RNG"])

        info = text
        if notes:
            info = (text + "\n\n" if text else "") + "[Load Image (SD)]\n" + "\n".join(notes)
            print("[Load Image (SD)] " + " | ".join(notes))

        return (image_t, mask_t, width, height, pos, neg, seed, steps, cfg, sampler, scheduler,
                clip_skip, info)

    @classmethod
    def IS_CHANGED(s, image):
        return file_signature(folder_paths.get_annotated_filepath(image))

    @classmethod
    def VALIDATE_INPUTS(s, image):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


NODE_CLASS_MAPPINGS = {"LoadImageSD": LoadImageSD}
NODE_DISPLAY_NAME_MAPPINGS = {"LoadImageSD": "Load Image SD (GeN13)"}
