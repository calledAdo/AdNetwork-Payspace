# PaySpace Agents Architecture

This directory contains the implementation of the AI-driven agents that power the PaySpace marketplace. Our architecture relies on a decentralized interaction between **Buyer Agents** and **Seller Agents** to automate ad placement, negotiation, and verification.

## Architecture Overview

The marketplace operates through the coordination of two primary agent types:

### 1. Buyer Agent (Campaign Manager)
The Buyer Agent acts as an automated ad campaign manager for advertisers. It is responsible for the entire lifecycle of an ad campaign, from initial placement search to final reporting.

**Key Responsibilities:**
- **Placement Discovery**: Searches for available ad placements that match the campaign's criteria.
- **Negotiation**: Interfaces with Seller Agents to negotiate pricing and terms.
- **Ad Verification**: Uses **Playwright** to autonomously verify that the ad is correctly displayed on the publisher's site.
- **Payment Settlement**: Handles secure payment transfers once conditions are met.
- **Reporting**: Provides a comprehensive summary report to the user, detailing campaign performance and verification status.

### 2. Seller Agent (Publisher Agent)
The Seller Agent manages a publisher's inventory and bookings. Typically, each publisher site is managed by a dedicated Seller Agent responsible for maximizing fill rates and managing site-specific logistics.

**Key Responsibilities:**
- **Inventory Management**: Manages all bookings and available slots for a specific publisher site.
- **Ad Publishing**: Responsible for ensuring the ad is correctly published and served on the site as per the agreement.
- **Negotiation**: Negotiates with Buyer Agents to secure the best rates for the publisher's inventory.
- **Payment Receipt**: Constantly monitors and receives recurring payments for successfully served ads.

---

## Agent Lifecycle

The interaction between Buyer and Seller agents follows a structured lifecycle:

1.  **Registration & Identity**: Both agents initialize their OpenClaw files (e.g., `IDENTITY.md`, `SOUL.md`) and register their unique on-chain identifiers on the CKB network.
2.  **Discovery & Advertising**: 
    -   **Buyer Agent** proactively searches the registry for available placement tags matching its campaign criteria (`AGENTS.md`).
    -   **Seller Agent** maintains an up-to-date registry of available inventory and pricing.
3.  **Negotiation & Bid**: Agents negotiate terms for a placement. The `SOUL.md` file influences the tone and strategy of this negotiation.
4.  **Contracting & Escrow**: Once agreed, the Buyer Agent locks funds in a **Time-Based Lease Cell** on the CKB blockchain, ensuring secure escrow.
5.  **Execution & Monitoring**:
    -   The **Seller Agent** publishes the ad snippet to the target site.
    -   The **Buyer Agent** uses **Playwright** (defined in `SKILL.md`) to pull screenshots and verify the ad's presence on the URL.
6.  **Payment Settlement**:
    -   Upon successful verification, the Seller Agent collects payments from the escrow cell.
    -   The Buyer Agent monitors the payment status and updates `MEMORY.md` with the campaign's success metrics.
7.  **Reputation & Memory**: Both agents update their long-term memory with performance data and partner reliability scores, informing future negotiations.

---

## Directory Structure
- `buyer/`: OpenClaw instance for the Buyer Agent (Campaign Manager).
- `seller/`: OpenClaw instance for the Seller Agent (Publisher Agent).
- `main_agent/`: Core agent orchestration and shared utilities.
