'use strict';

const fs = require('fs');
const path = require('path');
const { buildFootprintDrawer } = require('./graph-scan');
const { buildCertsPayload } = require('./graph-certs');
const { getCatalog, label } = require('./i18n');
const { sanitizeRenderText } = require('./sanitize-network-text');
const { isFloorCategory } = require('./agent-category');
const { stripTemplateComments } = require('./strip-internal-comments');
const { DEFAULT_REPORT_GATE } = require('./report-gating');
// 3x3 AI-Fluency matrix block (Usage axis persisted on the report).
const { renderAiFluencyMatrixHtml } = require('./render-ai-fluency');

// Rendered only when the Usage axis was judged and persisted on the report.
function aiFluencyHtml(report, lang) {
  const usage = report && report.aiFluencyUsage;
  if (!usage) return '';
  return `<div class="card reveal">${renderAiFluencyMatrixHtml({ status: 'ready', usage }, { lang })}</div>`;
}

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'report-sheet.html');
let _tpl = null;
// Issue 098: the template's comments are OURS and this document is the one the talent shares, so they are swept here — at load, before any talent data is in the string.
function template() {
  if (_tpl == null) _tpl = stripTemplateComments(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  return _tpl;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Literal, GLOBAL placeholder substitution.
function fill(tpl, token, value) {
  return tpl.split(token).join(value);
}

// Escapes a value for injection inside a single-quoted JS string literal in the template's inline <script>.
function jsStr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/</g, '\\u003c').replace(/\r?\n/g, ' ');
}

// Tier name, translated by STABLE KEY — same rule as render-terminal.js and render-html.js.
function tierName(fp, t) {
  const key = fp && fp.tier && fp.tier.key;
  return (key && key !== 'none' && t.tierNames && t.tierNames[key])
    || (fp && fp.tier && fp.tier.name) || '';
}

function bandClass(b) { return b === 'high' ? 'band-high' : b === 'mid' ? 'band-mid' : 'band-low'; }

// Localized Setup Level label from the drawer payload (ADR-016): prefer the
// i18n `setupLevels` catalog by key, fall back to the label baked into `fp`.
function setupLabel(fp, t) {
  const key = (fp.setup && fp.setup.key) || 'none';
  return (t && t.setupLevels && t.setupLevels[key] && t.setupLevels[key].label)
    || (fp.setup && fp.setup.label) || key;
}

function heroHtml(fp, c, t) {
  const rank = (fp.setup && typeof fp.setup.rank === 'number') ? fp.setup.rank : 0;
  const label = setupLabel(fp, t);
  // Four pips: Not certified + S1/S2/S3, current filled (ADR-016).
  const pills = Array.from({ length: 4 }, (_, i) => `<span class="${i <= rank ? 'on' : ''}"></span>`).join('');
  const chipK = esc(fp.tier.key && fp.tier.key !== 'none' ? fp.tier.key : (fp.setup && fp.setup.code) || '');
  return `<div class="card reveal">
    <div class="hero">
      <div class="ring" id="ring">
        <svg width="132" height="132" viewBox="0 0 132 132">
          <circle class="track" cx="66" cy="66" r="54"></circle>
          <circle class="fill" id="ringFill" cx="66" cy="66" r="54"></circle>
        </svg>
        <div class="num"><b id="scoreNum">0</b><small>/ 100</small></div>
      </div>
      <div class="hero-meta">
        <span class="tier-chip"><span class="k">${chipK}</span> ${esc(tierName(fp, t))}</span>
        <div class="band-line">${c.bandLine(esc(label))}</div>
        <div class="lvl-pills" title="S1–S3">${pills}</div>
      </div>
    </div>
  </div>`;
}

// The Setup Level ladder (ADR-016), with each rung's tiers and short meaning inline — meanings from the localized i18n `setupLevels` catalog (never invented).
function ladderHtml(fp, c, t) {
  const cur = (fp.setup && typeof fp.setup.rank === 'number') ? fp.setup.rank : 0;
  const catalog = (t && t.setupLevels) || {};
  const items = (fp.ladder || []).map((r) => {
    const cls = r.rank < cur ? 'done' : r.rank === cur ? 'current' : 'pending';
    const node = r.rank < cur ? '✓' : '';
    const copy = catalog[r.key] || {};
    const label = copy.label || r.label || r.key;
    // desc starts with the label prefix ("Assisted: …") — strip it so it isn't
    // doubled next to the name we already show.
    const meaning = (copy.desc || '').replace(/^[^:]+:\s*/, '');
    const here = r.rank === cur ? ` — ${esc(c.hereYouAre)}` : '';
    const line = meaning ? `<div class="desc">${esc(meaning)}${here}</div>` : (here ? `<div class="desc">${esc(c.hereYouAre)}</div>` : '');
    return `<li class="${cls}"><span class="node">${node}</span><span class="name">${esc(label)}</span>${line}</li>`;
  }).join('');
  return `<div class="card reveal"><h3>${esc(c.ladderT)}</h3><p class="sub">${esc(c.ladderS)}</p><ul class="ladder">${items}</ul></div>`;
}

