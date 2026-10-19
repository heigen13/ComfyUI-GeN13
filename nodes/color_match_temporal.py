# -*- coding: utf-8 -*-
"""
Color Match Temporal
====================
把影片影格的光影與色調對位到參考圖(通常是圖生影片的首幀圖)。

  temporal : 逐格計算色彩統計,沿時間軸以高斯權重平滑後再求校正,
             修正漸進漂移、不會像逐格 ColorMatch 一樣閃爍;
             平滑不跨過亮度跳變(圖生影片開頭一兩格是原圖,之後才跳到生成色調)
  global   : 整段影格合併成一組統計,全片共用同一個校正(等同一個 LUT)

演算法:
  white balance : 只修色偏、亮度與對比完全照原片(預設,2026-10-14)。
                  2026-10-19 起改量「沒動的背景」:每格與鏡頭開頭幾格逐像素比對,扣除整體明暗變化後亮度幾乎沒變的
                  像素(牆、地面、家具)才算沒動,人物、衣服因為在動自動被排除;沒動像素在開頭與這一格的顏色比值
                  就是真正的漂移量。舊法拿「接近白灰的像素」量色偏,人像片裡那群像素其實是白上衣與灰外套——
                  模型把衣服畫得偏米色就被判成整張偏暖、整段往藍推,背景真的漂了反而量不到(2026-10-19 實測)。
                  沒動像素太少(大幅運鏡)才退回舊法,且上限鎖 8%,寧可少修。
                  量出的偏差以線性光三色增益拉回,每個像素亮度維持原值;影片本身變亮變暗不修(硬拉亮度會把膚色推怪)。
  reinhard      : Lab 空間各通道平均值與標準差對位(與 color-matcher 套件同名方法一致)
  mkl           : RGB 空間 Monge-Kantorovich 線性映射(3x3 矩陣 + 位移,同上)

色階曲線(tone_curve):校正後的亮度怎麼分配(只用於 mkl、reinhard;white balance 亮度照原片)
  gamma    : 亮度走黑白端點不動的 gamma 曲線(每格求 γ,使平均亮度等於參考圖),色彩仍用上列演算法的結果。
             圖生影片的漂移近似 gamma(中間調變暗、黑白兩端不動),用線性映射拉回會把暗部墊高、亮部推爆,
             並連帶放大皮膚的局部對比;gamma 曲線三者都不會。
  linear   : 亮度直接用演算法的線性結果(2026-10-13 以前的行為)

換鏡頭後(after_cut):偵測只跟前一格比,不跟參考圖比——人物轉頭、走動、運鏡都是每格小變,
  換鏡頭是相鄰兩格突然大變;以「這一格的差 ÷ 前後幾格差的中位數」判定(自適應,不隨素材調門檻)。
  match new shot start     : 第一個鏡頭對首幀,之後每個鏡頭各自對「自己的頭幾格」——只修鏡頭內的漸進漂移,
                             不碰鏡頭之間的差異(預設:模型切鏡那一瞬間的顏色通常是對的,漂移是之後才累積)
  always match first frame : 不偵測,整段對首幀(同場景換景別時,特寫的整張統計會被拉向全身照,膚色略偏)
  stop when new shot       : 第一刀之後的影格與首幀無關,保留原色不校正(換場景的多鏡頭素材)
  偵測換鏡頭時,時間平滑都不跨過切點。

只依賴 torch,不需額外安裝套件。
"""

import math
import os
import re

import torch
import torch.nn.functional as F

try:
    import comfy.model_management as mm
    import folder_paths
except Exception:          # 單獨測試時
    mm = None
    folder_paths = None

STAT_SIDE = 256            # 統計用縮圖的長邊(只影響統計,不影響輸出解析度)
CHUNK = 8                  # 套用時每批送進 GPU 的影格數
CUBE_SIZE = 33
EPS = 1e-8
TONE_BINS = 256            # 亮度直方圖格數(求 gamma 用)
GAMMA_MIN, GAMMA_MAX = 0.4, 2.5   # gamma 上下限:畫面內容與參考圖差太多時不至於拉到離譜
_LUMA = (0.2126, 0.7152, 0.0722)  # Rec.709,作用於 sRGB 編碼值
STEP_SIGMA = 0.012         # 跳變門檻:相鄰兩格平均亮度差約 0.03 以上視為跳變,時間平滑不跨過去;0 為關閉(舊版行為)


# ─────────────────────────────────────────────────────────────
# sRGB <-> Lab (D65)
# ─────────────────────────────────────────────────────────────
_M = torch.tensor([[0.4124564, 0.3575761, 0.1804375],
                   [0.2126729, 0.7151522, 0.0721750],
                   [0.0193339, 0.1191920, 0.9503041]], dtype=torch.float64)
_WHITE = torch.tensor([0.95047, 1.0, 1.08883], dtype=torch.float64)
_D = 6.0 / 29.0


def rgb_to_lab(x):
    """x: [..., 3] sRGB 0..1 -> Lab"""
    m = _M.to(x.device, x.dtype)
    w = _WHITE.to(x.device, x.dtype)
    lin = torch.where(x <= 0.04045, x / 12.92, ((x.clamp(min=0) + 0.055) / 1.055) ** 2.4)
    xyz = (lin @ m.T) / w
    f = torch.where(xyz > _D ** 3, xyz.clamp(min=EPS) ** (1.0 / 3.0), xyz / (3 * _D * _D) + 4.0 / 29.0)
    L = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return torch.stack([L, a, b], dim=-1)


