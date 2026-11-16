#!/usr/bin/env bash
# OpenCode Pocket — one-command launcher for Termux.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8099}"
HOST="${HOST:-127.0.0.1}"
API_PORT="${OPENCODE_PORT:-4096}"
API="http://127.0.0.1:${API_PORT}"
LOG="${TMPDIR:-/tmp}/opencode-pocket-server.log"

echo ""
echo "  OpenCode Pocket"
echo "  ---------------"

if node -e "fetch('${API}/api/info').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  echo "  ✓ OpenCode server already running on ${API}"
  echo "  Password: copy it from the terminal running the server, or run 'opencode pair'."
else
  echo "  → starting opencode serve on ${API}"
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
    echo "  (or run: opencode pair  — then paste the whole link)"
  else
    echo "  Could not read the password yet."
    echo "  Check ${LOG}, or run 'opencode pair' in the server terminal."
  fi
fi

echo ""
echo "  → UI: http://127.0.0.1:${PORT}"
echo ""

if command -v termux-open-url >/dev/null 2>&1; then
  (sleep 1.5; termux-open-url "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true) &
fi

exec node ./server.mjs --port "${PORT}" --host "${HOST}"
