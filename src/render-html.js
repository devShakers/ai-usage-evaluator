'use strict';

const { getCatalog, categoryLabel } = require('./i18n');
const { getRoadmapEntry } = require('./roadmap-content');
const { analyzeTier } = require('./tier-analysis');
const { mergeRoadmapPersonalization } = require('./roadmap-personalization');
const { buildImplementationPrompt } = require('./roadmap-prompt');

/*
 * Generates a SELF-CONTAINED HTML dashboard: all the CSS and data are
 * embedded in the file. It makes no network calls at all, so the talent
 * opens the .html with a double-click and it works without a server or
 * connection.
 *
 * Design direction: Shakers visual language (design system "Nexia"). Clear,
 * sober surface by default, corporate teal green as the brand and
 * "signal detected" color, lime accent for momentum ("next step"), Inter
 * typography (with a system fallback — see the DRIFT note). Card-based
 * layout with the DS's radius/shadow/spacing scale. Supports light and dark
 * via prefers-color-scheme, as Nexia defines.
 *
 * IMPORTANT (privacy/trust invariant): ZERO network calls. No external
 * fonts, no CDN, no remote images, no fetch/XHR. Everything inline.
 *
 * i18n (talents-ai-score, report-i18n): `lang` ('es'|'en', see src/i18n.js)
 * decides the copy catalog (the `t` parameter passed to the helpers below).
 * Level and category are translated by STABLE KEY (maturity.key/level,
 * categoryLabel) without touching maturity.js/detectors.js — see the header
 * of src/i18n.js. Depth labels (depthLabel: mcpServers, instructions...) are
 * left as-is in both languages: they're scanner field names, not report copy.
 */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function strength(tool) {
  const depthSum = Object.values(tool.depth || {}).reduce((a, b) => a + b, 0);
  return Math.max(1, Math.min(4, tool.signalCount + Math.min(depthSum, 2)));
}

function depthLabel(tool) {
  const bits = Object.entries(tool.depth || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v}&nbsp;${esc(k)}`);
  return bits.join(' · ');
}

// Formats bytes into a readable unit (B/KB/MB). Presentation only: the raw
// data (tool.footprint.bytes) already comes aggregated and sanitized from
// the scanner. Units (B/KB/MB) are universal: not localized.
function humanizeBytes(bytes) {
  if (bytes === null || bytes === undefined) return null;
  if (bytes < 1024) return `${bytes}&nbsp;B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}&nbsp;KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}&nbsp;MB`;
}

// tool.footprint is null when the tool has no path of its own to measure
// (detected only via bin/vscodeExt) — it renders as null and the caller omits it.
function footprintLabel(tool, t) {
  if (!tool.footprint) return null;
  const { bytes, files } = tool.footprint;
  const size = humanizeBytes(bytes);
  const filesLabel = t.html.files(files);
  return size ? `${filesLabel} · ${size}` : filesLabel;
}

// Recency badge: handles bucket=null (nothing to date) and silently omits
// it, instead of showing a made-up state.
function recencyBadge(tool, t) {
  const r = tool.recency;
  if (!r || !r.bucket) return '';
  const label = t.recency[r.bucket] || r.bucket;
  const title = r.lastModified
    ? t.html.lastModified(new Date(r.lastModified).toLocaleDateString())
    : '';
  return `<span class="recency ${esc(r.bucket)}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
}

// tool.version is null when it wasn't detected via a binary on PATH, or the
// binary didn't respond to --version: it's omitted, never made up as "unknown".
function versionLabel(tool) {
  if (!tool.version) return '';
  return `<span class="ver">v${esc(tool.version)}</span>`;
}

/* ---------- project technologies (talents-ai-score, ADR-012) ----------
 * Dependency manifest NAMES only (src/tech-detector.js) — always shown
 * locally, regardless of consent. Associated with Shakers' Skill catalog
 * only server-side, at persistence time.
 */

function technologiesSection(report, t) {
  const technologies = Array.isArray(report.technologies) ? report.technologies : [];
  if (!technologies.length) {
    return `<section>
    <div class="h2">${esc(t.html.technologiesHeading)}</div>
    <div class="card tech-empty">${esc(t.html.technologiesEmpty)}</div>
  </section>`;
  }
  const chips = technologies.map((tech) => `<span class="chip">${esc(tech)}</span>`).join('');
  return `<section>
    <div class="h2">${esc(t.html.technologiesHeading)}</div>
    <div class="card chips-card"><div class="chips">${chips}</div></div>
  </section>`;
}

/* ---------- MCP servers by name (talents-ai-score, issue 015) ----------
 * `report.mcp.servers` (name + heuristic category, src/mcp-detector.js) is
 * already computed and already local-only-by-contract: it feeds the
 * browser-tools detector and countsByCategory/total in the persistence
 * payload (src/share.js), but the individual SERVER NAMES themselves are
 * never sent — see derivePayload's mcp field (countsByCategory/total only).
 * Rendered here for the first time: a plain list, name + category badge,
 * shown only when there's at least one server; omitted entirely when there
 * are none (never a misleading "no MCP" card where a manifest-driven
 * section would show one).
 */

function mcpCategoryLabel(t, category) {
  return (t.mcpCategories && t.mcpCategories[category]) || category;
}

function mcpSection(report, t) {
  const servers = report.mcp && Array.isArray(report.mcp.servers) ? report.mcp.servers : [];
  if (!servers.length) return '';
  const rows = servers
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => `<li class="mcp-row">
      <span class="mcp-name">${esc(s.name)}</span>
      <span class="mcp-category">${esc(mcpCategoryLabel(t, s.category))}</span>
    </li>`)
    .join('');
  return `<section>
    <div class="h2">${esc(t.html.mcpHeading)}</div>
    <ul class="mcp-list">${rows}</ul>
  </section>`;
}

/* ---------- projects per AI tool (skill-code-certification / ADR-011) ----------
 * `report.toolProjectUsage` (src/tool-project-usage.js) lists, per detected
 * tool, the projects where it has been used locally. STRICTLY LOCAL — these
 * paths are never persisted (not in src/share.js#derivePayload). Rendered as a
 * per-tool card: a project list when available, an honest "no local history"
 * note otherwise. Omitted entirely when no tool exposes a history at all, so we
 * never show an empty, misleading card. Deterministic (already sorted upstream).
 */
function toolProjectUsageSection(report, t) {
  const usage = Array.isArray(report.toolProjectUsage) ? report.toolProjectUsage : [];
  // Show ONLY tools that actually have projects (user request, ADR-011 follow-up):
  // drop `available:false` tools AND `available:true` ones with an empty list.
  // If nothing survives the filter, the whole section is omitted.
  const withProjects = usage.filter((u) => Array.isArray(u.projects) && u.projects.length > 0);
  if (!withProjects.length) return '';

  const cards = withProjects
    .map((u) => {
      const sourceLabel =
        u.sourceKey && t.html.toolUsageSource && t.html.toolUsageSource[u.sourceKey]
          ? ` <span class="tu-source">· ${esc(t.html.toolUsageSource[u.sourceKey])}</span>`
          : '';
      const items = u.projects
        .map(
          (p) =>
            `<li${p.approximate ? ' class="approx"' : ''}><code>${esc(p.path)}</code>${
              p.approximate ? ` <span class="tu-approx">(${esc(t.html.toolUsageApproxNote)})</span>` : ''
            }</li>`,
        )
        .join('');
      const body = `<div class="tu-count">${esc(t.html.toolUsageCount(u.projects.length))}</div><ul class="tu-projects">${items}</ul>`;
      return `<div class="card tu-card">
      <div class="tu-tool">${esc(u.toolName)}${sourceLabel}</div>
      ${body}
    </div>`;
    })
    .join('');

  return `<section>
    <div class="h2">${esc(t.html.toolUsageHeading)}</div>
    <p class="tu-intro">${esc(t.html.toolUsageIntro)}</p>
    ${cards}
  </section>`;
}

