#!/usr/bin/env python3
"""Mirror a legacy Hyperfy (hyperfy.io) world into a local folder.

Downloads the world record (scene JSON), every asset it references (GLB/VRM
models, textures, audio, HDRs), the component packages its entities use and
the world preview image. Files are stored under the same paths they have on
the original hosts:

    api.hyperfy.io/worlds/<world-id>.json      raw world record from the API
    api.hyperfy.io/entities/<component>.json   component metadata
    data.hyperfy.xyz/uploads/...               uploaded GLBs, textures, audio
    data.hyperfy.xyz/avatars/...               VRM avatars
    data.hyperfy.xyz/components/<id>/v<n>/...  component code + bundled assets
    data.hyperfy.xyz/world-images/...          world preview image
    data.hyperfy.xyz/core/...                  engine assets (sky, default avatar, ...)
    hyperfy.io/avatar@*.glb                    avatar locomotion clips (idle, walk, sit, ...)

It then writes:

    manifest.json   every file: source URL, local path, size, sha256, status,
                    original file name(s) and which entities reference it
    world.json      the scene with parsed entities and asset URLs rewritten to
                    the local relative paths (used by index.html)

Re-running is safe: files already on disk are kept (use --force to refetch).

Usage:
    python tools/hyperfy_mirror.py                  # world "pill" into whyweexist/
    python tools/hyperfy_mirror.py --slug hatch --out hatch
    python tools/hyperfy_mirror.py --world-id world-1766
"""

import argparse
import hashlib
import json
import mimetypes
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

PAGE_URL = "https://hyperfy.io"
API_URL = "https://api.hyperfy.io"
CDN_URL = "https://data.hyperfy.xyz"
USER_AGENT = "hyperfy-mirror/1.0 (+https://github.com/decentralize-dfw/whyweexist)"

# Engine assets the Hyperfy client always loads, independent of the world.
RUNTIME_ASSETS = [CDN_URL + "/" + p for p in (
    "core/sky.hdr",
    "core/hyperbot-v2.vrm",  # default visitor avatar
    "core/fallback-v2.vrm",
    "core/crash-block-v2.glb",
    "components/world/v2/assets/image.png",  # loading screen fallback
)] + [
    # Fonts the client hard-codes: troika text (signs) and Roboto for name
    # tags and ui panels.
    "https://fonts.gstatic.com/s/roboto/v18/KFOmCnqEu92Fr1Mu4mxM.woff",
    "https://fonts.gstatic.com/s/roboto/v29/KFOlCnqEu92Fr1MmEU9vAA.woff",
    "https://fonts.gstatic.com/s/roboto/v29/KFOmCnqEu92Fr1Me5g.woff",
    "https://fonts.gstatic.com/s/roboto/v29/KFOlCnqEu92Fr1MmWUlvAA.woff",
] + [
    # Avatar locomotion clips the engine applies to every VRM.
    "%s/avatar@%s.glb" % (PAGE_URL, n) for n in (
        "idle", "walk", "walk-left", "walk-right", "walk-back",
        "run", "run-left", "run-right", "run-back", "float", "fall", "seat")
]
# Components the client loads for every world (avatar + default emotes).
RUNTIME_COMPONENTS = ["hyperfy-avatar"]

ASSET_EXT = r"glb|gltf|vrm|png|jpe?g|webp|gif|ktx2|hdr|exr|mp3|ogg|wav|m4a|mp4|webm|json|bin"
ASSET_LITERAL_RE = re.compile(r"""["'`]([\w\-./ ()%%]+\.(?:%s))["'`]""" % ASSET_EXT, re.I)


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def http_get(url, retries=4, timeout=60):
    """GET a URL and return (bytes, content_type). Raises on final failure."""
    delay = 2
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read(), res.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            # 4xx (other than rate limiting) will not fix itself.
            if e.code < 500 and e.code != 429:
                raise
            err = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            err = e
        if attempt < retries:
            time.sleep(delay)
            delay *= 2
    raise err


