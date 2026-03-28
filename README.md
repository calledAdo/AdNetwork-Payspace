# Ad Network

alright in opencli --setup after the .openclaw has been entirely configured is the openclaw restarted or started ? i.e to save chnanges . also i think there should be boostrap.md file

Ad Network is a CKB-native ad marketplace protocol built around hosted buyer
and seller agents. PaySpace is an application built on top of Ad Network.

This monorepo holds **chain-facing MCP**, **shared agent skills**, **reference
workspace templates**, **smart contracts**, and two **example HTTP services**:
[`tracking_payspace_server`](./packages/tracking_payspace_server) (a sample
tracking/snippet endpoint with its own skills) and
[`playwright_server`](./packages/playwright_server) (a sample Playwright MCP
server). Both illustrate how you can attach protocol-adjacent capabilities via
MCP-style services—you could add others the same way (for example a Facebook- or
social-platform–oriented MCP). Agent runtimes (for example OpenClaw at repo-root
`.openclaw/`) are configured by you; see [Ad Network protocol](#ad-network-protocol).

At a high level:

- publishers onboard, define ad slots, and host seller agents
- campaigners onboard, define campaigns, and host buyer agents
- seller agents publish BookingSpace slots on-chain
- buyer agents discover slots, negotiate, verify delivery, and stream payments
- tracking, verification sidecars, and your agent host support that workflow

## Contents

- [Prerequisites](#prerequisites)
- [Environment](#environment)
- [Setup](#setup)
- [Repository layout](#repository-layout)
- [Architecture](#architecture)
- [Ad Network protocol](#ad-network-protocol)
- [Build](#build)
- [Run locally](#run-locally)
- [Package guide](#package-guide)
- [Development notes](#development-notes)
- [Root scripts](#root-scripts)
- [Setup notes and known local pitfalls](#setup-notes-and-known-local-pitfalls)
- [Contributing](#contributing)
- [License](#license)

## Prerequisites

You will need:

- Node.js 20+
- npm 10+
- OpenClaw CLI

Optional but recommended:

- Rust + Cargo
  Needed if you want to work on the contracts
- `jq`
- `curl`
- `git`

## Environment

The repo expects a root `.env` file. For CKB testnet, start from [`.testnet.env`](./.testnet.env):

```bash
cp .testnet.env .env
# edit .env (wallet, URLs, contract hashes)
```

**Required** (validated by `./scripts/setup.sh` unless you pass `--skip-env-check`):

- `CKB_RPC_URL` (CKB testnet)
- `DEFAULT_XUDT_TYPE_ARGS` — if unset, `CKB_PRIVATE_KEY` must be set so setup can mint testnet xUDT and merge this into `.env`
- `OPENAI_BASE_URL` — OpenAI-compatible API base URL (required at runtime; when set on first init, `scripts/init_openclaw_workspace.mjs` includes a `share-ai:default` entry in `auth-profiles.json` for the default primary model `share-ai/...`)
- `OPENAI_API_KEY` **or** `OPENAI_KEY` — API key for the API at `OPENAI_BASE_URL` (**validated by setup**; init still writes **empty** `"key"` fields in `auth-profiles.json` — you edit that file to supply credentials for OpenClaw)

**PaySpace BookingSpace + settlement lock** script references are **not** configured via `.env` — they live in `packages/ckb_payspace_mcp/src/constants.ts` (change there only for new deployments).

xUDT **script** metadata (code hash + cell dep) is resolved at runtime via CCC `KnownScript` — not stored in `.env`. Only the token **instance** (`DEFAULT_XUDT_TYPE_ARGS`) is persisted.

Other common variables:

- `TRACKING_URL`, `BLOCK_PUBLIC_URL`
- `DATA_DIR` (e.g. `./packages/tracking_payspace_server/data`)
- `AGENTS_DIR` (e.g. `./agent-workspaces` at repo root — used by integration tests and external agent hosts)
- `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH` (e.g. `./.openclaw` and `./.openclaw/openclaw.json`)
- `PLAYWRIGHT_MCP_HOST`, `PLAYWRIGHT_MCP_PORT`, **`PLAYWRIGHT_MCP_URL`** (base URL **without** `/mcp`, e.g. `http://127.0.0.1:9000` — must match how `playwright_server` is started)
- `PLAYWRIGHT_OUTPUT_DIR` (e.g. `./playwright-output` at repo root)

OpenClaw state for this repo lives at **repo root** `.openclaw/` (see `./scripts/init_openclaw_workspace.mjs`).

## Setup

Install dependencies and prepare the local environment:

```bash
./scripts/setup.sh
```

Options:

- `--skip-env-check` — install npm deps and prepare dirs without validating CKB/xUDT env (e.g. CI)
- `--xudt-hint` — print how `DEFAULT_XUDT_TYPE_ARGS` and KnownScript xUDT work; exit
- `--init-openclaw` — create repo-local `.openclaw` workspace (`buyer`/`seller` **prompt**); for **non-interactive** runs use  
  `node scripts/init_openclaw_workspace.mjs --template buyer --yes` then `npm install` in `.openclaw/agent-workplace`, or pipe template choice:  
  `printf 'buyer\n' | ./scripts/setup.sh --no-start-servers --init-openclaw`
- `--no-start-servers` — only install/build prep; do not background `tracking_payspace_server` or `playwright_server`

This script:

- loads repo-root `.env` if present
- validates required CKB / xUDT / OpenAI (`OPENAI_BASE_URL` + key) variables (unless skipped)
- installs npm dependencies for: `tracking_payspace_server`, `ckb_payspace_mcp`, `playwright_server` only (`packages/skills` excluded — install separately or via OpenClaw `agent-workplace`)
- runs `cargo fetch` for `contracts/` when Cargo is available
- creates runtime directories from env (`DATA_DIR`, `AGENTS_DIR`, OpenClaw paths, Playwright output)
- by default, builds and starts **tracking** (uses **`PORT`** from `.env`; often **4000**) and **`playwright_server`** on **`PLAYWRIGHT_MCP_HOST`:`PLAYWRIGHT_MCP_PORT`** (code fallback **8931**; many setups use **9000** — keep **`PLAYWRIGHT_MCP_URL`** consistent) in the background — logs and PIDs under `logs/`
- does **not** start **`ckb_payspace_mcp`** — it is **stdio MCP** (no HTTP port); configure your **MCP client** / IDE to spawn [`packages/ckb_payspace_mcp`](./packages/ckb_payspace_mcp) (same note as `./scripts/setup.sh --help`)

When you pass `--init-openclaw`, setup additionally:

- creates `.openclaw/openclaw.json`
- ensures `.openclaw/agents/main/agent/auth-profiles.json` with **empty `key` placeholders** — you must edit this file and set your API key(s) before the agent can call the LLM (see init script output for steps)
- prompts template selection (`buyer` or `seller`) and copies the corresponding default workspace into `.openclaw/agent-workplace/main-workplace`
- rewrites `.openclaw/agent-workplace/main-workplace/skills.json` to include all skills from `packages/skills` (paths `skills/<name>`)
- writes `.openclaw/agent-workplace/package.json` from `packages/skills/package.json` (with `file:` deps adjusted for that location), copies the skills tree to `.openclaw/agent-workplace/main-workplace/skills`, runs `npm install` in `.openclaw/agent-workplace`, then restarts OpenClaw with:
  - `OPENCLAW_STATE_DIR=<repo>/.openclaw`
  - `OPENCLAW_CONFIG_PATH=<repo>/.openclaw/openclaw.json`

xUDT help (does not modify files):

```bash
./scripts/xudt_env_hint.sh
```

Stop **tracking** and **Playwright** (PID files under `logs/` plus any orphan **`node`** still bound to the ports — avoids `EADDRINUSE` on the next start):

```bash
./scripts/stop_servers.sh
```

See `./scripts/stop_servers.sh --help`. It reads **`PORT`** and **`PLAYWRIGHT_MCP_PORT`** from `.env` when present, and also probes **8931** and **9000** as common Playwright ports.

## Repository layout

This repository is a monorepo with these main parts:

- [packages/tracking_payspace_server](./packages/tracking_payspace_server)
  **Example** tracking/snippet HTTP service (impressions, booking registration,
  loader delivery)—not a general “business backend”; it shows one way to pair a
  service with skills such as `payspace_metric_tracker`
- [packages/playwright_server](./packages/playwright_server)
  **Example** long-lived `@playwright/mcp` HTTP server (set `PLAYWRIGHT_MCP_URL`);
  same pattern as other MCP sidecars you might add
- [packages/ckb_payspace_mcp](./packages/ckb_payspace_mcp)
  Blockchain-facing MCP (stdio) for BookingSpace and payment-channel flows
- [packages/skills](./packages/skills)
  Shared skill implementations (also copied into OpenClaw `agent-workplace` by init)
- [packages/workspaces](./packages/workspaces)
  **Templates** (`default_buyer`, `default_seller`) for agent profiles—compose any
  new workplace by choosing a skill set and adapting memory/identity docs
- [contracts](./contracts)
  Rust smart contracts for BookingSpace and payment-channel lock logic

## Architecture

What lives **in this repo**:

- **Tracking service example** (`tracking_payspace_server`)
  Illustrates a tracking/snippet endpoint and how skills integrate with it—not a
  mandatory central “backend” for the protocol
- **ckb_payspace_mcp**
  Chain-facing MCP tools for placement and payment-channel build/submit
- **Playwright MCP example** (`playwright_server`)
  Browser automation over HTTP for agents/skills; replace or extend with other MCP
  servers as needed
- **Skills + workspace templates**
  Capabilities are composed from `packages/skills`; `packages/workspaces` shows how
  to assemble **buyer** and **seller** profiles. You can author new workplace
  templates that mix any subset of skills for your own agent roles
- **Primary / cross-cutting skills**
  **`messaging`** is treated as essential: it provides the generic A2A message path
  (`scripts/a2a.mjs`). Agents are expected to be able to send and receive messages
  over the A2A protocol; fold `messaging` (or an equivalent transport) into every
  serious workspace profile
- **contracts**
  On-chain source of truth for BookingSpace and payment-channel validation

Local agent development typically uses repo-root OpenClaw (`.openclaw/`,
`AGENTS_DIR`). For how OpenClaw fits this stack (if present in your tree), see:

- [OPENCLAW_MENTAL_MODEL.md](./OPENCLAW_MENTAL_MODEL.md)

## Ad Network protocol

The following sections describe the **Ad Network** protocol as a **P2P agent marketplace** for buying and selling ad slots. They intentionally **exclude** implementation details of the **example tracking service** (`packages/tracking_payspace_server/`).

The protocol surface in **this** repository lives primarily in:

- `contracts/` (on-chain primitives)
- `packages/ckb_payspace_mcp/` (chain tools exposed via MCP)
- `packages/skills/` and `packages/workspaces/` (agent modularity + runtime conventions)

**Where agents run** (OpenClaw, your own runner, etc.) and **how A2A is exposed on the wire** are up to your deployment; this repo supplies skills (including **`messaging`** for A2A) and workspace templates, not a hosted agent platform.

### What Ad Network is

Ad Network is a CKB-native marketplace where:

- **Publishers/sellers** offer ad inventory (slots) with explicit pricing and policy constraints.
- **Advertisers/buyers** discover inventory, negotiate terms, verify delivery, and pay sellers over time.
- **Hosted agents** (buyer and seller) execute most of the marketplace workflow automatically.

The core idea is **not** “a centralized ad exchange with APIs.” Instead, it is a **protocol**:

- the **chain** provides neutral, auditable state for _inventory_ and _settlement_
- agents provide the _operations layer_ (negotiation, verification, monitoring, ticket streaming)
- skills/workspaces provide a _modularity layer_ so the same protocol can be instantiated into many agent types and products

#### What problem it solves

Traditional digital ad marketplaces have structural frictions:

- **Trust and verification**: buyers fear paying for undelivered impressions; sellers fear non-payment.
- **Dispute handling**: payment disagreements tend to be centralized, opaque, or slow.
- **Micropayment overhead**: paying per verification interval or per impression on-chain is too expensive.
- **Interoperability**: publishers and advertisers integrate through platform-specific contracts and dashboards, not shared protocol primitives.

Ad Network addresses these by combining:

- **On-chain inventory** (standard slot representation)
- **Off-chain negotiated operations** (A2A)
- **Off-chain streaming payments with on-chain enforcement** (tickets + dispute/payout lockscript)

The result is a marketplace where:

- sellers can list inventory publicly and update it safely while available
- buyers can select inventory by on-chain fields and verify delivery before paying
- sellers can receive enforceable payment for delivered value without requiring on-chain updates for every payment increment

### High-level architecture (P2P agent marketplace)

#### Main actors

- **Seller agent**: represents a publisher’s inventory, answers A2A messages, and performs on-chain slot lifecycle actions.
- **Buyer agent**: represents an advertiser’s campaign execution, discovers placements, negotiates, verifies live delivery, and streams payment tickets.
- **Agent runtime / host**: wherever you execute the agent process (for example OpenClaw locally). It must surface tools/skills so the agent can use **`messaging`** (or equivalent) for A2A—this repository does not ship a separate gateway product.
- **CKB**: the neutral settlement and inventory substrate.

#### Key flows at a glance

1. **Inventory publication (seller)**:
   - Seller agent builds a BookingSpace publish transaction via MCP tools
   - Signs and submits it
   - The resulting on-chain cell becomes discoverable inventory

2. **Discovery + negotiation (buyer ↔ seller)**:
   - Buyer agent discovers BookingSpace placements (on-chain scan)
   - Buyer contacts seller using the on-chain `gateway_url` field (seller A2A endpoint URL hint; name is on-chain schema, not a separate product)
   - Negotiate terms off-chain (A2A)

3. **Verification (buyer)**:
   - Buyer verifies the ad is live (typically via Playwright sidecar) before opening payment

4. **Settlement channel open (buyer)**:
   - Buyer opens a payment channel by locking UDT into a settlement cell

5. **Booking activation (seller)**:
   - Seller marks slot as taken on-chain by writing `active_channel_id` into BookingSpace cell data

6. **Streaming payments (buyer → seller)**:
   - Buyer sends monotonically increasing signed tickets off-chain

7. **Close or dispute (either party)**:
   - Cooperative close (fast path) when both agree
   - Dispute → payout (fallback) when one side stops cooperating

### Modularity: workspaces and pluggable skills

The system is designed so “agent capability” is not hardcoded into a single monolith.

#### Workspaces

A **workspace** is a concrete runtime instance of an agent:

- a directory structure (memory, identity, skill code, configs)
- an agent card (advertised capabilities)
- persistent memory (placements, conversations, slots, tickets, etc.)

`default_buyer` and `default_seller` under `packages/workspaces/` are **templates**
for building agent profiles: they show one way to wire memory, prompts, and a
**chosen skill set**. You can fork them or author a new workplace that composes
any combination of skills (always including a path to **A2A messaging**—see
**Skills** below).

Workspaces live under:

- `packages/workspaces/` (reference templates; OpenClaw init can copy one into repo `.openclaw/agent-workplace/main-workplace`)
- per-agent trees under **`AGENTS_DIR`** (or equivalent) when you run agents

#### Skills

A **skill** is a reusable capability module that is **agent-type agnostic**:

- It defines _what_ can be done (tasks / commands)
- It provides scripts that implement building blocks for those tasks
- Multiple agents can include the same skill without sharing state

Canonical shared skills live under `packages/skills/`:

- **`messaging`** — **Primary** for protocol interoperability: generic A2A message sender (`scripts/a2a.mjs`). Agents are expected to participate in A2A; include this (or a compatible transport) in every workspace profile you ship
- `slot_v1` — BookingSpace slot lifecycle builders (publish/book/unbook)
- `payment_channel` — channel lifecycle builders + ticket/coop signing helpers
- `native_signer` — key + signature primitives, plus build→sign→submit convenience
- `asset_manager` — withdrawals/transfers
- `memory_manager` — workspace state persistence primitives

#### Why this modularity matters

This modular design lets you:

- create new agent types by composing skills (without rewriting protocol code)
- phase out legacy packages (e.g. old Express “MCP” style servers) without rewriting every consumer
- enforce consistent boundaries:
  - chain builders in MCP
  - cryptographic signing in `native_signer`
  - protocol lifecycle orchestration in protocol skills
  - generic A2A transport in `messaging`

### On-chain primitives: inventory and settlement

Ad Network uses two contracts that compose cleanly:

- **BookingSpace type script** (`contracts/booking-space-type/`)
  - “inventory primitive”: what a slot is, and what can change when
- **Payment-channel lock script** (`contracts/payment-channel-lock/`)
  - “settlement primitive”: how locked funds are updated, disputed, and paid out

#### BookingSpace = inventory state

The BookingSpace cell is the public listing for a slot:

- seller identity
- listing price (CPM in UDT units per 1000 impressions)
- placement category fields
- whether it’s available or taken
- the **current channel** that owns the slot while taken (`active_channel_id`)
- optional seller A2A URL hint (`gateway_url` — on-chain field name)
- optional off-chain details reference (`details_cid`, `details_hash`)

See:

- `contracts/booking-space-type/README.md`
- `contracts/booking-space-type/src/main.rs`

##### Why the BookingSpace contract is intentionally narrow

It does **not** try to:

- negotiate
- verify delivery
- track metrics
- settle payments

Instead, it ensures marketplace safety by enforcing a **mutability model**:

- while **available**: only `seller_pubkey` is immutable; other fields may change
- while **taken**: the entire cell data is frozen (byte-for-byte)
- taken slots cannot be destroyed

This gives buyers confidence that a booked slot cannot be silently altered.

#### Payment-channel lock = settlement state

The payment-channel lock script defines a **one-way UDT payment channel**:

- buyer is payer (funds channel)
- seller is payee (earns cumulative claim)

On-chain updates are not required for every payment increment. Instead:

- the channel opens on-chain once (locks UDT)
- buyer sends off-chain signed tickets over time
- either:
  - both sides close cooperatively, or
  - one side disputes and later claims payout

See:

- `contracts/payment-channel-lock/README.md`
- `contracts/payment-channel-lock/src/main.rs`

### Payment channel mechanism (extensive)

This section is grounded directly in the `payment-channel-lock` contract.

#### 1) Settlement cell and lock args

The channel’s state is encoded into the **lock args** (exactly **136 bytes**) and split into:

- **Immutable channel identity region** (never changes after open)
- **Mutable dispute region** (changes only when dispute updates happen)

From `contracts/payment-channel-lock/README.md`:

- Immutable region:
  - `seller_blake160` (20 bytes)
  - `buyer_blake160` (20 bytes)
  - `standard_lock_code_hash` (32 bytes): used to identify payout UDT output locks
  - `channel_id` (32 bytes): derived from settlement tx first input outpoint
- Mutable dispute region:
  - `dispute_start_time` (`u64`, seconds; 0 when open)
  - `seller_claim_udt` (`u128`, cumulative)
  - `ticket_timestamp` (`u64`, monotonic nonce)

**Why this design matters:**

- the immutable region binds the channel to the two parties and a unique `channel_id`
- the mutable region allows dispute state to be pushed on-chain without storing a growing history in the cell
- buyer’s authorization is proven by signatures stored in _witnesses_, not in cell args

#### 2) Channel ID (replay protection primitive)

The channel id is derived as described in the contract docs:

- \( channel_id = blake2b("ckb-default-hash", first_input_tx_hash || first_input_index_LE4) \)

Properties:

- globally unique per channel-open transaction input choice
- prevents reusing tickets between channels
- provides a stable identifier to be written into BookingSpace as `active_channel_id`

**Important operational rule (also stated in BookingSpace docs):**

- Compare BookingSpace `active_channel_id` to the channel’s derived `channel_id`,
  **not** to the settlement tx hash.

#### 3) Off-chain payment tickets (buyer → seller)

Each ticket is **56 bytes**:

- `seller_claim_udt` (`u128` LE, 16 bytes): cumulative seller claim
- `ticket_timestamp` (`u64` LE, 8 bytes): monotonic nonce
- `channel_id` (32 bytes)

Signing message:

- \( blake2b("ckb-default-hash", seller_claim || ticket_timestamp || channel_id) \)

Signature verification:

- the lock script recovers a secp256k1 pubkey from the signature and checks that
  `blake2b_256(compressed_pubkey)[0..20] == buyer_blake160`

**Monotonicity guarantees** (enforced in dispute update mode):

- `seller_claim_udt` must strictly increase
- `ticket_timestamp` must strictly increase

This makes “latest valid ticket” dominate earlier tickets.

#### 4) Cooperative close (fast path)

In cooperative close, both parties agree on final split and sign it.

Witness mode:

- witness lock length = **130 bytes**
- layout: `buyer_sig(65) || seller_sig(65)`

Signing message:

- \( blake2b("ckb-default-hash", seller_udt(16) || buyer_udt(16) || channel_id(32)) \)

Contract checks:

- dispute must not already be active (`dispute_start_time == 0`)
- both signatures verify against the correct party blake160
- UDT conservation: `seller_out + buyer_out == total_udt_in`
- and the “no leakage” constraint: the signed split must cover **all** UDT (prevents a third output siphon)

Operationally, this maps to:

- one party builds cooperative close tx with exact payout amounts
- both sign the same message
- either party can submit

#### 5) Dispute initiation / dispute update (fallback path)

Dispute mode allows either party to push the latest buyer-authorized claim on-chain.

Witness mode:

- witness lock length = **89 bytes**
- layout: `seller_claim(16) || ticket_timestamp(8) || buyer_sig(65)`

Contract checks:

- verifies buyer signature against `(seller_claim, ticket_timestamp, channel_id)`
- if channel already disputed:
  - enforces strict monotonicity (claim and timestamp strictly increase)
- updates output lock args mutable region atomically:
  - `dispute_start_time = t_now`
  - `seller_claim_udt = new_seller_claim`
  - `ticket_timestamp = new_timestamp`

**Notable design detail:**

- The buyer signature is _not_ copied into args.
- It remains in the witness of the dispute transaction, which is permanently on-chain and auditable.

#### 6) Post-dispute payout (enforced resolution)

After the dispute window expires, either party can finalize payout.

Witness mode:

- witness lock length = **0**

Time constraint:

- valid only when: \( t_now \ge dispute_start_time + 86400 \)

Contract checks:

- seller output amount equals stored `seller_claim_udt`
- buyer output amount is the remainder
- both outputs are locked using `standard_lock_code_hash` + respective blake160
- UDT conservation holds

#### 7) Time source and why header deps matter

The lock script reads time from the first header dependency:

- header timestamp is milliseconds
- contract converts to seconds

Practical implication:

- transaction builders must include a recent canonical header hash in `header_deps[0]`
- otherwise dispute/payout time validation cannot be performed deterministically

### How the protocol maps to this repository

#### `contracts/` (source of truth)

- `contracts/booking-space-type/`
  - inventory primitive and mutability rules
- `contracts/payment-channel-lock/`
  - settlement primitive: cooperative close, dispute update, payout

#### `packages/ckb_payspace_mcp/` (chain tools as MCP)

This package exposes chain operations as **MCP tools** (stdio transport).

Key tool families (see `packages/ckb_payspace_mcp/PROFILE.md`):

- **Placement builders** (used by `slot_v1`)
  - `build_publish_placement`
  - `build_book_placement`
  - `build_cancel_booking`
- **Settlement builders** (used by `payment_channel`)
  - `build_settlement`
  - `build_coop_close`
  - `build_dispute`
  - `build_payout`
- **Submission and reads**
  - `submit_transaction`
  - `get_live_cell`, `get_cells_by_lock`, `get_cells_by_type`, `get_transaction`, `get_tip_header`
  - `get_fuel_balance` (fuel preflight information returned by build tools)

All build tools return a `signing_message` which is then signed by an agent-local signer.

#### `packages/skills/` (agent-agnostic modular capabilities)

Skills are the protocol surface area that agent workspaces import.

- `packages/skills/messaging/`
  - **Primary** for A2A: `scripts/a2a.mjs` — generic message sender; expected on serious agent profiles
- `packages/skills/slot_v1/`
  - seller-side BookingSpace lifecycle builders (publish/book/unbook) using MCP build tools
- `packages/skills/payment_channel/`
  - settlement lifecycle builders and off-chain artifacts (tickets, coop signatures)
- `packages/skills/native_signer/`
  - key primitives + transaction signing primitives
- `packages/skills/memory_manager/`
  - durable workspace state primitives (atomic writes, schema validation helpers)

#### `packages/workspaces/` (reference agent workspaces)

- `packages/workspaces/default_buyer/`
  - template for a buyer-side agent profile, memory layout, and example protocol flow
- `packages/workspaces/default_seller/`
  - template for a seller-side profile and how to respond to A2A intents

These are **blueprints**: copy or adapt them when defining a new workplace, or mix
skills into a fresh profile. OpenClaw init (or your own tooling) materializes a
chosen template into runnable agent directories under **`AGENTS_DIR`** / `.openclaw/`.

### Glossary (protocol terms)

- **Placement / slot**: A seller-offered ad inventory unit represented on-chain by a BookingSpace cell.
- **Outpoint / placement_id**: The current on-chain identity of a slot instance, `tx_hash:index`.
- **Slot identity (off-chain)**: A stable seller-managed id (commonly `snippet_id`) used in workspace memory.
- **Settlement cell**: The payment-channel cell locked under `payment-channel-lock`.
- **Channel ID**: The derived 32-byte identifier bound into all tickets and written into BookingSpace when taken.
- **Ticket**: Buyer-signed off-chain authorization for a monotonically increasing seller claim.
- **Cooperative close**: both parties sign the final split, immediate settle.
- **Dispute**: push a signed ticket on-chain and start/reset the dispute timer.
- **Payout**: after dispute window, enforce the final split using stored claim.

## Build

Build the active packages:

```bash
./scripts/build.sh
```

This builds:

- `packages/tracking_payspace_server`
- `packages/ckb_payspace_mcp`
- `packages/playwright_server`

## Run locally

Start the local development stack:

```bash
./scripts/dev-stack.sh
```

This starts:

- tracking service example (`tracking_payspace_server` dev)
- playwright MCP example (`packages/playwright_server` dev; set `PLAYWRIGHT_MCP_URL` to match your port)

## Package guide

### Tracking service (example)

Path:

- [packages/tracking_payspace_server](./packages/tracking_payspace_server)

Illustrates:

- tracking and snippet delivery
- booking tracking registration and metrics reads
- pluggable standalone snippet + booking services (`/snippets`, `/tracking/bookings/register`)
- signed snippet content update and loader delivery

Run directly:

```bash
cd packages/tracking_payspace_server
npm run dev
```

### Playwright MCP server (example)

Path:

- [packages/playwright_server](./packages/playwright_server)

Illustrates the same pattern as other HTTP MCP sidecars:

- long-lived `@playwright/mcp` on `PLAYWRIGHT_MCP_HOST` / `PLAYWRIGHT_MCP_PORT` (defaults `127.0.0.1`:`8931`; `PLAYWRIGHT_SERVER_*` / `PORT` still accepted)
- agents and skills set `PLAYWRIGHT_MCP_URL` to that base (e.g. `http://127.0.0.1:8931`)

You can add another MCP server (e.g. platform-specific automation) alongside it using the same env + URL conventions.

Run directly:

```bash
cd packages/playwright_server
npm install
npm run build
npm start
```

### MCP

Path:

- [packages/ckb_payspace_mcp](./packages/ckb_payspace_mcp)

Responsibilities:

- BookingSpace discovery
- placement queries
- transaction building and submission

Run directly:

```bash
cd packages/ckb_payspace_mcp
npm run dev
```

### Contracts

Path:

- [contracts](./contracts)

Workspace members:

- `booking-space-type`
- `payment-channel-lock`

Basic check:

```bash
cd contracts
cargo check
```

## Development notes

- buyer/seller agent memory and skills in local dev typically live under **`AGENTS_DIR`** and OpenClaw **`.openclaw/agent-workplace`**
- the root `.gitignore` excludes generated output, local runtime state,
  tracking service data, and agent workspaces

## Root scripts

- [scripts/setup.sh](./scripts/setup.sh)
  Install dependencies and prepare local OpenClaw state
- [scripts/build.sh](./scripts/build.sh)
  Build active packages
- [scripts/dev-stack.sh](./scripts/dev-stack.sh)
  Start the local stack
- [scripts/helpers/README.md](./scripts/helpers/README.md)
  Optional helpers (e.g. **deploy xUDT** for `DEFAULT_XUDT_TYPE_ARGS`)

## Setup notes and known local pitfalls

There are two important local setup issues to be aware of.

### 1. Detached `tsx watch` processes are not reliable for long-running test harnesses

During integration work, we observed that starting services with:

- `npm run dev`

inside detached/background shell jobs can lead to services disappearing even
after health checks initially pass.

Practical effect:

- MCP or the tracking service may look healthy at startup
- later integration steps can fail with connection errors such as:
  - `ECONNREFUSED 127.0.0.1:3000`

Why this matters:

- `tsx watch` is fine for interactive development
- but it is a poor fit for a non-interactive orchestration harness

Recommendation:

- for automated integration startup, prefer stable `npm run start` processes
  after a build
- keep `npm run dev` for human-driven local development sessions

### 2. OpenClaw paths in `.env`

Use **`OPENCLAW_STATE_DIR`** and **`OPENCLAW_CONFIG_PATH`** relative to the **repo root** (e.g. `./.openclaw`), or use **absolute paths** if you launch tools from another working directory.

### 3. Preferred local development flow

For normal manual development:

- `./scripts/setup.sh`
- `./scripts/build.sh`
- `./scripts/dev-stack.sh`

For automated integration work:

- prefer built/stable processes where possible

## Contributing

If you are changing runtime contracts between the example tracking service, skills, and agents:

- keep buyer and seller template memory structures documented in workspace templates
  (`packages/workspaces`, OpenClaw `main-workplace`)
- keep skill docs aligned with `packages/skills` and MCP tools in `ckb_payspace_mcp`
- update setup or root docs when package responsibilities change

## License

This repository currently does not declare a root project license file.
