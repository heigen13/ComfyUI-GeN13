# -*- coding: utf-8 -*-
"""
Resource Monitor (GeN13) - back end
  Reads CPU / RAM and the GPU ComfyUI runs on (usage, temperature, VRAM, power and its limit) and
  pushes them to the front end as the event "gen13.monitor". GPU sources, first that works:
    NVIDIA          NVML (package nvidia-ml-py, module pynvml): every figure
    AMD on Linux    the amdgpu driver's files under /sys/class/drm: every figure the card exposes
    other Windows   the Windows performance counters Task Manager uses: usage and VRAM in use
    otherwise       torch: VRAM only (none on Apple silicon)
  "caps" tells the front end which cells have a source, so a missing one is hidden, not shown empty.
  It also reports the prompt running now, whoever queued it (a phone page, the API, another tab):
  the front end only gets "executing" / "progress" events for prompts it queued itself.
  Overall progress: each finished run records how long every node took (per workflow, in
  user/GeN13/monitor_times.json); the next run of the same workflow is weighted by those times, so the
  bar follows the whole prompt instead of one sampler's steps. The front end eases the shown value.
  The loop only reads while a page keeps it alive: the front end posts to /gen13/monitor every few
  seconds, and 15 s without a post pauses it. Not a node: NODE_CLASS_MAPPINGS stays empty.
"""
import glob
import hashlib
import json
import logging
import os
import sys
import threading
import time

import psutil
import torch
from aiohttp import web
from server import PromptServer

try:
    import folder_paths
except Exception:
    folder_paths = None

log = logging.getLogger("GeN13.monitor")

RATE_MIN, RATE_MAX, RATE_DEFAULT = 0.25, 5.0, 1.0
ALIVE = 15.0  # seconds a page post keeps the loop reading
TRACK_DT = 0.2  # seconds between progress readings while a prompt runs
KEEP = 64  # workflows whose node times are kept


def _torch_index():
    try:
        import comfy.model_management as mm
        d = mm.get_torch_device()
        if getattr(d, "type", "") == "cuda":
            return d.index or 0
    except Exception:
        pass
    return None


def _pci_bus():
    """PCI address of torch's GPU as "0000:03:00.0", or None."""
    i = _torch_index()
    if i is None:
        return None
    try:
        p = torch.cuda.get_device_properties(i)
        bus, dev = getattr(p, "pci_bus_id", None), getattr(p, "pci_device_id", None)
        if bus is None or dev is None:
            return None
        return "%04x:%02x:%02x.0" % (getattr(p, "pci_domain_id", 0) or 0, bus, dev)
    except Exception:
        return None


def _num(path, scale=1.0):
    try:
        with open(path, "r") as f:
            return float(f.read().strip()) * scale
    except Exception:
        return None


class _Sysfs:
    """AMD GPU on Linux, read from the amdgpu driver's files (no package needed)."""

    def __init__(self, root="/sys"):
        self.dev = None
        cards = []
        for card in sorted(glob.glob(os.path.join(root, "class", "drm", "card[0-9]*"))):
            if "-" in os.path.basename(card):  # connectors such as card0-DP-1
                continue
            dev = os.path.realpath(os.path.join(card, "device"))
            try:
                with open(os.path.join(dev, "vendor"), "r") as f:
                    if f.read().strip().lower() != "0x1002":
                        continue
            except Exception:
                continue
            if not os.path.exists(os.path.join(dev, "mem_info_vram_total")):
                continue
            cards.append(dev)
        if not cards:
            return
        bus = _pci_bus()
        match = [d for d in cards if bus and os.path.basename(d).lower() == bus]
        self.dev = match[0] if match else max(cards, key=lambda d: _num(os.path.join(d, "mem_info_vram_total")) or 0)
        mon = sorted(glob.glob(os.path.join(self.dev, "hwmon", "hwmon*")))
        mon = mon[0] if mon else None
        self.busy = os.path.join(self.dev, "gpu_busy_percent")
        self.temp = self.power = self.cap = None
        if mon:
            temps = sorted(glob.glob(os.path.join(mon, "temp*_input")))
            for t in temps:  # "edge" is the core reading NVML reports on NVIDIA; junction runs far hotter
                try:
                    with open(t.replace("_input", "_label"), "r") as f:
                        if f.read().strip().lower() == "edge":
                            self.temp = t
                            break
                except Exception:
                    pass
            if self.temp is None and temps:
                self.temp = temps[0]
            for name in ("power1_average", "power1_input"):
                if os.path.exists(os.path.join(mon, name)):
                    self.power = os.path.join(mon, name)
                    break
            if os.path.exists(os.path.join(mon, "power1_cap")):
                self.cap = os.path.join(mon, "power1_cap")
        self.has = {"gpu": _num(self.busy) is not None, "temp": _num(self.temp) is not None if self.temp else False,
                    "power": bool(self.power and self.cap and _num(self.power) is not None and _num(self.cap)),
                    "vram": _num(os.path.join(self.dev, "mem_info_vram_total")) is not None}

    def status(self):
        d = self.dev
        return {"gpu": _num(self.busy), "temp": _num(self.temp, 0.001) if self.temp else None,
                "vram_used": _num(os.path.join(d, "mem_info_vram_used")),
                "vram_total": _num(os.path.join(d, "mem_info_vram_total")),
                "power": _num(self.power, 1e-6) if self.power else None,
                "power_limit": _num(self.cap, 1e-6) if self.cap else None, "clock": None}


