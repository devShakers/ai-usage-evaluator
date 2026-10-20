---
name: my_profile
description: "Show your Shakers profile (role, rate, availability, \"My work with AI\")."
disable-model-invocation: true
allowed-tools: mcp__plugin_shakers_shakers__get_profile, mcp__plugin_shakers_shakers__get_rate, mcp__plugin_shakers_shakers__get_availability
---

Show my Shakers profile: call `get_profile` (and `get_rate` / `get_availability` if useful) and present it in plain terms. Any ids/codes are internal — never show them.
