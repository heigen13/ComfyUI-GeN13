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
              另抹紅點(2026-10-23):比周圍紅、但不一定比較暗的痘痘與小突起,判定尺度較大(近景時臉在畫面裡大,
              痘痘也大),只認「綠藍掉得比紅多」的點,所以唇、腮紅這種大片或長條的紅不會被當成紅點。
  deshine   : 去油光。只把膚色區域內「比周圍亮」的部分往下收(鼻樑、額頭、臉頰的反光),不是整體壓暗。
              區域以色相判定後取區域平均,所以反光本身(偏白、飽和度低)也算在皮膚內;白牆、白衣不受影響。
  even_tone : 勻膚。紅橘色相帶(HSV 色相中心 25°,兩側軟衰減)的色度朝全臉平均膚色收斂:
              泛紅斑塊變勻、血色保留,不往灰色收;只作用在皮膚區域,明度不變。
  decontour : 減立體。壓平中低頻的明暗起伏(過重的立體感)。底層用保邊的 guided filter 取得,
              輪廓不會像高斯模糊那樣發光起霧;最細一層紋理(約 1 px)原樣保留;只改明度不改色彩;
              只作用在皮膚區域(背景、頭髮、衣服不動)。
  cool_fair : 冷白皮(2026-10-23 重寫)。先量整批(影片整段)皮膚的平均 Lab,算出平均要乘多少(a*、b*)、
              加多少(L*)才到冷白皮目標(亮 70、紅 9、黃 7,偏粉),再把同一組比例與位移套到每個皮膚像素:
              平均落在目標、兩頰與陰影的相對起伏保留,不會整張臉變成同一個顏色。
              比例最多 1、位移最少 0:本來就比目標白、冷的皮膚不動;比例最少 0.5、提亮最多 +14:
              深膚色、暖皮開到 100 是「冷一點、亮一點、粉一點的同一個人」,不是硬拉成白皮。
              影片整段只算一組數值,不閃爍。提亮整片等量(L* 88 以上漸減),明暗與毛孔紋理保留。
              皮膚以 Lab 膚色帶(含暖皮色相 54–70°)× 周圍密度判定;牆、燈罩、床單(彩度低)、木櫃(暗)、
              木地板與金屬燈座(色相 70° 以上)不作用。唇(色相偏洋紅「且」彩度高)不作用。0 為關閉(預設)。

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
RED_RADIUS = 2.0           # 紅點的最大半徑(短邊 %):比暗點大,近景的痘痘才抓得到
RED_LO, RED_HI = 1.0, 4.0              # 比周圍紅出的 a* 量:不到 LO 不算紅點(一般血色起伏),超過 HI 完全抹除
RED_FEAT_LO, RED_FEAT_HI = 0.16, 0.30  # 紅點用的五官門檻:比周圍暗這麼多才算五官(痘痘只略暗,眼、眉、鼻孔遠超過)

FAIR_TARGET_L = 70.0       # 冷白皮目標:皮膚平均 L*(實測亞洲白皮臉 62–66、暖皮手部陰影 52)
FAIR_TARGET_A = 9.0        # 冷白皮目標:皮膚平均 a*(紅)(實測 14–20)
FAIR_TARGET_B = 7.0        # 冷白皮目標:皮膚平均 b*(黃)(實測 15–22);黃收得比紅多 = 偏粉的冷白
FAIR_MIN_SCALE = 0.5       # a*、b* 比例的下限:彩度最多收一半,深膚色、暖皮不會被收成灰
FAIR_MAX_LIFT = 14.0       # L* 提亮上限(整片等量,L* 88 以上漸減到 0 避免高光爆掉)
FAIR_SKIN_HUE = (20.0, 28.0, 64.0, 72.0)   # Lab 膚色帶:色相 20–28 起、64–72 止(實測臉 36–45°、腰與大腿內側 52–69°、
                                           # 木地板 70°、金屬燈座 83°)
