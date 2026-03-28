#!/usr/bin/env bash
# xUDT environment hint — does not write .env or deploy anything.
#
# Usage:
#   ./scripts/xudt_env_hint.sh
#
# ckb_payspace_mcp resolves xUDT script code hash + cell dep at runtime via CCC
# KnownScript (testnet). You only persist the token *instance* in .env:
#
#   DEFAULT_XUDT_TYPE_ARGS — type script args for your minted xUDT (issuer-specific)

set -euo pipefail

cat <<'EOF'
[xudt-env-hint] Testnet xUDT for PaySpace MCP:

  DEFAULT_XUDT_TYPE_ARGS — hex type script args for your xUDT instance (required for builds
                           when tools do not pass explicit udt_type_args).

  The canonical xUDT *script* (code hash + cell dep) is not stored in .env — the MCP loads
  it from the node via CCC getKnownScript(XUdt) on CKB testnet.

How to obtain DEFAULT_XUDT_TYPE_ARGS:

  1. Run ./scripts/setup.sh with CKB_RPC_URL + CKB_PRIVATE_KEY (testnet-funded wallet).
     Setup will mint a minimal xUDT and merge DEFAULT_XUDT_TYPE_ARGS into repo-root .env.
  2. Or run: ./scripts/deploy-xudt --dry-run
     and copy DEFAULT_XUDT_TYPE_ARGS from the JSON output.
  3. Fund testnet CKB first: https://faucet.nervos.org/

Other env:

  CKB_RPC_URL — CKB testnet RPC (default https://testnet.ckb.dev/)
  CKB_PRIVATE_KEY — only needed for mint; keep secret

After editing .env, re-run:

  ./scripts/setup.sh

See also: scripts/helpers/README.md
EOF
