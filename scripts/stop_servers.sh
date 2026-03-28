#!/usr/bin/env bash
# Stop background processes started by ./scripts/setup.sh (tracking + playwright).
#
# - Stops PIDs stored in logs/tracking_payspace_server.pid and logs/playwright_server.pid
#   (and removes those files).
# - Kills any process still listening on the tracking and Playwright ports. This handles
#   orphan `node` children that keep the port after the parent `npm run start` exits.
#
# Usage: ./scripts/stop_servers.sh [--help]
#
# Loads repo-root .env when present to resolve PORT and PLAYWRIGHT_MCP_PORT; always
# also checks 8931 and 9000 as common Playwright defaults.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: ./scripts/stop_servers.sh

Stops tracking_payspace_server and playwright_server started via ./scripts/setup.sh.
Removes logs/*.pid files and clears listeners on configured + common ports.
EOF
  exit 0
fi

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

TRACK_PORT="${PORT:-4000}"
PW_PORT="${PLAYWRIGHT_MCP_PORT:-${PLAYWRIGHT_SERVER_PORT:-8931}}"

collect_pids_for_port() {
  local port="$1"
  ss -tlnp 2>/dev/null | grep ":${port} " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u || true
}

stop_pid_file() {
  local f="$1"
  local name="$2"
  [[ -f "$f" ]] || return 0
  local pid
  pid="$(tr -d '[:space:]' <"$f" || true)"
  [[ -n "$pid" ]] || { rm -f "$f"; return 0; }
  if kill -0 "$pid" 2>/dev/null; then
    echo "[stop] ${name}: SIGTERM pid ${pid}"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    if kill -0 "$pid" 2>/dev/null; then
      echo "[stop] ${name}: SIGKILL pid ${pid}"
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$f"
}

stop_pid_file "${ROOT_DIR}/logs/tracking_payspace_server.pid" "tracking_payspace_server"
stop_pid_file "${ROOT_DIR}/logs/playwright_server.pid" "playwright_server"

declare -A seen_port=()
for port in "${TRACK_PORT}" "${PW_PORT}" 8931 9000; do
  [[ -z "$port" ]] && continue
  [[ -n "${seen_port[$port]:-}" ]] && continue
  seen_port[$port]=1
  mapfile -t pids < <(collect_pids_for_port "$port")
  for p in "${pids[@]:-}"; do
    [[ -z "$p" ]] && continue
    echo "[stop] orphan listener on port ${port}: pid ${p}"
    kill "$p" 2>/dev/null || true
  done
done

sleep 0.5
declare -A chk=()
still=""
for port in "${TRACK_PORT}" "${PW_PORT}" 8931 9000; do
  [[ -z "$port" ]] && continue
  [[ -n "${chk[$port]:-}" ]] && continue
  chk[$port]=1
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    still="${still} ${port}"
  fi
done
if [[ -n "${still// }" ]]; then
  echo "[stop] WARNING: still listening:${still}" >&2
  echo "[stop] Inspect: ss -tlnp | grep -E ':(${TRACK_PORT}|${PW_PORT}|8931|9000)\\b'" >&2
else
  echo "[stop] Ports clear (tracking ${TRACK_PORT}, playwright ${PW_PORT}; also checked 8931 9000)."
fi
