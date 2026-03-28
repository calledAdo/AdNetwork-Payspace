#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SKIP_ENV_CHECK=0
XUDT_HINT_ONLY=0
INIT_OPENCLAW=0
NO_START_SERVERS=0
SIMULATE=0

for arg in "$@"; do
  case "${arg}" in
    --skip-env-check) SKIP_ENV_CHECK=1 ;;
    --xudt-hint)      XUDT_HINT_ONLY=1 ;;
    --init-openclaw)  INIT_OPENCLAW=1 ;;
    --no-start-servers) NO_START_SERVERS=1 ;;
    --simulate)       SIMULATE=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/setup.sh [options]

  --skip-env-check    Install deps and prepare dirs without validating CKB/xUDT env
  --xudt-hint         Print how DEFAULT_XUDT_TYPE_ARGS / KnownScript xUDT work and exit
  --init-openclaw     Create repo .openclaw workspace (buyer/seller), install skills deps, restart openclaw
  --no-start-servers  Only install/build prep — do not launch tracking + playwright (see also notes below)
  --simulate          Dry run: npm install, xUDT mint preview only (no broadcast, no .env write), skip servers and OpenClaw.
                      Needs CKB_RPC_URL and CKB_PRIVATE_KEY when DEFAULT_XUDT_TYPE_ARGS is unset in .env.

Core install (always): packages/tracking_payspace_server, packages/ckb_payspace_mcp, packages/playwright_server
Excluded from npm install: packages/skills (install from repo root `packages/skills` or via OpenClaw `agent-workplace` after init)

After install, by default this script builds and starts in the background:
  • tracking_payspace_server — listens on PORT (default 4000)
  • playwright_server — listens on PLAYWRIGHT_MCP_HOST:PLAYWRIGHT_MCP_PORT (defaults 127.0.0.1:8931)
Logs and PIDs: logs/tracking_payspace_server.{log,pid}, logs/playwright_server.{log,pid}

Stop those processes (PID files + orphan listeners): ./scripts/stop_servers.sh

ckb_payspace_mcp uses stdio MCP (no HTTP port); start it from your MCP client / IDE — not via this script.

Environment:

  Create repo-root .env before first run (see .testnet.env for CKB testnet examples).

  Required unless --skip-env-check (non-simulate):
    CKB_RPC_URL
    DEFAULT_XUDT_TYPE_ARGS — if unset, CKB_PRIVATE_KEY must be set so setup can mint testnet xUDT and merge this into .env
    OPENAI_BASE_URL — OpenAI-compatible API base URL (runtime; gates share-ai auth profile for default OpenClaw primary model)
    OPENAI_API_KEY or OPENAI_KEY — API key for the API at OPENAI_BASE_URL (OpenClaw bootstrap / auth-profiles)

  xUDT script metadata uses CCC KnownScript at MCP runtime (not in .env).
  BookingSpace + settlement lock script IDs — packages/ckb_payspace_mcp/src/constants.ts
EOF
      exit 0
      ;;
    *)
      echo "[setup] ERROR: unknown option: ${arg}" >&2
      echo "(use ./scripts/setup.sh --help)" >&2
      exit 2
      ;;
  esac
done

if (( XUDT_HINT_ONLY )); then
  exec "${ROOT_DIR}/scripts/xudt_env_hint.sh"
fi

if [[ -f "${ROOT_DIR}/.env" ]]; then
  echo "[setup] loading ${ROOT_DIR}/.env"
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
else
  if (( ! SKIP_ENV_CHECK )); then
    echo "[setup] WARNING: no ${ROOT_DIR}/.env — copy .testnet.env or create .env before setup" >&2
  fi
fi

if (( ! SKIP_ENV_CHECK )); then
  if [[ -z "${DEFAULT_XUDT_TYPE_ARGS:-}" ]]; then
    if [[ -z "${CKB_PRIVATE_KEY:-}" ]]; then
      echo "[setup] ERROR: DEFAULT_XUDT_TYPE_ARGS is unset but CKB_PRIVATE_KEY is empty" >&2
      echo "[setup] Add CKB_PRIVATE_KEY to .env so setup can mint testnet xUDT, or set DEFAULT_XUDT_TYPE_ARGS (see ./scripts/xudt_env_hint.sh)" >&2
      exit 1
    fi
  fi
