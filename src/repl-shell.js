'use strict';

const { getCatalog } = require('./i18n');
const { oscLink } = require('./osc-link');

/*
 * Branded mini-shell (ADR-014). The REPL is the SINGLE entrypoint of the tool
 * (`sh-eval`): it prints a Shakers wordmark, shows a prompt, and dispatches the
 * SAME command logic that used to live behind the `ai-footprint`/`ai-certify`
 * binaries — no behaviour change, the commands are just wrapped.
 *
 * Zero-dependency: node stdlib + ANSI only (no TUI framework), honouring the
 * repo invariant. Logic lives here (testable) so bin/sh-eval.js stays a thin
 * entrypoint (bin/*.js call their entry on load and can't be require()d).
 *
 * The commands are injected as `deps.runFootprint(args, { ask })` /
 * `deps.runCertify(args, { ask })` so the shell is unit-testable with fakes and
 * never hard-imports the binaries here.
 */

// ── Shakers brand colours (from shakers-design-system/design-spec/tokens.css) ──
// 24-bit truecolour ANSI. Gated on a TTY by the caller (colour=false -> plain).
// Palette direction (user feedback with the real logo, 2026-07-16): LIME is the
// hero accent (the logo is a lime bolt on a dark tile), white for primary text,
// grey for secondary/meta, a sparing violet for a second section title. Teal is
// demoted to a secondary accent (the prompt).
const BRAND = {
  primary: [5, 52, 44],    // #05342c teal (primary)
  teal500: [14, 125, 105], // #0e7d69 teal-500 (prompt accent)
  teal700: [8, 71, 60],    // #08473c teal-700 — box borders (darker brand green)
  lime: [216, 230, 55],    // #d8e637 lime — HERO accent (bolt, border, titles)
  violet: [139, 92, 246],  // #8b5cf6 — sparing 2nd accent
  white: [244, 244, 245],  // primary text
  zinc: [113, 113, 122],   // secondary / meta text
  dark: [24, 27, 26],      // #181B1A — logo tile background (real asset colour)
};

