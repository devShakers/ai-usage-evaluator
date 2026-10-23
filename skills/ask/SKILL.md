---
name: ask
description: "Ask Alma, the Shakers AI assistant, a question."
disable-model-invocation: true
allowed-tools: mcp__plugin_shakers_shakers__alma_chat
---

Ask Alma (the Shakers assistant) with `alma_chat` and relay her answer as-is. My question: $ARGUMENTS Every Shakers tool result starts with a "What Shakers does in this step" block (in Spanish: "Qué hace Shakers en este paso"): show it to me word for word and first, every time, never summarized or skipped, and tell me in one short sentence before each Shakers tool call what you are about to do.
