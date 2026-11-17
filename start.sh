#!/usr/bin/env bash
# OpenCode Pocket - one-command launcher for Termux.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8099}"
HOST="${HOST:-127.0.0.1}"
API_PORT="${OPENCODE_PORT:-4096}"
API="http://127.0.0.1:${API_PORT}"
LOG="${TMPDIR:-/tmp}/opencode-pocket-server.log"
# The password rotates whenever the server restarts, so keep the current one:
# the next launch can then hand the browser a working link on its own.
PW_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-pocket/password"

echo ""
echo "  OpenCode Pocket"
echo "  ---------------"

if node -e "fetch('${API}/api/info').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  echo "  OK - OpenCode server already running on ${API}"
  if [ -f "${PW_FILE}" ]; then
    SAVED="$(cat "${PW_FILE}" 2>/dev/null || true)"
    if [ -n "${SAVED}" ] && node -e 'fetch(process.argv[1]+"/api/info",{headers:{authorization:"Basic "+Buffer.from("opencode:"+process.argv[2]).toString("base64")}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' "${API}" "${SAVED}" >/dev/null 2>&1; then
      PW="${SAVED}"
      echo "  Reusing the saved password."
    else
      echo "  Password: copy it from the terminal running the server, or run 'opencode pair'."
    fi
  else
    echo "  Password: copy it from the terminal running the server, or run 'opencode pair'."
  fi
else
  echo "  -> starting opencode serve on ${API}"
  # On Android, OpenCode 2 needs a Linux environment (proot-distro). Set
  # OPENCODE_CMD to the launcher that starts it, e.g.:
  #   OPENCODE_CMD="oc serve --hostname 127.0.0.1 --port 4096" ./start.sh
  if [ -n "${OPENCODE_CMD:-}" ]; then
    echo "    using: ${OPENCODE_CMD}"
    (bash -c "${OPENCODE_CMD}" >"${LOG}" 2>&1 &) || true
  else
    (opencode serve --hostname 127.0.0.1 --port "${API_PORT}" >"${LOG}" 2>&1 &) || true
  fi

  PW=""
  # A first run inside proot has to boot Node and npm, so allow a full minute.
  for _ in $(seq 1 120); do
    PW="$(grep -a 'server password' "${LOG}" 2>/dev/null | tail -1 | awk '{print $NF}' || true)"
    [ -n "${PW}" ] && break
    sleep 0.5
  done

  if [ -n "${PW}" ]; then
    echo ""
    echo "  Server password: ${PW}"
    mkdir -p "$(dirname "${PW_FILE}")" 2>/dev/null || true
    (printf '%s' "${PW}" > "${PW_FILE}" && chmod 600 "${PW_FILE}") 2>/dev/null || true
    echo "  (or run: opencode pair, then paste the whole link)"
  else
    echo "  Could not read the password yet."
    echo "  Check ${LOG}, or run 'opencode pair' in the server terminal."
  fi
fi

# The native Android shell serves the web client itself from its APK assets and
# proxies the API, so it only needs OpenCode running. Skip the Node UI server and
# the browser hand-off in that mode. This check must come after the server has
# started and the password has been captured above.
if [ "${POCKET_NATIVE:-0}" = "1" ]; then
  echo "  Native shell: OpenCode is ready; the app serves the UI."
  exit 0
fi

# Hand the browser an already-connected link when we know the password, so the
# 43-character secret never has to be typed on a phone keyboard. `:` and `/` are
# legal in a query string; only characters that would break parsing are escaped.
OPEN_URL="http://127.0.0.1:${PORT}/"
if [ -n "${PW:-}" ]; then
  ESCAPED="$(printf '%s' "${PW}" | sed 's/+/%2B/g; s/=/%3D/g; s/&/%26/g; s/#/%23/g')"
  OPEN_URL="${OPEN_URL}?base=${API}&secret=${ESCAPED}"
fi

echo "  -> UI: http://127.0.0.1:${PORT}"
echo ""

# Tapping the home-screen shortcut twice is normal: bring the UI back instead of
# dying on EADDRINUSE.
if node -e "fetch('http://127.0.0.1:${PORT}/').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  echo "  OK - Pocket UI already running"
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "${OPEN_URL}" >/dev/null 2>&1 || true
  fi
  exit 0
fi

if command -v termux-open-url >/dev/null 2>&1; then
  (sleep 1.5; termux-open-url "${OPEN_URL}" >/dev/null 2>&1 || true) &
fi

exec node ./server.mjs --port "${PORT}" --host "${HOST}"
