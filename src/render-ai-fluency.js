'use strict';

// Renders the "My work with AI" preview (3x3 matrix + vision E + howIWork F +
// traction), terminal + HTML. Copy is inlined for the spike; promote to i18n later.

const { SETUP_CODE, CELL_NAMES } = require('./ai-fluency-cell');
const { detectedToolNames } = require('./detected-tools');

const SETUP_ORDER = ['ASSISTED', 'EXTENDED', 'ORCHESTRATED'];
const USAGE_ORDER = ['REACTIVE', 'DELIBERATE', 'RIGOROUS'];

const COPY = {
  es: {
    title: 'Tu trabajo con IA (Setup x Uso)',
    usage: { REACTIVE: 'Reactivo', DELIBERATE: 'Deliberado', RIGOROUS: 'Riguroso' },
    setup: { ASSISTED: 'Asistido', EXTENDED: 'Extendido', ORCHESTRATED: 'Orquestado' },
    aiNative: 'AI Native',
    pending: 'Tu perfil se está evaluando; míralo en un momento en "Mi trabajo con IA".',
    matrixUpdating: 'Tu matriz Setup x Uso se está actualizando; aparecerá en breve.',
    setupOnly: 'Disponible en tu perfil tras iniciar sesión y compartir el informe.',
    visionLabel: 'Mi visión sobre la IA',
    howIWorkLabel: 'Cómo trabajo con IA',
    howIWorkMissing: 'Se genera tras la entrevista de onboarding.',
    tractionLabel: 'Actividad',
    sessions90d: 'sesiones (90d)',
    daysPerWeek: 'días/semana',
    agents: (d, p) => `${d} agentes detectados${p != null ? ` · ${p} en tu perfil` : ''}`,
    toolsLabel: 'herramientas',
    axisSetup: 'Setup',
    axisUsage: 'Uso',
    agentsLabel: 'Agentes',
  },
  en: {
    title: 'Your work with AI (Setup x Usage)',
    usage: { REACTIVE: 'Reactive', DELIBERATE: 'Deliberate', RIGOROUS: 'Rigorous' },
    setup: { ASSISTED: 'Assisted', EXTENDED: 'Extended', ORCHESTRATED: 'Orchestrated' },
    aiNative: 'AI Native',
    pending: 'Your profile is being evaluated; check "My work with AI" shortly.',
    matrixUpdating: 'Your Setup x Usage matrix is updating; it will appear shortly.',
    setupOnly: 'Available on your profile after you log in and share the report.',
    visionLabel: 'My vision on AI',
    howIWorkLabel: 'How I work with AI',
    howIWorkMissing: 'Generated after the onboarding interview.',
    tractionLabel: 'Traction',
    sessions90d: 'sessions (90d)',
    daysPerWeek: 'days/week',
    agents: (d, p) => `${d} agents detected${p != null ? ` · ${p} on your profile` : ''}`,
    toolsLabel: 'tools',
    axisSetup: 'Setup',
    axisUsage: 'Usage',
    agentsLabel: 'Agents',
  },
};

function copyFor(lang) {
  return COPY[lang === 'es' ? 'es' : 'en'];
}

// The matrix band can lag behind E/F (independent projection). When absent, render
// E/F/traction anyway and swap the 3x3 grid for a short "updating" note.
function matrixReady(matrix) {
  return !!(matrix && (matrix.setupLevel || matrix.usageLevel || matrix.cell));
}

const noColor = new Proxy({}, { get: () => '' });

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Traction metrics as compact "label: value" fragments, omitting null fields.
function tractionParts(traction, t) {
  if (!traction) return [];
  const parts = [];
  if (traction.sessions90d != null) parts.push(`${traction.sessions90d} ${t.sessions90d}`);
  if (traction.activeDaysPerWeek != null) parts.push(`${traction.activeDaysPerWeek} ${t.daysPerWeek}`);
  if (traction.agentsDetected != null) parts.push(t.agents(traction.agentsDetected, traction.agentsOnProfile));
  const tools = detectedToolNames(traction.tools);
  if (tools.length) parts.push(`${t.toolsLabel}: ${tools.join(', ')}`);
  return parts;
}

