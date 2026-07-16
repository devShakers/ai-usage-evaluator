'use strict';

const { getCatalog } = require('./i18n');

/*
 * Branded mini-shell (ADR-014). The REPL is the SINGLE entrypoint of the tool
 * (`shakers`): it prints a Shakers wordmark, shows a prompt, and dispatches the
 * SAME command logic that used to live behind the `ai-footprint`/`ai-certify`
 * binaries — no behaviour change, the commands are just wrapped.
 *
 * Zero-dependency: node stdlib + ANSI only (no TUI framework), honouring the
 * repo invariant. Logic lives here (testable) so bin/shakers.js stays a thin
 * entrypoint (bin/*.js call their entry on load and can't be require()d).
 *
 * The commands are injected as `deps.runFootprint(args, { ask })` /
 * `deps.runCertify(args, { ask })` so the shell is unit-testable with fakes and
 * never hard-imports the binaries here.
 */

// ── Shakers brand colours (from shakers-design-system/design-spec/tokens.css) ──
// 24-bit truecolour ANSI. Gated on a TTY by the caller (colour=false -> plain).
const BRAND = {
  primary: [5, 52, 44],    // #05342c teal (primary)
  teal500: [14, 125, 105], // #0e7d69 teal-500
  lime: [216, 230, 55],    // #d8e637 lime spark
  zinc: [113, 113, 122],   // muted grey for the tagline
};

function fg(rgb) {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ASCII wordmark. Kept as plain text so it degrades gracefully when colour is
// off (piped / non-TTY).
const WORDMARK = [
  '  ____  _   _    _    _  _______ ____  ____  ',
  ' / ___|| | | |  / \\  | |/ / ____|  _ \\/ ___| ',
  ' \\___ \\| |_| | / _ \\ | \' /|  _| | |_) \\___ \\ ',
  '  ___) |  _  |/ ___ \\| . \\| |___|  _ < ___) |',
  ' |____/|_| |_/_/   \\_\\_|\\_\\_____|_| \\_\\____/ ',
];

// Builds the startup banner: coloured wordmark + a lime underline spark +
// tagline and version. `color=false` yields a plain, accent-free banner.
function renderBanner({ lang = 'en', version = '', color = true } = {}) {
  const catalog = getCatalog(lang);
  const r = catalog.repl;
  const lines = [];
  lines.push('');
  for (const row of WORDMARK) {
    lines.push(color ? `${BOLD}${fg(BRAND.teal500)}${row}${RESET}` : row);
  }
  const spark = ' ────────────────────────────────────────── ';
  lines.push(color ? `${fg(BRAND.lime)}${spark}${RESET}` : spark);
  const tagline = `  ${r.tagline}${version ? `  ·  v${version}` : ''}`;
  lines.push(color ? `${fg(BRAND.zinc)}${tagline}${RESET}` : tagline);
  lines.push(color ? `${fg(BRAND.zinc)}  ${r.hint}${RESET}` : `  ${r.hint}`);
  lines.push('');
  return lines.join('\n') + '\n';
}

// The coloured prompt string (e.g. "shakers ›"). No trailing newline.
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

  out.write(renderBanner({ lang, version, color: useColor }));

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
  WORDMARK,
  BRAND,
};
