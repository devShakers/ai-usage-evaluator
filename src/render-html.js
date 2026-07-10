'use strict';

const fs = require('fs');
const path = require('path');
const { getCatalog, categoryLabel } = require('./i18n');

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

/* ---------- agent org chart (talents-ai-score, ADR-009) ----------
 * Nodes = agents. Structure + names only (name, wired tools, model,
 * hierarchy) — the report never carries descriptions/prompts (see
 * src/agent-org-chart.js / src/share.js), so there's nothing here to
 * accidentally render beyond what the shape already whitelists.
 */

// Groups agents by their declared parent. Agents with no `parent`, or whose
// declared `parent` doesn't resolve to another known agent (defensive:
// never crash on a dangling reference), are treated as children of the
// implicit root orchestrator (bucket `null`).
function groupAgentsByParent(agents) {
  const byName = new Set(agents.map((a) => a.name));
  const childrenByParent = new Map();
  for (const agent of agents) {
    const parentKey = agent.parent && byName.has(agent.parent) ? agent.parent : null;
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey).push(agent);
  }
  return childrenByParent;
}

function agentToolChips(agent) {
  return (agent.tools || []).map((tool) => `<span class="chip">${esc(tool)}</span>`).join('');
}

function agentModelChip(agent, t) {
  if (!agent.model) return '';
  return `<span class="chip model" title="${esc(t.html.orgChartModelLabel)}">${esc(agent.model)}</span>`;
}

function agentNode(agent, childrenByParent, t) {
  const children = childrenByParent.get(agent.name) || [];
  const childrenHtml = children.length
    ? `<ul class="org-children">${children.map((c) => agentNode(c, childrenByParent, t)).join('')}</ul>`
    : '';
  return `<li class="org-node">
    <div class="org-card">
      <span class="org-name">${esc(agent.name)}</span>
      <div class="org-meta">${agentModelChip(agent, t)}${agentToolChips(agent)}</div>
    </div>
    ${childrenHtml}
  </li>`;
}

// `report.agents` is optional for compatibility with reports generated
// before ADR-009 (agents field absent) — renders the empty state instead of
// throwing.
function orgChartSection(report, t) {
  const agents = Array.isArray(report.agents) ? report.agents : [];
  if (!agents.length) {
    return `<section>
    <div class="h2">${esc(t.html.orgChartHeading)}</div>
    <div class="card org-empty">${esc(t.html.orgChartEmpty)}</div>
  </section>`;
  }
  const childrenByParent = groupAgentsByParent(agents);
  const roots = childrenByParent.get(null) || [];
  return `<section>
    <div class="h2">${esc(t.html.orgChartHeading)}</div>
    <ul class="org-tree">
      ${roots.map((agent) => agentNode(agent, childrenByParent, t)).join('\n')}
    </ul>
  </section>`;
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

/* ---------- agent diagram: Mermaid, inline, zero-network (ADR-010/011) ----------
 * Rendered ONLY when the ephemeral agent-synthesis call succeeded this run
 * (`report.agentSynthesis`, attached by bin/report.js — never computed
 * here). On failure/timeout/invalid response, bin/report.js simply doesn't
 * attach it and this section shows a short fallback note instead — the
 * deterministic org chart (ADR-009) is already its own section above, so
 * the fallback doesn't duplicate it.
 *
 * mermaid.js is vendored (vendor/mermaid.min.js, see vendor/README.md) and
 * inlined VERBATIM into a <script> tag so the resulting report.html makes
 * ZERO network calls — the same invariant every other part of this report
 * upholds. Deliberately only inlined when a diagram actually needs
 * rendering (fallback runs stay lightweight, no ~3.2MB payload for nothing).
 */

let cachedMermaidLib = null;
function readMermaidVendorLib() {
  if (cachedMermaidLib !== null) return cachedMermaidLib;
  try {
    cachedMermaidLib = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'mermaid.min.js'), 'utf8');
  } catch {
    cachedMermaidLib = ''; // vendor file missing (e.g. a stripped install) — degrade, never throw
  }
  return cachedMermaidLib;
}

// Mermaid node ids must be valid identifiers; agent `name` is free-ish text
// (kebab-case in practice, but not guaranteed), so it's sanitized into a
// safe id and the human-readable text goes in the node's label instead.
function mermaidNodeId(name) {
  return 'agent_' + String(name).replace(/[^A-Za-z0-9_]/g, '_');
}

