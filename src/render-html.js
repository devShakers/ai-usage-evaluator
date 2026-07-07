'use strict';

/*
 * Genera un dashboard HTML AUTOCONTENIDO: todo el CSS y los datos van
 * incrustados en el fichero. No hace ninguna llamada de red, así el talento
 * abre el .html con doble clic y funciona sin servidor ni conexión.
 *
 * Dirección de diseño ("consola de señales"): panel de instrumentos sobre
 * fondo azul-pizarra profundo, tipografía monoespaciada como voz principal
 * (encaja con el mundo de la terminal), acento teal para lo detectado y ámbar
 * para el nivel. Cada herramienta es un "canal": encendido si se detecta,
 * apagado y tenue si no. El contraste entre canales es el elemento memorable.
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

function channelRow(tool) {
  if (!tool.detected) {
    return `<li class="ch off">
      <span class="dot"></span>
      <span class="nm">${esc(tool.name)}</span>
      <span class="cat">${esc(tool.category)}</span>
      <span class="sig" aria-hidden="true"></span>
      <span class="meta">no detectada</span>
    </li>`;
  }
  const s = strength(tool);
  const bars = Array.from({ length: 4 }, (_, i) =>
    `<i class="${i < s ? 'on' : ''}"></i>`).join('');
  return `<li class="ch on">
    <span class="dot"></span>
    <span class="nm">${esc(tool.name)}</span>
    <span class="cat">${esc(tool.category)}</span>
    <span class="sig">${bars}</span>
    <span class="meta">${depthLabel(tool) || esc(tool.vendor)}</span>
  </li>`;
}

function renderHtml(report, maturity) {
  const channels = report.tools
    .slice()
    .sort((a, b) => Number(b.detected) - Number(a.detected))
    .map(channelRow)
    .join('\n');

  const detectedCount = report.tools.filter((t) => t.detected).length;
  const dataJson = esc(JSON.stringify({ report, maturity }, null, 2));

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Footprint · Nivel ${maturity.level}</title>
<style>
  :root{
    --ink:#0d1526; --panel:#131f33; --panel2:#0f1b2e; --line:#223349;
    --text:#e6eef7; --mute:#7d90a8; --signal:#34d3c4; --warm:#f0b23c;
    --off:#2a3a52;
    --mono:ui-monospace,"SF Mono","Cascadia Code","JetBrains Mono",Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:
      radial-gradient(1200px 600px at 80% -10%, #16243d 0%, transparent 60%),
      var(--ink);
    color:var(--text);font-family:var(--mono);line-height:1.5;
    -webkit-font-smoothing:antialiased;padding:40px 20px 64px;}
  .wrap{max-width:820px;margin:0 auto}
  .eyebrow{font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--mute)}
  .eyebrow b{color:var(--signal);font-weight:600}
  header{border-bottom:1px solid var(--line);padding-bottom:28px;margin-bottom:28px}
  .lvlrow{display:flex;flex-wrap:wrap;align-items:flex-end;gap:24px 40px;margin-top:18px}
  .lvl .n{font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:var(--mute)}
  .lvl .v{font-size:clamp(38px,7vw,62px);font-weight:700;letter-spacing:-.02em;line-height:1;
    font-family:var(--sans);margin-top:6px}
  .lvl .v small{display:block;font-family:var(--mono);font-size:15px;font-weight:400;
    letter-spacing:.02em;color:var(--signal);margin-top:10px}
  .meter{flex:1;min-width:220px}
  .meter .top{display:flex;justify-content:space-between;font-size:12px;color:var(--mute);
    letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px}
  .track{height:10px;background:var(--panel2);border:1px solid var(--line);border-radius:2px;overflow:hidden}
  .fill{height:100%;width:0;background:linear-gradient(90deg,var(--signal),#6ff3e6);
    box-shadow:0 0 18px rgba(52,211,196,.5);transition:width 1.1s cubic-bezier(.2,.7,.2,1)}
  .fill.go{width:${maturity.score}%}

  section h2{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--mute);
    font-weight:500;margin:0 0 14px}
  ul.channels{list-style:none;margin:0 0 32px;padding:0;display:flex;flex-direction:column;gap:1px;
    background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden}
  .ch{display:grid;grid-template-columns:14px 1fr auto auto;align-items:center;gap:14px;
    background:var(--panel);padding:13px 18px;font-size:14px}
  .ch .dot{width:9px;height:9px;border-radius:50%;background:var(--off)}
  .ch.on .dot{background:var(--signal);box-shadow:0 0 10px var(--signal)}
  .ch .nm{font-weight:600;letter-spacing:.01em}
  .ch .cat{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
  .ch .sig{display:inline-flex;gap:3px;align-items:flex-end;height:16px;justify-self:end}
  .ch .sig i{width:4px;height:6px;background:var(--off);border-radius:1px}
  .ch .sig i:nth-child(2){height:9px}
  .ch .sig i:nth-child(3){height:12px}
  .ch .sig i:nth-child(4){height:16px}
  .ch.on .sig i.on{background:var(--signal)}
  .ch .meta{grid-column:2 / -1;font-size:12px;color:var(--mute);letter-spacing:.02em}
  .ch.off{background:var(--panel2)}
  .ch.off .nm{color:var(--mute);font-weight:500}

  .next{border:1px solid var(--line);border-left:3px solid var(--warm);border-radius:6px;
    background:linear-gradient(90deg,rgba(240,178,60,.06),transparent);padding:20px 22px;margin-bottom:28px}
  .next .k{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--warm);margin-bottom:8px}
  .next .t{font-family:var(--sans);font-size:16px;line-height:1.55}

  footer{border-top:1px solid var(--line);padding-top:20px;color:var(--mute);font-size:12px}
  footer .priv{color:var(--text);opacity:.85;margin-bottom:10px}
  footer code{color:var(--signal)}
  details{margin-top:14px}
  details summary{cursor:pointer;color:var(--mute)}
  pre{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:14px;
    overflow:auto;font-size:11px;color:var(--mute);max-height:280px}

  @media (prefers-reduced-motion:reduce){.fill{transition:none}.fill.go{width:${maturity.score}%}
    .ch{animation:none !important;opacity:1 !important}}
  ul.channels .ch{opacity:0;transform:translateY(6px);animation:rise .5s forwards}
  @keyframes rise{to{opacity:1;transform:none}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow"><b>AI FOOTPRINT</b> · perfil de uso de IA</div>
    <div class="lvlrow">
      <div class="lvl">
        <div class="n">Nivel ${maturity.level} de 4</div>
        <div class="v">${maturity.emoji} ${esc(maturity.name)}
          <small>${detectedCount} de ${report.tools.length} herramientas detectadas</small>
        </div>
      </div>
      <div class="meter">
        <div class="top"><span>Madurez</span><span>${maturity.score} / 100</span></div>
        <div class="track"><div class="fill" id="fill"></div></div>
      </div>
    </div>
  </header>

  <section>
    <h2>Canales</h2>
    <ul class="channels">
      ${channels}
    </ul>
  </section>

  <div class="next">
    <div class="k">Siguiente paso</div>
    <div class="t">${esc(maturity.next)}</div>
  </div>

  <footer>
    <div class="priv">Este informe se ha generado en local. Solo registra qué herramientas
      existen, cuántas configuraciones tienes y tu nivel: nunca el contenido de tus ficheros,
      rutas ni credenciales.</div>
    <div>Generado ${esc(new Date(report.generatedAt).toLocaleString())}
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
    document.getElementById('fill').classList.add('go');
    var chs = document.querySelectorAll('ul.channels .ch');
    chs.forEach(function(el,i){ el.style.animationDelay = (i*45)+'ms'; });
  });
</script>
</body>
</html>`;
}

module.exports = { renderHtml };
