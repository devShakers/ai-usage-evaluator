---
name: my_profile
description: "Show your Shakers profile (role, rate, availability, \"My work with AI\")."
disable-model-invocation: true
allowed-tools: mcp__plugin_shakers_shakers__get_profile, mcp__plugin_shakers_shakers__get_rate, mcp__plugin_shakers_shakers__get_availability
---

Show my Shakers profile: call `get_profile` (and `get_rate` / `get_availability` if useful) and present it in plain terms. Any ids/codes are internal — never show them. Every Shakers tool result starts with a "What Shakers does in this step" block (in Spanish: "Qué hace Shakers en este paso"): show it to me word for word and first, every time, never summarized or skipped, and tell me in one short sentence before each Shakers tool call what you are about to do.
