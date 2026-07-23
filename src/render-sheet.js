'use strict';

/*
 * render-sheet.js — the SHAREABLE report (`report`, alias `sheet`) rendered with
 * the approved mockup design (src/templates/report-sheet.html, ported verbatim
 * from mockup-report.html: its <style> + interactive <script> — ring, tabs,
 * accordions, expand-all, copy — are untouched). This module builds the report
 * BODY (both columns) server-side from LIVE report-store data and injects it,
 * so the design is the mock's but the content is real (no placeholders).
 *
 * Data:
 *   - Footprint (left col): buildFootprintDrawer(report, maturity) → tier / score
 *     / ladder / tools / technologies (same deterministic source `map` uses).
 *   - Certifications (right col): buildCertsPayload(project, lang) → skills
 *     (rationale + improvements + score band) and agents (level + meta +
 *     verified/unverified evidence + areas), REUSING the shared cert logic.
 *
 * Self-contained / zero-network at view time — inherited from the template.
 * Inline es/en copy (like bin/map.js) so the i18n catalog is untouched; a few
 * script-driven micro-labels (expand/collapse, theme toggle) stay as the
 * template ships them.
 */

const fs = require('fs');
const path = require('path');
const { buildFootprintDrawer } = require('./graph-scan');
const { buildCertsPayload } = require('./graph-certs');
const { getCatalog } = require('./i18n');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'report-sheet.html');
let _tpl = null;
function template() { if (_tpl == null) _tpl = fs.readFileSync(TEMPLATE_PATH, 'utf8'); return _tpl; }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const COPY = {
  es: {
    footprint: 'Huella de IA', certs: 'Certificaciones',
    ladderT: 'Escalera de madurez', ladderS: 'Tu nivel de uso de IA, de 0 a 4.',
    toolsT: 'Herramientas detectadas', toolsS: 'Clientes de IA presentes en tu entorno.',
    techT: 'Tecnologías del proyecto', techS: 'Stack reconocido en el repositorio.',
    skills: 'Skills', agents: 'Agentes',
    valoracion: 'Valoración', comoMejorar: 'Cómo mejorar', porQue: 'Por qué', areas: 'Áreas evaluadas',
    noNextSteps: 'Sin próximos pasos para este agente.',
    bandLine: (lvl, name) => `Nivel de madurez <b>${esc(lvl)} · ${esc(name)}</b>.`,
    hereYouAre: 'Estás aquí',
    noFoot: 'Aún no hay huella de IA. Ejecuta footprint en este proyecto.',
    noSkills: 'Aún no hay skills certificadas. Ejecuta certify.',
    noAgents: 'Aún no hay agentes certificados. Ejecuta certify agents.',
    footer: 'Informe generado localmente · Shakers',
  },
  en: {
    footprint: 'AI footprint', certs: 'Certifications',
    ladderT: 'Maturity ladder', ladderS: 'Your AI-usage level, 0 to 4.',
    toolsT: 'Detected tools', toolsS: 'AI clients present in your environment.',
    techT: 'Project technologies', techS: 'Stack recognized in the repository.',
    skills: 'Skills', agents: 'Agents',
    valoracion: 'Assessment', comoMejorar: 'How to improve', porQue: 'Why', areas: 'Assessed areas',
    noNextSteps: 'No next steps for this agent.',
    bandLine: (lvl, name) => `Maturity level <b>${esc(lvl)} · ${esc(name)}</b>.`,
    hereYouAre: 'You are here',
    noFoot: 'No AI footprint yet. Run footprint in this project.',
    noSkills: 'No certified skills yet. Run certify.',
    noAgents: 'No certified agents yet. Run certify agents.',
    footer: 'Report generated locally · Shakers',
  },
};

const AREA_TAG = { // tagKey -> [css class, glyph]
  verified: ['tag-verificado', '✓'], partial: ['tag-parcial', '◐'],
  claimed: ['tag-afirmado', '!'], not_evidenced: ['tag-na', '–'], n_a: ['tag-na', '–'],
};
function bandClass(b) { return b === 'high' ? 'band-high' : b === 'mid' ? 'band-mid' : 'band-low'; }