def describe_error(e):
    if isinstance(e, urllib.error.HTTPError):
        return "http_%d" % e.code
    reason = getattr(e, "reason", e)
    return "%s: %s" % (type(e).__name__, reason)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def kind_of(path):
    ext = path.rsplit(".", 1)[-1].lower()
    if ext in ("glb", "gltf", "bin"):
        return "model"
    if ext == "vrm":
        return "avatar"
    if ext in ("png", "jpg", "jpeg", "webp", "gif", "ktx2"):
        return "texture"
    if ext in ("hdr", "exr"):
        return "environment"
    if ext in ("mp3", "ogg", "wav", "m4a"):
        return "audio"
    if ext in ("mp4", "webm"):
        return "video"
    if ext == "js":
        return "script"
    if ext == "json":
        return "json"
    return "other"


def cdn_path(url):
    """https://data.hyperfy.xyz/uploads/x.glb?v=1 -> data.hyperfy.xyz/uploads/x.glb

    Works for any host: files are stored under <host>/<path>."""
    p = urllib.parse.urlsplit(url)
    return p.netloc + urllib.parse.unquote(p.path)


def resolve_world_id(slug):
    """hyperfy.io/<slug> is a SPA; the world id is only exposed in its meta tags."""
    html, _ = http_get("%s/%s" % (PAGE_URL, urllib.parse.quote(slug)))
    m = re.search(rb"world-images/(world-\d+)\.", html)
    if m:
        return m.group(1).decode()
    # Fallback: scan the public world list.
    worlds = json.loads(http_get(API_URL + "/worlds")[0])
    for w in worlds:
        if w.get("slug") == slug:
            return w["id"]
    raise SystemExit("could not resolve world id for slug %r" % slug)


def iter_asset_refs(value, path=""):
    """Yield (json_path, url, original_name) for every data.hyperfy.xyz URL."""
    if isinstance(value, dict):
        url = value.get("url")
        if isinstance(url, str) and url.startswith(CDN_URL + "/"):
            yield path, url, value.get("name")
        for k, v in value.items():
            if k == "url":
                continue
            yield from iter_asset_refs(v, "%s.%s" % (path, k) if path else k)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from iter_asset_refs(v, "%s[%d]" % (path, i))
    elif isinstance(value, str) and value.startswith(CDN_URL + "/"):
        yield path, value, None


def rewrite_urls(value, prefix):
    """Replace CDN URLs with local relative paths (prefix + host + path)."""
    if isinstance(value, dict):
        return {k: rewrite_urls(v, prefix) for k, v in value.items()}
    if isinstance(value, list):
        return [rewrite_urls(v, prefix) for v in value]
    if isinstance(value, str) and value.startswith(CDN_URL + "/"):
        return prefix + cdn_path(value)
    return value


def gltf_external_uris(data):
    """Return external (non data:) buffer/image URIs of a GLB/VRM file."""
    if len(data) < 20 or data[:4] != b"glTF":
        return []
    chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A:  # 'JSON'
        return []
    try:
        gltf = json.loads(data[20:20 + chunk_len])
    except ValueError:
        return []
    uris = []
    for key in ("buffers", "images"):
        for item in gltf.get(key, []):
            uri = item.get("uri")
            if uri and not uri.startswith("data:"):
                uris.append(uri)
    return uris


