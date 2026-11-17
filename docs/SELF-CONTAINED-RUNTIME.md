# Self-contained runtime — feasibility notes (not shipped)

The goal was a single APK: install, open, grant permissions, and the app sets up
OpenCode itself — no Termux, no Debian install, no `start.sh`. This file records
what was actually tested on a Realme RMX5003 (Android 16, arm64-v8a) so the work
is not repeated from scratch. **Nothing here is enabled in the shipped app.**

## What works

[`build-runtime.py`](../tools/build-runtime.py) produces a valid runtime bundle:

- Alpine 3.24.4 minirootfs (4 MB) as a musl userspace
- OpenCode 2.3.0's musl binary (from `@opencode/cli-linux-arm64-musl@2.3.0`)
- `libstdc++` and `libgcc_s` from Alpine's APK repo
- Termux `proot` + `libtalloc` + `libandroid-shmem` from the Termux apt repo
- a `start.sh` that runs `proot -r rootfs … /usr/local/bin/opencode serve …`

Result: `runtime.tar.gz`, ~118 MB, sha256
`2afda3e355f54bef72e3a0eaa3bd316702eb7c4658f27a2a393a47b7c4c618d6` at the time
of the experiment. Absolute symlinks are rewritten to relative ones so toybox
`tar` can extract the bundle into app-private storage.

## Why it cannot finish as a normal app

1. **The OpenCode binary needs a Linux loader.** The npm `bin/opencode.exe` is
   only a launcher; the real binary is the platform optional dependency. Both
   variants are ELF `ET_EXEC` with an absolute interpreter:
   - glibc build → `/lib/ld-linux-aarch64.so.1`
   - musl build → `/lib/ld-musl-aarch64.so.1`
   
   Neither path exists on Android. Patch the interpreter to `/system/bin/linker64`
   and Android refuses it: *"Android only supports position-independent
   executables (-fPIE)"*. There is no PIE build of OpenCode 2.3.0 on npm.

2. **A downloaded binary needs targetSdk ≤ 28.** With `targetSdk = 36`,
   `ProcessBuilder` on an extracted `bin/proot` fails with
   `error=13, Permission denied`. Lowering `targetSdk` to 28 makes the host
   `proot` executable start correctly (verified on the device). This alone is
   acceptable for a sideloaded GitHub build.

3. **proot cannot execute anything inside the guest from a third-party app.**
   With targetSdk 28, proot starts but every guest `execve` fails:
   
   ```
   proot error: execve("/usr/local/bin/opencode"): Permission denied
   proot error: execve("/bin/busybox"): Permission denied
   ```
   
   The same happens from an `adb shell` and from the app process, with and
   without `PROOT_NO_SECCOMP=1`. Termux's proot works on the same device — its
   app domain carries the ptrace/seccomp permissions a normal app does not get.

Point 3 is the blocker. Downloading the runtime is fine; running it without
Termux is not, on stock Android. The only ways past it are outside this repo's
control: a PIE build of OpenCode (not published), a device with an unlocked
SELinux policy/root, or keeping Termux as the host.

## Update — native launcher version (in progress)

Play Store apps (AnyClaw, NativeCode, AndroPI) and the open-source Mobile
Harness prove this is possible, so the earlier conclusion was too broad. Their
technique is now being tried here:

- `app/src/main/jniLibs/arm64-v8a/libproot.so` — Termux proot with DT_NEEDED
  rewritten to short names (`libtt.so`, `libas.so`) so it runs from the native
  library dir, which is executable even at targetSdk 36.
- `app/src/main/cpp/launcher.cpp` + `NativeLauncher.kt` — a JNI fork/execve
  bridge with an output pipe, replacing Java `ProcessBuilder`.
- `android:extractNativeLibs="true"` so native libs are extracted and can be
  executed by path.
- `EmbeddedRuntime.kt` — download/verify/extract + launch, gated behind an
  `PROBE_EMBEDDED` marker. Not enabled in normal use.

**Device status:** with this setup, proot now *starts* via the JNI launcher from
the native lib dir (the earlier "Permission denied" at host exec is gone), but
the guest `execve("/usr/local/bin/opencode")` still reported Permission denied
in the last run. A direct-musl-loader experiment was added but could not be run
because the phone lost adb connectivity mid-test. Nothing is claimed to work
yet; the default Termux path is unchanged and `targetSdk` was restored to 36.

## What stays supported

- Browser/PWA path: Termux + Debian/proot + `start.sh`.
- Native APK: the same WebView shell, with `OpencodeService` starting OpenCode
  in Termux via `RUN_COMMAND`.

## If you want to pick this up again

- Build and inspect the bundle with `python tools/build-runtime.py`.
- Check for a newer OpenCode package with a PIE binary:
  `npm view @opencode/cli-linux-arm64-musl version`.
- Test guest exec from the app domain before building any UI; the probe that
  produced the results above lived in `RuntimeProbe.kt` and was removed so it
  cannot ship by accident.
