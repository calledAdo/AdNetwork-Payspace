#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PACKAGES=(
  "packages/payspace_backend"
  "packages/mcp"
  "packages/gateway"
  "packages/payspace_frontend"
)

echo "[build] root: ${ROOT_DIR}"

for pkg in "${PACKAGES[@]}"; do
  echo "[build] npm run build -> ${pkg}"
  (
    cd "${ROOT_DIR}/${pkg}"
    npm run build
  )
done

echo "[build] done"