class _Pdh:
    """Any GPU on Windows, from the performance counters Task Manager uses: usage and VRAM in use.
    Temperature and power are not published there."""

    MORE = 0x800007D2
    DOUBLE, LARGE = 0x00000200, 0x00000400

    def __init__(self):
        self.ok = False
        import ctypes
        from ctypes import wintypes
        self.c, self.w = ctypes, wintypes

        class _V(ctypes.Union):
            _fields_ = [("long", ctypes.c_long), ("double", ctypes.c_double), ("large", ctypes.c_longlong)]

        class _Val(ctypes.Structure):
            _fields_ = [("status", wintypes.DWORD), ("v", _V)]

        class _Item(ctypes.Structure):
            _fields_ = [("name", wintypes.LPWSTR), ("value", _Val)]

        self.Item = _Item
        lib = ctypes.WinDLL("pdh")
        H, D, PD = wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)
        sig = {"PdhOpenQueryW": [wintypes.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(H)],
               "PdhAddEnglishCounterW": [H, wintypes.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(H)],
               "PdhCollectQueryData": [H],
               "PdhGetFormattedCounterArrayW": [H, D, PD, PD, ctypes.c_void_p]}
        for name, args in sig.items():  # explicit types: handles and sizes are 64-bit
            f = getattr(lib, name)
            f.argtypes, f.restype = args, ctypes.c_uint32
        self.lib = lib
        self.q = wintypes.HANDLE()
        if self.lib.PdhOpenQueryW(None, 0, ctypes.byref(self.q)) != 0:
            return
        self.eng = self._add(r"\GPU Engine(*)\Utilization Percentage")
        self.mem = self._add(r"\GPU Adapter Memory(*)\Dedicated Usage")
        if self.eng is None or self.mem is None:
            return
        self.lib.PdhCollectQueryData(self.q)  # usage is a rate: the first sample only starts the window
        self.luid = None
        self.ok = True

    def _add(self, path):
        h = self.w.HANDLE()
        # English names: counter names are translated on a Chinese or Japanese Windows
        if self.lib.PdhAddEnglishCounterW(self.q, path, 0, self.c.byref(h)) != 0:
            return None
        return h

    def _array(self, h, fmt):
        c = self.c
        size, count = self.w.DWORD(0), self.w.DWORD(0)
        r = self.lib.PdhGetFormattedCounterArrayW(h, fmt, c.byref(size), c.byref(count), None)
        if r != self.MORE or not size.value:
            return []
        buf = c.create_string_buffer(size.value)
        if self.lib.PdhGetFormattedCounterArrayW(h, fmt, c.byref(size), c.byref(count), buf) != 0:
            return []
        items = c.cast(buf, c.POINTER(self.Item))
        out = []
        for k in range(count.value):
            it = items[k]
            if it.value.status in (0, 1):  # PDH_CSTATUS_VALID_DATA, PDH_CSTATUS_NEW_DATA
                out.append((it.name or "", it.value.v.double if fmt == self.DOUBLE else float(it.value.v.large)))
        return out

    @staticmethod
    def _luid(name):
        i = name.find("luid_")
        if i < 0:
            return None
        parts = name[i:].split("_")
        return "_".join(parts[:3]) if len(parts) >= 3 else None  # luid_0x00000000_0x0000D1B6

    def status(self, torch_used=None):
        out = {"gpu": None, "temp": None, "vram_used": None, "vram_total": None,
               "power": None, "power_limit": None, "clock": None}
        if self.lib.PdhCollectQueryData(self.q) != 0:
            return out
        mem = {}
        for n, v in self._array(self.mem, self.LARGE):
            l = self._luid(n)
            if l:
                mem[l] = mem.get(l, 0.0) + v
        # picked again on every reading: a virtual adapter (remote desktop, streaming apps) holds no
        # memory, and the first reading can miss the real card
        mem = {l: v for l, v in mem.items() if v > 0}
        if not mem:
            return out
        if torch_used is not None:  # the adapter torch uses: closest to torch's own reading
            self.luid = min(mem, key=lambda l: abs(mem[l] - torch_used))
        else:
            self.luid = max(mem, key=lambda l: mem[l])
        out["vram_used"] = mem.get(self.luid)
        eng = {}
        for n, v in self._array(self.eng, self.DOUBLE):
            if self._luid(n) != self.luid:
                continue
            i = n.find("_eng_")
            key = n[i:] if i >= 0 else n
            eng[key] = eng.get(key, 0.0) + v  # one engine summed over processes, as Task Manager does
        if eng:
            out["gpu"] = min(100.0, max(eng.values()))
        return out