FAIR_SKIN_CHROMA = (8.0, 12.0, 32.0, 40.0)  # 彩度 8–12 起、32–40 止(牆、燈罩、床單、窗簾 < 10;唇 30–42 另由唇色判定排除)
FAIR_SKIN_L = (35.0, 45.0, 85.0, 93.0)      # 明度 35–45 起、85–93 止(木櫃 L 10–30)
FAIR_DENSITY = 3.0         # 周圍密度的尺度(短邊 %):膚色像素在周圍占 REGION_LO–HI 才算皮膚,零星同色的木紋、布料不算
FAIR_FEATHER = 0.5         # 皮膚遮罩邊緣的羽化(短邊 %),避免遮罩邊界出現一塊白一塊黃
FAIR_LIP_HUE = (14.0, 24.0)           # 唇色判定(一):Lab 色相低於上限開始算、低於下限完全算(實測唇 16–22°、皮膚 24–54°)
FAIR_LIP_CHROMA = (26.0, 36.0)        # 唇色判定(二):彩度高於下限開始算、高於上限完全算(實測唇 30–42、皮膚 11–24);
                                      # 兩個條件相乘,只有「偏洋紅且高彩度」才是唇;臉上低彩度的紅斑不算,會一起收

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


def _retouch(x, smooth, deblemish, deshine, decontour, r, r_smooth, r_shine, r_feat, r_grow, r_grow_spot, r_spot, r_red):
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
            # 紅點:在 Lab 的 a*(紅)上做同樣的線段補平,尺度較大;只把「比周圍紅的小點」的紅收回周圍的值,
            # 偏暗的也順便補亮。長條的唇線、大片腮紅在某個方向夠長,補不平,所以不會被當成紅點
            L, a, b = _to_lab(x.clamp(0.0, 1.0))
            a_fill = -fill_spots(-a.unsqueeze(1), r_red).squeeze(1)
            L_fill = fill_spots(L.unsqueeze(1), r_red).squeeze(1)
            # 五官保護改用「夠暗」的五官(眼、眉、鼻孔):紅色痘痘本身也略暗,用一般門檻會被當成五官保護起來
            yf = y_filled.unsqueeze(1)
            strong = _smoothstep(_closing(yf, r_feat) - yf, RED_FEAT_LO, RED_FEAT_HI)
            gate_r = deblemish * region * _smoothstep(a - a_fill, RED_LO, RED_HI) * feature_protect(strong, r_grow_spot)
            x = _from_lab(L + gate_r * (L_fill - L), a - gate_r * (a - a_fill), b)

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


_M_RGB2XYZ = ((0.4124564, 0.3575761, 0.1804375), (0.2126729, 0.7151522, 0.0721750), (0.0193339, 0.1191920, 0.9503041))
_WHITE = (0.95047, 1.0, 1.08883)


def _to_lab(x):
    """sRGB 0..1 [B,H,W,3] -> L*(0..100)、a*、b*"""
    lin = torch.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
    m = torch.tensor(_M_RGB2XYZ, dtype=x.dtype, device=x.device)
    xyz = lin @ m.T / torch.tensor(_WHITE, dtype=x.dtype, device=x.device)
    f = torch.where(xyz > 0.008856, xyz.clamp(min=1e-8) ** (1.0 / 3.0), 7.787 * xyz + 16.0 / 116.0)
    return 116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])


def _from_lab(L, a, b):
    fy = (L + 16.0) / 116.0
    f = torch.stack([fy + a / 500.0, fy, fy - b / 200.0], dim=-1)
    xyz = torch.where(f > 0.206893, f ** 3, (f - 16.0 / 116.0) / 7.787) * torch.tensor(_WHITE, dtype=L.dtype, device=L.device)
    m = torch.tensor(_M_RGB2XYZ, dtype=L.dtype, device=L.device)
    lin = (xyz @ torch.linalg.inv(m).T).clamp(min=0.0)
    return torch.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin.clamp(min=1e-8) ** (1.0 / 2.4) - 0.055)