function fg(rgb) {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}
function bg(rgb) {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// Shakers web, shown on the way out of the REPL. Language-neutral URL (the
// same in es/en), so it lives here rather than in the i18n catalog.
const SHAKERS_URL = 'https://www.shakersworks.com/en/';

// Lightning-bolt mark — the FAITHFUL silhouette of the real Shakers logo
// (shakers-hub-frontend .../images/shakers-logo.svg, viewBox 12×19), rasterised
// to half-block glyphs at Hpx=14 (9 wide × 7 rows) via scratchpad/rasterize.py.
// Per row: `█` = both sub-pixels are bolt, `▀` = top sub-pixel bolt, `▄` = bottom
// sub-pixel bolt, space = tile. tileCell paints the WHOLE cell with the dark
// tile background and the LIME foreground, so `▀`/`▄` render the bolt half in
// lime over a dark half — a lime bolt inside a solid dark tile, like the logo.
// Do NOT hand-edit the shape; regenerate from the SVG (adjust Hpx) if resized.
const BOLT_ART = [
  '     ▄██',
  '  ▄███▀',
  ' ██▀▀',
  ' ▀██████▄',
  '    ▄███▀',
  ' ▄███▀',
  '██▀',
];
const ART_W = Math.max(...BOLT_ART.map((s) => s.length)); // 9
// Natural tile: the bolt wrapped by a 1-cell dark margin each side (NOT forced
// square — that padding shifted it off-centre). The whole tile is then centred
// in the left column by centerCells. Width = ART_W + 2.
const TILE_ROWS = BOLT_ART;

// ── boxed-header primitives ───────────────────────────────────────────────
// A "cell" = { t: text, st: {bold?, fg?, bg?} }. Visible width is measured on
// the PLAIN text so ANSI escapes never break padding/alignment.
function span(text, st, color) {
  if (!color || !st) return text;
  let pre = '';
  if (st.bold) pre += BOLD;
  if (st.bg) pre += bg(st.bg);
  if (st.fg) pre += fg(st.fg);
  return `${pre}${text}${RESET}`;
}
function cellsPlain(cells) { return cells.map((c) => c.t).join(''); }
function cellsColored(cells, color) { return cells.map((c) => span(c.t, c.st, color)).join(''); }

function padRightCells(cells, width, color) {
  const len = cellsPlain(cells).length;
  return cellsColored(cells, color) + ' '.repeat(Math.max(0, width - len));
}
function centerCells(cells, width, color) {
  const len = cellsPlain(cells).length;
  const left = Math.max(0, (width - len) >> 1);
  return ' '.repeat(left) + cellsColored(cells, color) + ' '.repeat(Math.max(0, width - len - left));
}
// Box borders/corners/divider in brand lime (#d8e637). Single constant so the
// shade is trivial to swap (was teal-700 briefly; user prefers lime).
const BORDER = BRAND.lime;
function bd(ch, color) { return color ? `${fg(BORDER)}${ch}${RESET}` : ch; }

// Rounded top border with the title embedded, Claude-Code style:
//   ╭─ sh-eval · v0.1.0 ───────…───────╮
function topBorder(title, inner, color) {
  const dashCount = Math.max(0, inner - (title.length + 3)); // "─ " + title + " "
  if (!color) return `╭─ ${title} ${'─'.repeat(dashCount)}╮`;
  return `${fg(BORDER)}╭─ ${RESET}${BOLD}${fg(BRAND.white)}${title}${RESET}`
    + `${fg(BORDER)} ${'─'.repeat(dashCount)}╮${RESET}`;
}
function bottomBorder(inner, color) { return bd(`╰${'─'.repeat(inner)}╯`, color); }

// One tile row: solid dark tile with the lime bolt. The row keeps the bolt's own
// leading spaces (intra-shape alignment) and is padded to ART_W + a 1-cell dark
// margin each side, all painted with the dark background — a natural tile that
// wraps the bolt. The half-block glyphs (`▀`/`▄`) show their bolt sub-pixel in
// lime over a dark half. Width = ART_W + 2. Centred in the column by centerCells.
function tileCell(row) {
  const s = row || '';
  const t = ` ${s}${' '.repeat(Math.max(0, ART_W - s.length))} `;
  return { t, st: { bg: BRAND.dark, fg: BRAND.lime } };
}

// Builds the startup banner (shown ONCE on entry). Deliberately ALWAYS ENGLISH —
// a brand/product surface like the installer notice (functional footprint/
// certify output still respects the OS locale). Two-column boxed layout on wide
// terminals, degrading to a single stacked column under the box width.
//
// The wide box is 87 columns (see bannerWide's LW+RW+7). The threshold MUST
// match that width: rendering the two-column box in a narrower terminal is what
// makes the right border wrap and the columns look "descuadrado". Below it we
// fall back to the clean single-column stacked layout.
const WIDE_MIN_COLS = 87;
function renderBanner({ version = '', color = true, width = 80 } = {}) {
  const title = version ? `sh-eval · v${version}` : 'sh-eval';
  return width >= WIDE_MIN_COLS
    ? bannerWide({ title, color })
    : bannerStacked({ title, color, width });
}

function bannerWide({ title, color }) {
  const LW = 26;         // left (logo) column
  // RW/INNER are computed AFTER the rows are built (below), from the widest
  // VISIBLE row width (ADR-016: strip ANSI, count columns) — including the new
  // command rows — so the right border can never overflow the box.

  // Left column, with breathing room: welcome, blank, bolt tile, blank, product.
  const left = [];
  left.push([{ t: 'Welcome to ', st: { bold: true, fg: BRAND.white } }, { t: 'shakers', st: { bold: true, fg: BRAND.lime } }]);
  left.push([]);
  for (const row of TILE_ROWS) left.push([tileCell(row)]);
  left.push([]);
  left.push([{ t: 'AI Usage Evaluator', st: { fg: BRAND.zinc } }]);

  // Right column: a short "what it is" summary, then Commands + Getting started
  // (violet, the sparing 2nd accent).
  const NAME = 12;
  const right = [];
  right.push([{ t: 'A local-first CLI to level up how you work', st: { fg: BRAND.white } }]);
  right.push([{ t: 'with AI, and certify skills from your code.', st: { fg: BRAND.white } }]);
  right.push([]);
  right.push([{ t: 'Commands', st: { bold: true, fg: BRAND.lime } }]);
  right.push([{ t: 'footprint'.padEnd(NAME), st: { bold: true, fg: BRAND.white } }, { t: 'score AI setup (T0–T7) + agents', st: { fg: BRAND.zinc } }]);
  right.push([{ t: 'certify'.padEnd(NAME), st: { bold: true, fg: BRAND.white } }, { t: 'certify Skills from your code', st: { fg: BRAND.zinc } }]);
  right.push([{ t: 'map'.padEnd(NAME), st: { bold: true, fg: BRAND.white } }, { t: 'LOCAL report — AI/codebase graph', st: { fg: BRAND.zinc } }]);
  right.push([{ t: 'sheet'.padEnd(NAME), st: { bold: true, fg: BRAND.white } }, { t: 'SHAREABLE report — footprint + certs', st: { fg: BRAND.zinc } }]);
  right.push([{ t: 'share'.padEnd(NAME), st: { bold: true, fg: BRAND.white } }, { t: 'branded card for LinkedIn', st: { fg: BRAND.zinc } }]);
  const SEP = { sep: true }; // separator placeholder — sized once RW is known
  right.push(SEP);
  right.push([{ t: 'Getting started', st: { bold: true, fg: BRAND.violet } }]);
  right.push([
    { t: 'footprint', st: { fg: BRAND.white } }, { t: ' · ', st: { fg: BRAND.zinc } },
    { t: 'certify', st: { fg: BRAND.white } }, { t: ' · ', st: { fg: BRAND.zinc } },
    { t: 'map', st: { fg: BRAND.white } }, { t: ' · ', st: { fg: BRAND.zinc } },
    { t: 'sheet', st: { fg: BRAND.white } }, { t: ' · ', st: { fg: BRAND.zinc } },
    { t: 'share', st: { fg: BRAND.white } },
    { t: ' · help · exit', st: { fg: BRAND.zinc } },
  ]);

  // Box width from the widest VISIBLE row (ADR-016). RW must fit every right
  // row (incl. the "Getting started" line and the command rows); the separator
  // is then sized to RW, and LW never shrinks below its rows either.
  const RW = Math.max(54, ...right.filter((r) => r !== SEP).map((r) => cellsPlain(r).length));
  const LWv = Math.max(LW, ...left.map((r) => cellsPlain(r).length));
  const INNER = 1 + LWv + 3 + RW + 1;
  const rightRows = right.map((r) => (r === SEP ? [{ t: '─'.repeat(RW), st: { fg: BRAND.zinc } }] : r));

  // Vertically centre the (shorter) right column against the taller logo column.
  const rows = Math.max(left.length, rightRows.length);
  const topPad = Math.max(0, (rows - rightRows.length) >> 1);
  const rightPadded = [...Array(topPad).fill([]), ...rightRows];

  const lines = [''];
  lines.push(topBorder(title, INNER, color));
  for (let i = 0; i < rows; i++) {
    const l = centerCells(left[i] || [], LWv, color);
    const r = padRightCells(rightPadded[i] || [], RW, color);
    lines.push(`${bd('│', color)} ${l} ${bd('│', color)} ${r} ${bd('│', color)}`);
  }
  lines.push(bottomBorder(INNER, color));
  lines.push('');
  return lines.join('\n') + '\n';
}

function bannerStacked({ title, color, width }) {
  const INNER = Math.max(20, Math.min(width - 2, 56));
  const W = INNER - 2; // content width inside the "│ … │" padding
  const line = (cellsOrStr, { center = false } = {}) => {
    const cells = Array.isArray(cellsOrStr) ? cellsOrStr : [cellsOrStr];
    // truncate on plain length
    let plain = cellsPlain(cells);
    let body;
    if (plain.length > W) {
      const flat = plain.slice(0, W - 1) + '…';
      body = flat; // truncated -> drop styling (rare, narrow terminals)
      return `${bd('│', color)} ${body}${' '.repeat(Math.max(0, W - body.length))} ${bd('│', color)}`;
    }
    body = center ? centerCells(cells, W, color) : padRightCells(cells, W, color);
    return `${bd('│', color)} ${body} ${bd('│', color)}`;
  };

  const lines = [''];
  lines.push(topBorder(title, INNER, color));
  lines.push(line([{ t: '', st: null }]));
  for (const row of TILE_ROWS) lines.push(line([tileCell(row)], { center: true }));
  lines.push(line([{ t: '', st: null }]));
  lines.push(line([{ t: 'Welcome to ', st: { bold: true, fg: BRAND.white } }, { t: 'shakers', st: { bold: true, fg: BRAND.lime } }], { center: true }));
  lines.push(line([{ t: 'AI Usage Evaluator', st: { fg: BRAND.zinc } }], { center: true }));
  lines.push(line([{ t: '', st: null }]));
  lines.push(line([{ t: 'A local-first CLI to level up how you work', st: { fg: BRAND.white } }]));
  lines.push(line([{ t: 'with AI, and certify skills from your code.', st: { fg: BRAND.white } }]));
  lines.push(line([{ t: '', st: null }]));
  lines.push(line([{ t: 'Commands', st: { bold: true, fg: BRAND.lime } }]));
  lines.push(line([{ t: 'footprint  ', st: { bold: true, fg: BRAND.white } }, { t: 'score AI setup (T0–T7)', st: { fg: BRAND.zinc } }]));
  lines.push(line([{ t: 'certify    ', st: { bold: true, fg: BRAND.white } }, { t: 'certify your Skills', st: { fg: BRAND.zinc } }]));
  lines.push(line([{ t: 'map        ', st: { bold: true, fg: BRAND.white } }, { t: 'LOCAL report (graph)', st: { fg: BRAND.zinc } }]));
  lines.push(line([{ t: 'sheet      ', st: { bold: true, fg: BRAND.white } }, { t: 'shareable footprint+certs', st: { fg: BRAND.zinc } }]));
  lines.push(line([{ t: 'share      ', st: { bold: true, fg: BRAND.white } }, { t: 'card for LinkedIn', st: { fg: BRAND.zinc } }]));
  lines.push(line([{ t: '', st: null }]));
  lines.push(line([{ t: 'footprint · certify · map · sheet · share · help · exit', st: { fg: BRAND.zinc } }]));
  lines.push(bottomBorder(INNER, color));
  lines.push('');
  return lines.join('\n') + '\n';
}

// The coloured prompt string (e.g. "ϟ sh-eval ›", the bolt from the i18n
// prompt text). Whole prompt in brand teal. No trailing newline.
function renderPrompt({ lang = 'en', color = true } = {}) {
  const label = getCatalog(lang).repl.prompt;
  return color ? `  ${BOLD}${fg(BRAND.teal500)}${label}${RESET} ` : `  ${label} `;
}

// Splits a REPL input line into argv, honouring simple single/double quotes so
// a flag value with spaces (e.g. footprint --root "/my project") survives.
function tokenize(line) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  }
  return tokens;
}