function matrixTerminalLines(matrix, t, c) {
  // Column widths from the longest label (incl. current-cell brackets). Pad BEFORE
  // colorizing: padEnd counts ANSI escape bytes, so padding a colored string misaligns.
  const rowLabels = SETUP_ORDER.map((s) => `${SETUP_CODE[s]} ${t.setup[s]}`);
  const rowW = Math.max(...rowLabels.map((s) => s.length)) + 2;
  const cellLabels = SETUP_ORDER.flatMap((s) => USAGE_ORDER.map((u) => CELL_NAMES[s][u]));
  const headerLabels = USAGE_ORDER.map((u) => t.usage[u]);
  const colW = Math.max(...cellLabels.map((x) => x.length), ...headerLabels.map((x) => x.length)) + 4;

  const lines = [`  ${c.bold}${t.title}${c.reset}`];
  lines.push(`  ${c.dim}${' '.repeat(rowW) + headerLabels.map((u) => u.padEnd(colW)).join('')}${c.reset}`);
  for (const s of SETUP_ORDER) {
    const rowLabel = `${SETUP_CODE[s]} ${t.setup[s]}`.padEnd(rowW);
    const cells = USAGE_ORDER.map((u) => {
      const name = CELL_NAMES[s][u];
      const isCurrent = matrix.setupLevel === s && matrix.usageLevel === u;
      if (isCurrent) return `${c.accent}${c.bold}${`[${name}]`.padEnd(colW)}${c.reset}`;
      return `${c.muted}${name.padEnd(colW)}${c.reset}`;
    }).join('');
    lines.push(`  ${c.dim}${rowLabel}${c.reset}${cells}`);
  }
  return lines;
}

function buildProfileSections(preview, t) {
  const sections = [];
  const m = (preview && preview.matrix) || {};
  const setupExp = preview.setup && preview.setup.explanation ? preview.setup.explanation : null;
  if (m.setupLevel) {
    const value = [m.setupCode, t.setup[m.setupLevel]].filter(Boolean).join(' ');
    sections.push({ kind: 'axis', label: t.axisSetup, value, explanation: setupExp });
  }
  const usageExp = preview.usage && preview.usage.explanation ? preview.usage.explanation : null;
  if (m.usageLevel) {
    sections.push({ kind: 'axis', label: t.axisUsage, value: t.usage[m.usageLevel] || m.usageLevel, explanation: usageExp });
  }
  if (preview.vision) sections.push({ kind: 'narrative', label: t.visionLabel, body: preview.vision });
  if (preview.howIWork) sections.push({ kind: 'narrative', label: t.howIWorkLabel, body: preview.howIWork });
  return sections;
}

const axisBody = (s) => (s.explanation ? `${s.value} — ${s.explanation}` : s.value);

// Full "My work with AI" preview, terminal. `preview` is the normalized shape from
// resolveAiProfilePreview; `status` drives the fallbacks.
function renderAiProfileTerminal({ status, preview } = {}, { lang = 'en', c = noColor } = {}) {
  const t = copyFor(lang);
  // Non-fatal notices (not-yet-judged / setup-only) → yellow.
  if (status === 'unavailable') return `  ${c.warning || c.muted}${t.setupOnly}${c.reset}`;
  if (status !== 'ready' || !preview) return `  ${c.warning || c.muted}${t.pending}${c.reset}`;

  const lines = matrixReady(preview.matrix)
    ? matrixTerminalLines(preview.matrix, t, c)
    : [`  ${c.bold}${t.title}${c.reset}`, `  ${c.warning || c.muted}${t.matrixUpdating}${c.reset}`];
  const sections = buildProfileSections(preview, t);
  const axes = sections.filter((s) => s.kind === 'axis');
  if (axes.length) {
    lines.push('');
    for (const a of axes) lines.push(`  ${c.bold}${a.label}:${c.reset} ${c.muted}${axisBody(a)}${c.reset}`);
  }
  for (const n of sections.filter((s) => s.kind === 'narrative')) {
    lines.push('', `  ${c.bold}${n.label}${c.reset}`, `  ${c.muted}${n.body}${c.reset}`);
  }
  // Traction now lives in the Activity section (terminal-agents#printActivity).
  return lines.join('\n');
}

function plainAgentLines(agents) {
  if (!Array.isArray(agents) || agents.length === 0) return [];
  return agents.map((a) => {
    const bits = [a.category, a.role].filter(Boolean);
    return bits.length ? `- ${a.name} — ${bits.join(' · ')}` : `- ${a.name}`;
  });
}

// Full "My work with AI" report as plain markdown (NO ANSI), for the MCP tool so a chat client shows the same report the CLI terminal prints.
function renderAiProfilePlain({ status, preview } = {}, { lang = 'en', agents = [] } = {}) {
  const t = copyFor(lang);
  const out = [];
  if (status === 'unavailable') {
    out.push(t.setupOnly);
  } else if (status !== 'ready' || !preview) {
    out.push(t.pending);
  } else {
    if (matrixReady(preview.matrix)) {
      const gridLines = matrixTerminalLines(preview.matrix, t, noColor).slice(1);
      out.push(`## ${t.title}`, '', '```', ...gridLines, '```');
    } else {
      out.push(`## ${t.title}`, '', t.matrixUpdating);
    }
    const sections = buildProfileSections(preview, t);
    const axes = sections.filter((s) => s.kind === 'axis');
    if (axes.length) {
      out.push('');
      for (const a of axes) out.push(`${a.label}: ${axisBody(a)}`);
    }
    for (const n of sections.filter((s) => s.kind === 'narrative')) {
      out.push('', `**${n.label}**`, n.body);
    }
    const tp = tractionParts(preview.traction, t);
    if (tp.length) out.push('', `**${t.tractionLabel}:** ${tp.join(' · ')}`);
  }
  const agentLines = plainAgentLines(agents);
  if (agentLines.length) out.push('', `**${t.agentsLabel}**`, ...agentLines);
  return out.join('\n');
}