def _fair_weight(x, r_density, r_feather):
    """冷白皮作用權重 0..1 與 Lab。x: [B,H,W,3] 0..1 -> (k [B,H,W], L, a, b)
    Lab 膚色帶 × 周圍密度,羽化後扣掉唇。"""
    L, a, b = _to_lab(x)
    hue = torch.rad2deg(torch.atan2(b, a))
    chroma = torch.hypot(a, b)
    h0, h1, h2, h3 = FAIR_SKIN_HUE
    c0, c1, c2, c3 = FAIR_SKIN_CHROMA
    l0, l1, l2, l3 = FAIR_SKIN_L
    w = (_smoothstep(hue, h0, h1) * (1.0 - _smoothstep(hue, h2, h3)) *
         _smoothstep(chroma, c0, c1) * (1.0 - _smoothstep(chroma, c2, c3)) *
         _smoothstep(L, l0, l1) * (1.0 - _smoothstep(L, l2, l3)))
    w = w.unsqueeze(1)
    w = w * _smoothstep(_box(w, r_density), REGION_LO, REGION_HI)
    w = _box(_box(w, r_feather), r_feather).squeeze(1)      # 兩次方框 ≈ 三角羽化
    lip = (1.0 - _smoothstep(hue, *FAIR_LIP_HUE)) * _smoothstep(chroma, *FAIR_LIP_CHROMA)
    return w * (1.0 - lip), L, a, b


def _fair_stats(x, r_density, r_feather):
    """皮膚權重總和與 L*、a*、b* 的加權總和(供整批算一組比例)。-> tensor [4](float64)"""
    k, L, a, b = _fair_weight(x, r_density, r_feather)
    return torch.stack([k.sum(), (k * L).sum(), (k * a).sum(), (k * b).sum()]).double()


def _fair_params(stats, amount):
    """stats: _fair_stats 的累加;amount 0..1 -> (a* 比例, b* 比例, L* 位移)。皮膚太少時不作用。"""
    wsum = float(stats[0])
    if wsum < 1.0:
        return 1.0, 1.0, 0.0
    mL, ma, mb = (float(v) / wsum for v in stats[1:])
    def scale(mean, target):
        full = min(1.0, max(FAIR_MIN_SCALE, target / mean)) if mean > 1e-3 else 1.0
        return 1.0 - amount * (1.0 - full)
    lift = amount * min(FAIR_MAX_LIFT, max(0.0, FAIR_TARGET_L - mL))
    return scale(ma, FAIR_TARGET_A), scale(mb, FAIR_TARGET_B), lift


def _cool_fair(x, params, r_density, r_feather):
    """x: [B,H,W,3] 0..1;params: _fair_params 的結果。同一組比例與位移套到每個皮膚像素,相對起伏保留。"""
    sa, sb, lift = params
    k, L, a, b = _fair_weight(x, r_density, r_feather)
    a2 = a * (1.0 + (sa - 1.0) * k)
    b2 = b * (1.0 + (sb - 1.0) * k)
    L2 = L + k * lift * (1.0 - _smoothstep(L, 88.0, 100.0))
    return _from_lab(L2, a2, b2)


def radius_px(h, w, radius):
    return max(1, int(round(min(h, w) * radius / 100.0)))