class _Gpu:
    """The GPU torch uses, read from the first source that works; every reading returns None when it
    is not available."""

    def __init__(self):
        self.nv = None
        self.h = None
        self.name = ""
        self.cuda = _torch_index()
        self.warned = set()
        try:
            import pynvml
            pynvml.nvmlInit()
            self.nv = pynvml
        except Exception as e:
            log.info("[GeN13] monitor: NVML not available (%s); trying other GPU sources", e)
            self.nv = None
        if self.nv is not None:
            self.h = self._handle()
            if self.h is None:
                self.nv = None
        if self.nv is not None:
            try:
                n = self.nv.nvmlDeviceGetName(self.h)
                self.name = n.decode() if isinstance(n, bytes) else str(n)
            except Exception:
                self.name = ""
        elif self.cuda is not None:
            try:
                self.name = torch.cuda.get_device_name(self.cuda)
            except Exception:
                self.name = ""
        self.sys = self.pdh = None
        if self.nv is None and sys.platform.startswith("linux"):
            try:
                s = _Sysfs()
                self.sys = s if s.dev else None
            except Exception as e:
                log.info("[GeN13] monitor: AMD sysfs not readable (%s)", e)
        if self.nv is None and self.sys is None and sys.platform == "win32":
            try:
                p = _Pdh()
                self.pdh = p if p.ok else None
            except Exception as e:
                log.info("[GeN13] monitor: Windows GPU counters not readable (%s)", e)
        self.torch_vram = self._torch_mem() is not None
        self.src = "nvml" if self.nv is not None else "sysfs" if self.sys else "pdh" if self.pdh else "torch"
        log.info("[GeN13] monitor: GPU source %s%s", self.src, (" (%s)" % self.name) if self.name else "")

    # match torch's device to NVML: by UUID, then PCI bus, then index (CUDA_VISIBLE_DEVICES can reorder)
    def _handle(self):
        nv = self.nv
        i = self.cuda if self.cuda is not None else 0
        props = None
        try:
            if self.cuda is not None:
                props = torch.cuda.get_device_properties(self.cuda)
        except Exception:
            props = None
        if props is not None:
            u = getattr(props, "uuid", None)
            if u is not None:
                try:
                    return nv.nvmlDeviceGetHandleByUUID("GPU-" + str(u))
                except Exception:
                    pass
            bus = getattr(props, "pci_bus_id", None)
            dev = getattr(props, "pci_device_id", None)
            dom = getattr(props, "pci_domain_id", None)
            if bus is not None and dev is not None:
                try:
                    return nv.nvmlDeviceGetHandleByPciBusId("%08X:%02X:%02X.0" % (dom or 0, bus, dev))
                except Exception:
                    pass
        try:
            return nv.nvmlDeviceGetHandleByIndex(i)
        except Exception:
            return None

    def _read(self, key, fn):
        try:
            return fn()
        except Exception as e:
            if key not in self.warned:
                self.warned.add(key)
                log.info("[GeN13] monitor: %s not readable (%s)", key, e)
            return None

    def _torch_mem(self):
        if self.cuda is None:
            return None
        try:
            f = torch.cuda.mem_get_info(self.cuda)
            return float(f[1] - f[0]), float(f[1])
        except Exception:
            return None

    def caps(self):
        """Which cells have a source; fixed at start so a cell never flickers in and out."""
        if self.nv is not None:
            return {"gpu": True, "temp": True, "power": True, "vram": True}
        if self.sys is not None:
            h = self.sys.has
            return {"gpu": h["gpu"], "temp": h["temp"], "power": h["power"], "vram": h["vram"] or self.torch_vram}
        return {"gpu": self.pdh is not None, "temp": False, "power": False, "vram": self.torch_vram}

    def status(self):
        out = {"gpu": None, "temp": None, "vram_used": None, "vram_total": None,
               "power": None, "power_limit": None, "clock": None}
        nv, h = self.nv, self.h
        if self.sys is not None:
            out.update(self._read("amd sysfs", self.sys.status) or {})
        elif self.pdh is not None:
            tm = self._torch_mem()
            out.update(self._read("windows counters", lambda: self.pdh.status(tm[0] if tm else None)) or {})
            # VRAM from torch (in use and size from one source); the counters only give usage here
            out["vram_used"], out["vram_total"] = tm if tm is not None else (None, None)
        if nv is not None:
            u = self._read("usage", lambda: nv.nvmlDeviceGetUtilizationRates(h))
            if u is not None:
                out["gpu"] = float(u.gpu)
            out["temp"] = self._read("temperature", lambda: float(nv.nvmlDeviceGetTemperature(h, nv.NVML_TEMPERATURE_GPU)))
            m = self._read("memory", lambda: nv.nvmlDeviceGetMemoryInfo(h))
            if m is not None:
                out["vram_used"], out["vram_total"] = float(m.used), float(m.total)
            p = self._read("power", lambda: nv.nvmlDeviceGetPowerUsage(h))
            if p is not None:
                out["power"] = p / 1000.0
            pl = self._read("power limit", lambda: nv.nvmlDeviceGetEnforcedPowerLimit(h))
            if pl is not None:
                out["power_limit"] = pl / 1000.0
            out["clock"] = self._read("clock", lambda: float(nv.nvmlDeviceGetClockInfo(h, nv.NVML_CLOCK_GRAPHICS)))
        if out["vram_total"] is None and self.cuda is not None:
            f = self._read("torch memory", self._torch_mem)
            if f is not None:
                out["vram_used"], out["vram_total"] = f
        return out


