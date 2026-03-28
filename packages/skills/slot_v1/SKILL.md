---
name: slot_v1
description: BookingSpace on-chain slot lifecycle builders for publish/book/unbook flows.
---

# Skill: slot_v1

## Possible Tasks

- build publish, book, and unbook BookingSpace placement transactions (seller-side)

## Scripts

Seller-side BookingSpace scripts:

- `scripts/build_publish_slot.mjs` (build publish tx)
- `scripts/build_lock_slot.mjs` (build book tx)
- `scripts/build_free_slot.mjs` (build unbook/cancel tx)

## Command vs Script

- Task/command names express intended behavior.
- Script filenames are execution helpers and may not be 1:1 with commands.
- A single task may use multiple scripts plus memory operations.