// Parses a line into { command, args }. Command is lower-cased; args keep case
// (paths/emails are case-sensitive).
function parseCommandLine(line) {
  const tokens = tokenize(String(line || '').trim());
  if (tokens.length === 0) return { command: '', args: [] };
  return { command: tokens[0].toLowerCase(), args: tokens.slice(1) };
}

function printHelp(out, catalog) {
  out.write('\n' + catalog.repl.help + '\n');
}

// Dispatches a single parsed command. Returns { exit } — true ends the REPL.
// `deps.runFootprint` / `deps.runCertify` receive the parsed args + the shared
// `ask` (nested stdin). Unknown commands inform and continue.
async function dispatchCommand({ command, args }, { ask, catalog, deps, out = process.stdout }) {
  switch (command) {
    case '':
      return { exit: false };
    case 'exit':
    case 'quit':
      return { exit: true };
    case 'help':
    case '?':
      printHelp(out, catalog);
      return { exit: false };
    case 'clear':
    case 'cls':
      out.write('\x1b[2J\x1b[H');
      return { exit: false };
    case 'footprint':
      await deps.runFootprint(args, { ask });
      return { exit: false };
    case 'certify':
      await deps.runCertify(args, { ask });
      return { exit: false };
    case 'share':
      await deps.runShare(args, { ask });
      return { exit: false };
    case 'map':
      // LOCAL report (graph protagonist, v2). No-op if deps omit it.
      if (deps.runMap) await deps.runMap(args, { ask });
      else out.write(`\n  ${catalog.repl.unknown(command)}\n`);
      return { exit: false };
    case 'sheet':
    case 'report':
      // SHAREABLE report (footprint + certs, no graph). `report` is the
      // back-compat alias of `sheet` (docs/graph-report.md).
      await deps.runReport(args, { ask });
      return { exit: false };
    case 'superadmin':
      // ADR-021 NON-PROD test-identity provisioning (hidden from the banner;
      // a superadmin tool, not a product surface). No-op if deps omit it.
      if (deps.runSuperadmin) await deps.runSuperadmin(args, { ask });
      else out.write(`\n  ${catalog.repl.unknown(command)}\n`);
      return { exit: false };
    default:
      out.write(`\n  ${catalog.repl.unknown(command)}\n`);
      return { exit: false };
  }
}