# ---- overall progress ---------------------------------------------------------------------------
def _state(e):
    st = e.get("state")
    return getattr(st, "value", st)


def _sig(prompt):
    """A workflow's key: its node ids and types (values such as seeds, sizes or models do not count)."""
    parts = sorted("%s:%s" % (k, v.get("class_type", "")) for k, v in prompt.items() if isinstance(v, dict))
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]


def _steps_in(prompt, nid):
    n = prompt.get(nid)
    s = n.get("inputs", {}).get("steps") if isinstance(n, dict) else None
    return s if isinstance(s, int) and s > 1 else 0


class _Times:
    """Node times of finished runs, per workflow; blended with the earlier runs so one odd run
    (a model reload, a cold start) moves the estimate only part of the way."""

    def __init__(self):
        self.path = None
        self.data = None
        self.lock = threading.Lock()

    def _file(self):
        if self.path is None:
            try:
                base = folder_paths.get_user_directory()
            except Exception:
                base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "user")
            self.path = os.path.join(base, "GeN13", "monitor_times.json")
        return self.path

    def _load(self):
        if self.data is None:
            try:
                with open(self._file(), "r", encoding="utf-8") as f:
                    d = json.load(f)
                self.data = d if isinstance(d, dict) else {}
            except Exception:
                self.data = {}
        return self.data

    def get(self, sig):
        with self.lock:
            w = self._load().get(sig)
            return dict(w.get("nodes", {})) if isinstance(w, dict) else {}

    def put(self, sig, ran, cached):
        with self.lock:
            d = self._load()
            old = d.get(sig, {}).get("nodes", {}) if isinstance(d.get(sig), dict) else {}
            nodes = {nid: old[nid] for nid in cached if nid in old}  # a cached node keeps its last time
            for nid, m in ran.items():
                o = old.get(nid)
                if isinstance(o, dict) and o.get("max", 0) == m.get("max", 0):
                    b = {}
                    for k, v in m.items():
                        ov = o.get(k)
                        if k == "max" or not isinstance(ov, (int, float)):
                            b[k] = v
                        else:
                            v = min(max(v, ov / 3.0), ov * 3.0)
                            b[k] = round(0.6 * ov + 0.4 * v, 3)
                    m = b
                nodes[nid] = m
            d[sig] = {"nodes": nodes, "used": time.time()}
            if len(d) > KEEP:
                for k in sorted(d, key=lambda k: d[k].get("used", 0) if isinstance(d[k], dict) else 0)[: len(d) - KEEP]:
                    del d[k]
            try:
                path = self._file()
                os.makedirs(os.path.dirname(path), exist_ok=True)
                tmp = path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(d, f, separators=(",", ":"))
                os.replace(tmp, path)
            except Exception as e:
                log.warning("[GeN13] monitor: could not save node times: %s", e)


