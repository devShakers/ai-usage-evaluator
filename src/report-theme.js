'use strict';

/*
 * Shared, self-contained Shakers visual theme for BOTH HTML reports
 * (ai-footprint's dashboard and ai-certify's Skill-certification report),
 * and for the cumulative report that stitches them into ONE document
 * (src/report-store.js). Extracted here (skill-code-certification, reporting
 * redesign) so the two renderers stop diverging: previously render-html.js
 * carried a full Shakers theme while render-certification.js used a generic
 * system-ui/light-dark stylesheet with off-brand colors.
 *
 * Design direction: Shakers design system (design-spec/tokens.css + DESIGN.md).
 * Tokens (teal/lime/zinc palette, DS status colors, radii 6/8/10/14, shadcn
 * shadow set, Inter type scale) are copied VERBATIM from the DS — never
 * invented here. React components can't be imported into a static HTML file,
 * so we reincarnate the visual LANGUAGE (tokens + primitives), not the
 * components.
 *
 * Priority #1 (explicit product requirement): the report background is WHITE
 * (#ffffff — the DS's own `--color-background` token). Unlike the previous
 * footprint theme, there is NO `prefers-color-scheme: dark` override: the
 * surface stays white on every OS/theme, always.
 *
 * Invariant (privacy/trust): ZERO network. No @font-face, no CDN, no remote
 * image, no fetch/XHR. Everything is inline; the only <script> is the
 * clipboard copy helper below (local DOM only).
 */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ---------- design tokens (Shakers "Nexia", light-only, WHITE bg) ---------- */

const TOKENS_CSS = `
  :root{
    /* Layer 1 — brand primitives (subset used), verbatim from the DS */
    --ds-teal-50:#e2f2f0; --ds-teal-100:#c5e5e1; --ds-teal-300:#51b1a5;
    --ds-teal-400:#269787; --ds-teal-500:#0e7d69; --ds-teal-600:#0b5a4c;
    --ds-teal-700:#08473c; --ds-teal-800:#05342c; --ds-teal-900:#03211c;
    --ds-lime-200:#f5ff96; --ds-lime-500:#d8e637; --ds-lime-600:#b0bd2d;
    --ds-zinc-50:#fafafa; --ds-zinc-100:#f4f4f5; --ds-zinc-200:#e4e4e7;
    --ds-zinc-300:#d4d4d8; --ds-zinc-400:#a1a1aa; --ds-zinc-500:#71717a;
    --ds-zinc-600:#52525b; --ds-zinc-700:#3f3f46; --ds-zinc-800:#27272a; --ds-zinc-900:#18181b;
    --ds-zinc-950:#09090b; --ds-white:#ffffff;
    /* DS status palette (design-spec/tokens.css) — used for score bands and
       the "partial sample" warning; functional status colors, not invented. */
    --ds-success:#059669; --ds-success-fg:#ecfdf5;
    --ds-warning:#f59e0b; --ds-warning-fg:#fffdf5;
    --ds-destructive:#e11d48; --ds-destructive-fg:#fef2f2;

    /* Radii ("Border Radius" frame) */
    --r-sm:6px; --r-md:8px; --r-lg:10px; --r-xl:14px; --r-full:9999px;
    /* Shadows (shadcn upstream) */
    --shadow-sm:0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1);
    --shadow-md:0 1px 3px 0 rgb(0 0 0 / .1), 0 2px 4px -1px rgb(0 0 0 / .1);
    --shadow-lg:0 1px 3px 0 rgb(0 0 0 / .1), 0 4px 6px -1px rgb(0 0 0 / .1);

    /* Inter with a system fallback (no @font-face, no network): if Inter isn't
       installed it degrades to the DS's own fallback stack. */
    --font-sans:"Inter",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,
      "Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif,
      "Apple Color Emoji","Segoe UI Emoji";
    --font-mono:ui-monospace,"SF Mono","Cascadia Code","JetBrains Mono",Menlo,Consolas,monospace;

    /* Layer 2 — semantic (light theme, the ONLY theme). Background is WHITE
       (the DS's --color-background), priority #1. */
    --bg:var(--ds-white);
    --surface:var(--ds-white);
    --fg:var(--ds-zinc-900);
    --muted:var(--ds-zinc-700);
    /* zinc-600 (not zinc-500) for caption/label text: clears WCAG AA on white. */
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
    /* Model chip: an opaque lime tint over the surface, dark teal text. */
    --model-bg:color-mix(in srgb,var(--ds-lime-500) 26%, var(--surface));
    --model-fg:var(--ds-teal-800);
    --off:var(--ds-zinc-300);
    --track:var(--ds-zinc-100);
    --ring:var(--ds-teal-500);
    /* Score bands (certification): DS status colors. */
    --band-high-bg:var(--ds-success); --band-high-fg:var(--ds-success-fg);
    --band-mid-bg:var(--ds-warning); --band-mid-fg:var(--ds-warning-fg);
    --band-low-bg:var(--ds-destructive); --band-low-fg:var(--ds-destructive-fg);
  }
`;

