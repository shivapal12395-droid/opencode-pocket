# Install OpenCode Pocket

Three ways to run it. Pick one; they share the same client.

| You want | Use | Needs |
|---|---|---|
| The whole thing on one phone | **Android APK** (recommended) | Android 8+, ~350 MB free |
| A browser/PWA, server in Termux | **Termux + Debian** | Termux, ~2 GB free |
| The UI on the phone, the agent on a laptop | **Split setup** | Both on the same Wi-Fi |

The app is MIT, has no accounts of its own, and talks only to the OpenCode
server you point it at.

---

## 1. Android APK (recommended)

The APK is a WebView over the same UI. On first launch it downloads a small
verified OpenCode 2.3.0 runtime, starts its own daemon on `127.0.0.1:4098`,
reads the password from the process output, and opens the chat connected.
No Termux, no Debian, no root.

**Install a prebuilt APK**

1. Download `app-debug.apk` from
   [Releases](https://github.com/shivapal12395-droid/opencode-pocket/releases).
2. Allow **Install unknown apps** for your browser/file manager when asked.
3. Open Pocket and wait for the first-run download (one time, ~120 MB).
4. Pick a provider and sign in when the app asks (or add a key in
   **Settings → Connections**).

**Build it yourself** (Android SDK + JDK 17):

```bash
git clone https://github.com/shivapal12395-droid/opencode-pocket.git
cd opencode-pocket/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The Gradle task copies the current web assets into the APK, so rebuild after
changing `index.html`, `assets/app.js` or `assets/app.css`.

**Using an existing Termux/Debian server instead:** in the app open
**Settings → Runtime → Termux**, reopen Pocket, and grant Termux
**Settings → Allow external commands**. The APK then uses `127.0.0.1:4096`
instead of starting its own daemon.

**Battery:** set Pocket and Termux to **Unrestricted** in Android battery
settings. The phantom-process killer can end a long turn otherwise.

---

## 2. Browser / PWA with Termux (no build step)

The stack stays on the phone: Debian runs OpenCode, Termux serves the UI,
Chrome (or the installed PWA) is the screen.

```
Chrome/PWA  ──▶ 127.0.0.1:8099 (Node in Termux: Pocket UI)
                    │
                    └──▶ 127.0.0.1:4096 (OpenCode 2 inside Debian/proot)
```

**Step 1 — Termux.** Install from [F-Droid](https://f-droid.org/en/packages/com.termux/)
or the [GitHub releases](https://github.com/termux/termux-app/releases). The Play
Store build is outdated and will not work. Keep ~2 GB free.

**Step 2 — OpenCode inside Debian.** One line installs proot-distro, Node 22
and OpenCode 2:

```bash
pkg install -y curl
curl -fsSL https://raw.githubusercontent.com/MeanderX/opencode-android/main/get.sh | bash
```

Approve the storage prompt. Sign in to a provider with `oc auth login` (or
later from inside OpenCode).

**Step 3 — Pocket.**

```bash
pkg install -y nodejs git
git clone https://github.com/shivapal12395-droid/opencode-pocket.git
cd opencode-pocket
```

**Step 4 — Start everything.**

```bash
OPENCODE_CMD="oc ~/projects serve --hostname 127.0.0.1 --port 4096" bash start.sh
```

`start.sh` starts OpenCode, waits for the server password, serves the UI, and
opens Chrome with the password already in the link.

**Step 5 — Home screen.** Chrome menu → **Add to Home screen**.

**One-tap start (optional).** Install
[Termux:Widget](https://github.com/termux/termux-widget/releases), long-press the
home screen → **Widgets** → **Termux:Widget** → drag **Pocket**. The shortcut runs
`pocket`, which boots everything and opens the browser connected.

**If the one-liner misbehaves — two terminals:**

```bash
# session 1: the agent
oc shell
cd ~/projects && opencode serve --hostname 127.0.0.1 --port 4096

# session 2: the UI
cd ~/opencode-pocket && bash start.sh
```

**Keep it alive over USB debugging (once):**

```bash
adb shell settings put global settings_enable_monitor_phantom_procs false
adb shell cmd deviceidle whitelist +com.termux
```

Then set Termux to **Unrestricted** in battery settings.

---

## 3. Split setup (UI on the phone, agent on a laptop)

```bash
# laptop
opencode serve --hostname 0.0.0.0 --port 4096

# phone (Termux)
cd ~/opencode-pocket
POCKET_BASE=http://<laptop-ip>:4096 node server.mjs --port 8099
```

Open `http://127.0.0.1:8099` on the phone and paste the laptop's password once.
Only do this on a network you trust: `opencode serve` exposes a shell.

---

## Updating

| Install | How to update |
|---|---|
| APK | Install the newer APK over the old one; sessions and settings stay. |
| Termux/PWA | `cd ~/opencode-pocket && git pull`, then reload the tab. If the app looks stale, clear the site data once (service worker). |
| Both on one phone | One port, one owner: stop `bash start.sh` before installing the APK, and vice versa. The APK uses `8099` for the UI and `4098` for its daemon. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Connect screen says authentication failed | The password changes on every server restart. Copy the new one from `start.sh`, or use a fresh `oc pair` link. |
| `4099`/`8099` already in use | Another Pocket UI is running. Stop it (Ctrl-C in Termux, or force-stop the app) and start again. |
| First APK launch looks stuck | The runtime download takes a few minutes on a slow connection. Keep the app in the foreground. |
| Turns die in the background | Disable battery optimisation for Pocket/Termux and run `termux-wake-lock`. |
| No `@` file suggestions | The bundled runtime answers `500` on `/api/fs/find`; Pocket falls back to listing the workspace, so files still appear. |

## Verify your checkout (optional)

```bash
node server.mjs --port 8099          # in one terminal
node test/suite-1.cjs … suite-18.cjs # in another
```

Device suites (`test/device-*.cjs`) need the app installed, `adb` attached and
the WebView forwarded to `tcp:9228`.