class _Tracker:
    """Follows the running prompt through the progress registry (read only): when each node starts,
    each sampler step, when it finishes. Its model() is what the front end turns into a percentage."""

    def __init__(self):
        self.times = _Times()
        self.lock = threading.Lock()
        self.pid = None
        self.last = None  # {"id", "ok"} of the prompt that finished last
        self._clear()

    def _clear(self):
        self.prompt, self.sig, self.hist = {}, None, {}
        self.nodes, self.cached = {}, set()

    def tick(self, pid, prompt):
        now = time.monotonic()
        with self.lock:
            if pid != self.pid:
                if self.pid is not None:
                    self._end(now)
                self.pid = pid
                self._clear()
                if pid is None:
                    return
                self.prompt = prompt if isinstance(prompt, dict) else {}
                self.sig = _sig(self.prompt)
                self.hist = self.times.get(self.sig)
            self._scan(now)

    def _scan(self, now):
        try:
            from comfy_execution.progress import get_progress_state
            reg = get_progress_state()
        except Exception:
            return
        if getattr(reg, "prompt_id", None) != self.pid:
            return
        for nid, e in list(reg.nodes.items()):
            st = _state(e)
            n = self.nodes.get(nid)
            if st == "running":
                if n is None:
                    n = self.nodes[nid] = {"t0": now, "t1": None, "steps": [], "max": 0}
                mx, v = int(e.get("max") or 0), int(e.get("value") or 0)
                if mx > 1:
                    if mx != n["max"]:
                        n["max"], n["steps"] = mx, n["steps"][:mx]
                    while len(n["steps"]) < min(v, mx):
                        n["steps"].append(now)
            elif st == "finished":
                if n is None:
                    # finished without being seen running: an output from the cache, or a node quicker
                    # than one reading; one that took 1 s or more last time can only be the cache
                    h = self.hist.get(nid)
                    if isinstance(h, dict) and h.get("t", 0) >= 1.0:
                        self.cached.add(nid)
                    else:
                        self.nodes[nid] = {"t0": now, "t1": now, "steps": [], "max": 0}
                elif n["t1"] is None:
                    n["t1"] = now
                    while n["max"] > 1 and len(n["steps"]) < n["max"]:
                        n["steps"].append(now)

    def _end(self, now):
        ok = False
        try:
            h = PromptServer.instance.prompt_queue.get_history(prompt_id=self.pid, map_function=lambda p: p.get("status"))
            st = h.get(self.pid) or {}
            ok = bool(st.get("completed")) and st.get("status_str", "success") == "success"
        except Exception:
            pass
        if ok:
            self._scan(now)  # the last node, if the registry still holds this prompt
        self.last = {"id": self.pid, "ok": ok}
        if not ok or not self.nodes or self.sig is None:
            return
        ran = {}
        for nid, n in self.nodes.items():
            t1 = n["t1"] if n["t1"] is not None else now
            m = {"t": round(max(0.0, t1 - n["t0"]), 3)}
            st = n["steps"]
            if n["max"] > 1 and st:
                m["max"] = n["max"]
                m["first"] = round(st[0] - n["t0"], 3)
                m["per"] = round((st[-1] - st[0]) / (len(st) - 1), 3) if len(st) > 1 else m["first"]
                m["tail"] = round(max(0.0, t1 - st[-1]), 3)
            ran[nid] = m
        try:
            self.times.put(self.sig, ran, self.cached)
        except Exception as e:
            log.warning("[GeN13] monitor: %s", e)

    def _exp(self, nid):
        """Expected seconds of a node in this run, and its learned record (or None)."""
        h = self.hist.get(nid)
        if not isinstance(h, dict):
            return (0.5 if self.hist else 1.0), None
        steps = (self.nodes.get(nid) or {}).get("max", 0) or _steps_in(self.prompt, nid)
        if h.get("max", 0) > 1 and steps > 1 and steps != h["max"]:
            h = dict(h, max=steps)
            h["t"] = h["first"] + h["per"] * (steps - 1) + h.get("tail", 0.0)
        return float(h.get("t", 0.0)), h

    def model(self):
        """{total, done, base, segw, seg, se, learned}: overall = (done + base + segw * ease(se / seg)) / total,
        seconds of expectation (node counts on a workflow's first run); se is read now and the
        front end keeps it running between readings."""
        with self.lock:
            if self.pid is None:
                return None
            now = time.monotonic()
            learned = bool(self.hist)
            ids = set(self.hist) if learned else set(self.prompt)
            ids |= set(self.nodes)
            ids -= self.cached
            total = done = 0.0
            cur, cur_t0 = None, -1.0
            for nid in ids:
                e, h = self._exp(nid)
                total += e
                n = self.nodes.get(nid)
                if n is None:
                    continue
                if n["t1"] is not None:
                    done += e
                elif n["t0"] > cur_t0:
                    cur, cur_t0 = (nid, e, h, n), n["t0"]
            m = {"total": round(max(total, 1e-6), 3), "done": round(done, 3), "base": 0.0, "segw": 0.0,
                 "seg": 1.0, "se": 0.0, "learned": learned}
            if cur is None:
                return m
            nid, e, h, n = cur
            el = now - n["t0"]
            st, mx = n["steps"], n["max"]
            if mx > 1:
                c = len(st)
                if h is not None and h.get("max", 0) > 1:
                    first, per, tail = h["first"], h["per"], h.get("tail", 0.0)
                    w = (1.0, 1.0)
                else:  # first run: the node's weight shared out by step, step time as measured so far
                    per = (st[-1] - st[0]) / (len(st) - 1) if len(st) > 1 else (st[0] - n["t0"] if st else max(el, 5.0))
                    first, tail = (st[0] - n["t0"] if st else max(el, 5.0)), per * 0.3
                    w = (e / mx / max(first, 1e-3), e / mx / max(per, 1e-3))
                if c == 0:
                    base, seg, se, segw = 0.0, first, el, first * w[0]
                elif c < mx:
                    base = first * w[0] + per * (c - 1) * w[1]
                    seg, se, segw = per, now - st[-1], per * w[1]
                else:
                    base = first * w[0] + per * (mx - 1) * w[1]
                    seg, se, segw = max(tail, 0.3), now - st[-1], max(e - base, 0.0)
                m.update(base=round(base, 3), segw=round(max(segw, 0.0), 3), seg=round(max(seg, 0.05), 3), se=round(se, 3))
            else:
                m.update(segw=round(e, 3), seg=round(max(e, 0.05), 3), se=round(el, 3))
            return m


