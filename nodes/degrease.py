# -*- coding: utf-8 -*-
"""
Degrease
========
人像去油膩與美顏。建議接在 Color Match Temporal 之後
(色調與飽和度的整體漂移由它處理,本節點處理它管不到的皮膚局部)。

參數命名比照美顏 App 的用語,全部 0 ~ 100,數值越高效果越強,0 為關閉:

  smooth    : 磨皮祛皺。膚色區域內朝保邊平滑後的底層收斂,毛孔、細紋、法令紋變淡;
              輪廓(下顎、髮際、唇線)由保邊濾波保留。
  deblemish : 祛斑祛痘。抹掉皮膚上「各方向都很小」的暗點(痣、斑、痘、雀斑),用周圍的膚色補上。
              以十六個方向的線段閉運算取最小值判定:暗點在每個方向都短,會被補平;
              髮絲、睫毛、皺紋在自己的走向上夠長,不會被當成暗點。
  deshine   : 去油光。只把膚色區域內「比周圍亮」的部分往下收(鼻樑、額頭、臉頰的反光),不是整體壓暗。
              區域以色相判定後取區域平均,所以反光本身(偏白、飽和度低)也算在皮膚內;白牆、白衣不受影響。
  even_tone : 勻膚。紅橘色相帶(HSV 色相中心 25°,兩側軟衰減)的色度朝全臉平均膚色收斂:
              泛紅斑塊變勻、血色保留,不往灰色收;只作用在皮膚區域,明度不變。
  decontour : 減立體。壓平中低頻的明暗起伏(過重的立體感)。底層用保邊的 guided filter 取得,
              輪廓不會像高斯模糊那樣發光起霧;最細一層紋理(約 1 px)原樣保留;只改明度不改色彩;
              只作用在皮膚區域(背景、頭髮、衣服不動)。

五官保護:smooth、deblemish、decontour 都避開「小而暗、但不是暗點」的特徵(眼睛、睫毛、眉毛、鼻孔、髮絲)
  及其周圍一圈。偵測用形態學黑帽(閉運算減原圖),先把暗點補平再偵測,所以痣不會被當成五官保護起來。
  只看明度,不需要人臉模型。

已知限制:暗點靠「小」來認。全身遠景時眼睛在畫面裡也只有幾個像素,可能被當成暗點;
  很深的暗點(瞳孔那種深度)一律不抹當作保險,但遠景仍請調低 deblemish。

全部為逐格獨立的確定性運算,不引入閃爍,不需時間軸平滑。只依賴 torch,不需額外安裝套件。

實測依據(2026-10-13,DaSiWa V4 Turbo 640x800,對首幀原圖量臉部皮膚內側):
  生成後中頻對比 +13~24%、低頻對比 +15~16%;細紋理與邊緣梯度都沒有高於原圖——
  「線條像被描過」來自局部對比與反光變重,不是邊緣變銳,所以不做任何降銳利的處理。
"""

import math

import torch
import torch.nn.functional as F

try:
    import comfy.model_management as mm
    import comfy.utils as comfy_utils
except Exception:          # 單獨測試時
    mm = None
    comfy_utils = None

CHUNK_PIXELS = 8_000_000   # 每批送進 GPU 的像素上限(0.5MP 約 16 格、1MP 約 8 格)
CHUNK_MAX = 16

CONTOUR_RADIUS = 4.0       # decontour 的作用尺度(短邊 %)
EDGE_EPS = 0.01            # decontour 的保邊門檻(明度 0..1 的變異數):起伏約 0.1 以下視為可壓平的局部對比,0.3 以上的輪廓保留
FINE_PX = 1                # decontour 保留的最細紋理半徑(px);小於此尺度的細節不動
SHADOW_LO, SHADOW_HI = 0.10, 0.35      # 暗部保護:底層明度低於 LO 完全不動,高於 HI 完全作用

SMOOTH_RADIUS = 1.5        # 磨皮的尺度(短邊 %)
SMOOTH_EPS = 0.004         # 磨皮的保邊門檻:起伏約 0.06 以下的紋理與淡陰影會被抹平,更強的輪廓保留