class Mirror:
    def __init__(self, out, force=False, workers=8):
        self.out = out
        self.force = force
        self.workers = workers
        self.files = {}  # local path -> manifest entry

    def add(self, url, group, required=True, name=None, ref=None):
        path = cdn_path(url) if url.startswith(("https://", "http://")) else None
        if path is None:
            return None
        entry = self.files.get(path)
        if entry is None:
            entry = self.files[path] = {
                "path": path,
                "url": url,
                "kind": kind_of(path),
                "group": group,
                "required": required,
                "names": [],
                "referencedBy": [],
            }
        else:
            entry["required"] = entry["required"] or required
        if name and name not in entry["names"]:
            entry["names"].append(name)
        if ref:
            entry["referencedBy"].append(ref)
        return entry

    def save(self, path, data):
        full = os.path.join(self.out, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        tmp = full + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, full)

    def fetch(self, entry):
        full = os.path.join(self.out, entry["path"])
        if os.path.exists(full) and not self.force:
            with open(full, "rb") as f:
                data = f.read()
            entry["status"] = "ok"
            entry["cached"] = True
        else:
            try:
                data, ctype = http_get(entry["url"])
            except Exception as e:  # noqa: BLE001 - recorded in the manifest
                entry["status"] = "missing" if describe_error(e) == "http_404" else "error"
                entry["error"] = describe_error(e)
                return None
            self.save(entry["path"], data)
            entry["status"] = "ok"
            entry["contentType"] = ctype
        entry["bytes"] = len(data)
        entry["sha256"] = sha256(data)
        return data

    def fetch_all(self, entries, on_done=None):
        """Download entries in parallel; on_done may add follow-up entries."""
        pending = [e for e in entries if "status" not in e]
        while pending:
            with ThreadPoolExecutor(self.workers) as pool:
                results = list(pool.map(self.fetch, pending))
            new = []
            for entry, data in zip(pending, results):
                mark = "ok " if entry["status"] == "ok" else "ERR"
                log("  [%s] %s%s" % (mark, entry["path"],
                                     "" if entry["status"] == "ok" else "  (%s)" % entry["error"]))
                if data is not None and on_done:
                    new.extend(on_done(entry, data) or [])
            pending = [e for e in new if "status" not in e]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slug", default="pill", help="world slug, i.e. hyperfy.io/<slug> (default: pill)")
    ap.add_argument("--world-id", help="world id (e.g. world-1766); skips slug lookup")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "whyweexist"),
                    help="output directory (default: the repository's whyweexist/ folder)")
    ap.add_argument("--force", action="store_true", help="re-download files that already exist")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--no-runtime", action="store_true",
                    help="skip engine assets (core/*, hyperfy-avatar) not referenced by the world")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    world_id = args.world_id or resolve_world_id(args.slug)
    log("world: %s -> %s" % (args.slug if not args.world_id else "-", world_id))

    mirror = Mirror(out, force=args.force, workers=args.workers)
    api_host = urllib.parse.urlsplit(API_URL).netloc

    # 1. World record (always refreshed: it is the source of truth).
    raw, _ = http_get("%s/worlds/%s" % (API_URL, world_id))
    world = json.loads(raw)
    world_path = "%s/worlds/%s.json" % (api_host, world_id)
    mirror.save(world_path, raw)
    entities = json.loads(world.get("entities") or "[]")
    log("entities: %d" % len(entities))

    # 2. Assets referenced from entity state.
    for ent in entities:
        for jpath, url, name in iter_asset_refs(ent.get("state", {})):
            mirror.add(url, "world", name=name, ref={
                "uid": ent["uid"], "component": ent["id"], "field": jpath})

    if world.get("image", "").startswith(CDN_URL):
        mirror.add(world["image"], "world-image", ref={"world": world_id, "field": "image"})

    # 3. Component packages (code + bundled assets), exact versions in use.
    components = {}
    for ent in entities:
        components.setdefault(ent["id"], set()).add(ent["version"])
    if not args.no_runtime:
        for cid in RUNTIME_COMPONENTS:
            components.setdefault(cid, set())
        for url in RUNTIME_ASSETS:
            mirror.add(url, "runtime", required=False)

    component_meta = {}
    for cid in sorted(components):
        meta_path = "%s/entities/%s.json" % (api_host, cid)
        try:
            raw, _ = http_get("%s/entities/%s" % (API_URL, cid))
            mirror.save(meta_path, raw)
            component_meta[cid] = meta = json.loads(raw)
        except Exception as e:  # noqa: BLE001
            log("  [ERR] %s  (%s)" % (meta_path, describe_error(e)))
            continue
        versions = components[cid] or {meta["version"]}
        group = "component" if cid not in RUNTIME_COMPONENTS or components[cid] else "runtime"
        for v in sorted(versions):
            base = "%s/components/%s/v%d" % (CDN_URL, cid, v)
            mirror.add(base + "/index.js", group, ref={"component": cid, "version": v})
            if meta.get("image") and not meta["image"].startswith(("http", "data:")):
                mirror.add("%s/assets/%s" % (base, meta["image"]), group, required=False,
                           ref={"component": cid, "version": v, "field": "image"})

    def follow_up(entry, data):
        """Discover files referenced from downloaded component code / glTF."""
        found = []
        path, url = entry["path"], entry["url"]
        if path.endswith("/index.js") and "/components/" in path:
            base = url.rsplit("/", 1)[0] + "/assets/"
            for lit in sorted(set(ASSET_LITERAL_RE.findall(data.decode("utf-8", "replace")))):
                lit = lit.lstrip("./")
                if lit.startswith("assets/"):
                    lit = lit[len("assets/"):]
                if "/" in lit or lit.startswith("http"):
                    continue
                found.append(mirror.add(base + urllib.parse.quote(lit), entry["group"], required=False,
                                        ref={"file": path, "field": "literal"}))
        elif entry["kind"] in ("model", "avatar"):
            for uri in gltf_external_uris(data):
                found.append(mirror.add(urllib.parse.urljoin(url, uri), entry["group"],
                                        ref={"file": path, "field": "gltf-uri"}))
        return [f for f in found if f]

    log("downloading %d files ..." % len(mirror.files))
    mirror.fetch_all(list(mirror.files.values()), on_done=follow_up)

    # Optional files that 404 are just guesses from string literals; drop them.
    for path in [p for p, e in mirror.files.items() if not e["required"] and e.get("status") == "missing"
                 and any(r.get("field") == "literal" for r in e["referencedBy"])]:
        del mirror.files[path]

    # 4. Local scene file for the viewer.
    local_world = {k: v for k, v in world.items() if k != "entities"}
    for key in ("settings",):
        if isinstance(local_world.get(key), str):
            try:
                local_world[key] = json.loads(local_world[key])
            except ValueError:
                pass
    local_world = rewrite_urls(local_world, "")
    scene = {
        "source": {
            "page": "%s/%s" % (PAGE_URL, world.get("slug") or args.slug),
            "api": "%s/worlds/%s" % (API_URL, world_id),
            "cdn": CDN_URL,
            "raw": world_path,
        },
        "world": local_world,
        "components": {cid: {"versions": sorted(v) or [component_meta.get(cid, {}).get("version")],
                             "name": component_meta.get(cid, {}).get("name")}
                       for cid, v in sorted(components.items())},
        "entities": rewrite_urls(entities, ""),
    }
    with open(os.path.join(out, "world.json"), "w", encoding="utf-8") as f:
        json.dump(scene, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # 5. Manifest.
    files = sorted(mirror.files.values(), key=lambda e: e["path"])
    status = {}
    for e in files:
        status[e.get("status", "skipped")] = status.get(e.get("status", "skipped"), 0) + 1
    by_kind = {}
    for e in files:
        k = by_kind.setdefault(e["kind"], {"files": 0, "bytes": 0})
        k["files"] += 1
        k["bytes"] += e.get("bytes", 0)
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": "tools/hyperfy_mirror.py",
        "world": {
            "id": world_id,
            "slug": world.get("slug"),
            "title": world.get("title"),
            "description": world.get("description"),
            "ownerId": world.get("ownerId"),
            "updatedAt": world.get("updatedAt"),
            "entityCount": len(entities),
            "record": world_path,
            "scene": "world.json",
        },
        "summary": {
            "files": len(files),
            "bytes": sum(e.get("bytes", 0) for e in files),
            "status": status,
            "byKind": by_kind,
        },
        "files": [{k: e[k] for k in ("path", "url", "kind", "group", "required", "status", "bytes",
                                     "sha256", "contentType", "error", "names", "referencedBy") if k in e}
                  for e in files],
        "api": sorted([world_path] + ["%s/entities/%s.json" % (api_host, c) for c in component_meta]),
    }
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")

    failed = [e for e in files if e["required"] and e.get("status") != "ok"]
    log("done: %d files, %.1f MB, status %s" % (len(files), manifest["summary"]["bytes"] / 1e6, status))
    big = [e for e in files if e.get("bytes", 0) > 50 * 1024 * 1024]
    for e in big:
        log("  note: %s is %.1f MB (GitHub rejects files over 100 MB; consider Git LFS)"
            % (e["path"], e["bytes"] / 1e6))
    if failed:
        log("%d required files could not be downloaded; see manifest.json (status != ok)" % len(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
