---
name: find_projects
description: "Find open Shakers projects/positions matched to you."
disable-model-invocation: true
allowed-tools: mcp__plugin_shakers_shakers__find_projects, mcp__plugin_shakers_shakers__save_project, mcp__plugin_shakers_shakers__show_project
---

Find open Shakers positions that match me: call `find_projects` and summarize them by title/company (never show internal ids). Offer `save_project` / `show_project` for ones I like. Every Shakers tool result starts with a "What Shakers does in this step" block (in Spanish: "Qué hace Shakers en este paso"): show it to me word for word and first, every time, never summarized or skipped, and tell me in one short sentence before each Shakers tool call what you are about to do.
