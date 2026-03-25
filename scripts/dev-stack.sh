#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  for pid_var in MCP_PID BACKEND_PID GATEWAY_PID FRONTEND_PID; do
    pid="${!pid_var:-}"
    if [[ -n "${pid}" ]]; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

echo "[dev-stack] starting mcp"
(
  cd "${ROOT_DIR}/packages/mcp"
  npm run dev
) &
MCP_PID=$!

echo "[dev-stack] starting backend"
(
  cd "${ROOT_DIR}/packages/payspace_backend"
  npm run dev
) &
BACKEND_PID=$!

echo "[dev-stack] starting gateway"
(
  cd "${ROOT_DIR}/packages/gateway"
  npm run dev
) &
GATEWAY_PID=$!

echo "[dev-stack] starting main frontend"
(
  cd "${ROOT_DIR}/packages/payspace_frontend"
  npm run dev -- --host 0.0.0.0
) &
FRONTEND_PID=$!

echo "[dev-stack] running"
echo "[dev-stack] mcp pid: ${MCP_PID}"
echo "[dev-stack] backend pid: ${BACKEND_PID}"
echo "[dev-stack] gateway pid: ${GATEWAY_PID}"
echo "[dev-stack] frontend pid: ${FRONTEND_PID}"

wait
