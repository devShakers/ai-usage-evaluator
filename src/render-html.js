'use strict';

/*
 * Genera un dashboard HTML AUTOCONTENIDO: todo el CSS y los datos van
 * incrustados en el fichero. No hace ninguna llamada de red, así el talento
 * abre el .html con doble clic y funciona sin servidor ni conexión.
 *
 * Dirección de diseño: lenguaje visual de Shakers (design system "Nexia").
 * Superficie clara y sobria por defecto, verde teal corporativo como color de
 * marca y de "señal detectada", acento lime para el impulso ("siguiente paso"),
 * tipografía Inter (con fallback de sistema — ver nota de DRIFT). Layout basado
 * en tarjetas (cards) con la escala de radios/sombras/espaciado del DS.
 * Soporta claro y oscuro vía prefers-color-scheme, como define Nexia.
 *
 * IMPORTANTE (invariante de privacidad/confianza): CERO llamadas de red. Sin
 * fuentes externas, sin CDN, sin imágenes remotas, sin fetch/XHR. Todo inline.
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

// Formatea bytes a una unidad legible (B/KB/MB). Solo presentación: el dato
// crudo (tool.footprint.bytes) ya viene agregado y saneado del scanner.
function humanizeBytes(bytes) {
  if (bytes === null || bytes === undefined) return null;
  if (bytes < 1024) return `${bytes}&nbsp;B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}&nbsp;KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}&nbsp;MB`;
}

// tool.footprint es null cuando la herramienta no tiene ruta propia que medir
// (detectada solo por bin/vscodeExt) — se renderiza null y el llamador lo omite.
function footprintLabel(tool) {
  if (!tool.footprint) return null;
  const { bytes, files } = tool.footprint;
  const size = humanizeBytes(bytes);
  const filesLabel = `${files}&nbsp;${files === 1 ? 'fichero' : 'ficheros'}`;
  return size ? `${filesLabel} · ${size}` : filesLabel;
}

const RECENCY_LABEL = {
  today: 'hoy',
  this_week: 'esta semana',
  this_month: 'este mes',
  this_quarter: 'este trimestre',
  stale: 'desactualizado',
};

// Badge de recencia: cuenta con bucket=null (sin footprint que fechar) y lo
// omite en silencio, en vez de mostrar un estado inventado.
function recencyBadge(tool) {
  const r = tool.recency;
  if (!r || !r.bucket) return '';
  const label = RECENCY_LABEL[r.bucket] || r.bucket;
  const title = r.lastModified
    ? `última modificación: ${new Date(r.lastModified).toLocaleDateString()}`
    : '';
  return `<span class="recency ${esc(r.bucket)}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
}

// tool.version es null cuando no se detectó por binario en PATH, o el binario
// no respondió a --version: se omite, nunca se inventa "desconocida".
function versionLabel(tool) {
  if (!tool.version) return '';
  return `<span class="ver">v${esc(tool.version)}</span>`;
}

function toolRow(tool) {
  if (!tool.detected) {
    return `<li class="tool off">
      <span class="dot" aria-hidden="true"></span>
      <span class="nm">${esc(tool.name)}</span>
      <span class="cat">${esc(tool.category)}</span>
      <span class="sig" aria-hidden="true"></span>
      <span class="meta">no detectada</span>
    </li>`;
  }
  const s = strength(tool);
  const bars = Array.from({ length: 4 }, (_, i) =>
    `<i class="${i < s ? 'on' : ''}"></i>`).join('');
  const metaLeft = [depthLabel(tool), footprintLabel(tool)].filter(Boolean).join(' · ')
    || esc(tool.vendor);
  return `<li class="tool on">
    <span class="dot" aria-hidden="true"></span>
    <span class="nm">${esc(tool.name)}${versionLabel(tool)}</span>
    <span class="cat">${esc(tool.category)}</span>
    <span class="sig" title="intensidad de configuración">${bars}</span>
    <span class="meta"><span class="left">${metaLeft}</span>${recencyBadge(tool)}</span>
  </li>`;
}

function renderHtml(report, maturity) {
  const rows = report.tools
    .slice()
    .sort((a, b) => Number(b.detected) - Number(a.detected))
    .map(toolRow)
    .join('\n');

  const detectedCount = report.tools.filter((t) => t.detected).length;
  const dataJson = esc(JSON.stringify({ report, maturity }, null, 2));

  // Bloque Entorno: campo nuevo del scanner, opcional por compatibilidad con
  // informes generados antes de este campo (report.environment ausente).
  const env = report.environment || {};
  const editors = Array.isArray(env.editorsInstalled) ? env.editorsInstalled : [];
  const editorChips = editors.length
    ? editors.map((id) => `<span class="chip">${esc(id)}</span>`).join('')
    : '<span class="chip empty">ninguno detectado</span>';

  // Escala de niveles 0..4 para el indicador de progreso por pasos.
  const levelPips = Array.from({ length: 5 }, (_, i) => {
    const cls = i < maturity.level ? 'done' : (i === maturity.level ? 'here' : '');
    return `<span class="pip ${cls}"></span>`;
  }).join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Footprint · Nivel ${maturity.level}</title>
<style>
  /* =========================================================
   * Tokens Shakers (Nexia). Layer 1 (primitivos) → Layer 2 (semánticos).
   * Reimplementados inline: no se pueden importar componentes React en un
   * HTML estático, así que reencarnamos el lenguaje visual, no los componentes.
   * ========================================================= */
  :root{
    /* Layer 1 — primitivos de marca (subconjunto usado) */
    --ds-teal-50:#e2f2f0; --ds-teal-100:#c5e5e1; --ds-teal-300:#51b1a5;
    --ds-teal-400:#269787; --ds-teal-500:#0e7d69; --ds-teal-600:#0b5a4c;
    --ds-teal-700:#08473c; --ds-teal-800:#05342c; --ds-teal-900:#03211c;
    --ds-lime-200:#f5ff96; --ds-lime-500:#d8e637; --ds-lime-600:#b0bd2d;
    --ds-zinc-50:#fafafa; --ds-zinc-100:#f4f4f5; --ds-zinc-200:#e4e4e7;
    --ds-zinc-300:#d4d4d8; --ds-zinc-400:#a1a1aa; --ds-zinc-500:#71717a;
    --ds-zinc-700:#3f3f46; --ds-zinc-800:#27272a; --ds-zinc-900:#18181b;
    --ds-zinc-950:#09090b; --ds-white:#ffffff;

    /* Radios (frame "Borde Radius") */
    --r-sm:6px; --r-md:8px; --r-lg:10px; --r-xl:14px; --r-full:9999px;
    /* Sombras (shadcn upstream, mismo set claro/oscuro) */
    --shadow-sm:0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1);
    --shadow-md:0 1px 3px 0 rgb(0 0 0 / .1), 0 2px 4px -1px rgb(0 0 0 / .1);
    --shadow-lg:0 1px 3px 0 rgb(0 0 0 / .1), 0 4px 6px -1px rgb(0 0 0 / .1);

    /* Tipografía Inter con fallback de sistema (ver nota DRIFT). Sin @font-face
       ni red: si Inter no está instalada, degrada al stack del propio DS. */
    --font-sans:"Inter",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,
      "Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif,
      "Apple Color Emoji","Segoe UI Emoji";
    --font-mono:ui-monospace,"SF Mono","Cascadia Code","JetBrains Mono",Menlo,Consolas,monospace;

    /* Layer 2 — semánticos (tema claro, default de Nexia) */
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

  /* ---- Hero card: nivel + medidor ---- */
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

  /* ---- Sección herramientas ---- */
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

  /* ---- Badge de recencia (bucket derivado del mtime, ver ADR-003 scanner) ---- */
  .recency{flex:none;font-size:10px;font-weight:600;letter-spacing:.04em;
    text-transform:uppercase;padding:2px 8px;border-radius:var(--r-full);
    white-space:nowrap}
  .recency.today,.recency.this_week{background:var(--secondary);color:var(--secondary-fg)}
  .recency.this_month{background:var(--track);color:var(--muted)}
  .recency.this_quarter{background:var(--track);color:var(--faint)}
  .recency.stale{background:color-mix(in srgb,var(--accent-lime) 32%, transparent);
    color:var(--accent-lime-fg)}

  /* ---- Entorno ---- */
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

  /* ---- Siguiente paso (acento lime = impulso) ---- */
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

  /* Animaciones sutiles (se anulan con reduced-motion) */
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
    <h1>Tu perfil de uso de IA</h1>
    <p class="sub">Un vistazo local a qué herramientas de IA tienes y cuánto las has configurado.</p>
  </header>

  <div class="card hero">
    <div class="lvl">
      <div class="k">Nivel ${maturity.level} de 4</div>
      <div class="v">
        <span class="glyph">${maturity.emoji}</span>
        <span class="name">${esc(maturity.name)}</span>
      </div>
      <div class="pips">${levelPips}</div>
      <div class="count"><b>${detectedCount}</b> de ${report.tools.length} herramientas detectadas</div>
    </div>
    <div class="meter">
      <div class="top">
        <span>Madurez</span>
        <span class="score">${maturity.score}<span> / 100</span></span>
      </div>
      <div class="track"><div class="fill" id="fill"></div></div>
    </div>
  </div>

  <section>
    <div class="h2">Herramientas</div>
    <ul class="tools">
      ${rows}
    </ul>
  </section>

  <section>
    <div class="h2">Entorno</div>
    <div class="card env">
      <div class="env-grid">
        <div class="env-item"><span class="k">Plataforma</span><span class="v">${esc(env.platform ?? '—')}</span></div>
        <div class="env-item"><span class="k">Arquitectura</span><span class="v">${esc(env.arch ?? '—')}</span></div>
        <div class="env-item"><span class="k">Node</span><span class="v">${esc(env.nodeVersion ?? '—')}</span></div>
      </div>
      <div class="env-editors">
        <span class="k">Editores instalados</span>
        <div class="chips">${editorChips}</div>
      </div>
    </div>
  </section>

  <section>
    <div class="card next">
      <div class="icon" aria-hidden="true">→</div>
      <div>
        <div class="k">Siguiente paso</div>
        <div class="t">${esc(maturity.next)}</div>
      </div>
    </div>
  </section>

  <footer>
    <div class="priv">
      <span class="lock" aria-hidden="true">🔒</span>
      <span>Este informe se ha generado en local. Solo registra qué herramientas
      existen, cuántas configuraciones tienes y tu nivel: nunca el contenido de tus
      ficheros, rutas ni credenciales.</span>
    </div>
    <div class="meta-line">Generado ${esc(new Date(report.generatedAt).toLocaleString())}
      · id anónimo <code>${esc(report.anonId)}</code>
      · plataforma ${esc(report.platform)}</div>
    <details>
      <summary>Ver los datos exactos de este informe (JSON)</summary>
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