def lab_to_rgb(x):
    """Lab -> sRGB 0..1(未 clamp)"""
    m_inv = torch.linalg.inv(_M).to(x.device, x.dtype)
    w = _WHITE.to(x.device, x.dtype)
    fy = (x[..., 0] + 16.0) / 116.0
    fx = fy + x[..., 1] / 500.0
    fz = fy - x[..., 2] / 200.0
    f = torch.stack([fx, fy, fz], dim=-1)
    xyz = torch.where(f > _D, f ** 3, 3 * _D * _D * (f - 4.0 / 29.0)) * w
    lin = (xyz @ m_inv.T).clamp(min=0)
    return torch.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1.0 / 2.4) - 0.055)


# ─────────────────────────────────────────────────────────────
# 統計:每格的一階與二階動差(平滑動差再求變異數,數學上等同混合分佈)
# ─────────────────────────────────────────────────────────────
def _small(frames):
    """[B,H,W,3] -> 統計用縮圖 [B,h,w,3]"""
    b, h, w, c = frames.shape
    s = STAT_SIDE / max(h, w)
    if s >= 1.0:
        return frames
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    t = frames.permute(0, 3, 1, 2)
    t = F.interpolate(t, size=(nh, nw), mode="area")
    return t.permute(0, 2, 3, 1)


def frame_moments(frames, method, device):
    """回傳 (mean [B,3], second [B,3] 或 [B,3,3]),float64"""
    out_m, out_s = [], []
    for i in range(0, frames.shape[0], CHUNK):
        x = _small(frames[i:i + CHUNK].to(device, torch.float32)).to(torch.float64)
        if method == "reinhard":
            x = rgb_to_lab(x)
        x = x.reshape(x.shape[0], -1, 3)
        out_m.append(x.mean(dim=1).cpu())
        if method == "reinhard":
            out_s.append((x * x).mean(dim=1).cpu())
        else:
            out_s.append((x.transpose(1, 2) @ x / x.shape[1]).cpu())
    return torch.cat(out_m), torch.cat(out_s)


def _luma(x):
    """x: [..., 3] -> [...]"""
    return x[..., 0] * _LUMA[0] + x[..., 1] * _LUMA[1] + x[..., 2] * _LUMA[2]


def luma_hist(frames, device):
    """每格的亮度直方圖 [B,TONE_BINS](取自統計用縮圖),float64、每格總和為 1"""
    out = []
    for i in range(0, frames.shape[0], CHUNK):
        y = _luma(_small(frames[i:i + CHUNK].to(device, torch.float32))).clamp(0.0, 1.0)
        idx = (y * (TONE_BINS - 1) + 0.5).long().reshape(y.shape[0], -1)
        h = torch.zeros((y.shape[0], TONE_BINS), dtype=torch.float64, device=idx.device)
        h.scatter_add_(1, idx, torch.ones(idx.shape, dtype=torch.float64, device=idx.device))
        out.append((h / h.sum(dim=1, keepdim=True)).cpu())
    return torch.cat(out)


def solve_gamma(hist, target):
    """hist: [B,TONE_BINS];回傳每格的 γ [B],使 Σ h·c^γ = target。
    平均亮度對 γ 單調遞減,在對數域二分;無解(全黑、全白)時停在上下限。"""
    c = torch.arange(TONE_BINS, dtype=torch.float64) / (TONE_BINS - 1)
    lo = torch.full((hist.shape[0],), math.log(GAMMA_MIN), dtype=torch.float64)
    hi = torch.full((hist.shape[0],), math.log(GAMMA_MAX), dtype=torch.float64)
    for _ in range(40):
        mid = (lo + hi) / 2
        m = (hist * c[None, :] ** mid.exp()[:, None]).sum(dim=1)
        brighter = m > target                     # 還太亮 → γ 要更大
        lo = torch.where(brighter, mid, lo)
        hi = torch.where(brighter, hi, mid)
    return ((lo + hi) / 2).exp()


def hist_mean(hist):
    c = torch.arange(TONE_BINS, dtype=torch.float64) / (TONE_BINS - 1)
    return (hist * c[None, :]).sum(dim=1)


def _set_luma(x, y_old, y_new):
    """把亮度由 y_old 換成 y_new、色彩不變;超出色域時朝亮度軸收回以保色相(同 Luminosity 混合的 ClipColor)。"""
    c = x + (y_new - y_old).unsqueeze(-1)
    l = y_new.unsqueeze(-1)
    n = c.amin(dim=-1, keepdim=True)
    m = c.amax(dim=-1, keepdim=True)
    c = torch.where(n < 0.0, l + (c - l) * l / (l - n).clamp(min=1e-6), c)
    c = torch.where(m > 1.0, l + (c - l) * (1.0 - l) / (m - l).clamp(min=1e-6), c)
    return c


def step_barrier(guide, radius):
    """guide: 每格平均亮度 [n]。回傳 [n,n]:第 i、j 格之間最大的「相鄰兩格亮度差」。
    圖生影片開頭一兩格幾乎是原圖,之後才跳到生成結果的色調;平滑若跨過這個跳變,
    開頭幾格會被校正過頭、接著突然掉下來(畫面閃一下)。"""
    n = guide.shape[0]
    d = (guide[1:] - guide[:-1]).abs().to(torch.float64)
    b = torch.zeros((n, n), dtype=torch.float64)
    for off in range(1, min(radius, n - 1) + 1):
        i = torch.arange(n - off)
        b[i, i + off] = torch.maximum(b[i, i + off - 1], d[i + off - 1])
        b[i + off, i] = b[i, i + off]
    return b


