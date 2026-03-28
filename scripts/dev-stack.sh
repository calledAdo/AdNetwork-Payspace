#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  for pid_var in BACKEND_PID PLAYWRIGHT_PID; do
    pid="${!pid_var:-}"
    if [[ -n "${pid}" ]]; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

echo "[dev-stack] starting backend"
(
  cd "${ROOT_DIR}/packages/tracking_payspace_server"
  npm run dev
) &
BACKEND_PID=$!

echo "[dev-stack] starting playwright server (@playwright/mcp)"
(
  cd "${ROOT_DIR}/packages/playwright_server"
  npm run dev
) &
PLAYWRIGHT_PID=$!

echo "[dev-stack] running (tracking backend + playwright MCP; gateway/frontend packages removed from this repo)"
echo "[dev-stack] backend pid: ${BACKEND_PID}"
echo "[dev-stack] playwright pid: ${PLAYWRIGHT_PID}"

wait
