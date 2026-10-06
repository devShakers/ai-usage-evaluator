---
name: my_profile
description: Show your Shakers profile (role, rate, availability, "My work with AI").
disable-model-invocation: true
allowed-tools: mcp__shakers__get_profile, mcp__shakers__get_rate, mcp__shakers__get_availability
---

Show my Shakers profile: call `get_profile` (and `get_rate` / `get_availability` if useful) and present it in plain terms. Any ids or codes are internal — never show them.
