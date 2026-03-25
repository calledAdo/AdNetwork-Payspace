# Ad Network

Ad Network is a CKB-native ad marketplace protocol built around hosted buyer
and seller agents.

PaySpace is an application/company built on top of Ad Network.

At a high level:

- publishers onboard, define ad slots, and host seller agents
- campaigners onboard, define campaigns, and host buyer agents
- seller agents publish BookingSpace slots on-chain
- buyer agents discover slots, negotiate, verify delivery, and stream payments
- the backend and frontend provide the operational control plane around that
  agent workflow

## Repository Layout

This repository is a monorepo with five main parts:

- [packages/payspace_frontend](./packages/payspace_frontend)
  Main product frontend for campaigners and publishers
- [packages/payspace_backend](./packages/payspace_backend)
  Backend control plane for onboarding, tracking, snippet delivery, and
  subject-to-agent proxy routes
- [packages/gateway](./packages/gateway)
  Per-block gateway that hosts buyer and seller agents
- [packages/mcp](./packages/mcp)
  Blockchain-facing service for BookingSpace and payment-channel flows
- [contracts](./contracts)
  Rust smart contracts for BookingSpace and payment-channel lock logic

## Architecture

The current architecture is split along clear responsibilities:

- frontend
  User-facing app for onboarding, inventory, agent chat, and operations
- backend
  Business records, onboarding assistant, tracking/snippet delivery, and
  subject-based proxying of agent runtime details
- gateway
  Agent hosting, A2A routing, owner chat/commands, and agent memory inspection
- mcp
  Chain-facing placement and payment-channel read/build/submit service
- contracts
  On-chain source of truth for BookingSpace and payment-channel validation

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

The repo expects a root `.env` file.

Common variables used during local development include:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `TRACKING_URL`
- `PAYSPACE_API_KEY`
- `BLOCK_PUBLIC_URL`
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`

The gateway also uses a repo-local OpenClaw state tree under:

- `packages/gateway/.openclaw`

## Setup

Install dependencies and prepare the local environment:

```bash
./scripts/setup.sh
```

This script:

- installs npm dependencies for the active packages
- runs `cargo fetch` for the contract workspace when Cargo is available
- prepares and health-checks the gateway-local OpenClaw profile

## Build

Build the active packages:

```bash
./scripts/build.sh
```

This builds:

- `packages/payspace_backend`
- `packages/mcp`
- `packages/gateway`
- `packages/payspace_frontend`

## Run Locally

Start the local development stack:

```bash
./scripts/dev-stack.sh
```

This starts:

- MCP
- backend
- gateway
- main frontend

This is the default development path for the project.

## Package Guide

### Frontend

Path:

- [packages/payspace_frontend](./packages/payspace_frontend)

Responsibilities:

- campaign onboarding
- publisher onboarding
- slot creation
- inventory views
- buyer and seller operations dashboards

Run directly:

```bash
cd packages/payspace_frontend
npm run dev
```

### Backend

Path:

- [packages/payspace_backend](./packages/payspace_backend)

Responsibilities:

- onboarding assistant
- publisher and campaign records
- tracking and snippet delivery
- proxying runtime agent details by subject

Run directly:

```bash
cd packages/payspace_backend
npm run dev
```

### Gateway

Path:

- [packages/gateway](./packages/gateway)

Responsibilities:

- spawning hosted buyer and seller agents
- A2A routing
- owner chat and command proxying into OpenClaw
- agent memory inspection

Run directly:

```bash
cd packages/gateway
npm run dev
```

### MCP

Path:

- [packages/mcp](./packages/mcp)

Responsibilities:

- BookingSpace discovery
- placement queries
- transaction building and submission

Run directly:

```bash
cd packages/mcp
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

## Development Notes

- buyer and seller runtime memory lives inside gateway agent workspaces
- gateway `agents` routes validate memory reads with Zod
- buyer and seller template helper scripts validate memory writes with Zod
- the root `.gitignore` excludes generated output, local runtime state,
  backend data, and agent workspaces

## Root Scripts

- [scripts/setup.sh](./scripts/setup.sh)
  Install dependencies and prepare local OpenClaw state
- [scripts/build.sh](./scripts/build.sh)
  Build active packages
- [scripts/dev-stack.sh](./scripts/dev-stack.sh)
  Start the local stack

## Contributing

If you are changing runtime contracts between frontend, backend, and gateway:

- keep buyer and seller memory structures documented in the template
  `MEMORY.md` files
- keep agent cards and skill docs aligned between buyer and seller
- update setup or root docs when package responsibilities change

## License

This repository currently does not declare a root project license file.