def smooth(t, radius, mode, guide=None, seg=None):
    """沿第 0 維(時間)加權平均。global:全部等權(seg 有值時各鏡頭各自一組);temporal:高斯,邊緣截斷後重新正規化。
    給 guide(每格平均亮度)時,平滑不跨過亮度跳變;給 seg(每格鏡頭編號 [n])時,平滑不跨過換鏡頭。"""
    n = t.shape[0]
    flat = t.reshape(n, -1)
    if mode == "global":
        if seg is None or int(seg.max()) == 0:
            return flat.mean(dim=0, keepdim=True).expand(n, -1).reshape(t.shape)
        out = torch.empty_like(flat)
        for k in range(int(seg.max()) + 1):
            m = seg == k
            out[m] = flat[m].mean(dim=0, keepdim=True)
        return out.reshape(t.shape)
    if radius <= 0 or n == 1:
        return t
    idx = torch.arange(n, dtype=torch.float64)
    sigma = max(radius / 2.0, 0.5)
    w = torch.exp(-0.5 * ((idx[:, None] - idx[None, :]) / sigma) ** 2)
    w = w * ((idx[:, None] - idx[None, :]).abs() <= radius)
    if guide is not None and STEP_SIGMA > 0:
        w = w * torch.exp(-0.5 * (step_barrier(guide, int(radius)) / STEP_SIGMA) ** 2)
    if seg is not None:
        w = w * (seg[:, None] == seg[None, :])
    w = w / w.sum(dim=1, keepdim=True)
    return (w @ flat).reshape(t.shape)


# ─────────────────────────────────────────────────────────────
# 校正參數
# ─────────────────────────────────────────────────────────────
MKL_REG = 1e-5             # 共變異數正則項(色值 0..1 下約 std 0.003,低於 8-bit 一階),壓住雜訊方向的放大


def _sqrt_psd(c, floor):
    d, u = torch.linalg.eigh(c)
    return u, d.clamp(min=floor).sqrt()


def mkl_matrix(cs, ct):
    """Pitie & Kokaram MKL:回傳對稱矩陣 T,使 (x-ms)T 的共變異數為 ct"""
    eye = torch.eye(3, dtype=cs.dtype, device=cs.device)
    cs = cs + eye * MKL_REG
    ct = ct + eye * MKL_REG
    ua, da = _sqrt_psd(cs, MKL_REG)
    c = (da[:, None] * (ua.T @ ct @ ua)) * da[None, :]
    uc, dc = _sqrt_psd(c, MKL_REG * MKL_REG)   # c 為平方量級,下限需同量級
    dai = 1.0 / da
    return ua @ (dai[:, None] * (uc @ torch.diag(dc) @ uc.T) * dai[None, :]) @ ua.T


def build_params(method, ms, ss, mt, st):
    """每格的 (scale 或矩陣, src_mean, tgt_mean)"""
    if method == "reinhard":
        sd_s = (ss - ms * ms).clamp(min=EPS).sqrt()
        sd_t = (st - mt * mt).clamp(min=EPS).sqrt()
        return [(sd_t / sd_s[i], ms[i], mt) for i in range(ms.shape[0])]
    ct = st - torch.outer(mt, mt)
    out = []
    for i in range(ms.shape[0]):
        cs = ss[i] - torch.outer(ms[i], ms[i])
        out.append((mkl_matrix(cs, ct), ms[i], mt))
    return out


def apply(x, method, p, strength, gamma=None):
    """x: [..., 3] sRGB float32(在 device 上);gamma 為 None 時亮度用線性結果,否則改走 gamma 曲線"""
    k, m_s, m_t = (v.to(x.device, torch.float32) for v in p)
    if method == "reinhard":
        y = lab_to_rgb((rgb_to_lab(x) - m_s) * k + m_t)
    else:
        y = (x - m_s) @ k + m_t
    if gamma is not None:
        y = _set_luma(y, _luma(y), _luma(x).clamp(0.0, 1.0) ** gamma)
    if strength < 1.0:
        y = x + (y - x) * strength
    return y.clamp(0.0, 1.0)


# ─────────────────────────────────────────────────────────────
# white balance:只修色偏,亮度照原片
# ─────────────────────────────────────────────────────────────
WB_SAT = 0.25              # 近中性色:線性光 (max-min)/max 低於此值
WB_LO, WB_HI = 0.02, 0.95  # 太暗(雜訊大)與快爆(色彩被截)的像素不參與
WB_MIN_FRAC = 0.005        # 平滑窗內中性像素占比低於此值 → 量不準,增益淡回 1
WB_GAIN_MIN, WB_GAIN_MAX = 0.8, 1.25   # 單一通道增益上下限:判斷錯時頂多修不足,不會染色


def _lin(x):
    return torch.where(x <= 0.04045, x / 12.92, ((x.clamp(min=0) + 0.055) / 1.055) ** 2.4)


def _enc(x):
    x = x.clamp(min=0)
    return torch.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1.0 / 2.4) - 0.055)


WB_ITER = 3                # 中性像素選取的迭代次數(見 neutral_sums)