// The REPL loop. `stdin` is the shared reader from src/repl-stdin.js (an `ask`
// with .isEnded()). Prints the banner, then loops: prompt -> read line ->
// dispatch, until `exit`/`quit` or EOF (Ctrl-D / end of piped input).
async function runRepl({ stdin, deps, lang = 'en', version = '', out = process.stdout, color }) {
  const catalog = getCatalog(lang);
  const useColor = color === undefined ? !!out.isTTY : color;

  // Banner is always English; boxed layout adapts to the terminal width.
  out.write(renderBanner({ version, color: useColor, width: out.columns || 80 }));

  for (;;) {
    out.write(renderPrompt({ lang, color: useColor }));
    const line = await stdin(''); // prompt already printed; '' = don't reprint
    // Distinguish real EOF ('' + ended) from an empty line on a TTY.
    if (line === '' && stdin.isEnded && stdin.isEnded()) break;

    const parsed = parseCommandLine(line);
    if (parsed.command === '') continue;

    const result = await dispatchCommand(parsed, { ask: stdin, catalog, deps, out });
    if (result.exit) break;
  }

  // Goodbye + a branded link to the Shakers web. `exit`/`quit` and EOF
  // (Ctrl-D / end of piped input) both flow through here; the Ctrl-C path in
  // bin/sh-eval.js reuses the same renderGoodbye so every exit looks the same.
  out.write(renderGoodbye({ lang, color: useColor }));
}

// The farewell block shown on EVERY way out of the REPL: the i18n goodbye
// line plus a branded link to the Shakers web. Single source of truth so the
// exit/quit, Ctrl-D and Ctrl-C seams stay identical.
function renderGoodbye({ lang = 'en', color = false } = {}) {
  const catalog = getCatalog(lang);
  // OSC 8: make the Shakers URL clickable in iTerm2 &c. The label carries the
  // colour (teal500 when colour is on); terminals without OSC 8 just show the
  // coloured/plain URL. The lime bolt stays OUTSIDE the link.
  const label = color ? `${fg(BRAND.teal500)}${SHAKERS_URL}${RESET}` : SHAKERS_URL;
  const bolt = color ? `${fg(BRAND.lime)}ϟ${RESET}` : 'ϟ';
  const link = `${bolt} ${oscLink(SHAKERS_URL, label)}`;
  return `\n  ${catalog.repl.goodbye}\n  ${link}\n\n`;
}

module.exports = {
  renderBanner,
  renderPrompt,
  renderGoodbye,
  tokenize,
  parseCommandLine,
  dispatchCommand,
  runRepl,
  BRAND,
};
