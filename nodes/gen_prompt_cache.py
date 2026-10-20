"""
Prompt Cache (GeN13) - ComfyUI custom node  [v9]

Everything lives flat in ComfyUI/output/prompt_cache/ :

    AAA.txt                        <- current, written by save_as
    AAA.prev.txt                   <- the one automatic backup, overwritten each save
    AAA.fav.20260831-204512.txt    <- favorites, kept forever
    AAA.fav.20260830-113005.txt

Widgets:

  mode          : where the text comes from (see below).
  save_as       : free text. Where this run's upstream text gets written.
  read_file     : dropdown of every .txt in the cache folder, plus the sentinel
                  "(same as save_as)" which follows save_as. The sentinel is the
                  default, so a file written this run is readable immediately
                  without waiting for the dropdown to refresh.
  auto_backup   : copy the existing file to <stem>.prev.txt before overwriting.
                  One generation only - each save replaces the previous backup.
  Save favorite : button, added by the frontend script. Copies the current
                  save_as file to <stem>.fav.<timestamp>.txt. Favorites are never
                  pruned or overwritten.

Modes:

  "1: upstream" : always run the upstream branch, pass its text through and
                  write it to save_as.
  "2: cache"    : never run the upstream branch (the lazy input keeps it
                  pruned from the execution graph), just read the target file.
  "auto"        : run the upstream branch and use its text if there is any;
                  if it comes back None (node muted, or bypassed with no
                  passthrough) or empty, fall back to the target file. Never
                  falls through to off.
  "3: off"      : never run the upstream branch, read nothing, output an
                  empty string (source ["OFF"]). For running on your own
                  prompt text only.

Both Mute (Ctrl+M) and Bypass (Ctrl+B) work in "auto": muting drops the node
from the submitted prompt along with its link, so the lazy resolver is told not
to ask for the input at all rather than asking for a link that no longer exists.

"auto" cannot save the LLM from loading - deciding whether there is input
requires asking for it. Only "2: cache" prunes the branch, and only if nothing
else in the graph still needs it (another live consumer, or an OUTPUT_NODE
inside that branch, pulls it back in).

UI output (v9): every run reports where the text actually came from, stored in
the ComfyUI history outputs of this node:

    source : ["LLM"]   upstream text was used and written to save_as
             ["CACHE"] the text was read from a file (cache mode, or the
                       upstream returned None / empty and fell back)
    file   : [basename of the file written or read]

The source reflects what really happened, not the selected mode.

"""

import hashlib
import os
import shutil
import time

import folder_paths

BASE_DIR = os.path.join(folder_paths.get_output_directory(), "prompt_cache")

MODE_AUTO = "auto"
MODE_UPSTREAM = "1: upstream"
MODE_CACHE = "2: cache"
MODE_OFF = "3: off"
MODES = [MODE_AUTO, MODE_UPSTREAM, MODE_CACHE, MODE_OFF]

SAME_AS_SAVE = "(same as save_as)"
PREV_SUFFIX = ".prev"
FAV_SUFFIX = ".fav"

WEB_DIRECTORY = "./web"


def _mode(value):
    # Matches on the leading token, so values saved by earlier versions
    # ("1", "2", "auto") still resolve correctly.
    m = str(value).strip().lower()
    if m.startswith("1"):
        return MODE_UPSTREAM
    if m.startswith("2"):
        return MODE_CACHE
    if m.startswith("3"):
        return MODE_OFF
    return MODE_AUTO  # auto never falls through to off


def _text_is_linked(prompt, unique_id):
    """True when this node still has a live link feeding its text input.

    Muting the upstream node removes it, and the link, from the submitted
    prompt. Asking the lazy resolver for an input with no link raises
    NodeInputError before run() is ever reached, so the request has to be
    skipped rather than made and caught.
    """
    try:
        inputs = prompt[str(unique_id)]["inputs"]
    except (KeyError, TypeError, IndexError):
        return False
    link = inputs.get("text")
    if not isinstance(link, (list, tuple)) or not link:
        return False
    return str(link[0]) in prompt