/* ---------- agent cards: hierarchical role-card tree, pure HTML/CSS ----------
 * talents-ai-score: Mermaid (a graph rendering) turned out illegible even
 * after tuning; a flat card grid (the step before this one) was clearer but
 * only conveyed hierarchy as a text line ("Reports to: X") — the user wants
 * to SEE parent/child relationships, not read them. This is the sole
 * agents view now (consolidates and replaces the separate deterministic
 * "org chart" tree section, which duplicated this same data): a visual
 * tree of role cards — parent card on top, child cards nested/indented
 * below it with a rail connector, recursively for however deep the
 * `parent` chain goes. No vendored library, no `<script>`, zero-network by
 * construction (still pure HTML/CSS, same as the flat-grid version before).
 *
 * Data mapping — only fields we actually have, nothing invented:
 *   - title (bold)      = agentSynthesis.symbolicName, if a synthesis
 *                         result exists for this agent this run; else the
 *                         agent's real (structural) name.
 *   - badge (top-right) = the agent's real (structural) name — ALWAYS
 *                         present, shown as a small badge next to the
 *                         title when a symbolic name is also shown (so the
 *                         real identifier is never hidden), or as the
 *                         title itself when there's no synthesis.
 *   - phrase (italic)   = agentSynthesis.whatItDoes, only when present.
 *   - chips (pills)     = structural `tools[]` + one chip for `model`
 *                         (ADR-009 data, always available when there's an
 *                         agent at all — never depends on synthesis).
 *   - hierarchy         = VISUAL nesting (indentation + rail connector), not
 *                         a text line anymore. Agents with no `parent`
 *                         nest under an implicit "Orchestrator" root header
 *                         (mirrors ADR-009's implicit root — never a real
 *                         agent, so it never gets a full card: no data
 *                         backs tools/model/phrase for it). An `aria-label`
 *                         keeps the relationship available to screen
 *                         readers without a visible text line.
 *   - Deliberately OMITTED (no data to back it): L1/L2 maturity framing,
 *     "human judgment" narrative, "evidence" links, "edit ontology" — none
 *     of that exists in this report's data model; simulating it would
 *     violate the "never invent" invariant this whole CLI is built on.
 *
 * Layout choice: the root's DIRECT children (the common case — most real
 * `.claude/agents/` setups declare no `parent` at all) render in a
 * responsive GRID, since that's the shape that scales best for "many
 * siblings, no depth". Any card that itself has children (explicit,
 * multi-level `parent` chains — the rarer case) gets them nested directly
 * beneath it, indented, connected by a rail — the shape that scales best
 * for "real depth". Cards never shrink to fit: the container just grows/
 * scrolls.
 *
 * Fallback (no agentSynthesis this run, or a given agent isn't in it): the
 * SAME tree renders with title = real name, no badge, no phrase — chips
 * and hierarchy stay identical either way (they never depended on
 * synthesis to begin with).
 */