def neutral_sums(frames, device, tgt_chroma=None):
    """每格近中性像素的線性 RGB 總和 [B,3] 與像素數 [B](取自統計用縮圖),float64;另回傳每格總像素數。
    給 tgt_chroma 時迭代選取:先用目前的增益估計把這格暫時拉回,再在拉回後的色彩裡挑中性像素、重估增益。
    色偏大的影格(牆已經偏成咖啡色)用原色挑會把牆排除、只剩偏得少的像素,量出來永遠偏小(2026-10-14 實測:
    單次只挑到 13%,量到 8%;迭代三次挑到 47%,量到 22% 才是真值)。"""
    out_s, out_n = [], []
    total = 1
    for i in range(0, frames.shape[0], CHUNK):
        l = _lin(_small(frames[i:i + CHUNK].to(device, torch.float32)).to(torch.float64))
        l = l.reshape(l.shape[0], -1, 3)
        total = l.shape[1]
        g = torch.ones((l.shape[0], 1, 3), dtype=torch.float64, device=l.device)
        for it in range(WB_ITER if tgt_chroma is not None else 1):
            q = l * g
            mx, mn = q.amax(dim=-1), q.amin(dim=-1)
            w = (((mx - mn) < WB_SAT * mx) & (mx > WB_LO) & (mx < WB_HI)).to(torch.float64)
            s, n = (l * w[..., None]).sum(dim=1), w.sum(dim=1)
            if tgt_chroma is not None and it < WB_ITER - 1:
                c = _chroma(s / n.clamp(min=EPS)[:, None])
                g = torch.where(n[:, None] > 0, tgt_chroma.to(l.device)[None, :] / c.clamp(min=EPS), torch.ones_like(c))[:, None, :]
        out_s.append(s.cpu())
        out_n.append(n.cpu())
    return torch.cat(out_s), torch.cat(out_n), total


def _chroma(rgb):
    """線性 RGB 平均 [...,3] -> 色度比例(三通道除以三者平均,只剩色偏、與亮度無關)"""
    return rgb / rgb.mean(dim=-1, keepdim=True).clamp(min=EPS)


def wb_gains(src_sum, src_n, tgt_chroma, total):
    """src_sum [n,3]、src_n [n]:已沿時間平滑的中性像素總和與數量;回傳每格三通道增益 [n,3]。
    中性像素太少時增益淡回 1(量不準寧可少修)。"""
    c = _chroma(src_sum / src_n.clamp(min=EPS)[:, None])
    g = (tgt_chroma[None, :] / c.clamp(min=EPS)).clamp(WB_GAIN_MIN, WB_GAIN_MAX)
    conf = (src_n / (total * WB_MIN_FRAC)).clamp(0.0, 1.0)[:, None]
    return 1.0 + (g - 1.0) * conf


def apply_wb(x, gain, strength):
    """x: [...,3] sRGB float32;gain [3]。線性光乘增益後把亮度還原成原值(只改色偏)。"""
    g = 1.0 + (gain.to(x.device, torch.float32) - 1.0) * strength
    l = _lin(x)
    y0 = _luma(l)
    l2 = l * g
    l2 = l2 * (y0 / _luma(l2).clamp(min=1e-9)).unsqueeze(-1)
    return _enc(l2).clamp(0.0, 1.0)


# ─────────────────────────────────────────────────────────────
# white balance 主估計:沒動的背景像素(2026-10-19)
# ─────────────────────────────────────────────────────────────
ST_BLUR = 2                # 比對前 5×5 方框模糊(統計縮圖上):抵銷生成雜訊與細節重繪
ST_TOL = 0.08              # 「沒動」判定:扣除這一格整體明暗變化(對數亮度差的中位數)後,像素亮度差在 8% 內
ST_FULL, ST_MIN = 0.15, 0.05   # 沒動像素占比:≥ FULL 完全採信,≤ MIN 不採信,中間線性過渡
ST_MIN_PX = 50             # 沒動像素少於此數不量
WB_FALLBACK = 0.08         # 退回中性像素法時的單通道增益上限(±8%):那個方法會被白衣服騙,寧可少修


def _blur(l):
    """[B,h,w,3] -> 方框模糊(count_include_pad=False,邊緣不變暗)"""
    t = l.permute(0, 3, 1, 2)
    t = F.avg_pool2d(t, 2 * ST_BLUR + 1, stride=1, padding=ST_BLUR, count_include_pad=False)
    return t.permute(0, 2, 3, 1)


def _prep(frames, device, size=None):
    """影格 -> 統計縮圖、線性光、模糊 [B,h,w,3] float64(在 device 上);size 給 (h,w) 時改縮到該尺寸(參考圖對齊影格用)"""
    x = frames.to(device, torch.float32)
    if size is None:
        x = _small(x)
    else:
        x = F.interpolate(x.permute(0, 3, 1, 2), size=size, mode="area").permute(0, 2, 3, 1)
    return _blur(_lin(x.to(torch.float64)))


