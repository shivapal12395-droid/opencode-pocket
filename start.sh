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
else
  echo "  → starting opencode serve on ${API}"
  (opencode serve --hostname 127.0.0.1 --port "${API_PORT}" >"${LOG}" 2>&1 &) || true

  PW=""
  for _ in $(seq 1 40); do
    PW="$(grep -a 'server password' "${LOG}" 2>/dev/null | tail -1 | awk '{print $NF}' || true)"
    [ -n "${PW}" ] && break
    sleep 0.5
  done

  if [ -n "${PW}" ]; then
    echo ""
    echo "  Server password: ${PW}"
    echo "  (or run: opencode pair)"
  else
    echo "  Could not read the password yet — check ${LOG}"
  fi
fi

echo ""
echo "  → UI: http://127.0.0.1:${PORT}"
echo ""

if command -v termux-open-url >/dev/null 2>&1; then
  (sleep 1.5; termux-open-url "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true) &
fi

exec node ./server.mjs --port "${PORT}" --host "${HOST}"