class _Monitor:
    def __init__(self):
        self.rate = RATE_DEFAULT
        self.alive_until = 0.0
        self.wake = threading.Event()
        self.gpu = None
        self.thread = None
        self.guard = threading.Lock()
        self.job_id = None
        self.job_t0 = 0.0
        self.track = _Tracker()
        self.tthread = None

    def ping(self, rate):
        old = self.rate
        if rate is not None:
            try:
                self.rate = min(RATE_MAX, max(RATE_MIN, float(rate)))
            except (TypeError, ValueError):
                pass
        asleep = time.monotonic() > self.alive_until
        self.alive_until = time.monotonic() + ALIVE
        with self.guard:
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._loop, name="GeN13 monitor", daemon=True)
                self.thread.start()
            if self.tthread is None or not self.tthread.is_alive():
                self.tthread = threading.Thread(target=self._track_loop, name="GeN13 progress", daemon=True)
                self.tthread.start()
        # wake only a sleeping loop or a new interval: an extra reading would break the line's spacing
        # and give cpu_percent a window of a few ms
        if asleep or self.rate != old:
            self.wake.set()

    def info(self):
        g = self.gpu
        return {"rate": self.rate, "nvml": bool(g and g.nv), "gpu_name": g.name if g else "",
                "caps": g.caps() if g else None}

    def _read(self):
        vm = psutil.virtual_memory()
        data = {
            "cpu": float(psutil.cpu_percent(interval=None)),
            "ram_used": float(vm.total - vm.available),
            "ram_total": float(vm.total),
            "gpu_name": self.gpu.name,
            "nvml": bool(self.gpu.nv),
            "caps": self.gpu.caps(),
            "rate": self.rate,
        }
        data.update(self.gpu.status())
        data["job"] = self._job()
        return data

    # the prompt running now, read from the queue and the progress registry (read only)
    def _job(self):
        srv = PromptServer.instance
        try:
            running = srv.prompt_queue.get_current_queue_volatile()[0]
            remaining = srv.prompt_queue.get_tasks_remaining()
        except Exception:
            return None
        if not running:
            self.job_id = None
            return {"queue": remaining, "last": self.track.last}
        item = running[0]
        pid = item[1] if len(item) > 1 else None
        prompt = item[2] if len(item) > 2 and isinstance(item[2], dict) else {}
        extra = item[3] if len(item) > 3 and isinstance(item[3], dict) else {}
        if pid != self.job_id:
            self.job_id, self.job_t0 = pid, time.monotonic()
        node = getattr(srv, "last_node_id", None)
        if getattr(srv, "last_prompt_id", pid) != pid:
            node = None
        title = ""
        if node is not None:
            n = prompt.get(str(node))
            if isinstance(n, dict):
                meta = n.get("_meta") if isinstance(n.get("_meta"), dict) else {}
                title = str(meta.get("title") or n.get("class_type") or "")
        step = smax = 0
        try:
            from comfy_execution.progress import get_progress_state
            reg = get_progress_state()
            if getattr(reg, "prompt_id", None) == pid:
                for e in list(reg.nodes.values()):
                    st = getattr(e.get("state"), "value", e.get("state"))
                    if st == "running" and (e.get("max") or 0) > 1:
                        step, smax = e.get("value") or 0, e.get("max") or 0
        except Exception:
            pass
        prog = self.track.model() if self.track.pid == pid else None
        return {"id": pid, "client": extra.get("client_id"), "node": node, "title": title,
                "step": int(step), "max": int(smax), "elapsed": time.monotonic() - self.job_t0,
                "queue": remaining, "prog": prog, "last": self.track.last}

    # follows the running prompt every TRACK_DT, page open or not, so node times are learned from
    # every run; one reading a second while the queue is empty
    def _track_loop(self):
        srv = PromptServer.instance
        while True:
            pid = prompt = None
            try:
                running = srv.prompt_queue.get_current_queue_volatile()[0]
                if running:
                    item = running[0]
                    pid = item[1] if len(item) > 1 else None
                    prompt = item[2] if len(item) > 2 and isinstance(item[2], dict) else {}
            except Exception:
                pass
            try:
                self.track.tick(pid, prompt)
            except Exception as e:
                log.warning("[GeN13] monitor progress: %s", e)
            time.sleep(TRACK_DT if pid is not None else 1.0)

    def _loop(self):
        if self.gpu is None:
            self.gpu = _Gpu()
        psutil.cpu_percent(interval=None)  # the first reading is always 0: start the window now
        while True:
            self.wake.clear()
            if time.monotonic() > self.alive_until:
                self.wake.wait()  # no page open: sleep until the next post
                continue
            try:
                PromptServer.instance.send_sync("gen13.monitor", self._read())
            except Exception as e:
                log.warning("[GeN13] monitor: %s", e)
            self.wake.wait(self.rate)


MONITOR = _Monitor()


@PromptServer.instance.routes.post("/gen13/monitor")
async def _monitor_ping(request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    MONITOR.ping(body.get("rate") if isinstance(body, dict) else None)
    return web.json_response(MONITOR.info())


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