// Builds Mermaid flowchart SOURCE TEXT (not HTML) from the synthesis
// result. This is embedded inside an `esc()`-escaped <pre class="mermaid">
// element below — the browser's `.textContent` decodes it back to the raw
// source Mermaid expects, the same pattern already used for the raw-JSON
// debug dump in this file.
function buildMermaidSource(synthesis) {
  const agents = Array.isArray(synthesis.agents) ? synthesis.agents : [];
  const edges = Array.isArray(synthesis.edges) ? synthesis.edges : [];
  const lines = ['flowchart TD'];
  for (const a of agents) {
    const label = `${a.symbolicName || a.name}<br/>${(a.whatItDoes || '').replace(/"/g, "'")}`.replace(/"/g, "'");
    lines.push(`  ${mermaidNodeId(a.name)}["${label}"]`);
  }
  for (const e of edges) {
    lines.push(`  ${mermaidNodeId(e.from)} --> ${mermaidNodeId(e.to)}`);
  }
  return lines.join('\n');
}

function diagramSection(report, t) {
  const synthesis = report.agentSynthesis;
  const hasSynthesis = synthesis && Array.isArray(synthesis.agents) && synthesis.agents.length > 0;

  if (!hasSynthesis) {
    return `<section>
    <div class="h2">${esc(t.html.diagramHeading)}</div>
    <div class="card diagram-fallback">${esc(t.html.diagramFallbackNote)}</div>
  </section>`;
  }

  const mermaidSource = buildMermaidSource(synthesis);
  const mermaidLib = readMermaidVendorLib();
  return `<section>
    <div class="h2">${esc(t.html.diagramHeading)}</div>
    <div class="card diagram-wrap">
      <pre class="mermaid">${esc(mermaidSource)}</pre>
    </div>
  </section>
  <script>${mermaidLib}</script>
  <script>
    if (window.mermaid) { mermaid.initialize({ startOnLoad: true, securityLevel: 'strict' }); }
  </script>`;
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
  const nextStep = t.nextSteps[maturity.level] || maturity.next;

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
   * ========================================================= */
  :root{
    /* Layer 1 — brand primitives (subset used) */
    --ds-teal-50:#e2f2f0; --ds-teal-100:#c5e5e1; --ds-teal-300:#51b1a5;
    --ds-teal-400:#269787; --ds-teal-500:#0e7d69; --ds-teal-600:#0b5a4c;
    --ds-teal-700:#08473c; --ds-teal-800:#05342c; --ds-teal-900:#03211c;
    --ds-lime-200:#f5ff96; --ds-lime-500:#d8e637; --ds-lime-600:#b0bd2d;
    --ds-zinc-50:#fafafa; --ds-zinc-100:#f4f4f5; --ds-zinc-200:#e4e4e7;
    --ds-zinc-300:#d4d4d8; --ds-zinc-400:#a1a1aa; --ds-zinc-500:#71717a;
    --ds-zinc-700:#3f3f46; --ds-zinc-800:#27272a; --ds-zinc-900:#18181b;
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
    --faint:var(--ds-zinc-500);
    --border:var(--ds-zinc-200);
    --primary:var(--ds-teal-800);
    --primary-fg:var(--ds-zinc-50);
    --secondary:var(--ds-teal-50);
    --secondary-fg:var(--ds-teal-600);
    --emphasis:var(--ds-teal-500);
    --emphasis-strong:var(--ds-teal-600);
    --accent-lime:var(--ds-lime-500);
    --accent-lime-fg:var(--ds-teal-800);
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
  .sub{color:var(--muted);font-size:15px;margin:0}

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
    font-size:13px;color:var(--muted);margin-bottom:10px}
  .meter .top .score{font-size:22px;font-weight:700;color:var(--fg);
    font-variant-numeric:tabular-nums}
  .meter .top .score span{font-size:13px;font-weight:500;color:var(--faint)}
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
  .tool .meta{grid-column:2 / -1;font-size:12.5px;color:var(--faint);
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
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:11px;font-weight:500;letter-spacing:.02em;color:var(--secondary-fg);
    background:var(--secondary);padding:3px 10px;border-radius:var(--r-full)}
  .chip.empty{background:transparent;color:var(--faint);padding-left:0}

  /* ---- Agent org chart (talents-ai-score, ADR-009) ---- */
  .org-empty{padding:18px 20px;color:var(--faint);font-size:13px}
  ul.org-tree{list-style:none;margin:0;padding:0}
  ul.org-children{list-style:none;margin:10px 0 0 22px;padding:12px 0 0 20px;
    border-left:2px dashed var(--border);display:flex;flex-direction:column;gap:10px}
  li.org-node{margin:0 0 10px}
  li.org-node:last-child{margin-bottom:0}
  .org-card{background:var(--surface);border:1px solid var(--border);
    border-radius:var(--r-md);box-shadow:var(--shadow-sm);
    padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
  .org-name{font-weight:600;letter-spacing:-.01em;font-size:14px}
  .org-meta{display:flex;flex-wrap:wrap;gap:6px}
  .chip.model{background:var(--track);color:var(--muted);font-family:var(--font-mono)}

  /* ---- Project technologies (talents-ai-score, ADR-012) ---- */
  .tech-empty{padding:18px 20px;color:var(--faint);font-size:13px}
  .chips-card{padding:16px 18px}

  /* ---- Agent diagram: Mermaid (talents-ai-score, ADR-010/011) ---- */
  .diagram-fallback{padding:18px 20px;color:var(--faint);font-size:13px}
  .diagram-wrap{padding:18px 20px;overflow:auto}
  pre.mermaid{background:transparent;border:0;padding:0;margin:0;
    color:inherit;font-family:inherit;white-space:normal;max-height:none}

  /* ---- Next step (lime accent = momentum) ---- */
  .next{padding:22px 24px;border-left:4px solid var(--accent-lime);
    display:flex;gap:16px;align-items:flex-start}
  .next .icon{flex:none;width:36px;height:36px;border-radius:var(--r-md);
    background:var(--accent-lime);color:var(--accent-lime-fg);
    display:grid;place-items:center;font-size:18px;font-weight:700}
  .next .k{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:var(--faint);margin-bottom:6px}
  .next .t{font-size:16px;line-height:1.5;color:var(--fg)}

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

  ${orgChartSection(report, t)}

  ${diagramSection(report, t)}

  <section>
    <div class="card next">
      <div class="icon" aria-hidden="true">→</div>
      <div>
        <div class="k">${esc(t.html.nextStep)}</div>
        <div class="t">${esc(nextStep)}</div>
      </div>
    </div>
  </section>

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

module.exports = { renderHtml };