fi

# Installed here; gateway / frontend / skills are excluded (install those separately when needed).
PACKAGES=(
  "packages/tracking_payspace_server"
  "packages/ckb_payspace_mcp"
  "packages/playwright_server"
)

REQUIRED_ENV_VARS=(
  CKB_RPC_URL
  DEFAULT_XUDT_TYPE_ARGS
  OPENAI_BASE_URL
)

validate_required_env() {
  local missing=0
  local name
  for name in "${REQUIRED_ENV_VARS[@]}"; do
    local val="${!name:-}"
    if [[ -z "${val// }" ]]; then
      echo "[setup] ERROR: ${name} is empty or unset" >&2
      missing=1
    fi
  done
  local oa="${OPENAI_API_KEY:-}"
  local ok="${OPENAI_KEY:-}"
  if [[ -z "${oa// }" && -z "${ok// }" ]]; then
    echo "[setup] ERROR: set OPENAI_API_KEY or OPENAI_KEY (API key for the OpenAI-compatible API at OPENAI_BASE_URL)" >&2
    missing=1
  fi
  if (( missing )); then
    echo "" >&2
    echo "[setup] Set these in repo-root .env (see .testnet.env), then re-run:" >&2
    echo "  ./scripts/setup.sh" >&2
    echo "" >&2
    echo "[setup] For xUDT values specifically:" >&2
    echo "  ./scripts/xudt_env_hint.sh" >&2
    exit 1
  fi
}