function chipsCard(title, sub, items, withDot) {
  const chips = (items || []).map((x) => `<span class="chip">${withDot ? '<span class="d"></span>' : ''}${esc(x)}</span>`).join('');
  const body = chips || '<span class="chip" style="opacity:.6">—</span>';
  return `<div class="card reveal"><h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p><div class="chips">${body}</div></div>`;
}

// MCP SERVICES (issue 110).
function mcpCard(mcp, c) {
  const services = (mcp && Array.isArray(mcp.services) ? mcp.services : []);
  const unidentified = (mcp && typeof mcp.unidentified === 'number') ? mcp.unidentified : 0;
  if (services.length === 0 && unidentified === 0) {
    return `<div class="card reveal"><h3>${esc(c.mcpT)}</h3><p class="sub">${esc(c.mcpEmpty)}</p></div>`;
  }
  const chips = services
    .map((s) => `<span class="chip">${esc(s.label)}${s.count > 1 ? ` ×${s.count}` : ''}</span>`)
    .join('');
  // The unidentified servers are stated, never omitted: the list must account for
  // every server the tier counted.
  const note = unidentified > 0
    ? `<p class="sub" style="margin:8px 0 0">${esc(c.mcpUnidentified(unidentified))}</p>`
    : '';
  return `<div class="card reveal"><h3>${esc(c.mcpT)}</h3><p class="sub">${esc(c.mcpS)}</p><div class="chips">${chips}</div>${note}</div>`;
}

// DETECTED AGENTS, left column (issue 089).
function agentRow(a, c, t) {
  const cats = (t.classification && t.classification.categories) || {};
  const model = a.model ? `<span class="model">${esc(a.model)}</span>` : `<span class="model" style="opacity:.6">${esc(c.agentNoModel)}</span>`;
  // The category is the agent → catalog-seed association (per agent), not the Talent's tier.
  const catLabel = a.category ? (cats[a.category] || sanitizeRenderText(a.category)) : null;
  // ONE COLOUR PER CATEGORY (user request), and THREE distinct facts, not two: - a known catalog category -> its own colour token (`.cat-developer` …).
  // FOUR facts now, not three (issue 120).
  const coloured = !!(a.category && cats[a.category] && !isFloorCategory(a.category));
  const catClass = coloured ? `cat cat-${a.category}` : 'cat cat-none';
  // Issue 106: the empty badge says WHICH kind of empty it is.
  const cls = t.classification || {};
  const emptyLabel = a.evaluationState === 'omitted'
    ? cls.agentEvalOmitted
    : ((a.evaluationState === 'not-evaluated' || a.evaluated === false) ? c.agentNotEvaluated : c.agentNoCategory);
  const category = catLabel
    ? `<span class="chip ${catClass}">${esc(catLabel)}</span>`
    : `<span class="chip cat cat-none">${esc(emptyLabel)}</span>`;
  const orchestrates = a.hasChildren ? `<span class="usage">${esc(c.agentOrchestrates)}</span>` : '';
  const desc = a.whatItDoes ? `<p class="whatdo">${esc(a.whatItDoes)}</p>` : '';
  return `<li class="agent${a.depth > 0 ? ' child' : ''}">
      <div class="agent-row">
        <span class="an">${esc(a.name)}</span>
        ${model}
        <span class="spacer"></span>
        ${orchestrates}
        ${category}
      </div>
      ${desc}
    </li>`;
}

function agentsCard(agents, c, t) {
  const list = Array.isArray(agents) ? agents : [];
  // SAID ONCE, VISIBLY (issue 106): if nobody was evaluated, the reason the badges are empty is that the run could not classify, not that the agents have no category.
  const noneEvaluated = list.length > 0 && list.every((a) => a.evaluated === false);
  // AND THE PARTIAL RUN, NAMED (2026-08-03).
  const omitted = list.filter((a) => a.evaluationState === 'omitted').map((a) => a.name);
  const cls = (t && t.classification) || {};
  // OMITTED WINS OVER "NOBODY WAS EVALUATED", and the order is the fix.
  const notice = (omitted.length && typeof cls.agentsEvalPartial === 'function')
    ? `<p class="sub" style="margin:0 0 10px">${esc(cls.agentsEvalPartial(omitted.join(', '), omitted.length))}</p>`
    : (noneEvaluated ? `<p class="sub" style="margin:0 0 10px">${esc(c.agentsEvalMissing)}</p>` : '');
  // The empty state is explicit on purpose: "you have none" and "the tool does not
  // look" are different facts and used to look identical (nothing at all).
  const body = list.length
    ? `<ul class="tree">${list.map((a) => agentRow(a, c, t)).join('')}</ul>`
    : `<p class="sub" style="margin:0">${esc(label(c.agentsEmpty, 'No configured AI agents detected.'))}</p>`;
  return `<div class="card reveal"><h3>${esc(label(c.agentsT, 'AI agents'))}</h3><p class="sub">${esc(label(c.agentsS, ''))}</p>${notice}${body}</div>`;
}

