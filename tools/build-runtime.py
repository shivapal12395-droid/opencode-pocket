#!/usr/bin/env python3
"""Build the download-on-first-run OpenCode runtime bundle for arm64 Android.

Outputs runtime.tar.gz: a minimal Alpine (musl) rootfs with OpenCode 2.3.0 and
its C++ runtime libraries inside. The app extracts this into private storage
and runs the binary through the musl loader via the JNI fork/exec bridge.

The Termux proot and its libraries are also included for the proot-based path
that is still being evaluated; see docs/SELF-CONTAINED-RUNTIME.md.
"""
import io, os, re, shutil, tarfile, urllib.request, hashlib, json

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "runtime-build")
BUNDLE = os.path.join(HERE, "runtime")
ALPINE_BASE = "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/"
ALPINE = ALPINE_BASE + "alpine-minirootfs-3.24.4-aarch64.tar.gz"
ALPINE_APK = "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/"
TERMUX = "https://packages.termux.dev/apt/termux-main/"
DEBS = {
    "proot": "pool/main/p/proot/proot_5.1.107.102_aarch64.deb",
    "libandroid-shmem": "pool/main/liba/libandroid-shmem/libandroid-shmem_0.7_aarch64.deb",
    "libtalloc": "pool/main/libt/libtalloc/libtalloc_2.5.0_aarch64.deb",
}
OPENCODE = os.environ.get("OPENCODE_BIN") or os.path.join(HERE, "ocli", "package", "bin", "opencode")
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


def apk_version(index_path, package):
    with tarfile.open(index_path, "r:gz") as tf:
        name = [n for n in tf.getnames() if n.endswith("APKINDEX")][0]
        text = tf.extractfile(name).read().decode()
    for block in text.strip().split("\n\n"):
        if re.search(r"^P:" + re.escape(package) + r"$", block, re.M):
            return re.search(r"^V:(.+)$", block, re.M).group(1)
    raise RuntimeError("no APK index entry for " + package)


def extract_apk(path, out, wanted):
    with tarfile.open(path, "r:gz") as tf:
        for m in tf.getmembers():
            name = m.name.lstrip("./")
            base = os.path.basename(name)
            if base not in wanted:
                continue
            target = os.path.join(out, base)
            with tf.extractfile(m) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            os.chmod(target, 0o755)


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


def add_rootfs_libs(rootfs):
    """libstdc++ and libgcc are not in the mini rootfs; OpenCode needs both."""
    index = fetch(ALPINE_APK + "APKINDEX.tar.gz", os.path.join(WORK, "APKINDEX.tar.gz"))
    for pkg, names in [("libstdc++", {"libstdc++.so.6.0.34"}), ("libgcc", {"libgcc_s.so.1"})]:
        ver = apk_version(index, pkg)
        apk = fetch(ALPINE_APK + f"{pkg}-{ver}.apk", os.path.join(WORK, f"{pkg}-{ver}.apk"))
        extract_apk(apk, os.path.join(rootfs, "lib"), names)
    link = os.path.join(rootfs, "lib", "libstdc++.so.6")
    if not os.path.exists(link):
        SYMLINKS.append((os.path.relpath(link, BUNDLE).replace("\\", "/"), "libstdc++.so.6.0.34"))


def main():
    shutil.rmtree(BUNDLE, ignore_errors=True)
    SYMLINKS.clear()
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
                SYMLINKS.append((os.path.relpath(target, BUNDLE).replace("\\", "/"), m.linkname))
            elif m.isfile():
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with tf.extractfile(m) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                os.chmod(target, m.mode & 0o777 or 0o644)

    add_rootfs_libs(rootfs)

    for name, path in DEBS.items():
        deb = fetch(TERMUX + path, os.path.join(WORK, name + ".deb"))
        extract_deb(deb, BUNDLE)

    if not os.path.exists(OPENCODE):
        raise SystemExit("opencode musl binary missing: " + OPENCODE)
    dst = os.path.join(rootfs, "usr", "local", "bin", "opencode")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(OPENCODE, dst)
    os.chmod(dst, 0o755)

    start = os.path.join(BUNDLE, "start.sh")
    with open(start, "w", newline="\n") as f:
        f.write("""#!/system/bin/sh
HERE=$(cd "$(dirname "$0")" && pwd)
export LD_LIBRARY_PATH="$HERE/lib"
exec "$HERE/bin/proot" \\
  -R "$HERE/rootfs" \\
  -b /dev -b /proc \\
  -b "$HERE/workspace:/workspace" \\
  -w /workspace \\
  /usr/local/bin/opencode serve --hostname 127.0.0.1 --port 4096
""")
    os.chmod(start, 0o755)

    out = os.path.join(HERE, "runtime.tar.gz")
    with tarfile.open(out, "w:gz", compresslevel=6) as tf:
        tf.add(BUNDLE, arcname="runtime")
        for rel, link in SYMLINKS:
            if link.startswith("/") and rel.startswith("rootfs/"):
                import posixpath
                link = posixpath.relpath("rootfs" + link, posixpath.dirname(rel))
            info = tarfile.TarInfo("runtime/" + rel)
            info.type = tarfile.SYMTYPE
            info.linkname = link
            info.mode = 0o777
            tf.addfile(info)
    print(json.dumps({
        "bundle": out,
        "bytes": os.path.getsize(out),
        "sha256": hashlib.sha256(open(out, "rb").read()).hexdigest(),
        "symlinks": len(SYMLINKS),
    }, indent=2))


if __name__ == "__main__":
    main()
