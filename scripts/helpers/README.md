# Helper scripts

Operational helpers live beside the main `./scripts/setup.sh` / `build.sh` flow. They are optional; read each script’s header for exact env vars and flags.

| [`../stop_servers.sh`](../stop_servers.sh) | Stop `tracking_payspace_server` + `playwright_server` (PID files + port listeners). |

## Chain / xUDT

| Helper | Purpose |
|--------|---------|
| [`../xudt_env_hint.sh`](../xudt_env_hint.sh) | Print how `DEFAULT_XUDT_TYPE_ARGS` and KnownScript xUDT work (no writes). |
| **Deploy xUDT (mint)** | Issue a new xUDT from your wallet and print `.env` lines for PaySpace. |

### Deploy a settlement token (xUDT)

Uses `@ckb-ccc/core` (`KnownScript.XUdt`) — same pattern as [Nervos “Create a Fungible Token”](https://docs.nervos.org/docs/dapp/create-token).

From repo root (after `CKB_PRIVATE_KEY` and `CKB_RPC_URL` are in `.env`):

```bash
cd packages/ckb_payspace_mcp
npm run deploy-xudt
```

Preview derived `DEFAULT_XUDT_TYPE_ARGS` **without** spending CKB:

```bash
npm run deploy-xudt -- --dry-run
```

Custom initial supply (unsigned 128-bit LE amount in the issued cell; default is a large test value):

```bash
npm run deploy-xudt -- --amount 1000000000000
```

Successful run prints `DEFAULT_XUDT_TYPE_ARGS` and (on broadcast) `env_lines` for `.env`. `./scripts/setup.sh` merges `DEFAULT_XUDT_TYPE_ARGS` when missing. xUDT script metadata is not stored in `.env` (KnownScript at MCP runtime).

**Requirements:** funded issuer address on the target network (testnet faucet, etc.).

## OpenClaw

| Helper | Purpose |
|--------|---------|
| [`../init_openclaw_workspace.mjs`](../init_openclaw_workspace.mjs) | `.openclaw` workspace: interactive template, or `--template buyer\|seller` + `--yes` for CI. |

**ckb_payspace_mcp** is not started by `setup.sh`; it uses **stdio** MCP. Point your MCP host at `packages/ckb_payspace_mcp` (e.g. `npx tsx src/server.mts` from that package). See package `src/server.mts` header.