// talents-ai-score bugfix: matches the synthesis response back to the
// structural agent by EXACT name equality, which is fragile — an LLM can
// legitimately echo a name back trimmed differently, in a different case,
// or wrapped in backticks/quotes/markdown emphasis without that being a
// "wrong" answer in any meaningful sense. An exact-match miss caused by
// this kind of harmless formatting drift silently loses that agent's
// symbolicName/whatItDoes (falls through to "no synthesis for this one"),
// even though the synthesis response DID cover it. Normalizing both sides
// before comparing (never before storing/rendering) fixes the matching
// without weakening it: two DIFFERENT agent names still never collide.
function normalizeAgentName(name) {
  return String(name || '').trim().toLowerCase().replace(/^[`'"*]+|[`'"*]+$/g, '');
}

// talents-ai-score, description-always-present (real-browser user
// feedback): TWO earlier approaches were tried and rejected before this
// one. First, a deterministic FILLER phrase (derived from tools/model)
// whenever synthesis didn't cover an agent — every card got the SAME
// templated sentence, read as noise ("molesta"). That was reverted to "no
// phrase at all" when there's no synthesis. The user then rejected THAT
// too, in real-browser testing: a card with only name+model, no
// description whatsoever, is not acceptable either. Final behavior, in
// priority order — NEVER a blank phrase:
//   1. The synthesis result's `whatItDoes` (unchanged, richest option).
//   2. The agent's OWN raw `description`, straight from its
//      `.claude/agents/*.md` frontmatter (`report.agentDescriptions`,
//      attached by bin/report.js via agent-org-chart.js's
//      parseAgentDescriptions — ADR-010's gated function, now ALSO reused
//      for this local-only display, not just the ephemeral synthesis
//      request). Deterministic, local, from the talent's own file — a
//      legitimate "description based on your own files".
//
//      Deliberately NOT run through `scrubSecrets` here (unlike the
//      synthesis request, which sends this text to an external endpoint):
//      that heuristic redaction is tuned for "about to leave the machine"
//      and its path-matching rule turned out to mangle ordinary example
//      file paths a talent legitimately writes in their own description
//      ("Add test coverage for src/modules/.../foo.service.ts" ->
//      "[REDACTED]"), actively harming legibility for content that never
//      leaves the machine and offers no corresponding safety benefit
//      here — the talent is looking at their OWN file, on their OWN
//      machine, in a report Claude Code (or equivalent) already reads in
//      full every session. Still HTML-escaped (`esc()`, applied uniformly
//      to every rendered field) so it can never break out of the markup.
//   3. Only when NEITHER of the above exists: a minimal, name-derived
//      last-resort line (`agentDescriptionFromName`) — deliberately SHORT
//      and NOT a full templated sentence, so it doesn't reproduce the
//      "every card looks identical" problem from approach #1: it differs
//      per agent because the name differs, and it only ever fires for an
//      agent that genuinely declares nothing else.
//
// Merges the structural org chart (ADR-009: name/tools/model/parent —
// always available, deterministic) with the ephemeral synthesis result
// (ADR-010: symbolicName/whatItDoes — optional, per-run) and the raw
// per-agent descriptions, all keyed by NORMALIZED name (see
// normalizeAgentName above — the raw-description matching gets the exact
// same tolerance as synthesis matching, since both are free-text sources
// that could format a name slightly differently), then groups by parent
// (dangling/self/missing parent references fall back to the implicit
// root, same defensive rule the retired org-chart tree used).
//
// Guarantees:
//   - `name`: always the structural agent's name — parseAgentFile already
//     guarantees this is never blank (falls back to the filename there).
//   - `whatItDoes`: NEVER null or blank — always one of the 3 sources
//     above, in that priority order.
function humanizeAgentName(name) {
  const spaced = String(name || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced.replace(/^\S/, (c) => c.toUpperCase());
}

// talents-ai-score bugfix (real-browser testing against shakers-hub-backend):
// the raw frontmatter description showed literal YAML escape artifacts —
// this repo's minimal frontmatter parser (src/agent-org-chart.js) never
// interprets YAML string escapes, so a description authored with `\n`/`\r`/
// `\t` as literal 2-character escape sequences (or produced as a `|` block
// scalar, which our parser DOES join with real newline characters) leaked
// those artifacts straight into the rendered card. Strips both forms, any
// stray `|` characters (another YAML block-scalar artifact), and collapses
// the resulting whitespace — turning "YAML-escaped" text into plain prose.
// ONLY applied to the raw-frontmatter source (see buildAgentCardTree below)
// — never to the synthesis whatItDoes (already short/polished) or the
// last-resort name-derived line (already short and never came from YAML).
function cleanRawDescription(text) {
  return String(text || '')
    .replace(/\\[nrt]/g, ' ') // literal 2-char escape sequences, as typed in the source frontmatter
    .replace(/[\n\r\t]/g, ' ') // real control characters (e.g. from a `|` block scalar)
    .replace(/\|/g, ' ') // stray YAML block-scalar/table-like pipe artifacts
    .replace(/\s+/g, ' ')
    .trim();
}

// talents-ai-score bugfix: a real agent's `description` is often its FULL
// system-prompt text (multi-paragraph, "Examples:"/"Ejemplos:" sections
// included) — showing it whole made cards wildly uneven in height and
// unreadable. Extracts a short card excerpt: the first sentence (up to
// the first `.`/`!`/`?` that's followed by whitespace or the end of the
// string — a period immediately followed by another letter, like the one
// inside "bar.service.ts", is NOT treated as a sentence end) or ~160
// characters, WHICHEVER IS SHORTER. An ellipsis is appended only when the
// text was actually cut off mid-thought (never after a real, complete
// sentence — "sentence.…" would look broken).
const CARD_EXCERPT_MAX_LEN = 160;

function excerptForCard(text, maxLen = CARD_EXCERPT_MAX_LEN) {
  if (!text) return text;
  const sentenceMatch = text.match(/[.!?](?=\s|$)/);
  const sentenceEndIdx = sentenceMatch ? sentenceMatch.index + 1 : null;

  if (sentenceEndIdx !== null && sentenceEndIdx <= maxLen) {
    return text.slice(0, sentenceEndIdx).trim();
  }
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}…`;
}

function buildAgentCardTree(report, t) {
  const agents = Array.isArray(report.agents) ? report.agents : [];
  const synthesisAgents =
    report.agentSynthesis && Array.isArray(report.agentSynthesis.agents) ? report.agentSynthesis.agents : [];
  const synthesisByName = new Map(synthesisAgents.map((a) => [normalizeAgentName(a.name), a]));
  const rawDescriptions = Array.isArray(report.agentDescriptions) ? report.agentDescriptions : [];
  const rawDescByName = new Map(rawDescriptions.map((d) => [normalizeAgentName(d.name), d.description]));
  const byName = new Set(agents.map((a) => a.name));

  const cards = agents.map((a) => {
    const key = normalizeAgentName(a.name);
    const synth = synthesisByName.get(key);
    const parentKey = a.parent && byName.has(a.parent) && a.parent !== a.name ? a.parent : null;
    const tools = Array.isArray(a.tools) ? a.tools : [];
    const model = a.model || null;

    const synthPhrase =
      synth && typeof synth.whatItDoes === 'string' && synth.whatItDoes.trim() ? synth.whatItDoes.trim() : null;
    const rawRaw = rawDescByName.get(key);
    const rawPhrase =
      typeof rawRaw === 'string' && rawRaw.trim() ? excerptForCard(cleanRawDescription(rawRaw)) : null;
    const fallbackPhrase = t && t.html.agentDescriptionFromName ? t.html.agentDescriptionFromName(humanizeAgentName(a.name)) : null;
    const whatItDoes = synthPhrase || rawPhrase || fallbackPhrase;

    return {
      name: a.name,
      symbolicName: synth && synth.symbolicName ? synth.symbolicName : null,
      whatItDoes,
      tools,
      model,
      parent: parentKey,
    };
  });

  const childrenByParent = new Map();
  for (const card of cards) {
    if (!childrenByParent.has(card.parent)) childrenByParent.set(card.parent, []);
    childrenByParent.get(card.parent).push(card);
  }

  return { childrenByParent, roots: childrenByParent.get(null) || [] };
}

function agentCardHtml(card, t) {
  const hasSymbolicName = !!card.symbolicName;
  const title = esc(hasSymbolicName ? card.symbolicName : card.name);
  // The real (structural) name is always shown — as a small badge next to
  // a symbolic title, or folded into the title itself when there's no
  // synthesis for this agent.
  const badge = hasSymbolicName
    ? `<span class="agent-badge" title="${esc(t.html.agentRealNameLabel)}">${esc(card.name)}</span>`
    : '';
  const phrase = card.whatItDoes ? `<p class="agent-phrase">${esc(card.whatItDoes)}</p>` : '';
  const toolChips = card.tools
    .map((tool) => `<span class="chip pill"><i class="dot" aria-hidden="true"></i>${esc(tool)}</span>`)
    .join('');
  const modelChip = card.model
    ? `<span class="chip pill model"><i class="dot" aria-hidden="true"></i>${esc(card.model)}</span>`
    : '';
  // Hierarchy is now visual (nesting + rail, see agentNodeHtml) — the
  // `aria-label` is the accessible equivalent of the old "Reports to:"
  // text line, not a duplicate of it.
  const reportsTo = card.parent || t.html.orchestratorLabel;
  const ariaLabel = `${hasSymbolicName ? card.symbolicName : card.name}. ${t.html.reportsToLabel} ${reportsTo}`;

  return `<div class="agent-card" aria-label="${esc(ariaLabel)}">
    <div class="agent-card-head">
      <span class="agent-title">${title}</span>
      ${badge}
    </div>
    ${phrase}
    <div class="agent-chips">${toolChips}${modelChip}</div>
  </div>`;
}

// Recursive: renders a card plus its children, indented and rail-connected,
// however deep the explicit `parent` chain goes. `visited` guards against a
// malformed cycle in human-authored `parent` fields (e.g. A -> B -> A) —
// defensive, never a product requirement, just never infinite-loop on bad
// input.
function agentNodeHtml(card, childrenByParent, t, visited = new Set()) {
  if (visited.has(card.name)) return '';
  const nextVisited = new Set(visited);
  nextVisited.add(card.name);
  const children = childrenByParent.get(card.name) || [];
  const hasChildren = children.length > 0;
  const childrenHtml = hasChildren
    ? `<div class="agent-children">${children.map((c) => agentNodeHtml(c, childrenByParent, t, nextVisited)).join('')}</div>`
    : '';
  // `has-children` is the layout hook: at ROOT level (a direct child of
  // .agent-cards-grid) it turns the node into the sole horizontal-scroll
  // viewport for its own subtree, so deep nesting scrolls WITHOUT dragging
  // the wrappable root siblings into a shared scroll canvas (which was
  // clipping the second sibling — see the .agent-cards-grid CSS note).
  return `<div class="agent-node${hasChildren ? ' has-children' : ''}">
    ${agentCardHtml(card, t)}
    ${childrenHtml}
  </div>`;
}

function agentCardsSection(report, t) {
  const { childrenByParent, roots } = buildAgentCardTree(report, t);
  if (!roots.length) {
    return `<section>
    <div class="h2">${esc(t.html.diagramHeading)}</div>
    <div class="card diagram-fallback">${esc(t.html.agentsEmpty)}</div>
  </section>`;
  }
  return `<section>
    <div class="h2">${esc(t.html.diagramHeading)}</div>
    <div class="agent-tree">
      <div class="agent-root-header">${esc(t.html.orchestratorLabel)}</div>
      <div class="agent-cards-grid">
        ${roots.map((r) => agentNodeHtml(r, childrenByParent, t)).join('\n')}
      </div>
    </div>
  </section>`;
}

/* ---------- tier roadmap: current -> next (talents-ai-score, issue 020) ----------
 * Shows ONLY the entry for `maturity.tierKey` — never the whole T0-T7
 * ladder at once (source doc: "El informe muestra solo el salto actual →
 * siguiente"). Replaces the old generic band-keyed "next step" card:
 * this is strictly richer (upgrade criterion, unlocks, steps, a literal
 * copyable snippet, community tips, common mistakes) for the SAME slot,
 * rather than showing both and duplicating the message.
 *
 * Content is authored (src/roadmap-content.js, ported verbatim from the
 * product-manager's roadmap-content.md) — this function only renders it,
 * never generates prose. Snippets are LITERAL code, escaped for safe HTML
 * embedding but never translated.
 */

function roadmapStepsHtml(steps) {
  return steps
    .map((s) => `<li><span class="roadmap-step-text">${esc(s.text)}</span><span class="roadmap-step-estimate">${esc(s.estimate)}</span></li>`)
    .join('');
}

function roadmapSnippetHtml(snippet, t) {
  const label = snippet.label ? `<p class="roadmap-snippet-desc">${esc(snippet.label)}</p>` : '';
  const filename = snippet.filename ? `<div class="roadmap-snippet-filename">${esc(snippet.filename)}</div>` : '';
  const second = snippet.secondFile
    ? `<div class="roadmap-snippet-filename">${esc(snippet.secondFile.filename)}</div><pre class="roadmap-code"><code>${esc(snippet.secondFile.code)}</code></pre>`
    : '';
  return `<div class="roadmap-block">
    <div class="roadmap-block-label">${esc(t.html.roadmapSnippetLabel)}</div>
    ${label}
    ${filename}
    <pre class="roadmap-code"><code>${esc(snippet.code)}</code></pre>
    ${second}
  </div>`;
}

// talents-ai-score, i18n audit: both es/en roadmap content is now fully
// authored (src/roadmap-content.js) — this only fires as a DEFENSIVE
// fallback for a future tier added to Spanish before its English
// translation lands, never against today's complete T0-T7 set. Never
// falls back to Spanish prose (the old, retired `pendingTranslation`
// behavior): the i18n audit's hard rule is "an English locale never shows
// Spanish text", so this renders a short, all-English notice instead.
function roadmapUnavailableCard(entry, t) {
  return `<div class="card roadmap-card">
    <h3 class="roadmap-title">${esc(entry.tierKey)}</h3>
    <p class="roadmap-unavailable">${esc(t.html.roadmapContentUnavailable)}</p>
  </div>`;
}

// talents-ai-score, ADR-015: shown only when the 4 prose gaps were
// actually replaced by a validated, project-adapted response (never when
// falling back to curated verbatim) — an honest signal of what changed,
// same spirit as the agent card's real-name badge or the pending-
// translation notice above. Tier/band/criterion/snippet are NEVER
// personalized, so this notice never implies they were.
function roadmapPersonalizedNotice(personalized, t) {
  return personalized
    ? `<p class="roadmap-personalized">${esc(t.html.roadmapPersonalizedNotice)}</p>`
    : '';
}

function roadmapTerminalHtml(entry, t, promptText) {
  return `<div class="card roadmap-card">
    <h3 class="roadmap-title">${esc(entry.title)}</h3>
    <p class="roadmap-intro">${esc(entry.intro)}</p>
    <p class="roadmap-what-remains">${esc(entry.whatRemains)}</p>
    <div class="roadmap-block">
      <div class="roadmap-block-label">${esc(t.html.roadmapConsolidationLabel)}</div>
      <ul class="roadmap-list">${entry.consolidationSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>
    <div class="roadmap-block">
      <div class="roadmap-block-label">${esc(t.html.roadmapHonestyLabel)}</div>
      <p class="roadmap-honesty">${esc(entry.honestyNote)}</p>
    </div>
    ${implementationPromptBlock(promptText, t)}
  </div>`;
}

// talents-ai-score, "next steps -> prompt": a deterministic, ready-to-paste
// implementation prompt (src/roadmap-prompt.js) — the PRIMARY "how do I
// implement this" path now, replacing --build-next-level's file-writing as
// the main route (that stays available as a secondary, opt-in
// alternative — see its updated hint text). A plain `<pre>` block, same
// pattern already used for the roadmap's own copyable code snippet
// (roadmapSnippetHtml above): no click-to-copy JS button, just legible,
// manually-selectable text — consistent with the existing snippet UX.
// Copy-to-clipboard button (talents-ai-score): reads the prompt text back
// from the DOM (`target.textContent`) instead of re-embedding it into a
// second JS string literal — sidesteps escaping a multi-line, quote-and-
// backtick-heavy prompt into an inline attribute entirely. The button's
// own click handling lives in the single generic script at the bottom of
// the document (data-copy-target/data-copied-label attributes, not a
// per-button inline handler) — inline JS only, no network, matching the
// zero-network invariant this report is already built on. Label follows
// the report's own locale (t.html), same as everything else in this card.
function implementationPromptBlock(promptText, t) {
  if (!promptText) return '';
  return `<div class="roadmap-block roadmap-prompt-block">
    <div class="roadmap-prompt-head">
      <div class="roadmap-block-label">${esc(t.html.implementationPromptHeading)}</div>
      <button type="button" class="roadmap-prompt-copy" data-copy-target="implementation-prompt-code" data-copied-label="${esc(t.html.implementationPromptCopiedLabel)}">${esc(t.html.implementationPromptCopyLabel)}</button>
    </div>
    <p class="roadmap-prompt-hint">${esc(t.html.implementationPromptHint)}</p>
    <pre class="roadmap-prompt-code" id="implementation-prompt-code"><code>${esc(promptText)}</code></pre>
  </div>`;
}

function roadmapJumpHtml(entry, t, personalized, promptText) {
  return `<div class="card roadmap-card">
    ${roadmapPersonalizedNotice(personalized, t)}
    <h3 class="roadmap-title">${esc(entry.title)}</h3>
    <div class="roadmap-upgrade-when"><b>${esc(t.html.roadmapUpgradeWhenLabel)}</b> ${esc(entry.upgradeWhen)}</div>
    <div class="roadmap-block">
      <div class="roadmap-block-label">${esc(t.html.roadmapUnlocksLabel)}</div>
      <p class="roadmap-unlocks">${esc(entry.unlocks)}</p>
    </div>
    <div class="roadmap-block">
      <div class="roadmap-block-label">${esc(t.html.roadmapStepsLabel)}</div>
      <ol class="roadmap-list roadmap-steps">${roadmapStepsHtml(entry.steps)}</ol>
    </div>
    ${roadmapSnippetHtml(entry.snippet, t)}
    <div class="roadmap-block">
      <div class="roadmap-block-label">${esc(t.html.roadmapTipsLabel)}</div>
      <ul class="roadmap-list">${entry.tips.map((tip) => `<li>${esc(tip)}</li>`).join('')}</ul>
    </div>
    <div class="roadmap-block">
      <div class="roadmap-block-label">${esc(t.html.roadmapMistakesLabel)}</div>
      <ul class="roadmap-list">${entry.commonMistakes.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    </div>
    ${implementationPromptBlock(promptText, t)}
  </div>`;
}

/* ---------- tier analysis: why this tier (talents-ai-score) ----------
 * Deterministic, mechanical breakdown (src/tier-analysis.js) — never LLM
 * content. Complements the roadmap below: this section defends the
 * ALREADY-computed tier ("here's the evidence"), the roadmap covers what's
 * next ("here's how to level up").
 */

function tierAnalysisSection(report, t) {
  const analysis = analyzeTier(report, t);
  const tt = t.tierAnalysis;
  const metItems = analysis.metCriteria
    .map((c) => `<li>${esc(c.text)}</li>`)
    .join('');
  const blockingBlock = analysis.blockingCriterion
    ? `<div class="tier-analysis-blocking">
        <div class="tier-analysis-blocking-label">${esc(tt.blockingLabel)}</div>
        <p class="tier-analysis-blocking-text">${esc(analysis.blockingCriterion)}</p>
      </div>`
    : `<p class="tier-analysis-maxtier">${esc(tt.maxTierNote)}</p>`;

  return `<section>
    <div class="h2">${esc(tt.heading)}</div>
    <div class="card tier-analysis-card">
      <p class="tier-analysis-intro">${esc(tt.intro(analysis.tierKey, analysis.tierName))}</p>
      ${metItems ? `<div class="tier-analysis-block">
        <div class="tier-analysis-met-label">${esc(tt.metHeading)}</div>
        <ul class="tier-analysis-list">${metItems}</ul>
      </div>` : ''}
      ${blockingBlock}
    </div>
  </section>`;
}

// `maturity.tierKey` may be absent (an older maturity shape, pre-issue-019)
// or unrecognized — degrades to nothing rendered rather than throwing or
// inventing a tier.
//
// talents-ai-score, ADR-015: `report.roadmapPersonalization` (set by
// bin/report.js after an ephemeral, already-validated network call — see
// src/roadmap-personalization.js) merges in ONLY when this is a jump
// entry (never the T7 terminal one). Absent/null (no endpoint configured,
// or any fallback condition already collapsed it to null upstream) simply
// renders the curated content untouched, exactly as before ADR-015 —
// zero-cost, nothing broken.
function roadmapSection(report, maturity, t, lang) {
  const tierKey = maturity && maturity.tierKey;
  if (!tierKey) return '';
  const entry = getRoadmapEntry(tierKey, lang);
  if (!entry) return '';

  if (entry.contentUnavailable) {
    return `<section>
    <div class="h2">${esc(t.html.roadmapHeading)}</div>
    ${roadmapUnavailableCard(entry, t)}
  </section>`;
  }

  const personalization = report && report.roadmapPersonalization;
  const finalEntry = mergeRoadmapPersonalization(entry, personalization);
  const wasPersonalized = !entry.maxTier && !!personalization;
  // skill-code-certification (ADR-008): the prompt is built for the T7 terminal
  // entry too (a consolidation prompt) — the top of the ladder always shows a
  // copyable prompt, never a dead end.
  const promptText = buildImplementationPrompt(finalEntry, report, maturity, lang);
  const body = finalEntry.maxTier
    ? roadmapTerminalHtml(finalEntry, t, promptText)
    : roadmapJumpHtml(finalEntry, t, wasPersonalized, promptText);
  return `<section>
    <div class="h2">${esc(t.html.roadmapHeading)}</div>
    ${body}
  </section>`;
}

// talents-ai-score: renders a DETECTED tool row only — undetected tools are
// filtered out before this is ever called (see renderHtml below). Showing
// every known tool the scanner CHECKS FOR (most of them absent on any
// given machine) was pure noise: what's missing that's actually relevant
// is already covered by the tier roadmap's next-step guidance, not
// repeated here as a long "not detected" list.
function toolRow(tool, t, lang) {
  const category = categoryLabel(lang, tool.category);
  const s = strength(tool);
  const bars = Array.from({ length: 4 }, (_, i) =>
    `<i class="${i < s ? 'on' : ''}"></i>`).join('');
  const metaLeft = [depthLabel(tool), footprintLabel(tool, t)].filter(Boolean).join(' · ')
    || esc(tool.vendor);
  return `<li class="tool on">
    <span class="dot" aria-hidden="true"></span>
    <span class="nm">${esc(tool.name)}${versionLabel(tool)}</span>
    <span class="cat">${esc(category)}</span>
    <span class="sig" title="${esc(t.html.configIntensity)}">${bars}</span>
    <span class="meta"><span class="left">${metaLeft}</span>${recencyBadge(tool, t)}</span>
  </li>`;
}

/* ============================================================
 * Document assembly (skill-code-certification, reporting redesign).
 *
 * The Shakers theme (tokens + base primitives + WHITE background + the
 * document shell) now lives in src/report-theme.js, shared with the
 * certification report and the cumulative report. This file keeps only the
 * FOOTPRINT-specific component CSS and the footprint body markup. The prior
 * `prefers-color-scheme: dark` override is gone: the report is white always
 * (priority #1). The section builders above are unchanged.
 * ============================================================ */

const { renderDocument } = require('./report-theme');

// Footprint-specific component CSS (hero/meter, tool list, recency, env, MCP,
// agent tree, next-step, tier analysis, roadmap). Tokens + base primitives are
// injected by report-theme, so they are intentionally NOT repeated here.
const FOOTPRINT_CSS = `
  /* ---- Hero card: level + meter ---- */
  .hero{padding:28px;margin:24px 0;display:flex;flex-wrap:wrap;
    align-items:center;gap:28px 40px}
  .lvl{min-width:200px}
  .lvl .k{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
    color:var(--faint)}
  .lvl .v{display:flex;align-items:baseline;gap:14px;margin-top:10px}
  .lvl .glyph{font-size:44px;line-height:1;color:var(--emphasis)}
  .lvl .name{font-size:clamp(26px,4.5vw,34px);font-weight:700;letter-spacing:-.02em}
  .lvl .count{color:var(--muted);font-size:14px;margin-top:12px}
  .lvl .count b{color:var(--fg);font-weight:600}
  .pips{display:flex;gap:6px;margin-top:16px}
  .pip{width:34px;height:6px;border-radius:var(--r-full);background:var(--off)}
  .pip.done{background:var(--emphasis)}
  .pip.here{background:var(--emphasis-strong);
    box-shadow:0 0 0 3px color-mix(in srgb,var(--emphasis) 22%, transparent)}

  .meter{flex:1;min-width:240px}
  .meter .top{display:flex;justify-content:space-between;align-items:baseline;
    font-size:14px;color:var(--muted);margin-bottom:10px}
  .meter .top .score{font-size:24px;font-weight:700;color:var(--fg);
    font-variant-numeric:tabular-nums}
  .meter .top .score span{font-size:12px;font-weight:500;color:var(--faint)}
  .track{height:12px;background:var(--track);border-radius:var(--r-full);overflow:hidden}
  .fill{height:100%;width:0;border-radius:var(--r-full);
    background:linear-gradient(90deg,var(--emphasis-strong),var(--emphasis));
    transition:width 1.1s cubic-bezier(.2,.7,.2,1)}
  .fill.go{}

  /* ---- Tools section ---- */
  section{margin-bottom:24px}
  .h2{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:var(--faint);margin:0 0 12px 2px}
  ul.tools{list-style:none;margin:0;padding:0;overflow:hidden;
    border:1px solid var(--border);border-radius:var(--r-lg);background:var(--surface);
    box-shadow:var(--shadow-sm)}
  .tool{display:grid;grid-template-columns:10px 1fr auto auto;align-items:center;
    gap:14px;padding:14px 18px;font-size:14px;border-top:1px solid var(--border)}
  .tool:first-child{border-top:0}
  .tool .dot{width:9px;height:9px;border-radius:50%;background:var(--off)}
  .tool.on .dot{background:var(--emphasis);
    box-shadow:0 0 0 4px color-mix(in srgb,var(--emphasis) 18%, transparent)}
  .tool .nm{font-weight:600;letter-spacing:-.01em}
  .tool .nm .ver{margin-left:7px;font-size:11px;font-weight:500;letter-spacing:0;
    color:var(--faint);font-variant-numeric:tabular-nums;font-family:var(--font-mono)}
  .tool .cat{font-size:11px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;
    color:var(--secondary-fg);background:var(--secondary);
    padding:3px 9px;border-radius:var(--r-full);justify-self:start}
  .tool .sig{display:inline-flex;gap:3px;align-items:flex-end;height:16px;justify-self:end}
  .tool .sig i{width:4px;height:6px;background:var(--off);border-radius:1px}
  .tool .sig i:nth-child(2){height:9px}
  .tool .sig i:nth-child(3){height:12px}
  .tool .sig i:nth-child(4){height:16px}
  .tool.on .sig i.on{background:var(--emphasis)}
  .tool .meta{grid-column:2 / -1;font-size:12px;color:var(--faint);
    font-variant-numeric:tabular-nums;display:flex;flex-wrap:wrap;
    align-items:center;justify-content:space-between;gap:4px 10px}
  .tool .meta .left{min-width:0}
  .tool.off{background:color-mix(in srgb,var(--bg) 55%, var(--surface))}
  .tool.off .nm{color:var(--faint);font-weight:500}
  .tool.off .cat{background:transparent;color:var(--faint);padding-left:0}

  /* ---- Recency badge (bucket derived from mtime, see scanner ADR-003) ---- */
  .recency{flex:none;font-size:10px;font-weight:600;letter-spacing:.04em;
    text-transform:uppercase;padding:2px 8px;border-radius:var(--r-full);
    white-space:nowrap}
  .recency.today,.recency.this_week{background:var(--secondary);color:var(--secondary-fg)}
  .recency.this_month{background:var(--track);color:var(--muted)}
  .recency.this_quarter{background:var(--track);color:var(--faint)}
  .recency.stale{background:color-mix(in srgb,var(--accent-lime) 32%, transparent);
    color:var(--accent-lime-fg)}

  /* ---- Environment ---- */
  .env{padding:20px 22px;display:flex;flex-wrap:wrap;gap:20px 36px;align-items:flex-start}
  .env-grid{display:flex;flex-wrap:wrap;gap:18px 32px}
  .env-item{display:flex;flex-direction:column;gap:4px;min-width:100px}
  .env-item .k{font-size:11px;font-weight:600;letter-spacing:.05em;
    text-transform:uppercase;color:var(--faint)}
  .env-item .v{font-size:14px;font-weight:600;color:var(--fg);
    font-variant-numeric:tabular-nums}
  .env-editors{display:flex;flex-direction:column;gap:8px;flex:1;min-width:200px}
  .env-editors .k{font-size:11px;font-weight:600;letter-spacing:.05em;
    text-transform:uppercase;color:var(--faint)}
  /* Layout-audit fix (talents-ai-score): chips must never shrink to fit —
     without flex:none + white-space:nowrap, a flex row squeezed for space
     would shrink each chip below its content's width and wrap its text
     onto two lines inside the pill ("descuadre"). The row itself already
     wraps as whole units via .chips{flex-wrap:wrap}; individual chips
     just don't get squashed anymore. Same principle as the agent-card
     width-stability fix (flex:0 0 <fixed>) applied at the chip level. */
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:11px;font-weight:500;letter-spacing:.02em;color:var(--secondary-fg);
    background:var(--secondary);padding:3px 10px;border-radius:var(--r-full);
    flex:none;white-space:nowrap}
  .chip.empty{background:transparent;color:var(--faint);padding-left:0}

  /* ---- Project technologies (talents-ai-score, ADR-012) ---- */
  .tech-empty{padding:18px 20px;color:var(--faint);font-size:13px}
  .chips-card{padding:16px 18px}

  /* ---- MCP servers by name (talents-ai-score, issue 015) ----
   * Same list-card pattern as ul.tools below (fixed non-shrinking badge +
   * a flexible, wrappable name), not a card grid — a flat list has no
   * nesting-depth to fight over width, so no dedicated fixed-width rule
   * is needed here (unlike .agent-node). */
  ul.mcp-list{list-style:none;margin:0;padding:0;overflow:hidden;
    border:1px solid var(--border);border-radius:var(--r-lg);background:var(--surface);
    box-shadow:var(--shadow-sm)}
  .mcp-row{display:flex;align-items:center;justify-content:space-between;
    flex-wrap:wrap;gap:8px 14px;padding:14px 18px;font-size:14px;
    border-top:1px solid var(--border)}
  .mcp-row:first-child{border-top:0}
  .mcp-name{font-weight:600;letter-spacing:-.01em;min-width:0;word-break:break-word}
  .mcp-category{flex:none;white-space:nowrap;font-size:11px;font-weight:500;
    letter-spacing:.04em;text-transform:uppercase;color:var(--secondary-fg);
    background:var(--secondary);padding:3px 9px;border-radius:var(--r-full)}

  /* ---- Projects per AI tool (skill-code-certification / ADR-011) ---- */
  .tu-intro{margin:-4px 2px 14px;font-size:13px;color:var(--faint);line-height:1.5}
  .tu-card{padding:14px 18px;margin-bottom:10px}
  .tu-tool{font-weight:600;letter-spacing:-.01em;font-size:14px;margin-bottom:8px}
  .tu-source{font-weight:500;font-size:12px;color:var(--faint)}
  .tu-count{font-size:12px;color:var(--faint);margin-bottom:8px}
  .tu-note{font-size:13px;color:var(--faint);font-style:italic}
  ul.tu-projects{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
  ul.tu-projects li{font-size:13px;word-break:break-all}
  ul.tu-projects code{font-family:var(--font-mono);font-size:12px}
  .tu-approx{color:var(--faint);font-style:italic}

  /* ---- Agent cards: hierarchical role-card tree (talents-ai-score) ----
   * Plain HTML/CSS: no vendored library, no script, zero-network by
   * construction. Generous padding/font sizes throughout - legibility over
   * compactness. Hierarchy is VISUAL (indentation + rail connector), not a
   * text line: the root's direct children sit in a responsive grid (scales
   * well for "many siblings, no depth" - the common case, since most real
   * agent-config setups declare no parent); any card with its own
   * children gets them nested directly beneath it, indented and rail-
   * connected (scales well for real depth, the rarer explicit-parent
   * case). Cards never shrink to fit - the container just grows/scrolls. */
  .diagram-fallback{padding:18px 20px;color:var(--faint);font-size:13px}
  .agent-root-header{display:inline-flex;align-items:center;font-size:13px;
    font-weight:600;letter-spacing:.04em;text-transform:uppercase;
    color:var(--secondary-fg);background:var(--secondary);
    padding:8px 18px;border-radius:var(--r-full);margin-bottom:18px}
  /* Width/depth decoupling fix: cards were collapsing (title wrapping,
     one-word-per-line text, chips stacking) the deeper they nested, because
     each level's indentation (.agent-children's margin/padding-left) ate
     into a card width that had no floor of its own (.agent-node had
     min-width:0 and no explicit size, so it just shrank to whatever space
     indentation left behind). Fix: every .agent-node gets a FIXED width/
     flex-basis — indentation offsets the block sideways, it never resizes
     the card inside it. Both the root-level layout and the nested
     children layout are flex (not grid) precisely so this single fixed
     basis applies uniformly at every depth.

     Sibling-clip fix (talents-ai-score): the horizontal scroll used to live
     on .agent-tree, i.e. it wrapped BOTH the root sibling grid AND every
     nested subtree in one shared scroll canvas. A deep chain inflated that
     canvas' width, so the flex-wrap grid stopped wrapping against the
     VISIBLE width and the second root sibling clipped at the viewport edge
     (never wrapped, never scrolled cleanly). Fix: .agent-tree no longer
     scrolls — root siblings wrap freely and the page just grows taller.
     The horizontal scroll is scoped DOWN to each root node that owns a
     subtree (.agent-cards-grid>.agent-node.has-children): only genuinely
     deep nesting scrolls, and only within its own block, never dragging the
     wrappable siblings with it. */
  .agent-tree{padding-bottom:2px}
  .agent-cards-grid{display:flex;flex-wrap:wrap;align-items:flex-start;gap:18px}
  /* Base node width (used by NESTED nodes inside a subtree): fixed 400 so a
     deep chain keeps a stable, legible card width and scrolls sideways
     inside its owner's block rather than collapsing. */
  .agent-node{display:flex;flex-direction:column;gap:16px;
    flex:0 0 400px;width:400px}
  /* Narrow-viewport hardening (talents-ai-score responsive audit): ROOT
     cards (direct children of the grid — the common flat case, since most
     real agent setups declare no parent) must shrink to fit a narrow
     viewport instead of holding a fixed 400px that would spill past the
     right edge (and eat into the page padding) once the viewport drops
     toward ~400px and below. width:min(400px,100%) caps them at 400 on wide
     screens (they wrap, never stretch — grow:0) and lets them shrink to the
     available width on a phone. Nested nodes keep the fixed base above.
     Verified by real headless render at 320/360/375/520/780/1200px: no page
     overflow at any width. */
  .agent-cards-grid>.agent-node{flex:0 1 400px;width:min(400px,100%)}
  /* A root subtree owner spans its own row and is the ONLY horizontal-scroll
     viewport in the tree; its card is still capped at the fixed card width
     (see .agent-card max-width) so it doesn't stretch to the full row.
     min-width:0 makes the flex containment bulletproof: without it a flex
     item's automatic minimum size could let a very long unbreakable token
     inside the subtree push this scroll viewport (and thus the page) wider
     than 100%. */
  .agent-cards-grid>.agent-node.has-children{flex-basis:100%;width:100%;
    max-width:100%;min-width:0;overflow-x:auto;padding-bottom:6px}
  .agent-children{position:relative;margin-left:28px;padding-left:24px;
    border-left:2px dashed var(--border);display:flex;flex-direction:column;
    align-items:flex-start;gap:16px}
  .agent-children .agent-node{position:relative}
  .agent-children .agent-node::before{content:'';position:absolute;
    left:-24px;top:26px;width:24px;height:2px;background:var(--border)}
  .agent-card{background:var(--surface);border:1px solid var(--border);
    border-radius:var(--r-lg);box-shadow:var(--shadow-sm);
    padding:20px 22px;display:flex;flex-direction:column;gap:12px;
    width:100%;max-width:400px;box-sizing:border-box}
  .agent-card-head{display:flex;align-items:flex-start;justify-content:space-between;
    gap:10px}
  .agent-title{font-size:18px;font-weight:700;letter-spacing:-.01em;line-height:1.3}
  .agent-badge{flex:none;font-size:11px;font-weight:600;letter-spacing:.02em;
    color:var(--faint);font-family:var(--font-mono);background:var(--track);
    padding:4px 10px;border-radius:var(--r-full);white-space:nowrap}
  .agent-phrase{margin:0;font-size:14px;font-style:italic;line-height:1.5;
    color:var(--muted)}
  .agent-chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;
    font-weight:500;color:var(--secondary-fg);background:var(--secondary);
    padding:5px 12px;border-radius:var(--r-full)}
  .chip.pill .dot{width:7px;height:7px;border-radius:50%;background:var(--emphasis);
    flex:none}
  .chip.pill.model{color:var(--model-fg);background:var(--model-bg)}
  .chip.pill.model .dot{background:var(--model-fg)}

  /* ---- Next step (lime accent = momentum) ---- */
  .next{padding:22px 24px;border-left:4px solid var(--accent-lime);
    display:flex;gap:16px;align-items:flex-start}
  .next .icon{flex:none;width:36px;height:36px;border-radius:var(--r-md);
    background:var(--accent-lime);color:var(--accent-lime-fg);
    display:grid;place-items:center;font-size:18px;font-weight:700}
  .next .k{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:var(--faint);margin-bottom:6px}
  .next .t{font-size:16px;line-height:1.5;color:var(--fg)}

  /* ---- Tier analysis: why this tier (talents-ai-score) ----
   * Deterministic, mechanical breakdown (src/tier-analysis.js) — same card
   * shape as the roadmap below (analogous "analytical defense" vs.
   * "what's next" framing), teal accent instead of lime to distinguish it
   * from the roadmap's momentum framing. */
  .tier-analysis-card{padding:26px 28px;display:flex;flex-direction:column;
    gap:16px;border-left:4px solid var(--emphasis)}
  .tier-analysis-intro{margin:0;font-size:14.5px;line-height:1.65;color:var(--fg)}
  .tier-analysis-block{display:flex;flex-direction:column;gap:10px}
  .tier-analysis-met-label,.tier-analysis-blocking-label{font-size:12px;
    font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
  .tier-analysis-list{margin:0;padding-left:20px;display:flex;flex-direction:column;
    gap:8px;font-size:14px;line-height:1.55;color:var(--muted)}
  .tier-analysis-blocking{display:flex;flex-direction:column;gap:8px;
    padding:16px 18px;border-radius:var(--r-md);
    background:color-mix(in srgb,var(--accent-lime) 16%, transparent)}
  .tier-analysis-blocking-text{margin:0;font-size:14.5px;line-height:1.6;
    color:var(--fg);font-weight:500}
  .tier-analysis-maxtier{margin:0;font-size:14.5px;line-height:1.6;color:var(--fg)}

  /* ---- Tier roadmap: current -> next (talents-ai-score, issue 020) ---- */
  .roadmap-card{padding:26px 28px;display:flex;flex-direction:column;gap:18px;
    border-left:4px solid var(--accent-lime)}
  .roadmap-unavailable{margin:0;font-size:14px;line-height:1.6;color:var(--muted)}
  .roadmap-personalized{margin:0;font-size:12.5px;font-style:italic;color:var(--emphasis-strong)}
  .roadmap-title{margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em;color:var(--fg)}
  .roadmap-upgrade-when{font-size:14px;color:var(--muted);line-height:1.5}
  .roadmap-upgrade-when b{color:var(--fg)}
  .roadmap-block{display:flex;flex-direction:column;gap:8px}
  .roadmap-block-label{font-size:12px;font-weight:600;letter-spacing:.06em;
    text-transform:uppercase;color:var(--faint)}
  .roadmap-unlocks,.roadmap-intro,.roadmap-what-remains,.roadmap-honesty{
    margin:0;font-size:14px;line-height:1.6;color:var(--fg)}
  .roadmap-list{margin:0;padding-left:20px;display:flex;flex-direction:column;
    gap:8px;font-size:14px;line-height:1.5;color:var(--muted)}
  .roadmap-steps li{display:flex;flex-wrap:wrap;align-items:baseline;
    justify-content:space-between;gap:4px 12px}
  .roadmap-step-estimate{flex:none;font-size:12px;font-family:var(--font-mono);
    color:var(--faint);white-space:nowrap}
  .roadmap-snippet-desc{margin:0;font-size:14px;color:var(--muted)}
  .roadmap-snippet-filename{font-size:12px;font-family:var(--font-mono);
    color:var(--faint);margin-top:6px}
  .roadmap-code{background:var(--bg);border:1px solid var(--border);
    border-radius:var(--r-md);padding:14px;overflow:auto;
    font-family:var(--font-mono);font-size:12.5px;line-height:1.5;
    color:var(--muted);margin:4px 0 0}

  /* ---- Copyable implementation prompt (talents-ai-score) ----
   * Same pre-tag pattern as .roadmap-code above (legible, monospace,
   * manually selectable), plus a Copy button (inline JS, zero-network —
   * see the bottom <script>) for one-click copying, with a distinct
   * border accent so this card reads as its own, primary call to action
   * rather than another curated-content block. */
  .roadmap-prompt-block{border-top:1px dashed var(--border);padding-top:16px}
  .roadmap-prompt-head{display:flex;align-items:center;justify-content:space-between;
    gap:12px;margin-bottom:2px}
  .roadmap-prompt-head .roadmap-block-label{margin:0}
  .roadmap-prompt-copy{flex:none;font-family:var(--font-sans);font-size:12px;
    font-weight:600;letter-spacing:.02em;color:var(--secondary-fg);
    background:var(--secondary);border:1px solid transparent;
    padding:5px 12px;border-radius:var(--r-full);cursor:pointer}
  .roadmap-prompt-copy:hover{background:var(--track)}
  .roadmap-prompt-copy.copied{color:var(--accent-lime-fg);
    background:color-mix(in srgb,var(--accent-lime) 28%, transparent)}
  .roadmap-prompt-hint{margin:0 0 8px;font-size:13px;color:var(--muted)}
  .roadmap-prompt-code{background:var(--bg);border:1px solid var(--emphasis);
    border-radius:var(--r-md);padding:14px;overflow:auto;white-space:pre-wrap;
    word-break:break-word;font-family:var(--font-mono);font-size:12.5px;
    line-height:1.55;color:var(--fg);margin:0}

  /* ---- Footer ---- */
  footer{margin-top:28px;color:var(--faint);font-size:12.5px;line-height:1.55}
  .priv{display:flex;gap:12px;padding:16px 18px;border-radius:var(--r-lg);
    background:var(--secondary);color:var(--secondary-fg);margin-bottom:16px}
  .priv .lock{flex:none;font-size:16px;line-height:1.4}
  .meta-line{font-family:var(--font-mono);font-size:11.5px}
  .meta-line code{color:var(--emphasis-strong);font-weight:600}
  details{margin-top:14px}
  details summary{cursor:pointer;color:var(--muted);font-weight:500;
    padding:8px 0;user-select:none}
  details summary:hover{color:var(--fg)}
  pre{background:var(--bg);border:1px solid var(--border);border-radius:var(--r-md);
    padding:14px;overflow:auto;font-family:var(--font-mono);font-size:11.5px;
    color:var(--muted);max-height:300px}

  a:focus-visible,summary:focus-visible{outline:2px solid var(--ring);outline-offset:2px}

  @media (max-width:520px){
    .tool{grid-template-columns:10px 1fr auto;gap:10px}
    .tool .sig{display:none}
    .hero{padding:22px}
  }

  /* Subtle animations (disabled with reduced-motion) */
  ul.tools .tool{opacity:0;transform:translateY(6px);animation:rise .45s forwards}
  @keyframes rise{to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){
    .fill{transition:none}
    ul.tools .tool{animation:none;opacity:1;transform:none}
  }
`;

// Footprint animations only: fill meters grow from 0, tool rows stagger in.
// Clipboard copy is provided globally by report-theme's COPY_SCRIPT.
const FOOTPRINT_SCRIPT = `
  requestAnimationFrame(function(){
    document.querySelectorAll('.fill').forEach(function(f){
      f.classList.add('go');
      f.style.width = (f.getAttribute('data-target') || '0') + '%';
    });
    document.querySelectorAll('ul.tools .tool').forEach(function(el, i){
      el.style.animationDelay = (i * 40) + 'ms';
    });
  });
`;

// Header banner — standalone footprint document only. The cumulative report
// (src/report-store.js) renders its own single header, so it does NOT call this.
function footprintHeaderHtml(t) {
  return `<header>
    <span class="badge"><span class="spark"></span>AI FOOTPRINT</span>
    <h1>${esc(t.html.h1)}</h1>
    <p class="sub">${esc(t.html.sub)}</p>
  </header>`;
}

// Inner sections (hero + tools + env + technologies + mcp + agents + tier +
// roadmap), no header banner and no footer. Reused verbatim by BOTH the
// standalone renderHtml below and the cumulative report, so a project's
// footprint looks identical whichever document it lands in.
function footprintSectionsHtml(report, maturity, lang) {
  const t = getCatalog(lang);
  const detectedTools = report.tools.filter((tool) => tool.detected);
  const rows = detectedTools.map((tool) => toolRow(tool, t, lang)).join('\n');
  const detectedCount = detectedTools.length;
  const levelName = t.levelNames[maturity.key] || maturity.name;

  const env = report.environment || {};
  const editors = Array.isArray(env.editorsInstalled) ? env.editorsInstalled : [];
  const editorChips = editors.length
    ? editors.map((id) => `<span class="chip">${esc(id)}</span>`).join('')
    : `<span class="chip empty">${esc(t.html.noEditorsDetected)}</span>`;

  const levelPips = Array.from({ length: 5 }, (_, i) => {
    const cls = i < maturity.level ? 'done' : (i === maturity.level ? 'here' : '');
    return `<span class="pip ${cls}"></span>`;
  }).join('');

  return `<div class="card hero">
    <div class="lvl">
      <div class="k">${esc(t.html.levelOf(maturity.level))}</div>
      <div class="v">
        <span class="glyph">${maturity.emoji}</span>
        <span class="name">${esc(levelName)}</span>
      </div>
      <div class="pips">${levelPips}</div>
      <div class="count"><b>${detectedCount}</b> ${esc(t.html.detectedSuffix(report.tools.length))}</div>
    </div>
    <div class="meter">
      <div class="top">
        <span>${esc(t.html.maturity)}</span>
        <span class="score">${maturity.score}<span> / 100</span></span>
      </div>
      <div class="track"><div class="fill" data-target="${maturity.score}"></div></div>
    </div>
  </div>

  <section>
    <div class="h2">${esc(t.html.tools)}</div>
    ${detectedTools.length
      ? `<ul class="tools">
      ${rows}
    </ul>`
      : `<div class="card tool-empty">${esc(t.html.toolsEmpty)}</div>`}
  </section>

  <section>
    <div class="h2">${esc(t.html.environment)}</div>
    <div class="card env">
      <div class="env-grid">
        <div class="env-item"><span class="k">${esc(t.html.platform)}</span><span class="v">${esc(env.platform ?? '—')}</span></div>
        <div class="env-item"><span class="k">${esc(t.html.architecture)}</span><span class="v">${esc(env.arch ?? '—')}</span></div>
        <div class="env-item"><span class="k">Node</span><span class="v">${esc(env.nodeVersion ?? '—')}</span></div>
      </div>
      <div class="env-editors">
        <span class="k">${esc(t.html.installedEditors)}</span>
        <div class="chips">${editorChips}</div>
      </div>
    </div>
  </section>

  ${technologiesSection(report, t)}

  ${mcpSection(report, t)}

  ${toolProjectUsageSection(report, t)}

  ${agentCardsSection(report, t)}

  ${tierAnalysisSection(report, t)}

  ${roadmapSection(report, maturity, t, lang)}`;
}

// Footer (privacy note + meta line + raw-data disclosure) — standalone
// footprint document only, same as the header banner.
function footprintFooterHtml(report, maturity, t) {
  const dataJson = esc(JSON.stringify({ report, maturity }, null, 2));
  return `<footer>
    <div class="priv">
      <span class="lock" aria-hidden="true">🔒</span>
      <span>${esc(t.html.privacyNote)}</span>
    </div>
    <div class="meta-line">${t.html.metaLine(esc(new Date(report.generatedAt).toLocaleString()), esc(report.anonId), esc(report.platform))}</div>
    <details>
      <summary>${esc(t.html.rawData)}</summary>
      <pre>${dataJson}</pre>
    </details>
  </footer>`;
}

// `lang` ('es'|'en', see src/i18n.js) decides the text catalog. The report
// data (report/maturity) doesn't change with the language, only its copy.
function renderHtml(report, maturity, lang) {
  const t = getCatalog(lang);
  const body = `${footprintHeaderHtml(t)}

  ${footprintSectionsHtml(report, maturity, lang)}

  ${footprintFooterHtml(report, maturity, t)}`;

  return renderDocument({
    lang: t.html.lang,
    title: t.html.title(maturity.level),
    componentCss: FOOTPRINT_CSS,
    body,
    script: FOOTPRINT_SCRIPT,
  });
}

// buildAgentCardTree is also exported (not just renderHtml): render-terminal.js
// reuses it so the terminal's agent list/hierarchy is built from the EXACT
// same merged (structural + synthesis) tree as the HTML card tree. And
// footprintSectionsHtml / FOOTPRINT_CSS are exported for the cumulative report
// (src/report-store.js) to embed a project's footprint into the shared doc.
module.exports = { renderHtml, buildAgentCardTree, footprintSectionsHtml, FOOTPRINT_CSS, FOOTPRINT_SCRIPT };