function skillAcc(s, c, gate = DEFAULT_REPORT_GATE) {
  const imps = gate.showCertifyRemediation ? (s.improvements || []).map((i) => `<li>${esc(i)}</li>`).join('') : '';
  const improveBlk = imps ? `<div class="blk"><h5>${esc(c.comoMejorar)}</h5><ul>${imps}</ul></div>` : '';
  return `<div class="acc"><button class="acc-head"><span class="caret">▸</span><span class="title">${esc(s.name)}</span><span class="spacer"></span><span class="score-badge ${bandClass(s.band)}">${esc(s.levelName || '—')}</span></button>
    <div class="acc-body-wrap"><div class="acc-body-inner"><div class="acc-body">
      <div class="blk"><h5>${esc(c.valoracion)}</h5><p>${esc(s.rationale) || '—'}</p></div>
      ${improveBlk}
    </div></div></div></div>`;
}

// renderSheet(project, lang) -> full self-contained HTML string with the mockup design, populated from live report-store data.
function renderSheet(project, lang, gate = DEFAULT_REPORT_GATE) {
  const L = lang === 'en' ? 'en' : 'es';
  const t = getCatalog(L);
  const c = t.sheet;
  const hasFoot = !!(project && project.footprint && project.footprint.report);
  // `t` is passed now (issue 089): the drawer's agent rows use the catalog for the
  // description fallback and nothing else — it stays optional for the graph report.
  const fp = hasFoot ? buildFootprintDrawer(project.footprint.report, project.footprint.maturity, t) : null;
  // buildCertsPayload returns null when the project has no Skill certs — the sheet still renders both columns, so normalize to an empty list (clean state).
  const certs = buildCertsPayload(project, L) || { skills: [] };

  // LEFT column — footprint (or a clean empty state). The tier explainer now
  // lives INSIDE the maturity ladder (per rung), so no separate tiers card.
  const left = hasFoot
    ? heroHtml(fp, c, t) + aiFluencyHtml(project.footprint.report, L) + ladderHtml(fp, c, t) + agentsCard(fp.agents, c, t)
      + chipsCard(c.toolsT, c.toolsS, fp.tools, true) + chipsCard(c.techT, c.techS, fp.technologies, false)
      + mcpCard(fp.mcp, c)
    : `<div class="card reveal"><p class="sub">${esc(c.noFoot)}</p></div>`;

  // RIGHT column — Skill certifications (or a clean empty state).
  const skillsBody = certs.skills.length
    ? certs.skills.map((s) => skillAcc(s, c, gate)).join('')
    : `<div class="card reveal"><p class="sub">${esc(c.noSkills)}</p></div>`;

  const body = `
    <section class="col-left">
      <div class="col-head"><span class="dot"></span><h2>${esc(c.footprint)}</h2></div>
      ${left}
    </section>
    <section class="col-right">
      <div class="col-head"><span class="dot"></span><h2>${esc(c.certs)}</h2></div>
      <div class="tabs" id="tabs">
        <span class="tab-ind" id="tabInd"></span>
        <button class="tab active" data-tab="skills">${esc(c.skills)}<span class="cnt">${certs.skills.length}</span></button>
      </div>
      <div class="panel-controls"><button class="mini-btn" id="expandAll">${esc(c.expandAll)}</button></div>
      <div class="tabpanel show" data-panel="skills">${skillsBody}</div>
    </section>`;

  const projectName = project && project.root
    ? sanitizeRenderText(path.basename(String(project.root)))
    : 'project';

  let out = template();
  // Document/page chrome. HTML-escaped for the markup slots, JS-escaped for the
  // three that land inside the template's inline <script>.
  for (const [token, value] of [
    ['__LANG__', L],
    ['__SCORE__', String(fp ? Math.max(0, Math.min(100, Math.round(fp.score))) : 0)],
    ['__PROJECT__', esc(String(projectName))],
    ['__FOOTER__', esc(c.footer)],
    ['__REPORT_TITLE__', esc(c.reportTitle)],
    ['__THEME_TOGGLE__', esc(c.themeToggle)],
    ['__THEME_DARK__', esc(c.themeDark)],
    ['__THEME_LIGHT__', esc(c.themeLight)],
    ['__JS_THEME_DARK__', jsStr(c.themeDark)],
    ['__JS_THEME_LIGHT__', jsStr(c.themeLight)],
    ['__JS_COPIED__', jsStr(c.copied)],
    ['__JS_EXPAND_ALL__', jsStr(c.expandAll)],
    ['__JS_COLLAPSE_ALL__', jsStr(c.collapseAll)],
    ['__BODY__', body],
  ]) {
    out = fill(out, token, value);
  }
  return out;
}

module.exports = { renderSheet, agentsCard };