def degrease(images, smooth=30.0, deblemish=80.0, deshine=15.0, even_tone=10.0, decontour=10.0, cool_fair=0.0, device=None):
    """images: [B,H,W,C] 0..1 -> [B,H,W,3] float32(CPU);六個量皆 0..100"""
    img = images[..., :3]
    if smooth <= 0 and deblemish <= 0 and deshine <= 0 and even_tone <= 0 and decontour <= 0 and cool_fair <= 0:
        return img.cpu().float()                           # 與正常路徑一致(CPU float32),run() 接回 alpha 時才不會 device 不一致
    if device is None:
        device = mm.get_torch_device() if mm else torch.device("cpu")
    n, h, w = img.shape[0], img.shape[1], img.shape[2]
    r = radius_px(h, w, CONTOUR_RADIUS)
    r_smooth, r_shine = radius_px(h, w, SMOOTH_RADIUS), radius_px(h, w, SHINE_RADIUS)
    r_feat, r_grow = radius_px(h, w, FEAT_RADIUS), radius_px(h, w, FEAT_GROW)
    r_grow_spot = radius_px(h, w, FEAT_GROW_SPOT)
    r_spot = radius_px(h, w, BLEMISH_RADIUS)
    r_red = radius_px(h, w, RED_RADIUS)
    r_fair, r_feather = radius_px(h, w, FAIR_DENSITY), radius_px(h, w, FAIR_FEATHER)
    chunk = max(1, min(CHUNK_MAX, CHUNK_PIXELS // max(1, h * w)))
    pbar = comfy_utils.ProgressBar(n) if comfy_utils else None

    fair = None
    if cool_fair > 0:                                      # 先量整批皮膚平均,整段影片只算一組比例(不閃爍)
        stats = torch.zeros(4, dtype=torch.float64)
        for s in range(0, n, chunk):
            if mm:
                mm.throw_exception_if_processing_interrupted()
            stats += _fair_stats(img[s:s + chunk].to(device, torch.float32).clamp(0.0, 1.0), r_fair, r_feather).cpu()
        fair = _fair_params(stats, cool_fair / 100.0)

    out = torch.empty((n, h, w, 3), dtype=torch.float32, device="cpu")
    for s in range(0, n, chunk):
        if mm:
            mm.throw_exception_if_processing_interrupted()
        x = img[s:s + chunk].to(device, torch.float32).clamp(0.0, 1.0)   # 可能與輸入共用記憶體,不可原地改寫
        if smooth > 0 or deblemish > 0 or deshine > 0 or decontour > 0:
            x = _retouch(x, smooth / 100.0, deblemish / 100.0, deshine / 100.0, decontour / 100.0,
                         r, r_smooth, r_shine, r_feat, r_grow, r_grow_spot, r_spot, r_red)
        if even_tone > 0:
            x = _even_tone(x, even_tone / 100.0)
        if fair is not None:
            x = _cool_fair(x.clamp(0.0, 1.0), fair, r_fair, r_feather)
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
                    "tooltip": "Blemish removal: higher values fade moles, spots, acne and red bumps more."}),
                "deshine": ("FLOAT", {
                    "default": 15.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Shine removal: higher values reduce oily highlights on skin more."}),
                "even_tone": ("FLOAT", {
                    "default": 10.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Tone evening: higher values even out reddish-orange skin more."}),
                "decontour": ("FLOAT", {
                    "default": 10.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Contour flattening: higher values soften light and shadow across the face more."}),
            },
            # 選填:舊工作流與 API 範本沒有這個欄位時照 0(關閉)跑,不用重匯也不會驗證失敗
            "optional": {
                "cool_fair": ("FLOAT", {
                    "default": 0.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Cool fair skin: higher values move skin toward a lighter, cooler tone; lips keep their color."}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "run"
    CATEGORY = "GeN13/color"
    DESCRIPTION = "Portrait retouching that removes the greasy look: skin smoothing, blemish removal, shine removal, tone evening, contour flattening and cool fair skin, with eyes and other features protected. 0 turns each effect off; higher values are stronger."

    def run(self, images, enabled, smooth, deblemish, deshine, even_tone, decontour, cool_fair=0.0):
        if not enabled:                                    # BYPASS:原樣傳下去(經 API 送出的工作流也能用這個欄位停用)
            return (images,)
        out = degrease(images, smooth, deblemish, deshine, even_tone, decontour, cool_fair)
        if images.shape[-1] == 4:                          # 保留 alpha:ACTIVE 與 BYPASS 輸出的通道數一致
            out = torch.cat([out, images[..., 3:].cpu().float()], dim=-1)
        return (out,)


NODE_CLASS_MAPPINGS = {"DegreaseGeN13": Degrease}
NODE_DISPLAY_NAME_MAPPINGS = {"DegreaseGeN13": "Degrease (GeN13)"}
