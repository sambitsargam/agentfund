#!/usr/bin/env bash
# Rebuild and serve the dashboard as exactly one process.
#
# Several `next start` processes can bind the same port on macOS: the oldest keeps
# serving, so a page built minutes ago is handed out with a stylesheet hash the
# current build no longer contains, and every page renders unstyled. Always stop
# every listener before starting one.
set -euo pipefail
PORT="${PORT:-3000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${DASHBOARD_LOG:-$ROOT/apps/web/.next/dashboard.log}"

cd "$ROOT/apps/web"
[ "${SKIP_BUILD:-}" = "1" ] || npx next build

for _ in 1 2 3 4 5; do
  pids="$(lsof -ti:"$PORT" || true)"
  [ -z "$pids" ] && break
  echo "$pids" | xargs kill -9 2>/dev/null || true
  sleep 1
done
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "port $PORT is still held; stop it by hand before retrying" >&2
  exit 1
fi

AGENTFUND_ROOT="${AGENTFUND_ROOT:-$ROOT}" nohup npx next start -p "$PORT" >"$LOG" 2>&1 &
for _ in $(seq 1 30); do
  sleep 1
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/" || true)"
  [ "$code" = "200" ] || continue
  css="$(curl -s "http://localhost:$PORT/" | grep -oE '/_next/static/css/[a-z0-9]+\.css' | head -1)"
  # A 200 page that references a missing stylesheet means a stale process won the port.
  if [ -n "$css" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$css")" != "200" ]; then
    echo "serving a stale build: $css is missing" >&2
    exit 1
  fi
  echo "dashboard on http://localhost:$PORT (one process, stylesheet verified)"
  exit 0
done
echo "dashboard did not become ready; see $LOG" >&2
exit 1
