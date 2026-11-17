#!/usr/bin/env python3
"""Build the download-on-first-run OpenCode runtime bundle for arm64 Android.

Outputs runtime.tar.gz: a tiny Alpine (musl) rootfs with the OpenCode 2.3.0
musl binary inside, plus Termux's proot and its two libraries. The app
extracts this into its private files and runs start.sh.
"""
import io, os, shutil, tarfile, urllib.request, hashlib, json

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "runtime-build")
BUNDLE = os.path.join(HERE, "runtime")
ALPINE = "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/alpine-minirootfs-3.24.4-aarch64.tar.gz"
TERMUX = "https://packages.termux.dev/apt/termux-main/"
DEBS = {
    "proot": "pool/main/p/proot/proot_5.1.107.102_aarch64.deb",
    "libandroid-shmem": "pool/main/liba/libandroid-shmem/libandroid-shmem_0.7_aarch64.deb",
    "libtalloc": "pool/main/libt/libtalloc/libtalloc_2.5.0_aarch64.deb",
}
OPENCODE = os.path.join(HERE, "ocli", "package", "bin", "opencode")  # musl tgz extracted earlier
SYMLINKS = []


def fetch(url, dest):
    if os.path.exists(dest):
        print("cached", os.path.basename(dest))
        return dest
    print("fetch", url)
    req = urllib.request.Request(url, headers={"User-Agent": "opencode-pocket-runtime-builder/1"})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    return dest


def extract_deb(path, out):
    with open(path, "rb") as f:
        blob = f.read()
    assert blob[:8] == b"!<arch>\n", "not an ar archive"
    pos = 8
    while pos + 60 <= len(blob):
        hdr = blob[pos:pos + 60]
        name = hdr[:16].decode("ascii", "replace").strip().rstrip("/")
        size = int(hdr[48:58].decode("ascii").strip())
        data = blob[pos + 60:pos + 60 + size]
        pos += 60 + size + (size & 1)
        if name.startswith("data.tar"):
            mode = "r:" + ("xz" if name.endswith("xz") else "gz" if name.endswith("gz") else "bz2")
            with tarfile.open(fileobj=io.BytesIO(data), mode=mode) as tf:
                for m in tf.getmembers():
                    p = m.name
                    if p.startswith("./"):
                        p = p[2:]
                    prefix = "data/data/com.termux/files/usr/"
                    if p.startswith(prefix):
                        p = p[len(prefix):]
                    target = os.path.join(out, p)
                    if m.isdir():
                        os.makedirs(target, exist_ok=True)
                    elif m.isfile() or m.issym():
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        if m.issym():
                            if os.path.lexists(target):
                                os.remove(target)
                            SYMLINKS.append((os.path.relpath(target, BUNDLE).replace("\\", "/"), m.linkname))
                        else:
                            with tf.extractfile(m) as src, open(target, "wb") as dst:
                                shutil.copyfileobj(src, dst)
                            os.chmod(target, 0o755)
            return
    raise RuntimeError("no data.tar in " + path)


def main():
    shutil.rmtree(BUNDLE, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(os.path.join(BUNDLE, "rootfs"), exist_ok=True)
    os.makedirs(os.path.join(BUNDLE, "bin"), exist_ok=True)
    os.makedirs(os.path.join(BUNDLE, "lib"), exist_ok=True)

    alpine = fetch(ALPINE, os.path.join(WORK, "alpine.tar.gz"))
    rootfs = os.path.join(BUNDLE, "rootfs")
    with tarfile.open(alpine, "r:gz") as tf:
        for m in tf.getmembers():
            target = os.path.normpath(os.path.join(rootfs, m.name))
            if not target.startswith(rootfs):
                continue
            if m.isdir():
                os.makedirs(target, exist_ok=True)
            elif m.issym():
                os.makedirs(os.path.dirname(target), exist_ok=True)
                if os.path.lexists(target):
                    os.remove(target)
                # Windows cannot create symlinks without developer mode, but the
                # phone can. Keep them as symlink entries in the final tar.
                SYMLINKS.append((os.path.relpath(target, BUNDLE).replace("\\", "/"), m.linkname))
            elif m.isfile():
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with tf.extractfile(m) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                os.chmod(target, m.mode & 0o777 or 0o644)

    for name, path in DEBS.items():
        deb = fetch(TERMUX + path, os.path.join(WORK, name + ".deb"))
        extract_deb(deb, BUNDLE)

    if not os.path.exists(OPENCODE):
        raise SystemExit("opencode musl binary missing: " + OPENCODE)
    dst = os.path.join(BUNDLE, "rootfs", "usr", "local", "bin", "opencode")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(OPENCODE, dst)
    os.chmod(dst, 0o755)

    start = os.path.join(BUNDLE, "start.sh")
    with open(start, "w", newline="\n") as f:
        f.write("""#!/system/bin/sh
# Runs OpenCode 2.3.0 inside a musl rootfs, no root, no Termux.
HERE=$(cd "$(dirname "$0")" && pwd)
export LD_LIBRARY_PATH="$HERE/lib"
exec "$HERE/bin/proot" \\
  -R "$HERE/rootfs" \\
  -b /dev \\
  -b /proc \\
  -b /system \\
  -b "$HERE/workspace:/workspace" \\
  -w /workspace \\
  -0 /usr/local/bin/opencode serve --hostname 127.0.0.1 --port 4096
""")
    os.chmod(start, 0o755)

    out = os.path.join(HERE, "runtime.tar.gz")
    with tarfile.open(out, "w:gz", compresslevel=6) as tf:
        tf.add(BUNDLE, arcname="runtime")
        for rel, link in SYMLINKS:
            # toybox tar refuses absolute symlinks that escape the extract dir.
            # Rewrite guest-absolute links as paths relative to the symlink.
            if link.startswith("/") and rel.startswith("rootfs/"):
                import posixpath
                target = "rootfs" + link
                link = posixpath.relpath(target, posixpath.dirname(rel))
            info = tarfile.TarInfo("runtime/" + rel)
            info.type = tarfile.SYMTYPE
            info.linkname = link
            info.mode = 0o777
            tf.addfile(info)
    h = hashlib.sha256(open(out, "rb").read()).hexdigest()
    print(json.dumps({"bundle": out, "bytes": os.path.getsize(out), "sha256": h, "symlinks": len(SYMLINKS)}, indent=2))


if __name__ == "__main__":
    main()