resolve_repo_path() {
  local p="$1"
  if [[ -z "${p}" ]]; then
    echo ""
    return 0
  fi
  if [[ "${p}" == /* ]]; then
    echo "${p}"
  else
    echo "${ROOT_DIR}/${p#./}"
  fi
}

ensure_runtime_dirs() {
  local d
  for d in DATA_DIR AGENTS_DIR OPENCLAW_STATE_DIR PLAYWRIGHT_OUTPUT_DIR; do
    local raw="${!d:-}"
    [[ -z "${raw}" ]] && continue
    local abs
    abs="$(resolve_repo_path "${raw}")"
    mkdir -p "${abs}"
    echo "[setup] ensured directory (${d}): ${abs}"
  done
  local cfg="${OPENCLAW_CONFIG_PATH:-}"
  if [[ -n "${cfg}" ]]; then
    local abs_cfg
    abs_cfg="$(resolve_repo_path "${cfg}")"
    mkdir -p "$(dirname "${abs_cfg}")"
    echo "[setup] ensured OpenClaw config parent: $(dirname "${abs_cfg}")"
  fi
}

echo "[setup] root: ${ROOT_DIR}"

for pkg in "${PACKAGES[@]}"; do
  if [[ -f "${ROOT_DIR}/${pkg}/package.json" ]]; then
    echo "[setup] npm install -> ${pkg}"
    (
      cd "${ROOT_DIR}/${pkg}"
      npm install
    )
  else
    echo "[setup] skip missing package: ${pkg}"
  fi
done

if (( ! SKIP_ENV_CHECK )); then
  ensure_args=()
  if (( SIMULATE )); then
    ensure_args+=(--dry-run)
    echo "[setup] ensuring xUDT env (dry-run, no .env write)"
  else
    echo "[setup] ensuring xUDT env (mint + merge DEFAULT_XUDT_TYPE_ARGS when missing)"
  fi
  node "${ROOT_DIR}/scripts/ensure_xudt_env.mjs" "${ensure_args[@]}"
fi

if [[ -f "${ROOT_DIR}/.env" ]]; then
  echo "[setup] reloading ${ROOT_DIR}/.env"
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

if (( ! SKIP_ENV_CHECK )); then
  if (( SIMULATE )); then
    echo "[setup] simulate mode: skipped full env validation (OpenAI not required)"
  else
    validate_required_env
  fi
else
  echo "[setup] skipping required-env validation (--skip-env-check)"
fi

if command -v cargo >/dev/null 2>&1; then
  if [[ -d "${ROOT_DIR}/contracts" ]]; then
    echo "[setup] cargo fetch -> contracts"
    (
      cd "${ROOT_DIR}/contracts"
      cargo fetch
    )
  else
    echo "[setup] contracts/ not found; skipping cargo fetch"
  fi
else
  echo "[setup] cargo not found; skipping Rust dependency fetch"
fi

ensure_runtime_dirs

start_core_servers() {
  mkdir -p "${ROOT_DIR}/logs"

  echo "[setup] npm run build -> packages/tracking_payspace_server"
  (
    cd "${ROOT_DIR}/packages/tracking_payspace_server"
    npm run build
  )

  echo "[setup] npm run build -> packages/playwright_server"
  (
    cd "${ROOT_DIR}/packages/playwright_server"
    npm run build
  )

  local track_port="${PORT:-4000}"
  local pw_host="${PLAYWRIGHT_MCP_HOST:-${PLAYWRIGHT_SERVER_HOST:-127.0.0.1}}"
  local pw_port="${PLAYWRIGHT_MCP_PORT:-${PLAYWRIGHT_SERVER_PORT:-8931}}"

  (
    cd "${ROOT_DIR}/packages/tracking_payspace_server"
    nohup npm run start >>"${ROOT_DIR}/logs/tracking_payspace_server.log" 2>&1 &
    echo $! > "${ROOT_DIR}/logs/tracking_payspace_server.pid"
  )
  echo "[setup] tracking_payspace_server started (pid $(cat "${ROOT_DIR}/logs/tracking_payspace_server.pid"), PORT=${track_port})"

  (
    cd "${ROOT_DIR}/packages/playwright_server"
    nohup npm run start >>"${ROOT_DIR}/logs/playwright_server.log" 2>&1 &
    echo $! > "${ROOT_DIR}/logs/playwright_server.pid"
  )
  echo "[setup] playwright_server started (pid $(cat "${ROOT_DIR}/logs/playwright_server.pid"), ${pw_host}:${pw_port})"
  echo "[setup] set PLAYWRIGHT_MCP_URL=http://${pw_host}:${pw_port} for agents/skills (adjust if using 0.0.0.0 bind)"
}

if (( SIMULATE )); then
  echo "[setup] simulate mode: skipping server start"
elif (( ! NO_START_SERVERS )); then
  start_core_servers
else
  echo "[setup] skipping server start (--no-start-servers)"
fi

if (( INIT_OPENCLAW && SIMULATE )); then
  echo "[setup] simulate mode: ignoring --init-openclaw"
fi

if (( INIT_OPENCLAW && ! SIMULATE )); then
  echo "[setup] initializing repo-local OpenClaw workspace"
  (
    cd "${ROOT_DIR}"
    node "./scripts/init_openclaw_workspace.mjs"
  )

  REPO_SKILLS_RUNTIME="${ROOT_DIR}/.openclaw/agent-workplace"
  if [[ -f "${REPO_SKILLS_RUNTIME}/package.json" ]]; then
    echo "[setup] npm install -> .openclaw/agent-workplace (skills deps)"
    (
      cd "${REPO_SKILLS_RUNTIME}"
      npm install
    )
  else
    echo "[setup] WARNING: missing ${REPO_SKILLS_RUNTIME}/package.json; skipping agent-workplace npm install" >&2
  fi

  if command -v openclaw >/dev/null 2>&1; then
    echo "[setup] restarting openclaw using repo-local config"
    OPENCLAW_STATE_DIR="${ROOT_DIR}/.openclaw" \
    OPENCLAW_CONFIG_PATH="${ROOT_DIR}/.openclaw/openclaw.json" \
      openclaw restart
  else
    echo "[setup] WARNING: openclaw CLI not found; skip restart" >&2
  fi

  echo "[setup] Reminder: set non-empty API key(s) in .openclaw/agents/main/agent/auth-profiles.json before using the agent (init wrote placeholders)."
fi

echo "[setup] done"
echo "[setup] xUDT env help (no file writes): ./scripts/xudt_env_hint.sh"