/* ---------- shared base + primitives (used by every report) ---------- */

const BASE_CSS = `
  *{box-sizing:border-box}
  html{color-scheme:light}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:var(--font-sans);line-height:1.45;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
    padding:40px 20px 64px;}
  .wrap{max-width:840px;margin:0 auto;overflow-x:clip}
  .card{background:var(--surface);border:1px solid var(--border);
    border-radius:var(--r-lg);box-shadow:var(--shadow-sm)}

  /* Header */
  header{margin-bottom:24px}
  .badge{display:inline-flex;align-items:center;gap:8px;
    background:var(--secondary);color:var(--secondary-fg);
    font-size:12px;font-weight:600;letter-spacing:.02em;
    padding:5px 12px;border-radius:var(--r-full)}
  .badge .spark{width:7px;height:7px;border-radius:50%;background:var(--emphasis)}
  h1{font-size:clamp(28px,5vw,36px);font-weight:700;letter-spacing:-.02em;
    line-height:1.15;margin:16px 0 6px}
  .sub{color:var(--muted);font-size:16px;margin:0}

  /* Section scaffolding */
  section{margin-bottom:24px}
  .h2{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:var(--faint);margin:0 0 12px 2px}

  /* Chips */
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:11px;font-weight:500;letter-spacing:.02em;color:var(--secondary-fg);
    background:var(--secondary);padding:3px 10px;border-radius:var(--r-full);
    flex:none;white-space:nowrap}
  .chip.empty{background:transparent;color:var(--faint);padding-left:0}

  /* Footer */
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

  @media (prefers-reduced-motion:reduce){
    *{animation:none!important;transition:none!important}
  }
`;

// Generic, zero-network clipboard helper shared by every report. Any button
// with data-copy-target="<id>" copies that element's textContent, swapping to
// data-copied-label for ~1.8s. Reads text from the DOM (never a re-embedded JS
// string literal), so multi-line prompts full of quotes/backticks need no
// escaping. Safe to include even when there are no copy buttons on the page.
const COPY_SCRIPT = `
  (function(){
    function fallbackCopy(text){
      var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');
      ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();
      try{document.execCommand('copy');}catch(e){}document.body.removeChild(ta);
    }
    document.querySelectorAll('[data-copy-target]').forEach(function(btn){
      btn.addEventListener('click',function(){
        var target=document.getElementById(btn.getAttribute('data-copy-target'));
        if(!target)return;var text=target.textContent;
        var showCopied=function(){
          var original=btn.getAttribute('data-original-label')||btn.textContent;
          btn.setAttribute('data-original-label',original);
          btn.textContent=btn.getAttribute('data-copied-label')||original;
          btn.classList.add('copied');
          setTimeout(function(){btn.textContent=original;btn.classList.remove('copied');},1800);
        };
        if(navigator.clipboard&&navigator.clipboard.writeText){
          navigator.clipboard.writeText(text).then(showCopied,function(){fallbackCopy(text);showCopied();});
        }else{fallbackCopy(text);showCopied();}
      });
    });
  })();
`;

/*
 * Assembles a full, self-contained HTML document from the shared theme plus a
 * report's own component CSS, body markup, and (optional) extra script. The
 * <style> is always: TOKENS -> BASE -> the report's componentCss.
 */
function renderDocument({ lang, title, componentCss = '', body, script = '' }) {
  const scriptTag = (COPY_SCRIPT + '\n' + script).trim();
  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${TOKENS_CSS}${BASE_CSS}${componentCss}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
<script>${scriptTag}</script>
</body>
</html>`;
}

module.exports = { esc, renderDocument, TOKENS_CSS, BASE_CSS, COPY_SCRIPT };
