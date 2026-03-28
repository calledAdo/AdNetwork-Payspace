---
name: messaging
description: Agent-agnostic A2A messaging helpers for slot detail requests, negotiation, and campaign handoff.
---

# Skill: messaging

This skill owns generic A2A communication flows that are not chain builders.

## Possible Tasks

- send an agent-to-agent JSON-RPC message (`message/send`) to a target A2A
  skill endpoint

## Scripts

- `scripts/a2a.mjs`
  Generic template that builds the A2A request body from:
  - `--data` (JSON object payload) and/or
  - repeated `--kv key=value` overrides/extensions
  and routes it via `--skill`.

## Command vs Script

- Task names represent generic capability (`send_a2a`).
- Script names are execution helpers for that capability.
