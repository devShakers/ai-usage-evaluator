'use strict';

const { getCatalog } = require('./i18n');

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
  lime: [216, 230, 55],    // #d8e637 lime — HERO accent (bolt, border, titles)
  violet: [139, 92, 246],  // #8b5cf6 — sparing 2nd accent
  white: [244, 244, 245],  // primary text
  zinc: [113, 113, 122],   // secondary / meta text
  dark: [14, 14, 16],      // logo tile background
};

function fg(rgb) {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}
function bg(rgb) {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// Pixel-art lightning bolt — the logo's hero element (a thick, angular lime
// bolt on a dark tile, echoing the Shakers mark). Built from DIAGONAL glyphs
// (◢◣◤◥) + blocks so it reads as a real zigzag bolt: a diagonal upper stroke,
// a sharp jag across the middle, and a diagonal lower stroke (an S/Z), NOT a
// symmetric cross. All glyphs are BMP single-width, so alignment holds; plain
// (no-colour) still renders the shape via the triangle glyphs.
const BOLT_ART = [
  '   ◢███◤',
  '  ◢███◤',
  ' ◢███◤',
  '◢███████◣',
  '  ▀▀◥███◣',
  '     ◥███◣',
  '      ◥██',
];
const ART_W = Math.max(...BOLT_ART.map((s) => s.length));

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
function bd(ch, color) { return color ? `${fg(BRAND.lime)}${ch}${RESET}` : ch; }

// Rounded top border with the title embedded, Claude-Code style:
//   ╭─ sh-eval · v0.1.0 ───────…───────╮
function topBorder(title, inner, color) {
  const dashCount = Math.max(0, inner - (title.length + 3)); // "─ " + title + " "
  if (!color) return `╭─ ${title} ${'─'.repeat(dashCount)}╮`;
  return `${fg(BRAND.lime)}╭─ ${RESET}${BOLD}${fg(BRAND.white)}${title}${RESET}`
    + `${fg(BRAND.lime)} ${'─'.repeat(dashCount)}╮${RESET}`;
}
function bottomBorder(inner, color) { return bd(`╰${'─'.repeat(inner)}╯`, color); }

// One tile row: dark-background tile with the lime bolt. Every row is padded to
// the same inner width (ART_W) + a 1-space margin each side, so the dark bg
// forms a clean rectangle behind the bolt. Width = ART_W + 2.
const TILE_W = ART_W + 2;
function tileCell(i) {
  const art = BOLT_ART[i] || '';
  const t = ` ${art}${' '.repeat(ART_W - art.length)} `;
  return { t, st: { bg: BRAND.dark, fg: BRAND.lime, bold: true } };
}

// Builds the startup banner (shown ONCE on entry). Deliberately ALWAYS ENGLISH —
// a brand/product surface like the installer notice (functional footprint/
// certify output still respects the OS locale). Two-column boxed layout on wide
// terminals, degrading to a single stacked column under ~76 columns.
function renderBanner({ version = '', color = true, width = 80 } = {}) {
  const title = version ? `sh-eval · v${version}` : 'sh-eval';
  return width >= 76
    ? bannerWide({ title, color })
    : bannerStacked({ title, color, width });
}

function bannerWide({ title, color }) {
  const LW = 24;         // left (logo) column
  const RW = 44;         // right (info) column
  const INNER = 1 + LW + 3 + RW + 1; // between the outer borders (73)

  // Left column: welcome, bolt tile, product line.
  const left = [];
  left.push([{ t: 'Welcome to ', st: { bold: true, fg: BRAND.white } }, { t: 'shakers', st: { bold: true, fg: BRAND.lime } }]);
  for (let i = 0; i < BOLT_ART.length; i++) left.push([tileCell(i)]);
  left.push([{ t: 'AI Usage Evaluator', st: { fg: BRAND.zinc } }]);

  // Right column: Commands + Getting started (violet, the sparing 2nd accent).
  const NAME = 11;
  const right = [];
  right.push([]); // top spacer, aligns "Commands" with the tile top
  right.push([{ t: 'Commands', st: { bold: true, fg: BRAND.lime } }]);
  right.push([{ t: 'footprint'.padEnd(NAME), st: { bold: true, fg: BRAND.white } }, { t: 'score AI setup (T0–T7) + roadmap', st: { fg: BRAND.zinc } }]);
  right.push([{ t: 'certify'.padEnd(NAME), st: { bold: true, fg: BRAND.white } }, { t: 'certify Skills from your code', st: { fg: BRAND.zinc } }]);
  right.push([{ t: '─'.repeat(RW), st: { fg: BRAND.zinc } }]);
  right.push([{ t: 'Getting started', st: { bold: true, fg: BRAND.violet } }]);
  right.push([
    { t: 'Type ', st: { fg: BRAND.zinc } }, { t: 'footprint', st: { fg: BRAND.white } },
    { t: ' or ', st: { fg: BRAND.zinc } }, { t: 'certify', st: { fg: BRAND.white } },
    { t: ' · help · exit', st: { fg: BRAND.zinc } },
  ]);

  const rows = Math.max(left.length, right.length);
  const lines = [''];
  lines.push(topBorder(title, INNER, color));
  for (let i = 0; i < rows; i++) {
    const l = centerCells(left[i] || [], LW, color);
    const r = padRightCells(right[i] || [], RW, color);
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
  for (let i = 0; i < BOLT_ART.length; i++) lines.push(line([tileCell(i)], { center: true }));
  lines.push(line([{ t: 'Welcome to ', st: { bold: true, fg: BRAND.white } }, { t: 'shakers', st: { bold: true, fg: BRAND.lime } }], { center: true }));
  lines.push(line([{ t: 'AI Usage Evaluator', st: { fg: BRAND.zinc } }], { center: true }));
  lines.push(line([{ t: '', st: null }]));
  lines.push(line([{ t: 'Commands', st: { bold: true, fg: BRAND.lime } }]));
  lines.push(line([{ t: 'footprint  ', st: { bold: true, fg: BRAND.white } }, { t: 'score AI setup (T0–T7)', st: { fg: BRAND.zinc } }]));
  lines.push(line([{ t: 'certify    ', st: { bold: true, fg: BRAND.white } }, { t: 'certify your Skills', st: { fg: BRAND.zinc } }]));
  lines.push(line([{ t: '', st: null }]));
  lines.push(line([{ t: 'Type footprint or certify · help · exit', st: { fg: BRAND.zinc } }]));
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

  out.write(`\n  ${catalog.repl.goodbye}\n\n`);
}

module.exports = {
  renderBanner,
  renderPrompt,
  tokenize,
  parseCommandLine,
  dispatchCommand,
  runRepl,
  BRAND,
};