def static_gains(prepped, anchor):
    """prepped [B,h,w,3]、anchor [h,w,3](都是 _prep 的結果)。
    回傳 (每格對數增益 [B,3],把這一格拉回 anchor、三通道平均為 0 只含色偏;沒動像素占比 [B])。
    沒動 = 兩邊都不太暗不太亮,且 log(這格亮度 / anchor 亮度) 扣掉全圖中位數後 |差| < ST_TOL。"""
    la = _luma(anchor)
    lf = _luma(prepped)
    ok = (la > WB_LO) & (la < WB_HI) & (lf > WB_LO) & (lf < WB_HI)
    r = torch.log(lf.clamp(min=EPS)) - torch.log(la.clamp(min=EPS))
    r = torch.where(ok, r, torch.full_like(r, float("nan")))
    med = torch.nanmedian(r.reshape(r.shape[0], -1), dim=1).values
    m = ok & ((r - med[:, None, None]).abs() < ST_TOL)
    frac = m.to(torch.float64).reshape(m.shape[0], -1).mean(dim=1)
    cnt = m.reshape(m.shape[0], -1).sum(dim=1)
    w = m.to(torch.float64).unsqueeze(-1)
    f_mean = (prepped * w).sum(dim=(1, 2)) / cnt.clamp(min=1)[:, None]
    a_mean = (anchor.unsqueeze(0) * w).sum(dim=(1, 2)) / cnt.clamp(min=1)[:, None]
    g = _chroma(a_mean.clamp(min=EPS)) / _chroma(f_mean.clamp(min=EPS))
    logg = torch.log(g.clamp(min=EPS))
    logg = torch.where((cnt >= ST_MIN_PX)[:, None], logg, torch.zeros_like(logg))
    frac = torch.where(cnt >= ST_MIN_PX, frac, torch.zeros_like(frac))
    return logg.cpu(), frac.cpu()


def _confidence(frac):
    return ((frac - ST_MIN) / (ST_FULL - ST_MIN)).clamp(0.0, 1.0)


def _capped(g, cap):
    return g.clamp(1.0 - cap, 1.0 + cap)


# ─────────────────────────────────────────────────────────────
# 場景偵測:構圖相似度(扣除整體色調後的粗略 Lab 版面),換場景時自動淡出校正
# ─────────────────────────────────────────────────────────────
SCENE_GRID = (6, 4)        # 版面比對格數(高, 寬),粗到能容忍人物動作與小幅運鏡


def _layout(frames, device):
    """[B,H,W,3] -> 每格 Lab 三通道的正規化版面向量 [B,3,n](扣平均、除範數,與色偏無關)"""
    out = []
    for i in range(0, frames.shape[0], CHUNK):
        x = _small(frames[i:i + CHUNK].to(device, torch.float32)).to(torch.float64)
        lab = rgb_to_lab(x).permute(0, 3, 1, 2)
        t = F.adaptive_avg_pool2d(lab, SCENE_GRID).flatten(2)
        t = t - t.mean(dim=2, keepdim=True)
        out.append((t / (t.norm(dim=2, keepdim=True) + 1e-6)).cpu())
    return torch.cat(out)


CUT_RATIO = 5.0            # 換鏡頭:這一格與前一格的構圖差 ≥ 前後鄰格差中位數的幾倍
CUT_MIN = 0.12             # 換鏡頭:構圖差的絕對下限(靜態畫面鄰格差近 0,比值再大也不算),1 - cos 相似度
CUT_WIN = 8                # 中位數視窗:前後各幾格(不含自己)
SHOT_ANCHOR = 4            # match new shot start:每個鏡頭拿開頭幾格的平均當自己的目標(未平滑的原始統計)


def detect_cuts(images, device):
    """自適應換鏡頭偵測:每格與前一格的構圖差 d(1 - 加權 cos 相似度,扣除整體色調),
    d[k] 同時 ≥ CUT_MIN 且 ≥ CUT_RATIO × 前後 CUT_WIN 格 d 的中位數 → 第 k 格與第 k+1 格之間是一刀。
    回傳 (每格鏡頭編號 [n] int64,從 0 起;切點索引 list)。"""
    n = images.shape[0]
    seg = torch.zeros(n, dtype=torch.int64)
    if n < 3:
        return seg, []
    lay = _layout(images, device)                                 # [B,3,n]
    w_ch = torch.tensor([0.5, 0.25, 0.25], dtype=torch.float64)   # L 為主、a/b 為輔
    d = 1.0 - ((lay[1:] * lay[:-1]).sum(dim=2) * w_ch).sum(dim=1)  # [n-1]:d[k] = 第 k 與 k+1 格之差
    cuts = []
    m = d.shape[0]
    for k in range(m):
        if d[k] < CUT_MIN:
            continue
        lo, hi = max(0, k - CUT_WIN), min(m, k + CUT_WIN + 1)
        nb = torch.cat([d[lo:k], d[k + 1:hi]])
        if nb.numel() == 0:
            continue
        if d[k] >= CUT_RATIO * max(float(nb.median()), EPS):
            cuts.append(k)
    for k in cuts:
        seg[k + 1:] += 1
    return seg, cuts


# ─────────────────────────────────────────────────────────────
# .cube
# ─────────────────────────────────────────────────────────────
def lut_dir():
    if folder_paths is not None:
        here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # nodes -> ComfyUI-GeN13 -> custom_nodes
        ls = os.path.join(here, "ComfyUI_LayerStyle", "lut")
        if os.path.isdir(ls):
            return ls
        return os.path.join(folder_paths.get_output_directory(), "luts")
    return os.path.join(os.getcwd(), "luts")


def write_cube(path, title, method, p, strength, device, gamma=None):
    _write_cube_fn(path, title, lambda grid: apply(grid, method, p, strength, gamma), device)