function heroHtml(fp, c) {
  const lvl = fp.tier.level;
  const pills = Array.from({ length: 5 }, (_, i) => `<span class="${i <= lvl ? 'on' : ''}"></span>`).join('');
  const chipK = fp.tier.key && fp.tier.key !== 'none' ? esc(fp.tier.key) : String(lvl);
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
        <span class="tier-chip"><span class="k">${chipK}</span> ${esc(fp.tier.name)}</span>
        <div class="band-line">${c.bandLine(lvl, fp.tier.name)}</div>
        <div class="lvl-pills" title="0-4">${pills}</div>
      </div>
    </div>
  </div>`;
}

function ladderHtml(fp, c) {
  const cur = fp.tier.level;
  const items = (fp.ladder || []).map((r) => {
    const cls = r.n < cur ? 'done' : r.n === cur ? 'current' : 'pending';
    const node = r.n < cur ? '✓' : '';
    const here = r.n === cur ? `<div class="desc">${esc(c.hereYouAre)}.</div>` : '';
    return `<li class="${cls}"><span class="node">${node}</span><span class="k">${r.n}</span> · <span class="name">${esc(r.name)}</span>${here}</li>`;
  }).join('');
  return `<div class="card reveal"><h3>${esc(c.ladderT)}</h3><p class="sub">${esc(c.ladderS)}</p><ul class="ladder">${items}</ul></div>`;
}

function chipsCard(title, sub, items, withDot) {
  const chips = (items || []).map((x) => `<span class="chip">${withDot ? '<span class="d"></span>' : ''}${esc(x)}</span>`).join('');
  const body = chips || '<span class="chip" style="opacity:.6">—</span>';
  return `<div class="card reveal"><h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p><div class="chips">${body}</div></div>`;
}

function skillAcc(s, c) {
  const imps = (s.improvements || []).map((i) => `<li>${esc(i)}</li>`).join('');
  const improveBlk = imps ? `<div class="blk"><h5>${esc(c.comoMejorar)}</h5><ul>${imps}</ul></div>` : '';
  return `<div class="acc"><button class="acc-head"><span class="caret">▸</span><span class="title">${esc(s.name)}</span><span class="spacer"></span><span class="score-badge ${bandClass(s.band)}">${Number.isFinite(s.score) ? s.score : 0}</span></button>
    <div class="acc-body-wrap"><div class="acc-body-inner"><div class="acc-body">
      <div class="blk"><h5>${esc(c.valoracion)}</h5><p>${esc(s.rationale) || '—'}</p></div>
      ${improveBlk}
    </div></div></div></div>`;
}

// `a.verified`/`a.unverified` are OBJECTS from deriveCertEvidence
// (verified: {name, evidence}; unverified: {name, tagLabel, evidence}) — render
// their fields, NOT the object (which stringifies to "[object Object]").
function eviLine(v) {
  const label = v && v.name ? `<b>${esc(v.name)}</b>` : '';
  const tag = v && v.tagLabel ? ` <em>(${esc(v.tagLabel)})</em>` : '';
  const ev = v && v.evidence ? `${label || tag ? ' — ' : ''}${esc(v.evidence)}` : '';
  const line = `${label}${tag}${ev}`.trim();
  return `<li>${line || esc(typeof v === 'string' ? v : (v && v.name) || '')}</li>`;
}

function agentAcc(a, c, improvements) {
  const verifiedUl = a.verified && a.verified.length ? `<ul class="evi ok">${a.verified.map(eviLine).join('')}</ul>` : '';
  const unverifiedUl = a.unverified && a.unverified.length ? `<ul class="evi no">${a.unverified.map(eviLine).join('')}</ul>` : '';
  const areas = (a.areas || []).map((ar) => {
    const [cls, glyph] = AREA_TAG[ar.tagKey] || ['tag-na', '–'];
    return `<div class="area"><span class="icn">${glyph}</span><span class="nm">${esc(ar.name)}</span><span class="tag ${cls}">${esc(ar.tag)}</span></div>`;
  }).join('');
  const meta = a.meta ? `<span class="meta">· ${esc(a.meta)}</span>` : '';
  const lvlCls = a.level && a.level !== 'none' ? `lvl-${esc(a.level)}` : '';
  const rationale = a.rationale ? `<div class="blk"><p>${esc(a.rationale)}</p></div>` : '';
  // Next-step prompts (BUG 2): from the agent-evaluation improvements for this
  // agent (matched by name). Clean empty state when the agent has none — never
  // fabricated.
  const imps = Array.isArray(improvements) ? improvements.filter((i) => typeof i === 'string' && i.trim()) : [];
  const nextSteps = imps.length
    ? `<div class="blk"><h5>${esc(c.comoMejorar)}</h5><ul>${imps.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`
    : `<div class="blk"><h5>${esc(c.comoMejorar)}</h5><p class="sub">${esc(c.noNextSteps)}</p></div>`;
  return `<div class="acc"><button class="acc-head"><span class="caret">▸</span><span class="title">${esc(a.name)}</span>${meta}<span class="spacer"></span><span class="level-chip ${lvlCls}">${esc(a.levelName || a.level)}</span></button>
    <div class="acc-body-wrap"><div class="acc-body-inner"><div class="acc-body">
      <div class="blk"><h5>${esc(c.porQue)}</h5>${verifiedUl}${unverifiedUl}</div>
      ${areas ? `<div class="blk"><h5>${esc(c.areas)}</h5>${areas}</div>` : ''}
      ${nextSteps}
      ${rationale}
    </div></div></div></div>`;
}

// Compact TIER explainer (T0–T7) — real meanings from the localized i18n
// `ladder.tierDesc` (sourced from tier-engine), never invented.
function tierLegendCard(t, L) {
  const ladder = t.ladder || {};
  const td = ladder.tierDesc || {};
  const keys = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].filter((k) => td[k]);
  if (!keys.length) return '';
  const rows = keys.map((k) => `<div style="font-size:11px;line-height:1.5;margin:3px 0;color:var(--fg-soft)"><b style="color:var(--fg)">${k}</b> · ${esc(td[k])}</div>`).join('');
  const title = ladder.tiersHeading || (L === 'es' ? 'Escalera de tiers (T0-T7)' : 'Tier ladder (T0-T7)');
  return `<div class="card reveal"><h3>${esc(title)}</h3><p class="sub">${L === 'es' ? 'Qué significa cada tier.' : 'What each tier means.'}</p>${rows}</div>`;
}

// Compact PROFICIENCY-level explainer (P1–P5) — from the localized certifyAgents
// `levelNames` + `levelDesc` (the scale used for agents/skills).
function levelLegendCard(t, L) {
  const ca = t.certifyAgents || {};
  const ln = ca.levelNames || {};
  const ld = ca.levelDesc || {};
  const keys = ['P1', 'P2', 'P3', 'P4', 'P5'].filter((k) => ld[k]);
  if (!keys.length) return '';
  const rows = keys.map((k) => `<div style="font-size:11px;line-height:1.5;margin:3px 0;color:var(--fg-soft)"><b style="color:var(--fg)">${esc(ln[k] || k)}</b> — ${esc(ld[k])}</div>`).join('');
  return `<div class="card reveal"><h3>${L === 'es' ? 'Niveles de dominio (P1-P5)' : 'Proficiency levels (P1-P5)'}</h3><p class="sub">${L === 'es' ? 'Qué mide cada nivel de las certificaciones.' : 'What each certification level measures.'}</p>${rows}</div>`;
}

/*
 * renderSheet(project, lang) -> full self-contained HTML string with the mockup
 * design, populated from live report-store data. `project` is the report-store
 * project object (footprint.report / footprint.maturity / certifications /
 * agentCertifications).
 */
function renderSheet(project, lang) {
  const L = lang === 'en' ? 'en' : 'es';
  const c = COPY[L];
  const t = getCatalog(L);
  const hasFoot = !!(project && project.footprint && project.footprint.report);
  const fp = hasFoot ? buildFootprintDrawer(project.footprint.report, project.footprint.maturity) : null;
  // buildCertsPayload returns null when the project has no certs at all — the
  // sheet still renders both columns, so normalize to empty lists (clean state).
  const certs = buildCertsPayload(project, L) || { skills: [], agents: [] };

  // Agent next-step prompts come from the agent-EVALUATION improvements (the
  // certify-agents verdict carries no improvements), matched by agent name.
  const evalList = (hasFoot && project.footprint.report.agentEvaluation
    && Array.isArray(project.footprint.report.agentEvaluation.evaluations))
    ? project.footprint.report.agentEvaluation.evaluations : [];
  const improvementsByName = new Map();
  for (const e of evalList) {
    if (e && typeof e.name === 'string' && Array.isArray(e.improvements)) improvementsByName.set(e.name, e.improvements);
  }

  // LEFT column — footprint (or a clean empty state) + a compact TIERS explainer.
  const left = (hasFoot
    ? heroHtml(fp, c) + ladderHtml(fp, c) + chipsCard(c.toolsT, c.toolsS, fp.tools, true) + chipsCard(c.techT, c.techS, fp.technologies, false)
    : `<div class="card reveal"><p class="sub">${esc(c.noFoot)}</p></div>`)
    + tierLegendCard(t, L);

  // RIGHT column — certifications, tabs + accordions (or clean empty states).
  const skillsBody = certs.skills.length
    ? certs.skills.map((s) => skillAcc(s, c)).join('')
    : `<div class="card reveal"><p class="sub">${esc(c.noSkills)}</p></div>`;
  const agentsBody = certs.agents.length
    ? certs.agents.map((a) => agentAcc(a, c, improvementsByName.get(a.name))).join('')
    : `<div class="card reveal"><p class="sub">${esc(c.noAgents)}</p></div>`;

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
        <button class="tab" data-tab="agents">${esc(c.agents)}<span class="cnt">${certs.agents.length}</span></button>
      </div>
      <div class="panel-controls"><button class="mini-btn" id="expandAll">Expandir todo</button></div>
      <div class="tabpanel show" data-panel="skills">${skillsBody}</div>
      <div class="tabpanel" data-panel="agents">${agentsBody}</div>
      ${levelLegendCard(t, L)}
    </section>`;

  const projectName = project && project.root ? path.basename(String(project.root)) : 'project';

  return template()
    .replace('__LANG__', L)
    .replace('__SCORE__', String(fp ? Math.max(0, Math.min(100, Math.round(fp.score))) : 0))
    .replace('__PROJECT__', esc(String(projectName)))
    .replace('__FOOTER__', esc(c.footer))
    .replace('__BODY__', () => body);
}

module.exports = { renderSheet };