BLEMISH_RADIUS = 0.5       # 暗點的最大半徑(短邊 %);各方向都比這個小的暗點才算
BLEMISH_DIRS = 16          # 判定方向數(每 11.25° 一個);方向越多,斜向的細線越不會被誤認成暗點
BLEMISH_LO, BLEMISH_HI = 0.012, 0.035  # 比周圍暗不到 LO 不算暗點(一般膚質起伏),超過 HI 完全抹除
BLEMISH_MAX_LO, BLEMISH_MAX_HI = 0.24, 0.34   # 比周圍暗超過這個範圍的不抹:那種深度是瞳孔、鼻孔,不是痣(遠景時的保險)

SHINE_RADIUS = 3.0         # 去油光的周圍尺度(短邊 %);膚色區域也用這個尺度取平均
SHINE_EPS = 0.02           # 高光底層的保邊門檻:比 decontour 寬鬆,反光視為可壓的起伏
SHINE_KNEE = 0.02          # 軟膝:高出周圍不到此量的微小起伏幾乎不動,避免整片皮膚變暗
SHINE_BASE_LO, SHINE_BASE_HI = 0.45, 0.65   # 只在夠亮的皮膚上作用(暗處的亮點多半是眼神光、飾品)
REGION_LO, REGION_HI = 0.35, 0.70      # 區域內膚色像素比例低於 LO 不算皮膚,高於 HI 完全算

FEAT_RADIUS = 1.5          # 五官偵測:比此尺度(短邊 %)小的暗特徵視為五官
FEAT_GROW = 0.8            # 保護範圍往外擴的距離(短邊 %),把眼白、眼神光、睫毛根部一起包進去
FEAT_GROW_SPOT = 0.3       # 祛斑用的保護範圍只擴一點點:眼角、眉尾旁邊的痣才抹得到
FEAT_LO, FEAT_HI = 0.08, 0.20          # 比周圍暗不到 LO 不算五官(淡紋),超過 HI 完全保護

TONE_RADIUS = 20.0         # 勻膚取平均膚色的範圍(短邊 %):約整張臉,兩頰泛紅往全臉平均收
TONE_BOOST = 2.0           # 勻膚的膚色權重放大倍數(上限 1),淡的膚色也收得動
SKIN_HUE = 25.0            # 膚色色相帶中心(HSV 度)
SKIN_FULL = 13.0           # 中心 ± 此角度內完全作用
SKIN_ZERO = 35.0           # 中心 ± 此角度外完全不作用
SKIN_SAT_LO, SKIN_SAT_HI = 0.12, 0.50  # 飽和度加權:S 低於 LO 不動,高於 HI 完全作用
SKIN_VAL_LO, SKIN_VAL_HI = 0.08, 0.25  # 極暗處(色相不可靠)不動

_LUMA = (0.2126, 0.7152, 0.0722)       # Rec.709,作用於 sRGB 編碼值