// Full "My work with AI" preview, HTML. '' when there is nothing to show inline.
function renderAiProfileHtml({ status, preview } = {}, { lang = 'en' } = {}) {
  const t = copyFor(lang);
  if (status === 'unavailable') return `<p class="ai-fluency-note">${esc(t.setupOnly)}</p>`;
  if (status !== 'ready' || !preview) return `<p class="ai-fluency-note">${esc(t.pending)}</p>`;

  const m = preview.matrix;
  const out = [
    `<section class="ai-fluency" aria-label="${esc(t.title)}">`,
    `<h3>${esc(t.title)}</h3>`,
  ];
  if (matrixReady(m)) {
    const rows = SETUP_ORDER.map((s) => {
      const cells = USAGE_ORDER.map((u) => {
        const current = m.setupLevel === s && m.usageLevel === u;
        return `<td class="ai-fluency-cell${current ? ' is-current' : ''}">${esc(CELL_NAMES[s][u])}</td>`;
      }).join('');
      return `<tr><th scope="row">${esc(SETUP_CODE[s])} ${esc(t.setup[s])}</th>${cells}</tr>`;
    }).join('');
    const head = USAGE_ORDER.map((u) => `<th scope="col">${esc(t.usage[u])}</th>`).join('');
    out.push(
      '<table class="ai-fluency-matrix">',
      `<thead><tr><th></th>${head}</tr></thead>`,
      `<tbody>${rows}</tbody>`,
      '</table>',
    );
  } else {
    out.push(`<p class="ai-fluency-note">${esc(t.matrixUpdating)}</p>`);
  }
  if (m.cell) {
    out.push(`<p class="ai-fluency-current">${esc(m.setupCode)}·${esc(t.usage[m.usageLevel] || m.usageLevel)} → <strong>${esc(m.cell)}</strong>${m.isAiNative ? ` <span class="ai-native">★ ${esc(t.aiNative)}</span>` : ''}</p>`);
  }
  if (preview.vision) {
    out.push(`<div class="ai-vision"><h4>${esc(t.visionLabel)}</h4><p>${esc(preview.vision)}</p></div>`);
  }
  out.push(`<div class="ai-howiwork"><h4>${esc(t.howIWorkLabel)}</h4><p>${preview.howIWork ? esc(preview.howIWork) : `<em>${esc(t.howIWorkMissing)}</em>`}</p></div>`);
  const parts = tractionParts(preview.traction, t);
  if (parts.length) {
    out.push(`<p class="ai-traction"><strong>${esc(t.tractionLabel)}:</strong> ${esc(parts.join(' · '))}</p>`);
  }
  out.push('</section>');
  return out.join('');
}

// Matrix-only HTML (kept for render-sheet.js; the HTML report is a separate iteration).
function renderAiFluencyMatrixHtml({ status, usage } = {}, { lang = 'en' } = {}) {
  const t = copyFor(lang);
  if (status === 'unavailable') return `<p class="ai-fluency-note">${esc(t.setupOnly)}</p>`;
  if (status !== 'ready' || !usage || !usage.cell) return `<p class="ai-fluency-note">${esc(t.pending)}</p>`;
  const rows = SETUP_ORDER.map((s) => {
    const cells = USAGE_ORDER.map((u) => {
      const current = usage.setupLevel === s && usage.usageLevel === u;
      return `<td class="ai-fluency-cell${current ? ' is-current' : ''}">${esc(CELL_NAMES[s][u])}</td>`;
    }).join('');
    return `<tr><th scope="row">${esc(SETUP_CODE[s])} ${esc(t.setup[s])}</th>${cells}</tr>`;
  }).join('');
  const head = USAGE_ORDER.map((u) => `<th scope="col">${esc(t.usage[u])}</th>`).join('');
  return [
    `<section class="ai-fluency" aria-label="${esc(t.title)}">`,
    `<h3>${esc(t.title)}</h3>`,
    '<table class="ai-fluency-matrix">',
    `<thead><tr><th></th>${head}</tr></thead>`,
    `<tbody>${rows}</tbody></table>`,
    `<p class="ai-fluency-current">${esc(usage.setupCode)}·${esc(t.usage[usage.usageLevel] || usage.usageLevel)} → <strong>${esc(usage.cell)}</strong>${usage.isAiNative ? ` <span class="ai-native">★ ${esc(t.aiNative)}</span>` : ''}</p>`,
    '</section>',
  ].join('');
}

module.exports = {
  renderAiProfileTerminal,
  renderAiProfilePlain,
  renderAiProfileHtml,
  renderAiFluencyMatrixHtml,
  copyFor,
  tractionParts,
  SETUP_ORDER,
  USAGE_ORDER,
};
