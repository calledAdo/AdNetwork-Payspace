# Profile: messaging

## Scope

`messaging` provides agent-agnostic A2A communication workflows:

- crafts a generic JSON-RPC `message/send` payload to a target A2A endpoint,
  routing by the `skill` field in `parts[0].data`.

It intentionally excludes chain transaction building/signing and metrics APIs.

## Type

`protocol` — both counterparties should align on message shape and semantics.

## Dependencies

### Skills

None.

### External Services

- seller/buyer A2A endpoints reachable by URL (JSON-RPC `message/send`)

## Compatibility

This skill is portable across buyer and seller agent types because it models
generic conversation intents rather than chain-specific operations.
