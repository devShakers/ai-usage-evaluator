'use strict';

const { getCatalog, categoryLabel } = require('./i18n');
const { getRoadmapEntry } = require('./roadmap-content');

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

// Merges the structural org chart (ADR-009: name/tools/model/parent —
// always available, deterministic) with the ephemeral synthesis result
// (ADR-010: symbolicName/whatItDoes — optional, per-run), keyed by name,
// then groups by parent (dangling/self/missing parent references fall back
// to the implicit root, same defensive rule the retired org-chart tree
// used). This module never reads `description` from anywhere.
function buildAgentCardTree(report) {
  const agents = Array.isArray(report.agents) ? report.agents : [];
  const synthesisAgents =
    report.agentSynthesis && Array.isArray(report.agentSynthesis.agents) ? report.agentSynthesis.agents : [];
  const synthesisByName = new Map(synthesisAgents.map((a) => [a.name, a]));
  const byName = new Set(agents.map((a) => a.name));

  const cards = agents.map((a) => {
    const synth = synthesisByName.get(a.name);
    const parentKey = a.parent && byName.has(a.parent) && a.parent !== a.name ? a.parent : null;
    return {
      name: a.name,
      symbolicName: synth && synth.symbolicName ? synth.symbolicName : null,
      whatItDoes: synth && synth.whatItDoes ? synth.whatItDoes : null,
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || null,
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
  const { childrenByParent, roots } = buildAgentCardTree(report);
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

function roadmapPendingNotice(entry, t) {
  return entry.pendingTranslation
    ? `<p class="roadmap-pending">${esc(t.html.roadmapPendingTranslation)}</p>`
    : '';
}

function roadmapTerminalHtml(entry, t) {
  return `<div class="card roadmap-card">
    ${roadmapPendingNotice(entry, t)}
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
  </div>`;
}

function roadmapJumpHtml(entry, t) {
  return `<div class="card roadmap-card">
    ${roadmapPendingNotice(entry, t)}
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
  </div>`;
}

// `maturity.tierKey` may be absent (an older maturity shape, pre-issue-019)
// or unrecognized — degrades to nothing rendered rather than throwing or
// inventing a tier.
function roadmapSection(maturity, t, lang) {
  const tierKey = maturity && maturity.tierKey;
  if (!tierKey) return '';
  const entry = getRoadmapEntry(tierKey, lang);
  if (!entry) return '';

  const body = entry.maxTier ? roadmapTerminalHtml(entry, t) : roadmapJumpHtml(entry, t);
  return `<section>
    <div class="h2">${esc(t.html.roadmapHeading)}</div>
    ${body}
  </section>`;
}

function toolRow(tool, t, lang) {
  const category = categoryLabel(lang, tool.category);
  if (!tool.detected) {
    return `<li class="tool off">
      <span class="dot" aria-hidden="true"></span>
      <span class="nm">${esc(tool.name)}</span>
      <span class="cat">${esc(category)}</span>
      <span class="sig" aria-hidden="true"></span>
      <span class="meta">${esc(t.html.notDetected)}</span>
    </li>`;
  }
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

// `lang` ('es'|'en', see src/i18n.js) decides the text catalog. The report
// data (report/maturity) doesn't change with the language, only its copy.
function renderHtml(report, maturity, lang) {
  const t = getCatalog(lang);
  const rows = report.tools
    .slice()
    .sort((a, b) => Number(b.detected) - Number(a.detected))
    .map((tool) => toolRow(tool, t, lang))
    .join('\n');

  const detectedCount = report.tools.filter((tool) => tool.detected).length;
  const dataJson = esc(JSON.stringify({ report, maturity }, null, 2));

  const levelName = t.levelNames[maturity.key] || maturity.name;

  // Environment block: new scanner field, optional for compatibility with
  // reports generated before this field existed (report.environment absent).
  const env = report.environment || {};
  const editors = Array.isArray(env.editorsInstalled) ? env.editorsInstalled : [];
  const editorChips = editors.length
    ? editors.map((id) => `<span class="chip">${esc(id)}</span>`).join('')
    : `<span class="chip empty">${esc(t.html.noEditorsDetected)}</span>`;

  // 0..4 level scale for the step progress indicator.
  const levelPips = Array.from({ length: 5 }, (_, i) => {
    const cls = i < maturity.level ? 'done' : (i === maturity.level ? 'here' : '');
    return `<span class="pip ${cls}"></span>`;
  }).join('');

  return `<!doctype html>
<html lang="${t.html.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.html.title(maturity.level))}</title>
<style>
  /* =========================================================
   * Shakers tokens (Nexia). Layer 1 (primitives) → Layer 2 (semantic).
   * Reimplemented inline: React components can't be imported into a static
   * HTML file, so we reincarnate the visual language, not the components.
   * Values are copied VERBATIM from the design system's design-spec
   * (tokens.css / DESIGN.md): teal/lime/zinc palette, radii 6/8/10/14px,
   * shadcn shadow set, Inter type scale (12/14/16/18/20/24/30/36).
   *
   * Intentional deviations from Nexia (documented, not drift):
   *  - lime is used as an "accent/momentum" role here. In Nexia, brand-lime
   *    is a primitive, NOT a Layer-2 semantic alias. This report is a public
   *    talent-facing artifact (not the Hub backoffice), and lime is a core
   *    Shakers brand accent, so it is lifted to a local accent role on
   *    purpose. Paired for WCAG AA in both themes (see --model-fg/--accent).
   *  - dark-theme --emphasis is teal-300 (not the light teal-500) so the
   *    brand green stays legible on the dark surface.
   * ========================================================= */
  :root{
    /* Layer 1 — brand primitives (subset used) */
    --ds-teal-50:#e2f2f0; --ds-teal-100:#c5e5e1; --ds-teal-300:#51b1a5;
    --ds-teal-400:#269787; --ds-teal-500:#0e7d69; --ds-teal-600:#0b5a4c;
    --ds-teal-700:#08473c; --ds-teal-800:#05342c; --ds-teal-900:#03211c;
    --ds-lime-200:#f5ff96; --ds-lime-500:#d8e637; --ds-lime-600:#b0bd2d;
    --ds-zinc-50:#fafafa; --ds-zinc-100:#f4f4f5; --ds-zinc-200:#e4e4e7;
    --ds-zinc-300:#d4d4d8; --ds-zinc-400:#a1a1aa; --ds-zinc-500:#71717a;
    --ds-zinc-600:#52525b; --ds-zinc-700:#3f3f46; --ds-zinc-800:#27272a; --ds-zinc-900:#18181b;
    --ds-zinc-950:#09090b; --ds-white:#ffffff;

    /* Radii ("Border Radius" frame) */
    --r-sm:6px; --r-md:8px; --r-lg:10px; --r-xl:14px; --r-full:9999px;
    /* Shadows (shadcn upstream, same light/dark set) */
    --shadow-sm:0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1);
    --shadow-md:0 1px 3px 0 rgb(0 0 0 / .1), 0 2px 4px -1px rgb(0 0 0 / .1);
    --shadow-lg:0 1px 3px 0 rgb(0 0 0 / .1), 0 4px 6px -1px rgb(0 0 0 / .1);

    /* Inter typography with a system fallback (see the DRIFT note). No
       @font-face or network: if Inter isn't installed, it degrades to the
       DS's own stack. */
    --font-sans:"Inter",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,
      "Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif,
      "Apple Color Emoji","Segoe UI Emoji";
    --font-mono:ui-monospace,"SF Mono","Cascadia Code","JetBrains Mono",Menlo,Consolas,monospace;

    /* Layer 2 — semantic (light theme, Nexia default) */
    --bg:var(--ds-zinc-50);
    --surface:var(--ds-white);
    --fg:var(--ds-zinc-900);
    --muted:var(--ds-zinc-700);
    /* zinc-600, not zinc-500: caption/label text sits on the zinc-50 page bg,
       where zinc-500 is 4.47:1 — just under WCAG AA (4.5:1). zinc-600 clears
       AA (~7.4:1) on both the page bg and the white card surface. */
    --faint:var(--ds-zinc-600);
    --border:var(--ds-zinc-200);
    --primary:var(--ds-teal-800);
    --primary-fg:var(--ds-zinc-50);
    --secondary:var(--ds-teal-50);
    --secondary-fg:var(--ds-teal-600);
    --emphasis:var(--ds-teal-500);
    --emphasis-strong:var(--ds-teal-600);
    --accent-lime:var(--ds-lime-500);
    --accent-lime-fg:var(--ds-teal-800);
    /* Model chip: an opaque lime tint over the surface (not a transparent
       overlay), paired with a theme-aware foreground so it clears contrast
       in BOTH themes. In light, dark teal text on a pale lime tint. */
    --model-bg:color-mix(in srgb,var(--ds-lime-500) 26%, var(--surface));
    --model-fg:var(--ds-teal-800);
    --off:var(--ds-zinc-300);
    --track:var(--ds-zinc-100);
    --ring:var(--ds-teal-500);
  }

  @media (prefers-color-scheme: dark){
    :root{
      --bg:var(--ds-zinc-950);
      --surface:var(--ds-zinc-900);
      --fg:var(--ds-zinc-50);
      --muted:var(--ds-zinc-300);
      --faint:var(--ds-zinc-400);
      --border:var(--ds-zinc-800);
      --primary:var(--ds-teal-600);
      --primary-fg:var(--ds-zinc-50);
      --secondary:var(--ds-teal-900);
      --secondary-fg:var(--ds-teal-50);
      --emphasis:var(--ds-teal-300);
      --emphasis-strong:var(--ds-teal-400);
      --accent-lime:var(--ds-lime-200);
      --accent-lime-fg:var(--ds-teal-900);
      /* Dark: the light theme's dark-teal-on-pale-lime chip would be dark
         text on a dark surface (illegible). Flip to a bright lime foreground
         over a subtle lime tint of the dark surface. */
      --model-bg:color-mix(in srgb,var(--ds-lime-500) 20%, var(--surface));
      --model-fg:var(--ds-lime-200);
      --off:var(--ds-zinc-700);
      --track:var(--ds-zinc-800);
      --ring:var(--ds-teal-600);
    }
  }

  *{box-sizing:border-box}
  html{color-scheme:light dark}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:var(--font-sans);line-height:1.45;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
    padding:40px 20px 64px;}
  .wrap{max-width:840px;margin:0 auto}
  .card{background:var(--surface);border:1px solid var(--border);
    border-radius:var(--r-lg);box-shadow:var(--shadow-sm)}

  /* ---- Header ---- */
  header{margin-bottom:24px}
  .badge{display:inline-flex;align-items:center;gap:8px;
    background:var(--secondary);color:var(--secondary-fg);
    font-size:12px;font-weight:600;letter-spacing:.02em;
    padding:5px 12px;border-radius:var(--r-full)}
  .badge .spark{width:7px;height:7px;border-radius:50%;background:var(--emphasis)}
  h1{font-size:clamp(28px,5vw,36px);font-weight:700;letter-spacing:-.02em;
    line-height:1.15;margin:16px 0 6px}
  .sub{color:var(--muted);font-size:16px;margin:0}

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
  .fill.go{width:${maturity.score}%}

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
  .agent-node{display:flex;flex-direction:column;gap:16px;
    flex:0 0 328px;width:328px}
  /* A root subtree owner spans its own row and is the ONLY horizontal-scroll
     viewport in the tree; its card is still capped at the fixed card width
     (see .agent-card max-width) so it doesn't stretch to the full row. */
  .agent-cards-grid>.agent-node.has-children{flex-basis:100%;width:100%;
    max-width:100%;overflow-x:auto;padding-bottom:6px}
  .agent-children{position:relative;margin-left:28px;padding-left:24px;
    border-left:2px dashed var(--border);display:flex;flex-direction:column;
    align-items:flex-start;gap:16px}
  .agent-children .agent-node{position:relative}
  .agent-children .agent-node::before{content:'';position:absolute;
    left:-24px;top:26px;width:24px;height:2px;background:var(--border)}
  .agent-card{background:var(--surface);border:1px solid var(--border);
    border-radius:var(--r-lg);box-shadow:var(--shadow-sm);
    padding:20px 22px;display:flex;flex-direction:column;gap:12px;
    width:100%;max-width:328px;box-sizing:border-box}
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

  /* ---- Tier roadmap: current -> next (talents-ai-score, issue 020) ---- */
  .roadmap-card{padding:26px 28px;display:flex;flex-direction:column;gap:18px;
    border-left:4px solid var(--accent-lime)}
  .roadmap-pending{margin:0;font-size:12.5px;font-style:italic;color:var(--faint)}
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
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="badge"><span class="spark"></span>AI FOOTPRINT</span>
    <h1>${esc(t.html.h1)}</h1>
    <p class="sub">${esc(t.html.sub)}</p>
  </header>

  <div class="card hero">
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
      <div class="track"><div class="fill" id="fill"></div></div>
    </div>
  </div>

  <section>
    <div class="h2">${esc(t.html.tools)}</div>
    <ul class="tools">
      ${rows}
    </ul>
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

  ${agentCardsSection(report, t)}

  ${roadmapSection(maturity, t, lang)}

  <footer>
    <div class="priv">
      <span class="lock" aria-hidden="true">🔒</span>
      <span>${esc(t.html.privacyNote)}</span>
    </div>
    <div class="meta-line">${t.html.metaLine(esc(new Date(report.generatedAt).toLocaleString()), esc(report.anonId), esc(report.platform))}</div>
    <details>
      <summary>${esc(t.html.rawData)}</summary>
      <pre>${dataJson}</pre>
    </details>
  </footer>
</div>
<script>
  requestAnimationFrame(function(){
    var f = document.getElementById('fill');
    if (f) f.classList.add('go');
    var rows = document.querySelectorAll('ul.tools .tool');
    rows.forEach(function(el,i){ el.style.animationDelay = (i*40)+'ms'; });
  });
</script>
</body>
</html>`;
}

// buildAgentCardTree is also exported (not just renderHtml): render-terminal.js
// reuses it so the terminal's agent list/hierarchy is built from the EXACT
// same merged (structural + synthesis) tree as the HTML card tree, instead
// of a second, potentially-diverging implementation — "same information",
// literally the same data structure, for both outputs.
module.exports = { renderHtml, buildAgentCardTree };
