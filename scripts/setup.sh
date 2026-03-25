#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PACKAGES=(
  "packages/payspace_backend"
  "packages/mcp"
  "packages/gateway"
  "packages/payspace_frontend"
)

echo "[setup] root: ${ROOT_DIR}"

for pkg in "${PACKAGES[@]}"; do
  if [[ -f "${ROOT_DIR}/${pkg}/package.json" ]]; then
    echo "[setup] npm install -> ${pkg}"
    (
      cd "${ROOT_DIR}/${pkg}"
      npm install
    )
  fi
done

if command -v cargo >/dev/null 2>&1; then
  echo "[setup] cargo fetch -> contracts"
  (
    cd "${ROOT_DIR}/contracts"
    cargo fetch
  )
else
  echo "[setup] cargo not found; skipping Rust dependency fetch"
fi

echo "[setup] preparing gateway-local OpenClaw state"
(
  cd "${ROOT_DIR}/packages/gateway"
  npm run openclaw:health
)

echo "[setup] done"