def _write_cube_fn(path, title, fn, device):
    """fn: [N,3] sRGB -> [N,3] sRGB"""
    n = CUBE_SIZE
    g = torch.linspace(0, 1, n, dtype=torch.float32)
    b, gg, r = torch.meshgrid(g, g, g, indexing="ij")        # 紅色變化最快
    grid = torch.stack([r, gg, b], dim=-1).reshape(-1, 3).to(device)
    y = fn(grid).cpu()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = ['TITLE "%s"' % title, "LUT_3D_SIZE %d" % n,
             "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0"]
    lines += ["%.6f %.6f %.6f" % tuple(v) for v in y.tolist()]
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="ascii", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, path)


# ─────────────────────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────────────────────
def _cube_name(cube_name):
    name = (cube_name or "").strip()
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)[:64] if name else ""


def _white_balance(ref, img, mode, smooth_frames, strength, cube_name, device, after_cut):
    """white balance 主流程:回傳 (影格 [B,H,W,3] float32 CPU, cube 路徑)。
    每個鏡頭各自以開頭 SHOT_ANCHOR 格為錨,逐格量「沒動像素」的色偏(static_gains),依沒動占比決定採信多少,
    不足的部分退回中性像素法(上限 ±WB_FALLBACK);第一個鏡頭再乘上「錨 → 參考圖」的增益,對位到首幀圖。"""
    n = img.shape[0]
    seg, cuts = detect_cuts(img, device) if after_cut != "always match first frame" else (None, [])
    weights = torch.ones(n, dtype=torch.float64)
    if after_cut == "stop when new shot" and cuts:
        weights[cuts[0] + 1:] = 0.0
    bounds = [0] + ([k + 1 for k in cuts] if after_cut == "match new shot start" else []) + [n]

    # 退回用:每格中性像素統計(不迭代、不對參考圖拉,純粹量這一格自己的中性色)
    fsum, fn, ftot = neutral_sums(img, device)
    guide = hist_mean(luma_hist(img, device))                # 每格平均亮度,平滑不跨過亮度跳變

    logg = torch.zeros((n, 3), dtype=torch.float64)
    frac = torch.zeros(n, dtype=torch.float64)
    fb = torch.ones((n, 3), dtype=torch.float64)             # 退回用增益(frame -> 錨)
    anchors = []                                             # 每段的錨(模糊縮圖),第一段另要對參考圖
    for si in range(len(bounds) - 1):
        a, b = bounds[si], bounds[si + 1]
        e = min(b, a + SHOT_ANCHOR)
        anc = _prep(img[a:e], device).mean(dim=0)
        anchors.append(anc)
        for i in range(a, b, CHUNK):
            j = min(b, i + CHUNK)
            lg, fr = static_gains(_prep(img[i:j], device), anc)
            logg[i:j], frac[i:j] = lg, fr
            if mm is not None:
                mm.throw_exception_if_processing_interrupted()
        if float(fn[a:e].sum()) >= ftot * (e - a) * WB_MIN_FRAC:
            anc_c = _chroma(fsum[a:e].sum(dim=0) / fn[a:e].sum())
            fb[a:b] = _capped(wb_gains(fsum[a:b], fn[a:b], anc_c, ftot), WB_FALLBACK)

    # 沿時間平滑(以採信度加權),不跨過換鏡頭與亮度跳變
    conf = _confidence(frac)[:, None]
    s_lg = smooth(logg * conf, smooth_frames, mode, guide, seg)
    s_c = smooth(conf, smooth_frames, mode, guide, seg)
    s_lg = s_lg / s_c.clamp(min=1e-6)
    s_fb = torch.log(smooth(fb, smooth_frames, mode, guide, seg).clamp(min=EPS))
    gains = torch.exp(s_c * s_lg + (1.0 - s_c) * s_fb)

    # 第一段的錨 -> 參考圖(首幀圖):先試沒動像素(首幀圖與影片開頭幾乎同一張),不行退回中性像素法 ±8%
    h, w = anchors[0].shape[0], anchors[0].shape[1]
    ref_p = _prep(ref, device, size=(h, w)).mean(dim=0, keepdim=True)
    lg_r, fr_r = static_gains(ref_p, anchors[0])            # 把參考圖拉回錨 → 反過來就是錨拉到參考圖
    c_r = float(_confidence(fr_r)[0])
    g_ref = torch.exp(-lg_r[0])
    rsum, rn, rtot = neutral_sums(ref, device)
    a0, e0 = bounds[0], min(bounds[1], bounds[0] + SHOT_ANCHOR)
    if float(rn.sum()) >= rtot * ref.shape[0] * WB_MIN_FRAC and float(fn[a0:e0].sum()) >= ftot * (e0 - a0) * WB_MIN_FRAC:
        g_fb_ref = _capped(_chroma(rsum.sum(dim=0) / rn.sum()) / _chroma(fsum[a0:e0].sum(dim=0) / fn[a0:e0].sum()), WB_FALLBACK)
    else:
        g_fb_ref = torch.ones(3, dtype=torch.float64)
    g_ref = torch.exp(c_r * torch.log(g_ref.clamp(min=EPS)) + (1.0 - c_r) * torch.log(g_fb_ref))
    gains[bounds[0]:bounds[1]] = gains[bounds[0]:bounds[1]] * g_ref[None, :]
    gains = gains.clamp(WB_GAIN_MIN, WB_GAIN_MAX)

    out = torch.empty_like(img, device="cpu", dtype=torch.float32)
    for i in range(0, n, CHUNK):
        x = img[i:i + CHUNK].to(device, torch.float32)       # 可能與輸入共用記憶體,不可原地改寫
        y = torch.stack([apply_wb(x[j], gains[i + j], strength * float(weights[i + j]))
                         if weights[i + j] > 1e-3 else x[j]
                         for j in range(x.shape[0])])
        out[i:i + CHUNK] = y.cpu()
        if mm is not None:
            mm.throw_exception_if_processing_interrupted()

    if after_cut != "always match first frame":
        off = int((weights <= 1e-3).sum())
        print("[Color Match Temporal] %s: scene cut %s, %d frames corrected, %d untouched"
              % (after_cut, ("at frame " + ", ".join(str(k + 1) for k in cuts)) if cuts else "none", n - off, off))
    # 每個鏡頭一行:沒動像素占比、完全採信的格數比例、增益範圍(看哪一刀之後出問題,不用看影片)
    dev = (gains - 1.0).abs().amax(dim=1)
    print("[Color Match Temporal] white balance: anchor->reference %s (static %.0f%%), %d shot(s), max shift %.1f%%"
          % ("/".join("%.3f" % float(v) for v in g_ref), c_r * 100, len(bounds) - 1, float(dev.max()) * 100))
    for si in range(len(bounds) - 1):
        a, b = bounds[si], bounds[si + 1]
        if weights[a:b].max() <= 1e-3:
            continue
        if weights[a:b].min() <= 1e-3:                               # stop when new shot:只報有校正的那段
            b = a + int((weights[a:b] > 1e-3).sum())
        fr, cf, gg = frac[a:b], conf[a:b, 0], gains[a:b]
        br = (gg[:, 2] / gg[:, 0] - 1.0) * 100                       # 藍/紅比:正為往藍修,負為往暖修
        print("[Color Match Temporal]   shot %d  f%d-%d  static px median %.0f%% (min %.0f%%), trusted %.0f%%, "
              "gain RGB %s -> %s, blue/red %+.1f%%..%+.1f%%"
              % (si + 1, a, b - 1, float(fr.median()) * 100, float(fr.min()) * 100,
                 float((cf >= 1.0).to(torch.float64).mean()) * 100,
                 "/".join("%.3f" % float(v) for v in gg[0]), "/".join("%.3f" % float(v) for v in gg[-1]),
                 float(br.min()), float(br.max())))
    if int((weights <= 1e-3).sum()):
        print("[Color Match Temporal]   f%d-%d untouched (stop when new shot)" % (int((weights > 1e-3).sum()), n - 1))

    cube_path = ""
    name = _cube_name(cube_name)
    if name:
        g = gains[weights > 1e-3].mean(dim=0) if bool((weights > 1e-3).any()) else torch.ones(3, dtype=torch.float64)
        cube_path = os.path.join(lut_dir(), name + ".cube")
        _write_cube_fn(cube_path, name, lambda grid: apply_wb(grid, g, strength), device)
        print("[Color Match Temporal] LUT saved: %s" % cube_path)
    return out, cube_path