def _smoothstep(x, lo, hi):
    t = ((x - lo) / (hi - lo)).clamp(0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _luma(x):
    """x: [B,H,W,3] -> [B,H,W]"""
    return x[..., 0] * _LUMA[0] + x[..., 1] * _LUMA[1] + x[..., 2] * _LUMA[2]


def _box(x, r):
    """方框平均(可分離,邊緣只計有效像素)。x: [B,C,H,W]"""
    k = 2 * r + 1
    x = F.avg_pool2d(x, (k, 1), stride=1, padding=(r, 0), count_include_pad=False)
    return F.avg_pool2d(x, (1, k), stride=1, padding=(0, r), count_include_pad=False)


def _dilate(x, r):
    """方形結構元素的最大值(可分離成兩次一維)。x: [B,C,H,W]"""
    k = 2 * r + 1
    x = F.max_pool2d(x, (k, 1), stride=1, padding=(r, 0))
    return F.max_pool2d(x, (1, k), stride=1, padding=(0, r))


def _closing(i, r):
    """形態學閉運算:填掉比 r 小的暗細節(眉、眼、鼻孔),亮斑保留。i: [B,C,H,W]"""
    return -_dilate(-_dilate(i, r), r)


def _line_offsets(r, n_dirs):
    """n_dirs 個方向、半長 r 的離散線段,每個方向一組 (dy, dx) 位移"""
    out = []
    for j in range(n_dirs):
        a = math.pi * j / n_dirs
        offs = sorted({(int(round(k * math.sin(a))), int(round(k * math.cos(a)))) for k in range(-r, r + 1)})
        if offs not in out:                                 # 半徑小時相鄰方向會落在同一組格點上,不重複計算
            out.append(offs)
    return out


def _line_max(x, offs, r):
    """沿一條離散線段取最大值。x: [B,C,H,W]"""
    h, w = x.shape[-2], x.shape[-1]
    p = F.pad(x, (r, r, r, r), mode="replicate")
    out = None
    for dy, dx in offs:
        s = p[..., r + dy:r + dy + h, r + dx:r + dx + w]
        out = s if out is None else torch.maximum(out, s)
    return out


def fill_spots(x, r, n_dirs=BLEMISH_DIRS):
    """把各方向都比 r 小的暗點補平。x: [B,C,H,W] -> 同形狀
    每個方向做一次線段閉運算(填掉在該方向上比線段短的暗處),再對所有方向取最小值:
    暗點在每個方向都短,每次都被填,取最小後仍是補平的;細線沿自己的走向夠長,那個方向不會被填,取最小後保留。"""
    out = None
    for offs in _line_offsets(r, n_dirs):
        c = -_line_max(-_line_max(x, offs, r), offs, r)     # 線段閉運算(線段對稱,膨脹與侵蝕用同一組位移)
        out = c if out is None else torch.minimum(out, c)
    return torch.maximum(out, x)                            # 閉運算只會變亮,取 max 消掉邊界數值誤差


def _guided(i, r, eps):
    """自導向 guided filter(He et al.)。i: [B,1,H,W] -> 保邊平滑後的底層"""
    mean = _box(i, r)
    var = (_box(i * i, r) - mean * mean).clamp(min=0.0)
    a = var / (var + eps)
    b = mean - a * mean
    return _box(a, r) * i + _box(b, r)


def _set_luma(x, y_old, y_new):
    """把明度由 y_old 換成 y_new、色彩不變;超出色域時朝明度軸收回以保色相(同 Luminosity 混合的 ClipColor)。"""
    c = x + (y_new - y_old).unsqueeze(-1)
    l = y_new.unsqueeze(-1)
    n = c.amin(dim=-1, keepdim=True)
    m = c.amax(dim=-1, keepdim=True)
    c = torch.where(n < 0.0, l + (c - l) * l / (l - n).clamp(min=1e-6), c)
    c = torch.where(m > 1.0, l + (c - l) * (1.0 - l) / (m - l).clamp(min=1e-6), c)
    return c


def _hue_sat_val(x):
    """x: [B,H,W,3] -> (HSV 色相度數, 飽和度, 明度)"""
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    mx = x.amax(dim=-1)
    c = mx - x.amin(dim=-1)
    cs = c.clamp(min=1e-6)
    h = torch.where(mx == r, (g - b) / cs,
        torch.where(mx == g, (b - r) / cs + 2.0, (r - g) / cs + 4.0)) * 60.0
    return h, c / mx.clamp(min=1e-6), mx


def _hue_dist(h, center):
    return ((h - center + 180.0) % 360.0 - 180.0).abs()      # 與色相帶中心的環狀距離


def skin_weight(x):
    """每像素的膚色權重 0..1(依飽和度加權,供 even_tone 用)。x: [B,H,W,3] -> [B,H,W]"""
    h, s, v = _hue_sat_val(x)
    w = 1.0 - _smoothstep(_hue_dist(h, SKIN_HUE), SKIN_FULL, SKIN_ZERO)
    return w * _smoothstep(s, SKIN_SAT_LO, SKIN_SAT_HI) * _smoothstep(v, SKIN_VAL_LO, SKIN_VAL_HI)


def skin_region(x, r):
    """膚色區域 0..1(供 smooth、deblemish、deshine 用):像素膚色度取區域平均,
    區域內偏白的反光、偏暗的痣也算皮膚。x: [B,H,W,3] -> [B,H,W]"""
    h, s, v = _hue_sat_val(x)
    w = 1.0 - _smoothstep(_hue_dist(h, 20.0), 18.0, 35.0)
    w = w * _smoothstep(s, 0.06, 0.16) * (1.0 - _smoothstep(s, 0.60, 0.80)) * _smoothstep(v, 0.30, 0.50)
    return _smoothstep(_box(w.unsqueeze(1), r).squeeze(1), REGION_LO, REGION_HI)


def feature_map(i, r_feat):
    """五官 0..1。i: 已補平暗點的明度 [B,1,H,W] -> [B,1,H,W]
    黑帽(閉運算 − 原圖)在小而暗的特徵(眼、眉、鼻孔、唇線、髮絲)上數值大。"""
    return _smoothstep(_closing(i, r_feat) - i, FEAT_LO, FEAT_HI)


def feature_protect(feat, r_grow):
    """五官保護 0..1(1 = 可處理,0 = 完全不動)。feat: feature_map 的結果 -> [B,H,W]
    往外擴一圈後柔化邊界;多擴一倍,柔化後 r_grow 以內仍是完全保護。"""
    return 1.0 - _box(_dilate(feat, 2 * r_grow), r_grow).squeeze(1)


def _retouch(x, smooth, deblemish, deshine, decontour, r, r_smooth, r_shine, r_feat, r_grow, r_grow_spot, r_spot):
    """x: [B,H,W,3] 0..1;四個量皆 0..1。先祛斑(動到色彩),其餘三項只改明度、合併成一次明度替換。"""
    region = skin_region(x, r_shine) if (smooth > 0 or deblemish > 0 or deshine > 0 or decontour > 0) else None
    protect = None
    if smooth > 0 or deblemish > 0 or decontour > 0:
        xc = x.permute(0, 3, 1, 2)
        filled = fill_spots(xc, r_spot).permute(0, 2, 3, 1)             # 暗點補平後的影像(三個通道一起補,痣的顏色也蓋掉)
        y_filled = _luma(filled)
        feat = feature_map(y_filled.unsqueeze(1), r_feat)                # 用補平後的明度偵測:痣不算五官
        protect = feature_protect(feat, r_grow)
        if deblemish > 0:
            depth = y_filled - _luma(x)
            deepest = _dilate(depth.unsqueeze(1), r_spot).squeeze(1)       # 整顆暗點最深的地方(邊緣的像素也跟著整顆一起判定)
            gate = _smoothstep(depth, BLEMISH_LO, BLEMISH_HI) * (1.0 - _smoothstep(deepest, BLEMISH_MAX_LO, BLEMISH_MAX_HI))
            gate = gate * feature_protect(feat, r_grow_spot)             # 眼睛、眉毛內部的小暗點(瞳孔、睫毛尖)不算痣
            x = x + (deblemish * region * gate).unsqueeze(-1) * (filled - x)

    y = _luma(x)
    i = y.unsqueeze(1)
    y_new = y
    if smooth > 0:
        base = _guided(i, r_smooth, SMOOTH_EPS).squeeze(1)
        y_new = y_new + smooth * region * protect * (base - y)
    if decontour > 0:
        base = _guided(i, r, EDGE_EPS)
        fine = _guided(i, FINE_PX, EDGE_EPS) if FINE_PX < r else i
        mid = (fine - base).squeeze(1)                     # 中低頻局部對比(最細一層除外)
        y_new = y_new - decontour * region * _smoothstep(base.squeeze(1), SHADOW_LO, SHADOW_HI) * protect * mid
    if deshine > 0:
        # 周圍底層先做閉運算:暗五官才不會把底層往下拉、害旁邊的皮膚被誤判成「比周圍亮」
        base = _guided(_closing(i, max(1, r_shine // 2)), r_shine, SHINE_EPS).squeeze(1)
        pos = (y_new - base).clamp(min=0.0)                # 只取比周圍亮的部分
        pos = pos * pos / (pos + SHINE_KNEE)               # 軟膝
        y_new = y_new - deshine * region * _smoothstep(base, SHINE_BASE_LO, SHINE_BASE_HI) * pos
    return _set_luma(x, y, y_new.clamp(0.0, 1.0))


def _even_tone(x, amount):
    """x: [B,H,W,3] 0..1;amount: 0..1。膚色色度朝周圍皮膚的平均色度收斂:泛紅斑塊變勻、血色保留(不往灰色收),
    明度不變,只作用在皮膚區域。"""
    h, w = x.shape[1], x.shape[2]
    wt = (skin_weight(x) * TONE_BOOST).clamp(max=1.0)
    region = skin_region(x, radius_px(h, w, SHINE_RADIUS))
    y = _luma(x).unsqueeze(-1)
    c = x - y                                              # 色度(去掉明度)
    r = radius_px(h, w, TONE_RADIUS)
    cw = (c * region.unsqueeze(-1)).permute(0, 3, 1, 2)
    target = (_box(cw, r) / _box(region.unsqueeze(1), r).clamp(min=1e-4)).permute(0, 2, 3, 1)   # 周圍皮膚的平均色度
    k = (amount * wt * region).unsqueeze(-1)
    return y + c + k * (target - c)


def radius_px(h, w, radius):
    return max(1, int(round(min(h, w) * radius / 100.0)))


def degrease(images, smooth=30.0, deblemish=80.0, deshine=15.0, even_tone=10.0, decontour=10.0, device=None):
    """images: [B,H,W,C] 0..1 -> [B,H,W,3] float32(CPU);五個量皆 0..100"""
    img = images[..., :3]
    if smooth <= 0 and deblemish <= 0 and deshine <= 0 and even_tone <= 0 and decontour <= 0:
        return img
    if device is None:
        device = mm.get_torch_device() if mm else torch.device("cpu")
    n, h, w = img.shape[0], img.shape[1], img.shape[2]
    r = radius_px(h, w, CONTOUR_RADIUS)
    r_smooth, r_shine = radius_px(h, w, SMOOTH_RADIUS), radius_px(h, w, SHINE_RADIUS)
    r_feat, r_grow = radius_px(h, w, FEAT_RADIUS), radius_px(h, w, FEAT_GROW)
    r_grow_spot = radius_px(h, w, FEAT_GROW_SPOT)
    r_spot = radius_px(h, w, BLEMISH_RADIUS)
    chunk = max(1, min(CHUNK_MAX, CHUNK_PIXELS // max(1, h * w)))
    pbar = comfy_utils.ProgressBar(n) if comfy_utils else None

    out = torch.empty((n, h, w, 3), dtype=torch.float32, device="cpu")
    for s in range(0, n, chunk):
        if mm:
            mm.throw_exception_if_processing_interrupted()
        x = img[s:s + chunk].to(device, torch.float32).clamp(0.0, 1.0)   # 可能與輸入共用記憶體,不可原地改寫
        if smooth > 0 or deblemish > 0 or deshine > 0 or decontour > 0:
            x = _retouch(x, smooth / 100.0, deblemish / 100.0, deshine / 100.0, decontour / 100.0,
                         r, r_smooth, r_shine, r_feat, r_grow, r_grow_spot, r_spot)
        if even_tone > 0:
            x = _even_tone(x, even_tone / 100.0)
        out[s:s + chunk] = x.clamp(0.0, 1.0).cpu()
        if pbar:
            pbar.update(x.shape[0])
    return out


class Degrease:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "Frames: connect after Color Match Temporal."}),
                "enabled": ("BOOLEAN", {
                    "default": True, "label_on": "ACTIVE", "label_off": "BYPASS",
                    "tooltip": "Enabled: BYPASS outputs the frames unchanged."}),
                "smooth": ("FLOAT", {
                    "default": 30.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Skin smoothing: higher values soften pores, fine lines and smile lines more."}),
                "deblemish": ("FLOAT", {
                    "default": 80.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Blemish removal: higher values fade moles, spots and acne more."}),
                "deshine": ("FLOAT", {
                    "default": 15.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Shine removal: higher values reduce oily highlights on skin more."}),
                "even_tone": ("FLOAT", {
                    "default": 10.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Tone evening: higher values even out reddish-orange skin more."}),
                "decontour": ("FLOAT", {
                    "default": 10.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Contour flattening: higher values soften light and shadow across the face more."}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "run"
    CATEGORY = "GeN13/color"
    DESCRIPTION = "Portrait retouching that removes the greasy look: skin smoothing, blemish removal, shine removal, tone evening and contour flattening, with eyes and other features protected. 0 turns each effect off; higher values are stronger."

    def run(self, images, enabled, smooth, deblemish, deshine, even_tone, decontour):
        if not enabled:                                    # BYPASS:原樣傳下去(經 API 送出的工作流也能用這個欄位停用)
            return (images,)
        out = degrease(images, smooth, deblemish, deshine, even_tone, decontour)
        if images.shape[-1] == 4:                          # 保留 alpha:ACTIVE 與 BYPASS 輸出的通道數一致
            out = torch.cat([out, images[..., 3:].cpu().float()], dim=-1)
        return (out,)


NODE_CLASS_MAPPINGS = {"DegreaseGeN13": Degrease}
NODE_DISPLAY_NAME_MAPPINGS = {"DegreaseGeN13": "Degrease (GeN13)"}