def _list_files():
    try:
        names = sorted(
            f for f in os.listdir(BASE_DIR)
            if f.lower().endswith(".txt") and os.path.isfile(os.path.join(BASE_DIR, f))
        )
    except OSError:
        names = []
    return [SAME_AS_SAVE] + names


def _resolve(name):
    name = (name or "").strip() or "last_prompt.txt"
    if not name.lower().endswith(".txt"):
        name += ".txt"
    if "/" in name or "\\" in name:
        raise ValueError("Prompt Cache: filename must not contain a path separator.")
    root = os.path.normpath(BASE_DIR)
    path = os.path.normpath(os.path.join(root, name))
    if not path.startswith(root + os.sep) and path != root:
        raise ValueError("Prompt Cache: filename escapes the cache directory.")
    return path


def _target(save_as, read_file):
    """Which file a read should come from."""
    chosen = (read_file or "").strip()
    if not chosen or chosen == SAME_AS_SAVE:
        return _resolve(save_as)
    return _resolve(chosen)


def _stem(path):
    return os.path.splitext(os.path.basename(path))[0]


def _read(path):
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    existing = [n for n in _list_files() if n != SAME_AS_SAVE]
    raise RuntimeError(
        "Prompt Cache: no file at %s. Files in the cache folder: %s"
        % (path, ", ".join(existing) if existing else "(none)")
    )


def _unique(path):
    """Avoid clobbering when two writes land inside the same second."""
    if not os.path.exists(path):
        return path
    root, ext = os.path.splitext(path)
    serial = 1
    while os.path.exists("%s-%d%s" % (root, serial, ext)):
        serial += 1
    return "%s-%d%s" % (root, serial, ext)


_FELL_BACK = {}  # unique_id -> the last run had a link but read the file (upstream gave nothing)


def _write_atomic(path, text):
    """Write to a temp file, then replace: a favorite copied at the same moment gets the old or the new file, never half."""
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def _make_favorite(save_as):
    """Copy the current save_as file to a timestamped favorite. Kept forever."""
    src = _resolve(save_as)
    if not os.path.isfile(src):
        raise FileNotFoundError(src)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dst = _unique(os.path.join(BASE_DIR, "%s%s.%s.txt" % (_stem(src), FAV_SUFFIX, stamp)))
    shutil.copy2(src, dst)
    return os.path.basename(dst)