def color_match_temporal(reference, images, method="mkl", mode="temporal",
                         smooth_frames=8, strength=1.0, cube_name="", device=None,
                         after_cut="match new shot start", tone="gamma"):
    if device is None:
        device = mm.get_torch_device() if mm else torch.device("cpu")
    ref = reference[..., :3]
    img = images[..., :3]
    if method == "white balance":
        out, cube_path = _white_balance(ref, img, mode, smooth_frames, strength, cube_name, device, after_cut)
        if images.shape[-1] == 4:                            # 保留 alpha
            out = torch.cat([out, images[..., 3:].cpu().float()], dim=-1)
        return out, cube_path

    rm, rs = frame_moments(ref, method, device)
    mt, st = rm.mean(dim=0), rs.mean(dim=0)                  # 多張參考圖合併
    fm, fs = frame_moments(img, method, device)

    seg, cuts = detect_cuts(img, device) if after_cut != "always match first frame" else (None, [])   # 換鏡頭:平滑不跨過切點
    weights = torch.ones(img.shape[0], dtype=torch.float64)
    if after_cut == "stop when new shot" and cuts:
        weights[cuts[0] + 1:] = 0.0                          # stop when new shot:第一刀之後原樣輸出
    guide = fm[:, 0] / 100.0 if method == "reinhard" else _luma(fm)      # 每格平均亮度,供平滑避開跳變
    ms, ss = smooth(fm, smooth_frames, mode, guide, seg), smooth(fs, smooth_frames, mode, guide, seg)

    fh = luma_hist(img, device) if tone == "gamma" else None
    target = hist_mean(luma_hist(ref, device)).mean() if tone == "gamma" else None   # 參考圖的平均亮度(多張取平均)
    if after_cut == "match new shot start" and cuts:          # 第一個鏡頭對首幀,之後每個鏡頭對自己的開頭
        bounds = [0] + [k + 1 for k in cuts] + [img.shape[0]]
        params, gammas = [], []
        for si in range(len(bounds) - 1):
            a, b = bounds[si], bounds[si + 1]
            if si == 0:
                tmt, tst, tgt = mt, st, target
            else:
                e = min(b, a + SHOT_ANCHOR)
                tmt, tst = fm[a:e].mean(dim=0), fs[a:e].mean(dim=0)
                tgt = hist_mean(fh[a:e]).mean() if fh is not None else None
            params += build_params(method, ms[a:b], ss[a:b], tmt, tst)
            if fh is not None:
                gammas.append(solve_gamma(smooth(fh[a:b], smooth_frames, mode, guide[a:b]), tgt))
        gammas = torch.cat(gammas) if fh is not None else None
    else:
        params = build_params(method, ms, ss, mt, st)
        gammas = solve_gamma(smooth(fh, smooth_frames, mode, guide, seg), target) if fh is not None else None

    out = torch.empty_like(img, device="cpu", dtype=torch.float32)
    for i in range(0, img.shape[0], CHUNK):
        x = img[i:i + CHUNK].to(device, torch.float32)       # 可能與輸入共用記憶體,不可原地改寫
        y = torch.stack([apply(x[j], method, params[i + j], strength * float(weights[i + j]),
                               None if gammas is None else float(gammas[i + j]))
                         if weights[i + j] > 1e-3 else x[j]
                         for j in range(x.shape[0])])
        out[i:i + CHUNK] = y.cpu()
        if mm is not None:
            mm.throw_exception_if_processing_interrupted()   # 長片可中途取消

    if after_cut != "always match first frame":
        off = int((weights <= 1e-3).sum())
        print("[Color Match Temporal] %s: scene cut %s, %d frames corrected, %d untouched"
              % (after_cut, ("at frame " + ", ".join(str(k + 1) for k in cuts)) if cuts else "none", len(weights) - off, off))
    if gammas is not None:
        print("[Color Match Temporal] tone gamma: first %.3f, last %.3f, min %.3f, max %.3f"
              % (float(gammas[0]), float(gammas[-1]), float(gammas.min()), float(gammas.max())))

    if images.shape[-1] == 4:                                # 保留 alpha
        out = torch.cat([out, images[..., 3:].cpu().float()], dim=-1)

    cube_path = ""
    name = _cube_name(cube_name)
    if name:
        gm, gs = smooth(fm, 0, "global")[:1], smooth(fs, 0, "global")[:1]
        gp = build_params(method, gm, gs, mt, st)[0]
        gg = None if gammas is None else float(solve_gamma(smooth(fh, 0, "global")[:1], target)[0])
        cube_path = os.path.join(lut_dir(), name + ".cube")
        write_cube(cube_path, name, method, gp, strength, device, gg)
        print("[Color Match Temporal] LUT saved: %s" % cube_path)
    return out, cube_path