class GenPromptCache:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (MODES, {
                    "default": MODE_AUTO,
                    "tooltip": "Mode: auto uses and saves upstream text if connected, else reads the file. 1 always runs upstream, 2 reads the file only, 3 outputs nothing.",
                }),
                "save_as": ("STRING", {
                    "default": "last_prompt.txt",
                    "multiline": False,
                    "tooltip": "Save as: file name in output\\prompt_cache\\; .txt is added if omitted. Empty saves to last_prompt.txt.",
                }),
                "read_file": (_list_files(), {
                    "default": SAME_AS_SAVE,
                    "tooltip": "Read file: follows save_as by default. .prev files are automatic backups, .fav files are favorites; the list refreshes after each run.",
                }),
                "auto_backup": ("BOOLEAN", {
                    "default": True,
                    "label_on": "keep previous",
                    "label_off": "off",
                    "tooltip": "Auto backup: before overwriting, the old file is kept as <name>.prev.txt (one generation); unchanged text is not saved again.",
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
            "optional": {
                "text": ("STRING", {
                    "forceInput": True,
                    "lazy": True,
                    "tooltip": "Text: the upstream source, usually an LLM output; upstream runs only in the modes that need it.",
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("Text: upstream text in auto and 1, file content in 2, empty in 3.",)
    FUNCTION = "run"
    CATEGORY = "GeN13/text"
    DESCRIPTION = "Saves upstream text, such as an LLM script, to a file so it can be reused later without loading the upstream nodes; keeps one automatic backup and any number of favorites."

    def check_lazy_status(self, mode, save_as, read_file, auto_backup, text=None,
                          prompt=None, unique_id=None, **kwargs):
        # Returning [] leaves the lazy input unrun, which prunes the whole
        # upstream branch. Only cache mode can do that.
        if _mode(mode) in (MODE_CACHE, MODE_OFF) or text is not None:
            self._asked = None
            return []
        # Nothing connected, or the upstream was muted away: never request it.
        if not _text_is_linked(prompt, unique_id):
            self._asked = None
            return []
        # Ask for the live branch once. If it still comes back None the upstream
        # was bypassed, so stop asking and let run() fall back - this guard is
        # what keeps the lazy resolver from looping.
        # The flag is scoped to this run (id of the prompt dict, one object per
        # queued prompt, kept alive by the history): the node object survives
        # between prompts, and an interrupted LLM run used to leave it set, so
        # the next WRITE silently replayed the cache instead of asking again.
        if getattr(self, "_asked", None) == id(prompt):
            self._asked = None
            return []
        self._asked = id(prompt)
        return ["text"]

    @classmethod
    def IS_CHANGED(cls, mode, save_as, read_file, auto_backup, text=None,
                   prompt=None, unique_id=None, **kwargs):
        if _mode(mode) == MODE_OFF:
            return "off"  # output is always empty, nothing to re-run
        # auto / upstream with a live link: the output is the upstream text, which is
        # already part of the cache key through the link, so nothing of our own
        # changes. (NaN here used to make every downstream node re-run on every
        # queue, fixed seed or not; keying on the file would still cost one extra
        # full re-run right after the script changed, because run() writes it.)
        if _mode(mode) != MODE_CACHE and _text_is_linked(prompt, unique_id):
            if not _FELL_BACK.get(unique_id):
                return "live"
            # the last run fell back to the file: an edit made to that file outside ComfyUI must re-run
            try:
                with open(_target(save_as, read_file), "rb") as f:
                    return "live:" + hashlib.sha1(f.read()).hexdigest()
            except Exception:
                return "live:missing"
        # cache mode, or no link (fallback reads the file): key on the file content
        try:
            with open(_target(save_as, read_file), "rb") as f:
                return hashlib.sha1(f.read()).hexdigest()
        except Exception:
            return "missing"

    def run(self, mode, save_as, read_file, auto_backup, text=None,
            prompt=None, unique_id=None, **kwargs):
        if _mode(mode) == MODE_OFF:
            return {"ui": {"source": ["OFF"], "file": [""]}, "result": ("",)}
        _FELL_BACK[unique_id] = _mode(mode) != MODE_CACHE and text is not None and not text.strip()
        if _mode(mode) == MODE_CACHE or text is None or not text.strip():
            target = _target(save_as, read_file)
            return {"ui": {"source": ["CACHE"], "file": [os.path.basename(target)]},
                    "result": (_read(target),)}

        path = _resolve(save_as)
        previous = None
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8", newline="") as f:
                    previous = f.read()
            except OSError:
                previous = None

        # compare with the line endings normalized: the file is written with "\n" only, so CRLF text
        # from upstream would otherwise never match and the single backup would be overwritten each run
        if previous is None or previous.replace("\r\n", "\n") != text.replace("\r\n", "\n"):
            if auto_backup and previous is not None:
                prev_path = os.path.join(BASE_DIR, _stem(path) + PREV_SUFFIX + ".txt")
                shutil.copy2(path, prev_path)  # overwrites the older backup
            os.makedirs(BASE_DIR, exist_ok=True)
            _write_atomic(path, text)

        return {"ui": {"source": ["LLM"], "file": [os.path.basename(path)]},
                "result": (text,)}


# --- frontend endpoint for the favorite button -----------------------------

try:
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.post("/gen13/prompt_cache/favorite")
    async def _favorite_route(request):
        try:
            payload = await request.json()
            name = _make_favorite(payload.get("save_as", ""))
            return web.json_response({"ok": True, "file": name})
        except FileNotFoundError as err:
            return web.json_response(
                {"ok": False, "error": "nothing to favorite yet: %s" % err}, status=404
            )
        except Exception as err:  # noqa: BLE001 - surfaced to the browser console
            return web.json_response({"ok": False, "error": str(err)}, status=400)
except Exception as err:  # noqa: BLE001
    print("[Prompt Cache] favorite endpoint unavailable:", err)


NODE_CLASS_MAPPINGS = {"GenPromptCacheGeN13": GenPromptCache}
NODE_DISPLAY_NAME_MAPPINGS = {"GenPromptCacheGeN13": "Prompt Cache (GeN13)"}
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