class ColorMatchTemporal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "影格:要校正的影片影格,接 VAE Decode。"}),
                "reference": ("IMAGE", {
                    "tooltip": "參考圖:目標色調,通常接首幀圖。"}),
                "enabled": ("BOOLEAN", {                       # 開關固定放最上面,之後新增欄位一律加在最下面
                    "default": True, "label_on": "ACTIVE", "label_off": "BYPASS",
                    "tooltip": "開關:BYPASS 時原樣輸出,不做任何處理。"}),
                "method": (["white balance", "mkl", "reinhard"], {
                    "default": "white balance",
                    "tooltip": "演算法:white balance 只修色偏、亮度照原片(建議),mkl、reinhard 連亮度一起對位。"}),
                "mode": (["temporal", "global"], {
                    "default": "temporal",
                    "tooltip": "模式:temporal 逐格校正並平滑(建議),global 整段共用一組。"}),
                "smooth_frames": ("INT", {
                    "default": 8, "min": 0, "max": 120, "step": 1,
                    "tooltip": "平滑半徑:前後各取幾格平均,越大越穩。0 為逐格獨立。"}),
                "strength": ("FLOAT", {
                    "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01,
                    "tooltip": "強度:0 為原始影格,1 為完全對位參考圖。"}),
                "cube_name": ("STRING", {
                    "default": "",
                    "tooltip": "LUT 檔名:留空不存。輸出 .cube 至 ComfyUI_LayerStyle\\lut,未安裝則存 output\\luts。"}),
            },
            "optional": {
                "tone_curve": (["gamma", "linear"], {
                    "default": "gamma",
                    "tooltip": "色階曲線:mkl、reinhard 專用,gamma 保留最黑與最白(建議),linear 為舊版。"}),
                "after_cut": (["match new shot start", "always match first frame", "stop when new shot"], {
                    "default": "match new shot start",
                    "tooltip": "換鏡頭後:新鏡頭對自己的開頭(建議)、全部對首幀、或停止校正。"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "run"
    CATEGORY = "GeN13/color"
    DESCRIPTION = "影片色調對位參考圖:逐格計算並沿時間軸平滑,修正圖生影片的漸進色偏且不閃爍。預設 white balance 只修色偏,亮度照原片。換鏡頭後各鏡頭對自己的開頭,不影響鏡頭間的差異。"

    def run(self, images, reference, enabled, method, mode, smooth_frames, strength, cube_name,
            tone_curve="gamma", after_cut="match new shot start"):
        if not enabled:                                      # BYPASS:原樣傳下去(經 API 送出的工作流也能用這個欄位停用)
            return (images,)
        out, _ = color_match_temporal(reference, images, method, mode,
                                      smooth_frames, strength, cube_name,
                                      after_cut=after_cut, tone=tone_curve)
        return (out,)


NODE_CLASS_MAPPINGS = {"ColorMatchTemporalGeN13": ColorMatchTemporal}
NODE_DISPLAY_NAME_MAPPINGS = {"ColorMatchTemporalGeN13": "Color Match Temporal (GeN13)"}
