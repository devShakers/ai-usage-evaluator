'use strict';

const { detectLangCode } = require('./locale');
const { CATEGORIES } = require('./detectors');

/*
 * Localization of the report (HTML + terminal) and of the CLI notices tied
 * to the report. Only two languages supported: 'es' and 'en'. Resolution
 * rule: any language that does NOT start with 'es' falls back to English —
 * English is the universal fallback, not just the language for English
 * speakers (talents-ai-score, report-i18n).
 *
 * Isolated change (talents-ai-score, report-i18n): this does NOT touch
 * src/maturity.js or src/detectors.js/src/scanner.js. `maturity.name` /
 * `maturity.next` (Spanish) remain untouched because src/share.js consumes
 * them as-is in the payload (maturity.name -> levelName). Here translation
 * happens by an already-existing STABLE KEY:
 *   - maturity level -> maturity.key ('none'|'exploring'|...) and
 *     maturity.level (0-4), both already returned by maturity.js unchanged.
 *   - tool category -> the stable key (AGENTIC_CLI, AI_EDITOR...) is
 *     resolved from the very `CATEGORIES` catalog that detectors.js ALREADY
 *     exports, by inverting its key->Spanish-text map (see categoryLabel
 *     below). Nothing is added or changed in detectors.js: only what it
 *     already exposes is read.
 *
 * Extension (talents-ai-score, ADR-007): the `consent` catalog below covers
 * the disclosure + consent + email-management copy used by
 * src/consent-flow.js and bin/report.js's one-shot consent commands. Unlike
 * the original report-i18n note above (which scoped this file to report
 * rendering only), the consent/disclosure flow is intentionally localized
 * too — GDPR-adjacent copy shouldn't default to a language the talent may
 * not read. It reuses the same `detectReportLang()` entry point.
 */

const catalogs = {
  es: {
    categories: {
      AGENTIC_CLI: 'CLI agéntica',
      AI_EDITOR: 'Editor con IA',
      IDE_ASSISTANT: 'Asistente en IDE',
      COMPLETION: 'Autocompletado',
      AI_TERMINAL: 'Terminal con IA',
    },
    // MCP server categories (talents-ai-score, issue 015's mcp-detector
    // heuristic: data|comms|dev|browser|other) — a DIFFERENT catalog from
    // `categories` above (tool categories), same idea.
    mcpCategories: {
      data: 'Datos',
      comms: 'Comunicación',
      dev: 'Desarrollo',
      browser: 'Navegador',
      other: 'Otro',
    },
    // talents-ai-score, i18n audit: the T0-T7 tier NAMES (as opposed to the
    // 0-4 band names in `levelNames` below) live in src/tier-engine.js's
    // `TIERS` array — Spanish-only there by design, since tier-engine.js is
    // domain logic, not i18n (same isolation rule as `levelNames`'s own
    // header note: nothing is added or changed in the engine itself).
    // Whenever a tier NAME is actually displayed to the talent (the tier-
    // analysis intro, the implementation prompt's context line), it's
    // resolved through this catalog by the stable `tierKey` — never through
    // tier-engine.js's raw (Spanish) `name` field — so it's translated
    // regardless of locale. See `tierName()` below.
    tierNames: {
      T0: 'Banco vacío',
      T1: 'Primera herramienta',
      T2: 'Banco con notas',
      T3: 'Banco conectado',
      T4: 'Herramienta propia',
      T5: 'Operador agéntico',
      T6: 'Multi-agente',
      T7: 'Taller orquestado',
    },
    // Deterministic "why this tier" analysis (talents-ai-score,
    // src/tier-analysis.js): mechanical, formula-driven copy — every
    // sentence is a direct readout of tier-engine.js's own ladder rule plus
    // the exact signal value backing it, not authored/curated prose (unlike
    // roadmap-content.js), so it's fully translated here, no
    // pendingTranslation flag needed.
    tierAnalysis: {
      heading: 'Análisis de tier: por qué este nivel',
      intro: (tierKey, tierName) =>
        `Tu tier actual es ${tierKey} (${tierName}). El motor de tiers es determinista: certifica un nivel `
        + 'solo cuando se cumplen TODOS los criterios de ese nivel y de todos los anteriores, verificado '
        + 'estrictamente de abajo hacia arriba (nunca se salta un tier inferior por tener una señal de uno '
        + 'superior). A continuación se detalla, criterio por criterio, qué se ha comprobado y con qué señal '
        + 'concreta de tu entorno queda respaldado.',
      metHeading: 'Criterios que cumples:',
      blockingLabel: 'Criterio exacto que te impide subir de tier:',
      maxTierNote: 'Cumples todos los criterios de la escalera T0-T7: no hay un criterio adicional bloqueando tu progreso.',
      criterion: {
        t1Met: (n) => `Tienes al menos una herramienta de IA detectada y configurada en tu entorno (\`totalDetected = ${n}\`).`,
        t2Met: (n) => `Dispones de al menos un fichero de contexto persistente — instrucciones, configuración o reglas — para alguna herramienta (\`context = ${n}\`).`,
        t3Met: (n) => `Tienes al menos un servidor MCP conectado, dando a la IA acceso a datos o herramientas externas (\`mcpServers = ${n}\`).`,
        t4Met: (n) => `Has creado activos propios — skills, comandos o reglas personalizadas — más allá de la configuración por defecto (\`custom = ${n}\`).`,
        t5Met: (hasAgentic, mcp, custom) => `Operas con una CLI agéntica (Claude Code, Aider, Gemini CLI, Codex CLI o Amazon Q Developer) combinada con MCP y activos propios (\`hasAgentic = ${hasAgentic}\`, \`mcpServers = ${mcp}\`, \`custom = ${custom}\`).`,
        t6Met: (n) => `Tienes un equipo de al menos 2 agentes especializados definidos (\`agentCounts.agents = ${n}\`).`,
        t7Met: (n) => `Tienes automatización basada en hooks configurada (\`hooks = ${n}\`).`,
        t1Blocking: (n) => `Para subir a T1 (Primera herramienta) necesitas al menos una herramienta de IA detectada — actualmente \`totalDetected = ${n}\`.`,
        t2Blocking: (n) => `Para subir a T2 (Banco con notas) necesitas al menos un fichero de contexto persistente (instrucciones, configuración o reglas) — actualmente \`context = ${n}\`.`,
        t3Blocking: (n) => `Para subir a T3 (Banco conectado) necesitas conectar al menos un servidor MCP — actualmente \`mcpServers = ${n}\`.`,
        t4Blocking: (n) => `Para subir a T4 (Herramienta propia) necesitas crear al menos un activo propio — skill, comando o regla — más allá de la configuración por defecto — actualmente \`custom = ${n}\`.`,
        t5Blocking: (hasAgentic, mcp, custom) => {
          const missing = [];
          if (!hasAgentic) missing.push('una CLI agéntica (Claude Code, Aider, Gemini CLI, Codex CLI o Amazon Q Developer)');
          if (mcp < 1) missing.push('al menos 1 servidor MCP');
          if (custom < 1) missing.push('al menos 1 activo propio (skill, comando o regla)');
          return `Para subir a T5 (Operador agéntico) te falta: ${missing.join('; ')} (\`hasAgentic = ${hasAgentic}\`, \`mcpServers = ${mcp}\`, \`custom = ${custom}\`).`;
        },
        t6Blocking: (n) => `Para subir a T6 (Multi-agente) necesitas al menos 2 agentes especializados definidos en \`.claude/agents/\` — actualmente tienes ${n}.`,
        t7Blocking: (n) => `Para subir a T7 (Taller orquestado) necesitas al menos un hook de automatización configurado — actualmente \`hooks = ${n}\`.`,
      },
    },
    // Progression ladder (skill-code-certification, report req 1): explains what
    // each maturity LEVEL (0-4) and each TIER (T0-T7) represents, and shows which
    // are passed (✓) / current (●) / pending (○) with the unlock criterion. The
    // unlock text itself is reused from `tierAnalysis.criterion.*` above; only the
    // "what it represents" descriptions live here.
    ladder: {
      levelsHeading: 'Niveles de madurez (0-4)',
      tiersHeading: 'Escalera de tiers (T0-T7)',
      levelLabel: (n) => `Nivel ${n}`,
      intro:
        'Tu nivel de madurez (0-4) resume tu uso de IA de un vistazo; el tier (T0-T7) es el eje '
        + 'fino del que se deriva. Ambos son deterministas. Abajo se marca lo que ya has superado (✓), '
        + 'dónde estás ahora (●) y lo que queda por delante (○) con el criterio exacto que lo desbloquea.',
      reachedLabel: 'Superado',
      currentLabel: 'Estás aquí',
      pendingLabel: 'Pendiente',
      unlockLabel: 'Para desbloquear',
      legend: (done, current, pending) => `${done} superado · ${current} actual · ${pending} pendiente`,
      levelDesc: {
        none: 'Sin rastro de IA: no se detecta ninguna herramienta de IA en tu entorno.',
        exploring: 'Explorando: tienes herramientas de IA instaladas y las estás probando.',
        integrated: 'Integrado: la IA está conectada a tus proyectos con contexto persistente.',
        power: 'Power user: extiendes la IA con MCP, skills/comandos propios y CLIs agénticas.',
        orchestrator: 'Orquestador: operas varios agentes coordinados y automatización de principio a fin.',
      },
      tierDesc: {
        T0: 'Banco vacío: aún no se detecta ninguna herramienta de IA.',
        T1: 'Primera herramienta: usas al menos una herramienta de IA.',
        T2: 'Banco con notas: ficheros de contexto persistente guían a la IA.',
        T3: 'Banco conectado: un servidor MCP da a la IA acceso a tus datos y herramientas.',
        T4: 'Herramienta propia: has creado tus propios skills, comandos o reglas.',
        T5: 'Operador agéntico: una CLI agéntica combina MCP y tus activos propios de punta a punta.',
        T6: 'Multi-agente: un equipo de 2+ agentes especializados.',
        T7: 'Taller orquestado: hooks automatizan el taller y los agentes se orquestan entre sí.',
      },
    },
    // Agent classification against the AI-agent catalog (skill-code-certification,
    // report req 2) + the "how to improve" tips (req 3). Shared by the HTML and
    // terminal renders. Category/level names are DISPLAY labels for the catalog's
    // stable keys; `method*` badges say whether the match was deterministic or
    // inferred by the model.
    classification: {
      label: 'Clasificación',
      noCategory: 'Sin categoría',
      improvementsHeading: 'Cómo mejorar este agente',
      categories: {
        developer: 'Desarrollo',
        product: 'Producto',
        designer: 'Diseño',
        marketing: 'Marketing',
        data: 'Datos',
      },
      levels: {
        L1: 'L1 · operativo',
        L2: 'L2 · táctico',
        L3: 'L3 · estratégico',
      },
    },
    // `certify agents` — flujo interactivo de certificación de agentes.
    certifyAgents: {
      intro: 'Certificación de agentes: elige un agente y responde unas preguntas; la IA juzgará, contra la implementación real, hasta qué punto lo dominas.',
      disclaimer: 'Se enviará la DEFINICIÓN del agente y tus respuestas al servicio de evaluación (efímero; el idioma no cambia el nivel). ¿Continuar? [s/N]',
      disclaimerDeclined: 'Cancelado. No se ha enviado nada.',
      noAgents: 'No se han detectado agentes en este proyecto (.claude/agents/).',
      chooseAgentHeading: 'Elige el agente a certificar:',
      selectHint: 'Flechas ↑/↓ para moverte · enter para elegir · esc para cancelar',
      choosePrompt: (max) => `Número (1-${max}), vacío para cancelar: `,
      allEvaluated: 'Ya has certificado todos los agentes detectados en esta sesión.',
      qAchieve: '¿Qué intentabas conseguir con este agente?',
      qDecisions: '¿Qué decisiones tomaste tú personalmente?',
      generatingFollowups: 'Preparando preguntas de seguimiento…',
      followupsHeading: 'Preguntas de seguimiento:',
      certifying: 'Evaluando tu dominio del agente contra su implementación…',
      definitionTruncated: (max) =>
        `Nota: la definición de este agente supera el máximo; se recorta a ${max} caracteres antes de enviarla al servicio.`,
      rerunPrompt: 'Certificar otro agente de los pendientes? [s/N]',
      gateNotRegistered: 'La certificación de agentes solo está disponible para talentos registrados en Shakers. El email indicado no corresponde a un talento registrado.',
      gateNotVerified: 'Verifica la propiedad de tu email antes de certificar (ejecuta el flujo con verificación).',
      error: (reason) => `No se pudo certificar el agente (${reason}). No se ha guardado nada.`,
      levelNames: {
        none: 'No sustanciado',
        P1: 'P1 · Familiar',
        P2: 'P2 · Practicante',
        P3: 'P3 · Competente',
        P4: 'P4 · Avanzado',
        P5: 'P5 · Experto',
      },
      levelDesc: {
        none: 'La evidencia no respalda un dominio significativo del agente.',
        P1: 'Conoces el agente y lo usas; poca autoría de su diseño.',
        P2: 'Lo operas deliberadamente; decisiones de configuración propias, con lagunas.',
        P3: 'Dominio sólido: modelaste alcance y límites y posees decisiones clave.',
        P4: 'Dominio profundo: diseñaste para fallos y edge-cases, evidencia verificada.',
        P5: 'Maestría: dominio verificado en todas las áreas clave; lo evolucionas.',
      },
      areaNames: {
        purpose_fit: 'Propósito y encaje',
        design_ownership: 'Autoría del diseño',
        boundaries_guardrails: 'Límites y guardarraíles',
        failure_handling: 'Manejo de fallos',
        operation_evolution: 'Operación y evolución',
      },
      tagLabels: {
        verified: 'verificado',
        partial: 'parcial',
        claimed: 'afirmado',
        not_evidenced: 'sin evidencia',
        n_a: 'no aplica',
      },
      reportHeading: 'Certificación del agente',
      levelLabel: 'Nivel',
      whyHeading: 'Por qué',
      verifiedHeading: 'Evidencias verificadas',
      unverifiedHeading: 'No verificadas (no confirmadas contra la implementación)',
      areasHeading: 'Áreas evaluadas',
      rationaleHeading: 'Valoración',
      noVerified: '(ninguna evidencia verificada)',
      savedHint: 'Guardado. Ejecuta `report` para ver el informe completo en el navegador.',
      // Terminal summary (the full breakdown now lives in the HTML report).
      summaryHeading: 'Agente certificado',
      areasVerified: (n, total) => `${n}/${total} verificadas`,
      // Superadmin-only fast testing shortcut (--fast): skip the Q&A.
      fastModeNotice: 'Modo rápido (superadmin): saltando el Q&A con respuestas de muestra; el veredicto se ejecuta de verdad.',
      fastModeDenied: 'El modo rápido (--fast) solo está disponible con una sesión superadmin activa; se responderá el Q&A normalmente.',
      sampleAchieve: 'Quería un agente que automatizara una parte concreta de mi flujo, con un alcance acotado y salidas revisables.',
      sampleDecisions: 'Definí yo su propósito y sus límites, elegí sus herramientas y sus guardarraíles, y decidí cómo maneja los fallos.',
      sampleFollowupAnswer: 'Lo diseñé así deliberadamente por las restricciones del proyecto y lo he iterado según los resultados reales.',
    },
    levelNames: {
      none: 'Sin rastro de IA',
      exploring: 'Explorando',
      integrated: 'Integrado',
      power: 'Power user',
      orchestrator: 'Orquestador',
    },
    nextSteps: {
      0: 'Instala una herramienta de IA (Claude Code, Cursor o Copilot) y pruébala en un proyecto real.',
      1: 'Añade un fichero de instrucciones al proyecto (CLAUDE.md, .cursorrules o copilot-instructions.md) para dar contexto persistente.',
      2: 'Conecta un servidor MCP o crea reglas/comandos propios para que la IA acceda a tus datos y flujos.',
      3: 'Combina una CLI agéntica con MCP y skills/comandos propios; automatiza una tarea recurrente de principio a fin.',
      4: 'Ya operas a nivel de orquestación: documenta tu setup y encadena agentes o ejecución en background.',
    },
    recency: {
      today: 'hoy',
      this_week: 'esta semana',
      this_month: 'este mes',
      this_quarter: 'este trimestre',
      stale: 'desactualizado',
    },
    terminal: {
      brandSub: 'perfil de uso de IA',
      toolsDetected: (n, total) => `${n}/${total} herramientas detectadas`,
      level: (level, name) => `Nivel ${level} · ${name}`,
      // Current tier appended to the top bar, next to the level (report req 1 addendum).
      tierInline: (key, name) => ` · Tier ${key} · ${name}`,
      detectedHeading: 'Detectadas',
      none: '(ninguna)',
      environment: 'Entorno',
      editors: 'editores',
      noEditorsDetected: 'ninguno detectado',
      // ADR-016 agent evaluation (terminal, one line per agent): compact usage
      // signal derived from the local Claude Code history.
      agentUsed: (n) => `usado ${n}×`,
      agentUnused: 'sin uso local',
      agentUsageUnavailable: '(sin historial local de Claude Code: uso no disponible)',
      // ADR-016: discoverability hint for the next-steps section (behind --roadmap).
      roadmapHint: 'Ejecuta `footprint --roadmap` para ver los siguientes pasos recomendados.',
      nextStep: 'Siguiente paso',
      files: (n) => `${n} ${n === 1 ? 'fichero' : 'ficheros'}`,
      lastModified: (label) => `última modificación: ${label}`,
    },
    html: {
      lang: 'es',
      title: (level) => `AI Footprint · Nivel ${level}`,
      h1: 'Tu perfil de uso de IA',
      sub: 'Un vistazo local a qué herramientas de IA tienes y cuánto las has configurado.',
      levelOf: (level) => `Nivel ${level} de 4`,
      // Current tier shown in the hero bar next to the level (report req 1 addendum).
      currentTier: (key, name) => `Tier ${key} · ${name}`,
      // Suffix only: the number is already bolded separately in the markup
      // (see render-html.js), so we avoid duplicating/parsing the translated string.
      detectedSuffix: (total) => `de ${total} herramientas detectadas`,
      maturity: 'Madurez',
      tools: 'Herramientas',
      // talents-ai-score: only DETECTED tools are listed now (undetected
      // ones were pure noise — any relevant next step already lives in the
      // tier roadmap section). Empty state covers the "nothing detected at
      // all" case, replacing the old per-row "not detected" label.
      toolsEmpty: 'No se ha detectado ninguna herramienta de IA en tu entorno.',
      configIntensity: 'intensidad de configuración',
      files: (n) => `${n}&nbsp;${n === 1 ? 'fichero' : 'ficheros'}`,
      lastModified: (dateStr) => `última modificación: ${dateStr}`,
      environment: 'Entorno',
      platform: 'Plataforma',
      architecture: 'Arquitectura',
      installedEditors: 'Editores instalados',
      noEditorsDetected: 'ninguno detectado',
      nextStep: 'Siguiente paso',
      // Agent cards (talents-ai-score): the SOLE agents view (consolidates
      // and replaces the earlier separate deterministic org-chart tree,
      // which duplicated this same data) — a hierarchical role-card tree,
      // enriched with the ephemeral synthesis result (symbolicName/
      // whatItDoes) when it succeeded this run; the SAME tree renders with
      // just the structural data (name/tools/model/hierarchy) otherwise.
      diagramHeading: 'Agentes',
      agentsEmpty: 'No se han detectado agentes de IA configurados (p. ej. .claude/agents/).',
      agentRealNameLabel: 'nombre real del agente',
      orchestratorLabel: 'Orchestrator',
      reportsToLabel: 'Reporta a:',
      // Last-resort description fallback (talents-ai-score, real-browser
      // user feedback: a card must NEVER show only name+model, no
      // description at all). Used ONLY when there's neither a synthesis
      // result nor a declared frontmatter `description` for this agent —
      // deliberately short and derived purely from the name, never a full
      // templated sentence (that repetitive-filler approach was already
      // tried and rejected).
      agentDescriptionFromName: (name) => `Agente "${name}" (sin descripción declarada en su fichero).`,
      // AI product an agent belongs to, derived from its source (proper nouns; same es/en).
      aiProducts: { 'claude-code': 'Claude Code' },
      // ADR-016 agent evaluation (HTML per-agent detail): definition-quality
      // score + LLM rationale + local usage signal. The full detail lives here;
      // the terminal keeps only a one-line summary.
      agentScoreLabel: 'Calidad de la definición (0-100)',
      agentQualityLabel: 'Por qué:',
      agentUsageLabel: 'Uso local (historial de Claude Code)',
      agentUsedTimes: (n) => `usado ${n}×`,
      agentUnused: 'sin uso local',
      // Project technologies (talents-ai-score, ADR-012). Refined: shows
      // recognized FRAMEWORKS/LIBRARIES only (React, Express...), not a raw
      // dependency dump — the empty state also covers "manifest exists but
      // recognizes nothing", not just "no manifest at all".
      technologiesHeading: 'Tecnologías del proyecto',
      technologiesEmpty: 'No se reconoció ningún framework o librería en los manifiestos de dependencias (package.json, requirements.txt, go.mod, pyproject.toml).',
      // MCP servers by name (talents-ai-score, issue 015). LOCAL ONLY — never
      // persisted (see src/share.js's derivePayload, which only sends
      // countsByCategory/total, never these names).
      mcpHeading: 'Servidores MCP detectados',
      // Tier roadmap (talents-ai-score, issue 020): only short UI labels
      // live here — the authored prose itself lives in
      // src/roadmap-content.js (ported verbatim from the product-manager's
      // content, ADR-013's "contenido autorado").
      roadmapHeading: 'Tu próximo nivel',
      roadmapUpgradeWhenLabel: 'Subes de tier cuando:',
      roadmapUnlocksLabel: 'Qué desbloquea',
      roadmapStepsLabel: 'Pasos',
      roadmapSnippetLabel: 'Snippet copiable',
      roadmapTipsLabel: 'Tips de comunidad',
      roadmapMistakesLabel: 'Errores comunes',
      roadmapConsolidationLabel: 'Pasos de consolidación',
      roadmapHonestyLabel: 'Nota de honestidad',
      // talents-ai-score, i18n audit: both es/en roadmap content is fully
      // authored (src/roadmap-content.js) — this defensive notice only
      // shows for a FUTURE tier added to Spanish before English catches
      // up; never fires against the current T0-T7 set. Deliberately does
      // NOT mention Spanish (unlike the retired `roadmapPendingTranslation`
      // it replaces): under an English locale, nothing Spanish is ever
      // shown, not even as a "coming soon" caveat.
      roadmapContentUnavailable: 'El contenido detallado de este nivel aún no está disponible en este idioma.',
      // ADR-015: shown only when the 4 prose gaps below were actually
      // replaced by a validated, project-adapted response — never on
      // fallback to the curated content.
      roadmapPersonalizedNotice: 'Contenido adaptado a tu proyecto.',
      // Copyable implementation prompt (talents-ai-score): the PRIMARY
      // "how do I implement this" path, replacing --build-next-level's
      // file-writing as the main route — a deterministic, ready-to-paste
      // prompt (src/roadmap-prompt.js) for the talent's own AI tool.
      implementationPromptHeading: 'Prompt para implementar',
      implementationPromptHint: 'Copia este prompt y pégalo en tu IA de confianza (Claude Code, Cursor, ChatGPT...) para que lo implemente en tu proyecto.',
      // Copy-to-clipboard button (HTML report only — talents-ai-score):
      // navigator.clipboard with a document.execCommand fallback, both
      // inline, zero-network. copiedLabel is the transient feedback state.
      implementationPromptCopyLabel: 'Copiar',
      implementationPromptCopiedLabel: 'Copiado ✓',
      privacyNote:
        'Este informe se ha generado en local. Solo registra qué herramientas '
        + 'existen, cuántas configuraciones tienes y tu nivel: nunca el contenido '
        + 'de tus ficheros, rutas ni credenciales.',
      metaLine: (dateStr, anonId, platform) =>
        `Generado ${dateStr} · id anónimo <code>${anonId}</code> · plataforma ${platform}`,
      rawData: 'Ver los datos exactos de este informe (JSON)',
    },
    cli: {
      // Reporting redesign (skill-code-certification): el HTML ya NO es opt-in
      // (se retira --html). En cada ejecución se actualiza el informe acumulado
      // y se imprime SIEMPRE su enlace file:// para abrirlo en el navegador.
      reportLink: (url) => `Abre tu informe en el navegador:\n  ${url}`,
      // `share` command (skill-code-certification): copy del CLI que envuelve a
      // la tarjeta branded para LinkedIn. La TARJETA en sí es siempre en inglés
      // (superficie de marca); esto es solo el copy del terminal, localizado.
      share: {
        help: 'share — crea una tarjeta branded con tu resultado de footprint (tier + nota) para compartir en LinkedIn.\n'
          + '  Usa `footprint` primero; `share` toma el último footprint de este proyecto.\n'
          + '  Opciones: --root <dir>, --lang es|en',
        noFootprint: 'Aún no hay footprint para este proyecto. Ejecuta `footprint` primero y luego `share`.',
        ready: (url) => `Tu tarjeta para compartir está lista — ábrela para descargar el PNG y publicarla:\n  ${url}`,
        hint: 'LinkedIn no permite adjuntar la imagen por URL: descarga el PNG desde la tarjeta y luego adjúntalo en tu publicación.',
        error: 'No se pudo generar la tarjeta para compartir.',
      },
      // `report` command (ADR-016): genera y ABRE el informe HTML completo y
      // compartible de este proyecto (footprint + Skills certificadas).
      // `footprint`/`certify` ya no imprimen enlace; el HTML se produce aquí.
      report: {
        help: 'report — genera y abre el informe HTML completo de este proyecto (footprint + Skills certificadas) para compartir con tu equipo.\n'
          + '  Usa `footprint` (y opcionalmente `certify`) primero; `report` reúne su resultado.\n'
          + '  Opciones: --root <dir>, --lang es|en, --no-open (no abre el navegador; solo imprime el enlace)',
        noData: 'Aún no hay nada que mostrar para este proyecto. Ejecuta `footprint` primero (y opcionalmente `certify`), luego `report`.',
        ready: (url) => `Tu informe está listo:\n  ${url}`,
        opening: 'Abriéndolo en tu navegador…',
        error: 'No se pudo generar el informe.',
      },
      // Terminal progress feedback (talents-ai-score): stderr-only status
      // during the two slow phases (see src/terminal-progress.js).
      scanningLabel: 'Escaneando entorno y detectores…',
      synthesizingLabel: 'Sintetizando agentes con IA…',
      // Roadmap personalization (talents-ai-score, ADR-015): reuses the
      // same spinner mechanism as synthesizingLabel above.
      personalizingRoadmapLabel: 'Personalizando roadmap…',
      // ADR-016: agent definition-quality evaluation (ephemeral LLM call).
      evaluatingAgentsLabel: 'Evaluando la calidad de tus agentes…',
      // "Construir el siguiente nivel ahora" (issue 021): now a SECONDARY,
      // opt-in alternative — the copyable implementation prompt (below) is
      // the PRIMARY "how do I implement this" path.
      buildNextLevelHint: 'Alternativamente, ejecuta `footprint --build-next-level` para generar el fichero de partida directamente en tu proyecto.',
      // Ayuda localizada (skill-code-certification / ADR-003): antes estaba
      // hardcodeada en español en bin/report.js; ahora pasa por i18n y respeta
      // la locale de la máquina.
      help:
        '\nAI Footprint — perfil local de uso de herramientas de IA\n\n'
        + 'Uso:\n  footprint [opciones]\n\n'
        + 'Opciones:\n'
        + '      --json             Imprime el informe en JSON por stdout\n'
        + '      --no-save          No guarda el estado del informe (solo muestra)\n'
        + '      --root DIR         Escanea DIR en vez del directorio actual\n'
        + '      --roadmap          Muestra el bloque de "siguientes pasos" (oculto por defecto)\n'
        + '      --build-next-level Genera el starter del siguiente tier (alternativa secundaria)\n'
        + '      --force            Junto a --build-next-level, sobrescribe un fichero existente\n'
        + '      --lang es|en       Fuerza el idioma (informe + prompt) en vez de detectarlo del sistema\n'
        + '      --consent-status   Muestra tu decisión de guardado / correo / último envío\n'
        + '      --consent-revoke   Revoca el guardado (→ denegado); deja de enviar\n'
        + '      --consent-reset    Borra la decisión (→ sin decidir); vuelve a preguntar\n'
        + '      --consent-email C  Cambia el correo guardado, sin tocar la decisión\n'
        + '      --set-endpoint URL Guarda el endpoint de ingesta en ~/.config/ai-footprint/config.json\n'
        + '                         (un host no-local debe ser https). La env var tiene prioridad\n'
        + '      --show-endpoint    Muestra el endpoint efectivo y de dónde sale (env / config / ninguno)\n'
        + '  -h, --help             Muestra esta ayuda\n\n'
        + 'El informe se genera y se muestra SIEMPRE en tu equipo. footprint ya NO imprime\n'
        + 'un enlace: usa el comando `report` para generar y abrir el informe HTML completo\n'
        + '(footprint + Skills certificadas) que puedes compartir con tu equipo. Antes de\n'
        + 'mostrar el resultado, la primera vez se te pregunta si quieres GUARDARLO en Shakers\n'
        + '(con tu correo); se pregunta una sola vez. Reabre la pregunta con --consent-reset.\n\n'
        + 'El destino de envío se resuelve así: AI_FOOTPRINT_INGEST_ENDPOINT (env) > el fichero\n'
        + 'de config (--set-endpoint) > ninguno. Sin endpoint, el informe se muestra pero no se\n'
        + 'envía a Shakers.\n',
    },
    // "Construir el siguiente nivel ahora" (talents-ai-score, issue 021):
    // optional, explicit phase — writes the deterministic starter for the
    // NEXT tier from the curated roadmap's own snippets, never LLM-generated.
    // Cumulative report (skill-code-certification, reporting redesign): the
    // single local HTML that both binaries fill in over time (footprint per
    // project + certification per Skill). Copy for its chrome/headings.
    cumulative: {
      title: 'Tu informe de Shakers',
      subtitle: 'Tu informe de IA para este proyecto.',
      footprintHeading: 'AI Footprint',
      certificationHeading: 'Certificación de Skills',
      agentCertificationHeading: 'Certificación de agentes',
      privacyNote: 'Este informe se genera y se guarda solo en tu equipo. Nada se envía a Shakers salvo que des tu consentimiento explícito.',
      updatedLabel: (when) => `Actualizado: ${when}`,
      unknownProject: '(proyecto desconocido)',
    },
    buildNextLevel: {
      heading: (tierKey) => `Generando el starter para subir a ${tierKey}...`,
      created: (filename) => `+ creado ${filename}`,
      overwritten: (filename) => `+ sobrescrito ${filename} (--force)`,
      skippedExists: (filename) => `${filename} ya existe — no se sobrescribe (usa --force para sobrescribir)`,
      maxTier: 'Ya estás en el tier máximo (T7): no hay siguiente nivel que construir.',
      noFileTarget: 'El siguiente paso no es un fichero que este comando pueda crear — revisa el snippet del roadmap en el informe.',
      unrecognizedTier: 'No se ha podido determinar tu tier actual.',
    },
    consent: {
      // talents-ai-score, ADR-011: the disclosure wall (what's sent / never
      // sent, itemized) is RETIRED from the CLI — that content now lives in
      // the repo's README. The informe ALWAYS shows locally, unconditionally.
      // What's left is this short, one-time question about PERSISTING
      // (saving) the already-shown report in Shakers.
      //
      // talents-ai-score, issue 022 (ADR-013/014): updated for the level-up
      // framework's expanded scope — persisting now also saves your tier/
      // level and structured signals across every detected category (MCP
      // type, memory structure, automations, browser tools, tech→Skill
      // association), never raw content. Still short (no itemized wall,
      // sin flags): the README covers the detail (ADR-011's disclosure
      // model is unchanged).
      persistIntro:
        'Este informe se ha generado y mostrado en tu equipo, siempre. '
        + 'Guardarlo en Shakers es opcional y revocable en cualquier momento '
        + '(footprint --consent-revoke): guarda tu nivel/tier y señales '
        + 'estructuradas derivadas (herramientas, MCP, memoria, '
        + 'automatizaciones, agentes, tecnologías) — nunca el contenido de '
        + 'tus ficheros, prompts, rutas ni credenciales. Dato indicativo, no '
        + 'verificado, no una cualificación oficial. Eres responsable de la '
        + 'información que decidas compartir; Shakers no asume responsabilidad '
        + 'por los datos que envíes. El uso indebido de estas herramientas —enviar '
        + 'o analizar código que no es tuyo o que no estás autorizado a analizar— '
        + 'puede acarrear penalizaciones en tu cuenta de Shakers, incluida la '
        + 'posible suspensión. Consulta el README de este repositorio para '
        + 'más detalle. [Copy legal PENDIENTE DE VALIDACIÓN LEGAL/LABORAL — NO DEFINITIVO]',
      persistQuestion: '¿Guardar este informe en Shakers? (s/n):',
      invalidAnswer: 'Respuesta no reconocida. Responde "s" (sí) o "n" (no).',
      emailPrompt: 'Introduce tu correo:',
      invalidEmail: 'Correo no válido, inténtalo de nuevo.',
      notObtained: 'No se ha podido registrar tu respuesta; se te volverá a preguntar la próxima vez.',
      deniedSaved: 'Entendido, no se guardará nada. Puedes cambiar de opinión más adelante volviendo a ejecutar el comando.',
      grantedSaved: (email) => `Gracias. A partir de ahora este informe se guardará automáticamente en Shakers (correo: ${email}, máx. 1 vez por hora).`,
      // DX visibility (talents-ai-score): the prompt runs exactly ONCE per
      // talent by design (ADR-007/ADR-011) — a talent who already answered
      // (even in an earlier test run) will never see it again, which read
      // as "it doesn't work" without an explicit explanation. Enumerated,
      // testable in src/consent-skip.js.
      skipAlreadyDecided: (decision, path) =>
        `Consentimiento ya respondido (${decision === 'granted' ? 'concedido' : 'rechazado'}) — guardado en ${path}. `
        + 'Usa --consent-status para verlo, --consent-revoke para rechazar o --consent-reset para volver a preguntar.',
      nonInteractiveWarning:
        'Entrada no interactiva (no-TTY) detectada: si no llega ninguna respuesta por stdin, '
        + 'el consentimiento no se guardará esta vez y se te volverá a preguntar la próxima vez.',
      status: {
        heading: 'Estado del consentimiento (guardado en Shakers)',
        decisionGranted: 'Decisión: concedido (granted)',
        decisionDenied: 'Decisión: rechazado (denied)',
        decisionNone: 'Decisión: sin decisión todavía',
        email: (value) => `Correo: ${value || '(sin correo)'}`,
        verificationPending: 'Correo pendiente de verificar: no se enviará nada a Shakers hasta verificarlo (usa --consent-reset para reintentar).',
        lastSentAt: (value) => `Último guardado: ${value || '(nunca)'}`,
      },
      revoked: 'Consentimiento revocado. No se guardará nada más automáticamente.',
      reset: 'Decisión de consentimiento reiniciada. Se te preguntará de nuevo en la próxima ejecución.',
      emailChanged: (email) => `Correo actualizado a ${email}. Se usará en el próximo guardado.`,
      emailInvalidCli: 'Correo no válido. Uso: footprint --consent-email tu@correo.com',
    },
    // Endpoint config (endpoint-config task): --set-endpoint / --show-endpoint
    // copy. The endpoint decide adónde va el código muestreado, de ahí la regla
    // https-para-hosts-no-locales. No barre el no-spanish-audit (solo informe).
    endpoint: {
      setOk: (url, path) => `Endpoint de ingesta guardado: ${url}\n  (en ${path}). La variable de entorno AI_FOOTPRINT_INGEST_ENDPOINT, si está definida, tiene prioridad.`,
      errInsecureRemote: 'Endpoint rechazado: un host que no sea localhost/127.0.0.1 debe usar https:// (el endpoint decide adónde se envía tu código). Usa una URL https o un host local.',
      errInvalidUrl: 'Endpoint rechazado: URL no válida. Debe ser una URL http(s) completa, p.ej. https://tu-hub/api/v1/works/ai-footprint/reports',
      errEmpty: 'Endpoint rechazado: no se indicó ninguna URL. Uso: footprint --set-endpoint https://tu-hub/api/v1/works/ai-footprint/reports',
      showEnv: (url) => `Endpoint de ingesta efectivo: ${url}\n  Origen: variable de entorno AI_FOOTPRINT_INGEST_ENDPOINT.`,
      showConfigFile: (url, path) => `Endpoint de ingesta efectivo: ${url}\n  Origen: fichero de config (${path}).`,
      showConfigInvalid: (path) => `El fichero de config (${path}) tiene un endpoint no válido o inseguro; se ignora. Corrígelo con footprint --set-endpoint <url>.`,
      showNone: 'No hay endpoint de ingesta configurado. Define AI_FOOTPRINT_INGEST_ENDPOINT o usa footprint --set-endpoint <url>. Sin él, el informe se sigue mostrando pero no se envía a Shakers.',
    },
    // Email-ownership verification (skill-code-certification / ADR-006): the
    // OTP "modo espera" copy, shared by both binaries. Shown only when the
    // Talent grants consent and a verification endpoint is reachable; gates
    // PERSISTENCE ONLY — the report was already shown. The pasted code is never
    // echoed here beyond the single prompt.
    verify: {
      sent: (email) => `Te enviamos un código de verificación a ${email}.`,
      waitHint: 'Pega aquí el código. Pulsa "r" y Enter para reenviarlo, o Enter en blanco para cancelar.',
      codePrompt: 'Código de verificación:',
      verified: 'Correo verificado. Guardando tu informe en Shakers…',
      invalidCode: 'Código incorrecto. Revísalo y vuelve a pegarlo.',
      expired: 'El código ha caducado. Pulsa "r" y Enter para enviar uno nuevo.',
      resent: (email) => `Te reenviamos un código a ${email}.`,
      resendFailed: 'No se pudo reenviar el código. Inténtalo de nuevo en un momento.',
      requestFailed: 'No se pudo enviar el código de verificación al Hub. No se guardará el informe; el reporte ya se te ha mostrado.',
      technicalError: 'No se pudo verificar el correo contra el Hub. No se guardará el informe; el reporte ya se te ha mostrado.',
      tooManyAttempts: 'Demasiados intentos fallidos. No se ha verificado el correo, así que no se guardará el informe.',
      cancelled: 'Verificación cancelada. No se guardará el informe (el reporte ya se te ha mostrado).',
      unavailable: 'La verificación de correo no está disponible ahora mismo; no se guardará el informe (el reporte ya se te ha mostrado).',
    },
    // Skill Code Certification (skill-code-certification, issues 004/006).
    // Copy for the SECOND binary `ai-certify` (resolve phase V1). Localized
    // like the consent flow — legal/disclaimer copy must not default to a
    // language the Talent may not read. Vocabulario CONTEXT: Talent, Skill.
    certify: {
      // Subcommand chooser (skill-code-certification): `certify` = skills or agents.
      flowHeading: 'Qué quieres certificar?',
      flowSkills: 'skills — certifica Skills de tu catálogo desde el código',
      flowAgents: 'agents — certifica tu dominio de un agente de IA',
      flowPrompt: 'Elige [1=skills, 2=agents], vacío para cancelar: ',
      flowUsage: 'Uso: `certify skills` o `certify agents`.',
      help:
        'AI Certify — certifica Skills de tu catálogo de Shakers analizando tu proyecto local\n\n'
        + 'Uso:\n'
        + '  certify [opciones]\n\n'
        + 'Opciones:\n'
        + '      --root DIR           Analiza DIR en vez del directorio actual\n'
        + '      --email CORREO       Tu correo de Talent (si no, se usa el guardado o se te pregunta)\n'
        + '      --lang es|en         Fuerza el idioma de la salida\n'
        + '      --accept-disclaimer  Acepta el aviso legal de forma no interactiva (aceptación explícita)\n'
        + '      --all                Certifica TODAS las Skills certificables (sin selección interactiva)\n'
        + '      --skills 1,3         Certifica las Skills en esas posiciones (sin selección interactiva)\n'
        + '      --fast               (`certify agents`, solo superadmin) salta el Q&A con respuestas de muestra\n'
        + '  -h, --help               Muestra esta ayuda\n\n'
        + 'Fase 1 (resolve): detecta las tecnologías de tu proyecto y consulta al Hub de\n'
        + 'Shakers qué Skills son certificables. Fase 2 (certify): eliges qué Skills\n'
        + 'certificar, se toma una muestra de código, se depuran los secretos y se envía\n'
        + 'para una evaluación por Skill (las notas son indicativas, no una cualificación\n'
        + 'oficial). Requiere AI_FOOTPRINT_CERTIFY_ENDPOINT configurado. Antes de cualquier\n'
        + 'envío se muestra un aviso legal que debes aceptar.',
      scanningLabel: 'Detectando tecnologías del proyecto…',
      resolvingLabel: 'Consultando Skills certificables…',
      // Aviso legal (ADR-001): asume el proyecto propiedad del Talent y le
      // atribuye la responsabilidad. Aceptación explícita obligatoria.
      disclaimer:
        'AVISO LEGAL — léelo antes de continuar:\n'
        + '  certify envía datos de tu proyecto a Shakers para certificar tus Skills.\n'
        + '  En esta fase (resolve) se envían tu correo y los NOMBRES de las tecnologías\n'
        + '  detectadas; la fase de certificación posterior enviará fragmentos de código.\n'
        + '  Eres el ÚNICO responsable de asegurarte de que eres propietario del código de\n'
        + '  este proyecto o de que estás autorizado a analizarlo. Shakers no asume ninguna\n'
        + '  responsabilidad por el código que envíes. Enviar código que no es tuyo o que\n'
        + '  no estás autorizado a analizar es un uso indebido de esta herramienta y puede\n'
        + '  acarrear penalizaciones en tu cuenta de Shakers, incluida la posible suspensión.\n'
        + '  NO uses esta herramienta sobre código de un tercero (p. ej. un cliente bajo NDA).\n'
        + '  Las notas son indicativas y no verificadas, no una cualificación oficial.\n'
        + '  [PENDIENTE DE VALIDACIÓN LEGAL/LABORAL — TEXTO NO DEFINITIVO]',
      disclaimerQuestion: '¿Aceptas y continúas? (s/n):',
      disclaimerAcceptedFlag: 'Aviso legal aceptado mediante --accept-disclaimer.',
      disclaimerNonInteractive:
        'Entrada no interactiva y sin --accept-disclaimer: no se puede obtener una '
        + 'aceptación explícita. Se cancela (no se ha enviado nada).',
      disclaimerDeclined: 'No has aceptado el aviso legal. No se ha enviado nada.',
      disclaimerInvalidAnswer: 'Respuesta no reconocida. Responde "s" (sí) o "n" (no).',
      disclaimerNoAnswer: 'No se ha obtenido respuesta. No se ha enviado nada.',
      emailPrompt: 'Introduce tu correo de Shakers:',
      emailInvalid: 'Correo no válido, inténtalo de nuevo.',
      emailUsing: (email) => `Usando el correo: ${email}`,
      emailNeeded: 'Se necesita un correo válido para resolver tus Skills certificables. No se ha enviado nada.',
      noTechnologies:
        'No se reconoció ningún framework o librería en este proyecto (package.json, '
        + 'requirements.txt, go.mod, pyproject.toml). No hay nada que certificar.',
      technologiesDetected: (list) => `Tecnologías detectadas: ${list}`,
      resolveHeading: 'Skills certificables para tu proyecto',
      certifiableHeading: 'Certificables:',
      certifiableEmpty: 'Ninguna tecnología detectada mapea a una Skill que puedas certificar ahora mismo.',
      certifiableLine: (skillName, technology, skillId) =>
        `✓ ${skillName}${technology ? ` (${technology})` : ''}${skillId != null ? ` [#${skillId}]` : ''}`,
      nonCertifiableHeading: 'No certificables:',
      nonCertifiableEmpty: 'Ninguna — todas las tecnologías detectadas son certificables.',
      nonCertifiableLine: (tech, reason) => `· ${tech} — ${reason}`,
      reasons: {
        'no-skill-match': 'no hay una Skill equivalente en el catálogo de Shakers',
        'not-declared': 'no has declarado esta Skill en tu perfil de Talent',
        'no-sampling': 'todavía no se puede certificar por código (sin muestreo de código definido)',
        notCertifiable: 'no es certificable',
      },
      errorNoEndpoint:
        'No hay endpoint configurado. certify usa la misma base que footprint: define el endpoint '
        + 'con footprint --set-endpoint <url> (o la variable AI_FOOTPRINT_INGEST_ENDPOINT), y la ruta '
        + 'de certificación se deriva automáticamente. (No hay certificación en local: el catálogo de '
        + 'Skills y el análisis viven en el Hub.)',
      errorIntro: 'No se han podido resolver las Skills certificables:',
      errorIntroCertify: 'No se han podido certificar tus Skills:',
      errorNetwork: 'no se pudo contactar con el servicio de certificación (error de red).',
      errorTimeout: 'el servicio de certificación agotó el tiempo de espera.',
      errorHttp: (status) => `el servicio de certificación devolvió un estado inesperado (HTTP ${status}).`,
      errorInvalidResponse: 'el servicio de certificación devolvió una respuesta inesperada.',
      errorRetryHint: 'No se ha certificado nada. Revisa tu conexión e inténtalo de nuevo más tarde.',
      // Resultado ESPERADO del gate (403), no un error técnico (issue 014):
      // mensaje calmado, sin "estado inesperado", sin "HTTP 403", sin reintento.
      notRegistered: (email) =>
        `La certificación de skills es solo para Talents registrados de Shakers; no encontramos ${email} como Talent.`,
      // 413: proyecto demasiado grande (issue 014) — accionable, no el genérico de conexión.
      errorTooLarge:
        'El proyecto es demasiado grande para certificar de una vez. Reduce el alcance '
        + '(menos ficheros o Skills) e inténtalo de nuevo.',
      // 5xx: el backend está caído/reiniciándose o le faltan migraciones de BD
      // (bugfix "missing migrations"). Mensaje accionable, DISTINTO del de red:
      // no es tu conexión, es el servidor.
      errorBackendOutdated:
        'El backend no está disponible: le faltan migraciones de base de datos o se está reiniciando. '
        + 'Aplica las migraciones y reinícialo, y vuelve a intentarlo. No se ha certificado nada.',
      // Interactive Skill selection (certify phase, issue 005).
      selectHeading: 'Selecciona las Skills que quieres certificar:',
      selectHint: 'Flechas ↑/↓ para moverte · espacio para marcar/desmarcar · a = todas · enter para confirmar · esc para cancelar',
      selectPrompt: 'Introduce los números separados por comas (o "todas"):',
      selectInvalid: 'Selección no válida. Introduce números de la lista (o "todas").',
      selectNonInteractive: 'Entrada no interactiva sin --skills/--all: no se pueden seleccionar Skills. Se cancela (no se ha enviado código).',
      selectNothing: 'No hay Skills certificables que seleccionar.',
      selectNoneChosen: 'No se ha seleccionado ninguna Skill. No se ha enviado código.',
      // Verified authorship gate (ADR-017): solo se certifica código atribuible
      // a la identidad verificada del Talent. "Sin email atribuible, no hay
      // certificación" — nunca se envía código no atribuible.
      authorshipNoGit: 'Sin historial de git no se puede verificar la autoría del código. Solo se certifica código atribuible a tu identidad verificada; no se ha certificado ni enviado nada.',
      authorshipNoneAttributable: 'Ninguna de las Skills seleccionadas tiene código atribuible a tu email verificado. Sin email atribuible, no hay certificación; no se ha enviado código.',
      authorshipRefused: (skills) => `No se certificaron estas Skills por falta de código atribuible a tu email verificado: ${skills}.`,
      // Human contact valve (ADR-018) — DISPLAY only, no automatic send. Shown
      // in the refusal path for a possible legitimate false negative (commits
      // con otro email, monorepo, historial migrado). Copy is DRAFT (a validar).
      authorshipContact: 'Si crees que tienes la autoría y esto es un error (commits con otro email, monorepo o historial migrado), escríbenos a talent@shakersworks.com.',
      // ADR-027: sesión de superadmin activa — se omite el gate de autoría.
      superadminBypass: (email) =>
        `Sesión de superadmin activa${email ? ` (${email})` : ''}: se omite el gate de autoría; se certificará todo el código muestreado (test_origin).`,
      selectOption: (index, skillName, technology) => `  ${index}) ${skillName}${technology ? ` (${technology})` : ''}`,
      certifyingLabel: 'Analizando el código de tus Skills…',
      // Reporting redesign: el HTML ya no es opt-in; cada certificación se
      // añade al informe acumulado y se imprime SIEMPRE su enlace file://.
      reportLink: (url) => `Abre tu informe en el navegador:\n  ${url}`,
      // Certify report (terminal + HTML). Rúbrica anclada + agregación determinista (ADR-024).
      report: {
        heading: 'Resultado de certificación de Skills',
        disclaimer:
          'Nota: la puntuación se calcula con una rúbrica anclada (dimensiones de 0 a 4) y una '
          + 'fórmula fija, por lo que el cálculo es determinista: con las mismas valoraciones '
          + 'sale la misma nota. Solo los juicios por criterio del modelo pueden variar '
          + 'ligeramente entre ejecuciones. Es una valoración indicativa, no una certificación '
          + 'oficial de cara al Client.',
        partialSampleWarning:
          'Muestra parcial: por los límites de tamaño la valoración se basa en una muestra del '
          + 'código, no en todo el proyecto.',
        scoreLine: (score) => `Puntuación: ${score == null ? 'n/d' : `${score}/100`}`,
        // ADR-024 rubric dimensions.
        dimensionsLabel: 'Dimensiones',
        dimensionNA: 'N/A',
        dimensionLabels: {
          idiomatic: 'Uso idiomático',
          correctness: 'Corrección y robustez',
          depth: 'Profundidad',
          structure: 'Estructura y mantenibilidad',
          testing: 'Tests',
        },
        rationaleLabel: 'Por qué',
        improvementsLabel: 'Mejoras sugeridas',
        // ADR-025 authorship receipt (atribución, NO prueba criptográfica).
        receipt: {
          label: 'Autoría',
          repoLabel: 'Repo',
          commitRangeLabel: 'Rango de commits',
          filesLabel: 'Fichero',
          authorLabel: 'Autor (git)',
          confirmedLabel: 'Autores confirmados con la identidad',
          attributedYes: '✓',
          attributedNo: '✗',
          summary: (attributed, total) => `${attributed}/${total} ficheros atribuidos a la identidad`,
          note:
            'Traza de autoría basada en el autor de git (self-asserted); no es una prueba '
            + 'criptográfica de autoría.',
        },
        sampleSummary: (included, candidate, estTokens) =>
          `Muestra: ${included}/${candidate} ficheros · ~${estTokens} tokens`,
        partialTag: '(muestra parcial)',
        notCertified: 'No se ha podido certificar esta Skill en esta ejecución.',
        notSampleableNote: (technology) =>
          `No hay muestreo definido para la tecnología "${technology}": todavía no se puede certificar por código.`,
        htmlTitle: 'Certificación de Skills · Shakers',
        noItems: 'No hay resultados de certificación que mostrar.',
        // Coste (issue 012): input mayor = más € por run.
        costNote:
          'Nota de coste: se analiza bastante código por Skill (hasta ~150k tokens/Skill), '
          + 'lo que tiene un coste por ejecución.',
        // Prompt de remediación (issue 011): generado en local desde las mejoras.
        remediationHeading: 'Prompt para aplicar las mejoras',
        remediationHint: 'Copia este prompt y pégalo en tu herramienta de IA (Claude Code, Cursor…) para aplicar las mejoras.',
        remediationIntro: (skillName, technology) =>
          `Ayúdame a mejorar mi código de ${skillName}${technology ? ` (${technology})` : ''} en este proyecto. `
          + 'Una revisión de código señaló estas mejoras:',
        remediationClosing:
          'Aplícalas directamente en mi proyecto: crea o edita lo necesario, sigue las convenciones que ya uso '
          + 'y explícame brevemente qué has cambiado y por qué.',
        remediationCopyLabel: 'Copiar',
        remediationCopiedLabel: 'Copiado ✓',
      },
    },
    // Branded mini-shell chrome (skill-code-certification / ADR-014). The
    // `sh-eval` REPL is the single entrypoint; this covers the prompt, the
    // Superadmin TEST-identity provisioning (ADR-021, NON-PROD only).
    superadmin: {
      // ADR-027 — sesión de superadmin autenticada por contraseña (no-prod).
      sessionIntro:
        'Abre una sesión de superadmin (solo entornos no productivos): certify funcionará con CUALQUIER email en CUALQUIER repo, saltándose los gates de identidad y autoría.',
      passwordPrompt: 'Contraseña de superadmin:',
      emailPrompt: 'Tu email de superadmin (solo para auditoría):',
      emailInvalid: 'Email no válido. Inténtalo de nuevo.',
      needInput: 'Se requieren contraseña y email (interactivo, o --password y --email).',
      sessionReady: (email) =>
        `Sesión de superadmin abierta (auditoría: ${email}). Ahora certify usará esta sesión con cualquier email.`,
      sessionExpires: (iso) => `La sesión caduca: ${iso}.`,
      sessionHint:
        'Ejecuta:  certify --email <cualquiera> --accept-disclaimer --all   ·   Para cerrarla:  superadmin --logout',
      loggedOut: 'Sesión de superadmin olvidada (token local eliminado).',
      errorNoEndpoint:
        'No hay endpoint configurado. Configura el backend (AI_FOOTPRINT_INGEST_ENDPOINT o footprint --set-endpoint) y reinténtalo.',
      errorWrongPassword: 'Contraseña de superadmin incorrecta.',
      errorDisabled:
        'Endpoint no disponible: la sesión de superadmin está deshabilitada fuera de entornos no productivos.',
      errorGeneric: 'No se pudo abrir la sesión de superadmin. Inténtalo de nuevo.',
      // Inspect (ADR-025) — recibo de atribución de certificaciones YA guardadas.
      inspectIntro:
        'Audita la evidencia de autoría de las certificaciones ya guardadas (solo lectura, entornos no productivos).',
      inspectEmailPrompt: 'Email cuya(s) certificación(es) quieres inspeccionar:',
      inspectNone: (email) => `No hay certificaciones guardadas para ${email}.`,
      inspectHeader: (count, email) =>
        `${count} certificación(es) guardada(s) para ${email}:`,
      inspectNote:
        'Traza de autoría basada en el autor de git (self-asserted); no es una prueba criptográfica de autoría.',
      inspectLabels: {
        score: 'Puntuación',
        dimensions: 'Dimensiones',
        repo: 'Repo',
        commitRange: 'Rango de commits',
        sampledFiles: 'Ficheros muestreados',
        authorsConfirmed: 'Autores confirmados',
        authorsConsidered: 'Autores considerados',
        model: 'Modelo',
        when: 'Fecha',
        testOrigin: 'Cuenta de prueba',
      },
      inspectErrorGeneric: 'No se pudo inspeccionar. Inténtalo de nuevo.',
    },
    // in-shell command help and messages — the commands keep their own copy.
    // The STARTUP BANNER is intentionally NOT here: it's always English (a
    // brand/product surface, like the installer), built in src/repl-shell.js.
    repl: {
      prompt: 'ϟ sh-eval ›',
      goodbye: 'Hasta pronto.',
      unknown: (cmd) => `Comando no reconocido: "${cmd}". Escribe "help" para ver los comandos disponibles.`,
      help:
        'Shakers — comandos disponibles\n\n'
        + '  footprint [opciones]   Escanea este proyecto y tu equipo; puntúa tu setup de IA (T0-T7)\n'
        + '  certify   [opciones]   Certifica tus Skills a partir del código de este proyecto\n'
        + '  report    [opciones]   Genera y abre el informe HTML completo (footprint + Skills certificadas)\n'
        + '  share     [opciones]   Crea una tarjeta branded de tu footprint para compartir en LinkedIn\n'
        + '  help                   Muestra esta ayuda\n'
        + '  clear                  Limpia la pantalla\n'
        + '  exit | quit            Cierra la shell\n\n'
        + 'Los flags de cada comando siguen funcionando dentro de la shell\n'
        + '(p.ej. `footprint --root <dir>`, `footprint --roadmap`, `certify --all`). Usa\n'
        + '`footprint --help` o `certify --help` para ver todas sus opciones.',
    },
  },
  en: {
    categories: {
      AGENTIC_CLI: 'Agentic CLI',
      AI_EDITOR: 'AI editor',
      IDE_ASSISTANT: 'IDE assistant',
      COMPLETION: 'Autocomplete',
      AI_TERMINAL: 'AI terminal',
    },
    mcpCategories: {
      data: 'Data',
      comms: 'Communication',
      dev: 'Development',
      browser: 'Browser',
      other: 'Other',
    },
    tierNames: {
      T0: 'Empty bench',
      T1: 'First tool',
      T2: 'Bench with notes',
      T3: 'Connected bench',
      T4: 'Own tooling',
      T5: 'Agentic operator',
      T6: 'Multi-agent',
      T7: 'Orchestrated workshop',
    },
    tierAnalysis: {
      heading: 'Tier analysis: why this level',
      intro: (tierKey, tierName) =>
        `Your current tier is ${tierKey} (${tierName}). The tier engine is deterministic: it certifies a `
        + 'level only when ALL criteria for that level and every level below it are met, checked strictly '
        + 'bottom-up (a signal for a higher tier never lets you skip a lower one). Below is a criterion-by-'
        + 'criterion breakdown of what was checked and the exact signal from your environment backing it.',
      metHeading: 'Criteria you meet:',
      blockingLabel: 'Exact criterion blocking your next tier:',
      maxTierNote: "You meet every criterion in the T0-T7 ladder: there's no additional criterion blocking your progress.",
      criterion: {
        t1Met: (n) => `You have at least one AI tool detected and configured in your environment (\`totalDetected = ${n}\`).`,
        t2Met: (n) => `You have at least one persistent context file — instructions, config or rules — for some tool (\`context = ${n}\`).`,
        t3Met: (n) => `You have at least one connected MCP server, giving the AI access to external data or tools (\`mcpServers = ${n}\`).`,
        t4Met: (n) => `You've created your own assets — skills, commands or custom rules — beyond the default configuration (\`custom = ${n}\`).`,
        t5Met: (hasAgentic, mcp, custom) => `You operate an agentic CLI (Claude Code, Aider, Gemini CLI, Codex CLI or Amazon Q Developer) combined with MCP and your own assets (\`hasAgentic = ${hasAgentic}\`, \`mcpServers = ${mcp}\`, \`custom = ${custom}\`).`,
        t6Met: (n) => `You have a team of at least 2 specialized agents defined (\`agentCounts.agents = ${n}\`).`,
        t7Met: (n) => `You have hook-based automation configured (\`hooks = ${n}\`).`,
        t1Blocking: (n) => `To reach T1 (First tool) you need at least one detected AI tool — currently \`totalDetected = ${n}\`.`,
        t2Blocking: (n) => `To reach T2 (Notebook bench) you need at least one persistent context file (instructions, config or rules) — currently \`context = ${n}\`.`,
        t3Blocking: (n) => `To reach T3 (Connected bench) you need to connect at least one MCP server — currently \`mcpServers = ${n}\`.`,
        t4Blocking: (n) => `To reach T4 (Own tooling) you need to create at least one asset of your own — skill, command or rule — currently \`custom = ${n}\`.`,
        t5Blocking: (hasAgentic, mcp, custom) => {
          const missing = [];
          if (!hasAgentic) missing.push('an agentic CLI (Claude Code, Aider, Gemini CLI, Codex CLI or Amazon Q Developer)');
          if (mcp < 1) missing.push('at least 1 MCP server');
          if (custom < 1) missing.push('at least 1 asset of your own (skill, command or rule)');
          return `To reach T5 (Agentic operator) you're missing: ${missing.join('; ')} (\`hasAgentic = ${hasAgentic}\`, \`mcpServers = ${mcp}\`, \`custom = ${custom}\`).`;
        },
        t6Blocking: (n) => `To reach T6 (Multi-agent) you need at least 2 specialized agents defined under \`.claude/agents/\` — currently you have ${n}.`,
        t7Blocking: (n) => `To reach T7 (Orchestrated workshop) you need at least one automation hook configured — currently \`hooks = ${n}\`.`,
      },
    },
    // Progression ladder (skill-code-certification, report req 1) — see the es block.
    ladder: {
      levelsHeading: 'Maturity levels (0-4)',
      tiersHeading: 'Tier ladder (T0-T7)',
      levelLabel: (n) => `Level ${n}`,
      intro:
        'Your maturity level (0-4) sums up your AI usage at a glance; the tier (T0-T7) is the '
        + 'fine-grained axis it is derived from. Both are deterministic. Below marks what you have '
        + 'already passed (✓), where you are now (●), and what lies ahead (○) with the exact criterion '
        + 'that unlocks it.',
      reachedLabel: 'Reached',
      currentLabel: 'You are here',
      pendingLabel: 'Pending',
      unlockLabel: 'To unlock',
      legend: (done, current, pending) => `${done} reached · ${current} current · ${pending} pending`,
      levelDesc: {
        none: 'No AI footprint: no AI tool detected in your environment.',
        exploring: 'Exploring: you have AI tools installed and are trying them out.',
        integrated: 'Integrated: AI is wired into your projects with persistent context.',
        power: 'Power user: you extend AI with MCP, your own skills/commands and agentic CLIs.',
        orchestrator: 'Orchestrator: you run several coordinated agents and end-to-end automation.',
      },
      tierDesc: {
        T0: 'Empty bench: no AI tool detected yet.',
        T1: 'First tool: you use at least one AI tool.',
        T2: 'Bench with notes: persistent context files guide the AI.',
        T3: 'Connected bench: an MCP server gives the AI access to your data and tools.',
        T4: 'Own tooling: you have built your own skills, commands or rules.',
        T5: 'Agentic operator: an agentic CLI drives MCP and your own assets end to end.',
        T6: 'Multi-agent: a team of 2+ specialized agents.',
        T7: 'Orchestrated workshop: hooks automate the workshop and agents orchestrate each other.',
      },
    },
    // Agent classification + improvement tips (skill-code-certification req 2/3) — see the es block.
    classification: {
      label: 'Classification',
      noCategory: 'No category',
      improvementsHeading: 'How to improve this agent',
      categories: {
        developer: 'Development',
        product: 'Product',
        designer: 'Design',
        marketing: 'Marketing',
        data: 'Data',
      },
      levels: {
        L1: 'L1 · operational',
        L2: 'L2 · tactical',
        L3: 'L3 · strategic',
      },
    },
    // `certify agents` — interactive agent-certification flow.
    certifyAgents: {
      intro: 'Agent certification: pick an agent and answer a few questions; the AI judges, against the real implementation, how deeply you command it.',
      disclaimer: 'The agent DEFINITION and your answers will be sent to the evaluation service (ephemeral; language does not change the level). Continue? [y/N]',
      disclaimerDeclined: 'Cancelled. Nothing was sent.',
      noAgents: 'No agents detected in this project (.claude/agents/).',
      chooseAgentHeading: 'Choose the agent to certify:',
      selectHint: 'Arrows ↑/↓ to move · enter to pick · esc to cancel',
      choosePrompt: (max) => `Number (1-${max}), empty to cancel: `,
      allEvaluated: 'You have certified every detected agent in this session.',
      qAchieve: 'What were you trying to achieve with this agent?',
      qDecisions: 'What decisions did you own personally?',
      generatingFollowups: 'Preparing follow-up questions…',
      followupsHeading: 'Follow-up questions:',
      certifying: 'Assessing your command of the agent against its implementation…',
      definitionTruncated: (max) =>
        `Note: this agent's definition exceeds the maximum; it was trimmed to ${max} characters before sending.`,
      rerunPrompt: 'Certify another of the remaining agents? [y/N]',
      gateNotRegistered: 'Agent certification is only available to Talents registered on Shakers. The email provided is not a registered Talent.',
      gateNotVerified: 'Verify ownership of your email before certifying (run the flow with verification).',
      error: (reason) => `Could not certify the agent (${reason}). Nothing was saved.`,
      levelNames: {
        none: 'Not substantiated',
        P1: 'P1 · Familiar',
        P2: 'P2 · Practitioner',
        P3: 'P3 · Proficient',
        P4: 'P4 · Advanced',
        P5: 'P5 · Expert',
      },
      levelDesc: {
        none: 'The evidence does not back a meaningful command of the agent.',
        P1: 'You know the agent and use it; little ownership of its design.',
        P2: 'You operate it deliberately; your own configuration decisions, with gaps.',
        P3: 'Solid command: you shaped scope and limits and own key decisions.',
        P4: 'Deep command: you designed for failures and edge-cases, evidence verified.',
        P5: 'Mastery: verified command across every key area; you evolve it.',
      },
      areaNames: {
        purpose_fit: 'Purpose & fit',
        design_ownership: 'Design ownership',
        boundaries_guardrails: 'Boundaries & guardrails',
        failure_handling: 'Failure handling',
        operation_evolution: 'Operation & evolution',
      },
      tagLabels: {
        verified: 'verified',
        partial: 'partial',
        claimed: 'claimed',
        not_evidenced: 'not evidenced',
        n_a: 'n/a',
      },
      reportHeading: 'Agent certification',
      levelLabel: 'Level',
      whyHeading: 'Why',
      verifiedHeading: 'Verified evidence',
      unverifiedHeading: 'Unverified (not confirmed against the implementation)',
      areasHeading: 'Areas assessed',
      rationaleHeading: 'Assessment',
      noVerified: '(no verified evidence)',
      savedHint: 'Saved. Run `report` to see the full report in your browser.',
      // Terminal summary (the full breakdown now lives in the HTML report).
      summaryHeading: 'Agent certified',
      areasVerified: (n, total) => `${n}/${total} verified`,
      // Superadmin-only fast testing shortcut (--fast): skip the Q&A.
      fastModeNotice: 'Fast mode (superadmin): skipping the Q&A with sample answers; the verdict still runs for real.',
      fastModeDenied: 'Fast mode (--fast) is only available with an active superadmin session; the Q&A will be asked normally.',
      sampleAchieve: 'I wanted an agent that automated a specific part of my workflow, with a bounded scope and reviewable outputs.',
      sampleDecisions: 'I defined its purpose and boundaries myself, chose its tools and guardrails, and decided how it handles failures.',
      sampleFollowupAnswer: 'I designed it this way deliberately for the project constraints and have iterated on it based on real results.',
    },
    levelNames: {
      none: 'No AI footprint',
      exploring: 'Exploring',
      integrated: 'Integrated',
      power: 'Power user',
      orchestrator: 'Orchestrator',
    },
    nextSteps: {
      0: 'Install an AI tool (Claude Code, Cursor or Copilot) and try it on a real project.',
      1: 'Add an instructions file to the project (CLAUDE.md, .cursorrules or copilot-instructions.md) to give it persistent context.',
      2: 'Connect an MCP server or create your own rules/commands so the AI can reach your data and workflows.',
      3: 'Combine an agentic CLI with MCP and your own skills/commands; automate a recurring task end to end.',
      4: 'You already operate at orchestration level: document your setup and chain agents or background runs.',
    },
    recency: {
      today: 'today',
      this_week: 'this week',
      this_month: 'this month',
      this_quarter: 'this quarter',
      stale: 'outdated',
    },
    terminal: {
      brandSub: 'AI usage profile',
      toolsDetected: (n, total) => `${n}/${total} tools detected`,
      level: (level, name) => `Level ${level} · ${name}`,
      // Current tier appended to the top bar, next to the level (report req 1 addendum).
      tierInline: (key, name) => ` · Tier ${key} · ${name}`,
      detectedHeading: 'Detected',
      none: '(none)',
      environment: 'Environment',
      editors: 'editors',
      noEditorsDetected: 'none detected',
      // ADR-016 agent evaluation (terminal, one line per agent): compact usage
      // signal derived from the local Claude Code history.
      agentUsed: (n) => `used ${n}×`,
      agentUnused: 'no local use',
      agentUsageUnavailable: '(no local Claude Code history: usage unavailable)',
      // ADR-016: discoverability hint for the next-steps section (behind --roadmap).
      roadmapHint: 'Run `footprint --roadmap` to see recommended next steps.',
      nextStep: 'Next step',
      files: (n) => `${n} ${n === 1 ? 'file' : 'files'}`,
      lastModified: (label) => `last modified: ${label}`,
    },
    html: {
      lang: 'en',
      title: (level) => `AI Footprint · Level ${level}`,
      h1: 'Your AI usage profile',
      sub: 'A local snapshot of which AI tools you have and how deeply you have configured them.',
      levelOf: (level) => `Level ${level} of 4`,
      // Current tier shown in the hero bar next to the level (report req 1 addendum).
      currentTier: (key, name) => `Tier ${key} · ${name}`,
      detectedSuffix: (total) => `of ${total} tools detected`,
      maturity: 'Maturity',
      tools: 'Tools',
      toolsEmpty: 'No AI tool was detected in your environment.',
      configIntensity: 'configuration intensity',
      files: (n) => `${n}&nbsp;${n === 1 ? 'file' : 'files'}`,
      lastModified: (dateStr) => `last modified: ${dateStr}`,
      environment: 'Environment',
      platform: 'Platform',
      architecture: 'Architecture',
      installedEditors: 'Installed editors',
      noEditorsDetected: 'none detected',
      nextStep: 'Next step',
      // Agent cards (talents-ai-score): the SOLE agents view (consolidates
      // and replaces the earlier separate deterministic org-chart tree,
      // which duplicated this same data) — a hierarchical role-card tree,
      // enriched with the ephemeral synthesis result (symbolicName/
      // whatItDoes) when it succeeded this run; the SAME tree renders with
      // just the structural data (name/tools/model/hierarchy) otherwise.
      diagramHeading: 'Agents',
      agentsEmpty: 'No configured AI agents detected (e.g. .claude/agents/).',
      agentRealNameLabel: "agent's real name",
      orchestratorLabel: 'Orchestrator',
      reportsToLabel: 'Reports to:',
      agentDescriptionFromName: (name) => `"${name}" agent (no description declared in its file).`,
      // AI product an agent belongs to, derived from its source (proper nouns; same es/en).
      aiProducts: { 'claude-code': 'Claude Code' },
      // ADR-016 agent evaluation (HTML per-agent detail): definition-quality
      // score + LLM rationale + local usage signal. The full detail lives here;
      // the terminal keeps only a one-line summary.
      agentScoreLabel: 'Definition quality (0-100)',
      agentQualityLabel: 'Why:',
      agentUsageLabel: 'Local usage (Claude Code history)',
      agentUsedTimes: (n) => `used ${n}×`,
      agentUnused: 'no local use',
      // Project technologies (talents-ai-score, ADR-012). Refined: shows
      // recognized FRAMEWORKS/LIBRARIES only, not a raw dependency dump.
      technologiesHeading: 'Project technologies',
      technologiesEmpty: 'No recognized framework or library was found in the dependency manifests (package.json, requirements.txt, go.mod, pyproject.toml).',
      // MCP servers by name (talents-ai-score, issue 015). LOCAL ONLY.
      mcpHeading: 'Detected MCP servers',
      // Tier roadmap (talents-ai-score, issue 020): only short UI labels
      // live here — the authored prose is Spanish-only for now (no English
      // translation authored yet), src/roadmap-content.js.
      roadmapHeading: 'Your next level',
      roadmapUpgradeWhenLabel: 'You level up when:',
      roadmapUnlocksLabel: 'What it unlocks',
      roadmapStepsLabel: 'Steps',
      roadmapSnippetLabel: 'Copyable snippet',
      roadmapTipsLabel: 'Community tips',
      roadmapMistakesLabel: 'Common mistakes',
      roadmapConsolidationLabel: 'Consolidation steps',
      roadmapHonestyLabel: 'Honesty note',
      roadmapContentUnavailable: "This level's detailed content isn't available in this language yet.",
      roadmapPersonalizedNotice: 'Content adapted to your project.',
      implementationPromptHeading: 'Implementation prompt',
      implementationPromptHint: 'Copy this prompt and paste it into your AI tool of choice (Claude Code, Cursor, ChatGPT...) so it implements this in your project.',
      implementationPromptCopyLabel: 'Copy',
      implementationPromptCopiedLabel: 'Copied ✓',
      privacyNote:
        'This report was generated locally. It only records which tools exist, '
        + 'how many configurations you have and your level: never the content of '
        + 'your files, paths or credentials.',
      metaLine: (dateStr, anonId, platform) =>
        `Generated ${dateStr} · anonymous id <code>${anonId}</code> · platform ${platform}`,
      rawData: "View this report's exact data (JSON)",
    },
    cli: {
      // Reporting redesign (skill-code-certification): HTML is no longer opt-in
      // (--html retired). Every run updates the cumulative report and ALWAYS
      // prints its file:// link to open in the browser.
      reportLink: (url) => `Open your report in your browser:\n  ${url}`,
      // `share` command (skill-code-certification): CLI copy wrapping the
      // branded LinkedIn card. The CARD itself is always English (brand
      // surface); this is only the localized terminal copy.
      share: {
        help: 'share — build a branded card with your footprint result (tier + score) to post on LinkedIn.\n'
          + '  Run `footprint` first; `share` uses this project\'s latest footprint.\n'
          + '  Options: --root <dir>, --lang es|en',
        noFootprint: 'No footprint for this project yet. Run `footprint` first, then `share`.',
        ready: (url) => `Your shareable card is ready — open it to download the PNG and post it:\n  ${url}`,
        hint: 'LinkedIn can\'t attach an image from a URL: download the PNG from the card, then attach it to your post.',
        error: 'Could not generate the shareable card.',
      },
      // `report` command (ADR-016): builds and OPENS the full, shareable HTML
      // report for this project (footprint + certified Skills).
      // `footprint`/`certify` no longer print a link; the HTML is produced here.
      report: {
        help: 'report — build and open the full HTML report for this project (footprint + certified Skills) to share with your team.\n'
          + '  Run `footprint` (and optionally `certify`) first; `report` gathers their result.\n'
          + '  Options: --root <dir>, --lang es|en, --no-open (do not open the browser; just print the link)',
        noData: 'Nothing to show for this project yet. Run `footprint` first (and optionally `certify`), then `report`.',
        ready: (url) => `Your report is ready:\n  ${url}`,
        opening: 'Opening it in your browser…',
        error: 'Could not generate the report.',
      },
      scanningLabel: 'Scanning environment and detectors…',
      synthesizingLabel: 'Synthesizing agents with AI…',
      personalizingRoadmapLabel: 'Personalizing roadmap…',
      // ADR-016: agent definition-quality evaluation (ephemeral LLM call).
      evaluatingAgentsLabel: 'Evaluating your agents’ quality…',
      buildNextLevelHint: 'Alternatively, run `footprint --build-next-level` to generate the starter file directly in your project.',
      // Localized help (skill-code-certification / ADR-003): previously
      // hardcoded Spanish in bin/report.js; now routed through i18n so it
      // respects the machine locale.
      help:
        '\nAI Footprint — local profile of your AI-tool usage\n\n'
        + 'Usage:\n  footprint [options]\n\n'
        + 'Options:\n'
        + '      --json             Print the report as JSON on stdout\n'
        + '      --no-save          Do not persist the report state (show only)\n'
        + '      --root DIR         Scan DIR instead of the current directory\n'
        + '      --roadmap          Show the "next steps" block (hidden by default)\n'
        + '      --build-next-level Generate the next tier starter (secondary alternative)\n'
        + '      --force            With --build-next-level, overwrite an existing file\n'
        + '      --lang es|en       Force the language (report + prompt) instead of OS detection\n'
        + '      --consent-status   Show your save decision / email / last send\n'
        + '      --consent-revoke   Revoke saving (→ denied); stops sending\n'
        + '      --consent-reset    Clear the decision (→ undecided); asks again\n'
        + '      --consent-email C  Change the stored email, decision untouched\n'
        + '      --set-endpoint URL Save the ingest endpoint to ~/.config/ai-footprint/config.json\n'
        + '                         (a non-local host must be https). The env var takes precedence\n'
        + '      --show-endpoint    Show the effective endpoint and where it comes from (env / config / none)\n'
        + '  -h, --help             Show this help\n\n'
        + 'The report is ALWAYS generated and shown on your machine. footprint no longer\n'
        + 'prints a link: use the `report` command to build and open the full HTML report\n'
        + '(footprint + certified Skills) you can share with your team. Before showing the\n'
        + 'result, the first time you are asked whether to SAVE it in Shakers (with your\n'
        + 'email); you are asked only once. Reopen the question with --consent-reset.\n\n'
        + 'The send destination resolves as: AI_FOOTPRINT_INGEST_ENDPOINT (env) > the config\n'
        + 'file (--set-endpoint) > none. Without an endpoint, the report is shown but not sent\n'
        + 'to Shakers.\n',
    },
    // Cumulative report (skill-code-certification, reporting redesign) —
    // English mirror. Same content/invariants as the Spanish catalog.
    cumulative: {
      title: 'Your Shakers report',
      subtitle: 'Your AI report for this project.',
      footprintHeading: 'AI Footprint',
      certificationHeading: 'Skill certification',
      agentCertificationHeading: 'Agent certification',
      privacyNote: 'This report is generated and stored only on your machine. Nothing is sent to Shakers unless you give explicit consent.',
      updatedLabel: (when) => `Updated: ${when}`,
      unknownProject: '(unknown project)',
    },
    buildNextLevel: {
      heading: (tierKey) => `Generating the starter to reach ${tierKey}...`,
      created: (filename) => `+ created ${filename}`,
      overwritten: (filename) => `+ overwritten ${filename} (--force)`,
      skippedExists: (filename) => `${filename} already exists — not overwriting (use --force to overwrite)`,
      maxTier: "You're already at the max tier (T7): there's no next level to build.",
      noFileTarget: "The next step isn't a file this command can create — check the roadmap snippet in the report.",
      unrecognizedTier: "Couldn't determine your current tier.",
    },
    consent: {
      // talents-ai-score, ADR-011: the disclosure wall (itemized sends /
      // never sends) is RETIRED from the CLI — that content now lives in
      // the repo's README. The report ALWAYS shows locally, unconditionally.
      // What's left is this short, one-time question about PERSISTING
      // (saving) the already-shown report in Shakers.
      //
      // talents-ai-score, issue 022 (ADR-013/014): updated for the level-up
      // framework's expanded scope — see the Spanish catalog's comment for
      // the full rationale (same content, same invariants).
      persistIntro:
        'This report has already been generated and shown on your machine, '
        + 'always. Saving it in Shakers is optional and revocable at any '
        + "time (footprint --consent-revoke): it saves your level/tier and "
        + 'structured signals derived across categories (tools, MCP, memory, '
        + 'automations, agents, technologies) — never the content of your '
        + 'files, prompts, paths or credentials. Indicative data, not verified, '
        + 'not an official qualification. You are responsible for the information '
        + 'you choose to share; Shakers assumes no liability for the data you '
        + 'submit. Misuse of these tools —submitting or analyzing code that is not '
        + 'yours or that you are not authorized to analyze— may result in penalties '
        + "on your Shakers account, up to and including suspension. See this "
        + "repository's README for more detail. "
        + '[Legal copy PENDING LEGAL/LABOR REVIEW — NOT FINAL]',
      persistQuestion: 'Save this report in Shakers? (y/n):',
      invalidAnswer: 'Answer not recognized. Reply "y" (yes) or "n" (no).',
      emailPrompt: 'Enter your email:',
      invalidEmail: 'Invalid email, try again.',
      notObtained: "Couldn't record your answer; you'll be asked again next time.",
      deniedSaved: 'Understood, nothing will be saved. You can change your mind later by running the command again.',
      grantedSaved: (email) => `Thanks. From now on this report will be saved in Shakers automatically (email: ${email}, max. once per hour).`,
      skipAlreadyDecided: (decision, path) =>
        `Consent already answered (${decision}) — stored at ${path}. `
        + 'Use --consent-status to view it, --consent-revoke to deny, or --consent-reset to be asked again.',
      nonInteractiveWarning:
        'Non-interactive input (no TTY) detected: if no answer arrives via stdin, consent will not be '
        + 'saved this run and you will be asked again next time.',
      status: {
        heading: 'Consent status (saved in Shakers)',
        decisionGranted: 'Decision: granted',
        decisionDenied: 'Decision: denied',
        decisionNone: 'Decision: no decision yet',
        email: (value) => `Email: ${value || '(none)'}`,
        verificationPending: 'Email pending verification: nothing is sent to Shakers until verified (use --consent-reset to retry).',
        lastSentAt: (value) => `Last saved: ${value || '(never)'}`,
      },
      revoked: 'Consent revoked. Nothing will be saved automatically anymore.',
      reset: 'Consent decision reset. You will be asked again on the next run.',
      emailChanged: (email) => `Email updated to ${email}. It will be used on the next save.`,
      emailInvalidCli: 'Invalid email. Usage: footprint --consent-email you@example.com',
    },
    // Endpoint config (endpoint-config task): --set-endpoint / --show-endpoint
    // copy. The endpoint decides where the sampled code is sent, hence the
    // https-for-non-local-hosts rule.
    endpoint: {
      setOk: (url, path) => `Ingest endpoint saved: ${url}\n  (at ${path}). The AI_FOOTPRINT_INGEST_ENDPOINT environment variable, if set, takes precedence.`,
      errInsecureRemote: 'Endpoint rejected: a host other than localhost/127.0.0.1 must use https:// (the endpoint decides where your code is sent). Use an https URL or a local host.',
      errInvalidUrl: 'Endpoint rejected: invalid URL. It must be a full http(s) URL, e.g. https://your-hub/api/v1/works/ai-footprint/reports',
      errEmpty: 'Endpoint rejected: no URL provided. Usage: footprint --set-endpoint https://your-hub/api/v1/works/ai-footprint/reports',
      showEnv: (url) => `Effective ingest endpoint: ${url}\n  Source: AI_FOOTPRINT_INGEST_ENDPOINT environment variable.`,
      showConfigFile: (url, path) => `Effective ingest endpoint: ${url}\n  Source: config file (${path}).`,
      showConfigInvalid: (path) => `The config file (${path}) has an invalid or insecure endpoint; it is ignored. Fix it with footprint --set-endpoint <url>.`,
      showNone: 'No ingest endpoint configured. Set AI_FOOTPRINT_INGEST_ENDPOINT or use footprint --set-endpoint <url>. Without it, the report is still shown but not sent to Shakers.',
    },
    // Email-ownership verification (skill-code-certification / ADR-006): the
    // OTP "wait mode" copy, shared by both binaries. Gates PERSISTENCE ONLY —
    // the report was already shown. The pasted code is never echoed here
    // beyond the single prompt.
    verify: {
      sent: (email) => `We sent a verification code to ${email}.`,
      waitHint: 'Paste the code here. Press "r" then Enter to resend it, or Enter on a blank line to cancel.',
      codePrompt: 'Verification code:',
      verified: 'Email verified. Saving your report in Shakers…',
      invalidCode: 'Incorrect code. Check it and paste it again.',
      expired: 'The code has expired. Press "r" then Enter to send a new one.',
      resent: (email) => `We resent a code to ${email}.`,
      resendFailed: 'Could not resend the code. Please try again in a moment.',
      requestFailed: 'Could not send the verification code to the Hub. The report will not be saved; it has already been shown to you.',
      technicalError: 'Could not verify the email against the Hub. The report will not be saved; it has already been shown to you.',
      tooManyAttempts: 'Too many failed attempts. The email was not verified, so the report will not be saved.',
      cancelled: 'Verification cancelled. The report will not be saved (it has already been shown to you).',
      unavailable: 'Email verification is not available right now; the report will not be saved (it has already been shown to you).',
    },
    // Skill Code Certification (skill-code-certification, issues 004/006) —
    // English mirror of the `certify` catalog. Same content/invariants.
    certify: {
      // Subcommand chooser (skill-code-certification): `certify` = skills or agents.
      flowHeading: 'What do you want to certify?',
      flowSkills: 'skills — certify Skills from your catalog, from code',
      flowAgents: 'agents — certify your command of an AI agent',
      flowPrompt: 'Choose [1=skills, 2=agents], empty to cancel: ',
      flowUsage: 'Usage: `certify skills` or `certify agents`.',
      help:
        'AI Certify — certify Skills from your Shakers catalog by analyzing your local project\n\n'
        + 'Usage:\n'
        + '  certify [options]\n\n'
        + 'Options:\n'
        + '      --root DIR           Analyze DIR instead of the current directory\n'
        + '      --email EMAIL        Your Talent email (else the stored one, else you are asked)\n'
        + '      --lang es|en         Force the output language\n'
        + '      --accept-disclaimer  Accept the legal disclaimer non-interactively (explicit acceptance)\n'
        + '      --all                Certify ALL certifiable Skills (no interactive selection)\n'
        + '      --skills 1,3         Certify the Skills at these positions (no interactive selection)\n'
        + '      --fast               (`certify agents`, superadmin only) skip the Q&A with sample answers\n'
        + '  -h, --help               Show this help\n\n'
        + 'Phase 1 (resolve): detects your project technologies and asks the Shakers Hub\n'
        + 'which Skills are certifiable. Phase 2 (certify): you pick which Skills to\n'
        + 'certify, a code sample is taken, secrets are scrubbed, and it is sent for a\n'
        + 'per-Skill assessment (scores are indicative, not an official qualification).\n'
        + 'Requires AI_FOOTPRINT_CERTIFY_ENDPOINT to be set. A legal disclaimer is shown\n'
        + 'and must be accepted before anything is sent.',
      scanningLabel: 'Detecting project technologies…',
      resolvingLabel: 'Resolving certifiable Skills…',
      disclaimer:
        'LEGAL DISCLAIMER — read before continuing:\n'
        + '  certify sends data about your project to Shakers to certify your Skills.\n'
        + '  In this phase (resolve) it sends your email and the NAMES of the detected\n'
        + '  technologies; the later certification phase will send code snippets.\n'
        + '  You are SOLELY responsible for ensuring you own, or are authorized to analyze,\n'
        + "  this project's code. Shakers assumes no liability for the code you submit.\n"
        + '  Submitting code that is not yours or that you are not authorized to analyze is\n'
        + '  a misuse of these tools and may result in penalties on your Shakers account, up\n'
        + '  to and including suspension. Do NOT use this tool on a third party\'s code\n'
        + '  (e.g. a client under NDA). Skill scores are indicative and unverified, not an\n'
        + '  official qualification.\n'
        + '  [PENDING LEGAL/LABOR REVIEW — NOT FINAL]',
      disclaimerQuestion: 'Do you accept and continue? (y/n):',
      disclaimerAcceptedFlag: 'Disclaimer accepted via --accept-disclaimer.',
      disclaimerNonInteractive:
        'Non-interactive input and no --accept-disclaimer: cannot obtain explicit '
        + 'acceptance. Aborting (nothing was sent).',
      disclaimerDeclined: 'You did not accept the disclaimer. Nothing was sent.',
      disclaimerInvalidAnswer: 'Answer not recognized. Reply "y" (yes) or "n" (no).',
      disclaimerNoAnswer: 'No answer obtained. Nothing was sent.',
      emailPrompt: 'Enter your Shakers email:',
      emailInvalid: 'Invalid email, try again.',
      emailUsing: (email) => `Using email: ${email}`,
      emailNeeded: 'A valid email is required to resolve your certifiable Skills. Nothing was sent.',
      noTechnologies:
        'No framework or library was recognized in this project (package.json, '
        + 'requirements.txt, go.mod, pyproject.toml). Nothing to certify.',
      technologiesDetected: (list) => `Detected technologies: ${list}`,
      resolveHeading: 'Certifiable Skills for your project',
      certifiableHeading: 'Certifiable:',
      certifiableEmpty: 'No detected technology maps to a Skill you can certify right now.',
      certifiableLine: (skillName, technology, skillId) =>
        `✓ ${skillName}${technology ? ` (${technology})` : ''}${skillId != null ? ` [#${skillId}]` : ''}`,
      nonCertifiableHeading: 'Not certifiable:',
      nonCertifiableEmpty: 'None — every detected technology is certifiable.',
      nonCertifiableLine: (tech, reason) => `· ${tech} — ${reason}`,
      reasons: {
        'no-skill-match': 'no matching Skill in the Shakers catalog',
        'not-declared': "you haven't declared this Skill in your Talent profile",
        'no-sampling': "can't be code-certified yet (no code sampling defined)",
        notCertifiable: 'not certifiable',
      },
      errorNoEndpoint:
        'No endpoint configured. certify uses the same base as footprint: set it with '
        + 'footprint --set-endpoint <url> (or the AI_FOOTPRINT_INGEST_ENDPOINT variable), and the '
        + 'certification path is derived automatically. (There is no local-only certification: the '
        + 'Skill catalog and the analysis live on the Hub.)',
      errorIntro: 'Could not resolve certifiable Skills:',
      errorIntroCertify: 'Could not certify your Skills:',
      errorNetwork: 'the certification service could not be reached (network error).',
      errorTimeout: 'the certification service timed out.',
      errorHttp: (status) => `the certification service returned an unexpected status (HTTP ${status}).`,
      errorInvalidResponse: 'the certification service returned an unexpected response.',
      errorRetryHint: 'Nothing was certified. Check your connection and try again later.',
      // Expected gate outcome (403), not a technical error (issue 014): calm
      // message, no "unexpected status", no "HTTP 403", no retry hint.
      notRegistered: (email) =>
        `Skill certification is only for registered Shakers Talents; we couldn't find ${email} as a Talent.`,
      // 413: project too large (issue 014) — actionable, not the generic connection error.
      errorTooLarge:
        'The project is too large to certify at once. Reduce the scope '
        + '(fewer files or Skills) and try again.',
      // 5xx: the backend is down/restarting or missing DB migrations (the
      // "missing migrations" bugfix). Actionable message, DISTINCT from the
      // network error: it's not your connection, it's the server.
      errorBackendOutdated:
        'The backend is unavailable: it is missing database migrations or is restarting. '
        + 'Apply migrations and restart it, then try again. Nothing was certified.',
      // Interactive Skill selection (certify phase, issue 005).
      selectHeading: 'Select the Skills you want to certify:',
      selectHint: 'Arrows ↑/↓ to move · space to toggle · a = all · enter to confirm · esc to cancel',
      selectPrompt: 'Enter the numbers separated by commas (or "all"):',
      selectInvalid: 'Invalid selection. Enter numbers from the list (or "all").',
      selectNonInteractive: 'Non-interactive input without --skills/--all: cannot select Skills. Aborting (no code was sent).',
      selectNothing: 'There are no certifiable Skills to select.',
      selectNoneChosen: 'No Skill selected. No code was sent.',
      // Verified authorship gate (ADR-017): only code attributable to the
      // Talent's verified identity is certifiable. "No attributable email, no
      // certification" — non-attributable code is never sent.
      authorshipNoGit: 'Without git history the code authorship cannot be verified. Only code attributable to your verified identity is certified; nothing was certified or sent.',
      authorshipNoneAttributable: 'None of the selected Skills has code attributable to your verified email. Without an attributable email there is no certification; no code was sent.',
      authorshipRefused: (skills) => `These Skills were not certified for lack of code attributable to your verified email: ${skills}.`,
      // Human contact valve (ADR-018) — DISPLAY only, no automatic send. Shown
      // in the refusal path for a possible legitimate false negative (commits
      // under another email, monorepo, migrated history). Copy is DRAFT (to validate).
      authorshipContact: 'If you believe you hold the authorship and this is an error (commits under another email, monorepo, or migrated history), write to us at talent@shakersworks.com.',
      // ADR-027: active superadmin session — the authorship gate is bypassed.
      superadminBypass: (email) =>
        `Superadmin session active${email ? ` (${email})` : ''}: authorship gate bypassed; all sampled code will be certified (test_origin).`,
      selectOption: (index, skillName, technology) => `  ${index}) ${skillName}${technology ? ` (${technology})` : ''}`,
      certifyingLabel: 'Analyzing your Skills’ code…',
      // Reporting redesign: HTML is no longer opt-in; each certification is
      // added to the cumulative report and its file:// link is ALWAYS printed.
      reportLink: (url) => `Open your report in your browser:\n  ${url}`,
      report: {
        heading: 'Skill certification result',
        disclaimer:
          'Note: the score is computed from an anchored rubric (0-4 dimensions) with a fixed '
          + 'formula, so the aggregation is deterministic — the same per-dimension judgments '
          + 'always yield the same score. Only the model’s per-criterion judgments may vary '
          + 'slightly between runs. It is an indicative assessment, not an official '
          + 'Client-facing certification.',
        partialSampleWarning:
          'Partial sample: due to size limits the assessment is based on a sample of the code, '
          + 'not the whole project.',
        scoreLine: (score) => `Score: ${score == null ? 'n/a' : `${score}/100`}`,
        // ADR-024 rubric dimensions.
        dimensionsLabel: 'Dimensions',
        dimensionNA: 'N/A',
        dimensionLabels: {
          idiomatic: 'Idiomatic usage',
          correctness: 'Correctness & robustness',
          depth: 'Depth',
          structure: 'Structure & maintainability',
          testing: 'Testing',
        },
        rationaleLabel: 'Why',
        improvementsLabel: 'Suggested improvements',
        // ADR-025 authorship receipt (attribution, NOT cryptographic proof).
        receipt: {
          label: 'Authorship',
          repoLabel: 'Repo',
          commitRangeLabel: 'Commit range',
          filesLabel: 'File',
          authorLabel: 'Author (git)',
          confirmedLabel: 'Authors confirmed against the identity',
          attributedYes: '✓',
          attributedNo: '✗',
          summary: (attributed, total) => `${attributed}/${total} files attributed to the identity`,
          note:
            'Attribution trail based on the git author (self-asserted); it is not '
            + 'cryptographic proof of authorship.',
        },
        sampleSummary: (included, candidate, estTokens) =>
          `Sample: ${included}/${candidate} files · ~${estTokens} tokens`,
        partialTag: '(partial sample)',
        notCertified: 'This Skill could not be certified in this run.',
        notSampleableNote: (technology) =>
          `No sampling is defined for the technology "${technology}": it can't be code-certified yet.`,
        htmlTitle: 'Skill Certification · Shakers',
        noItems: 'No certification results to show.',
        costNote:
          'Cost note: a fair amount of code is analyzed per Skill (up to ~150k tokens/Skill), '
          + 'which has a per-run cost.',
        remediationHeading: 'Prompt to apply the improvements',
        remediationHint: 'Copy this prompt and paste it into your AI tool (Claude Code, Cursor…) to apply the improvements.',
        remediationIntro: (skillName, technology) =>
          `Help me improve my ${skillName}${technology ? ` (${technology})` : ''} code in this project. `
          + 'A code review flagged these improvements:',
        remediationClosing:
          'Apply them directly in my project: create or edit whatever is needed, follow the conventions I already use, '
          + 'and briefly explain what you changed and why.',
        remediationCopyLabel: 'Copy',
        remediationCopiedLabel: 'Copied ✓',
      },
    },
    // Branded mini-shell chrome (skill-code-certification / ADR-014). The
    // ADR-027 — password-authenticated superadmin SESSION (NON-PROD only).
    superadmin: {
      sessionIntro:
        'Open a superadmin session (non-production environments only): certify will run against ANY email on ANY repo, bypassing the identity and authorship gates.',
      passwordPrompt: 'Superadmin password:',
      emailPrompt: 'Your superadmin email (for audit only):',
      emailInvalid: 'Invalid email. Try again.',
      needInput: 'Password and email are required (interactively, or --password and --email).',
      sessionReady: (email) =>
        `Superadmin session opened (audit: ${email}). certify will now use this session with any email.`,
      sessionExpires: (iso) => `Session expires: ${iso}.`,
      sessionHint:
        'Run:  certify --email <anyone> --accept-disclaimer --all   ·   To end it:  superadmin --logout',
      loggedOut: 'Superadmin session forgotten (local token removed).',
      errorNoEndpoint:
        'No endpoint configured. Set the backend (AI_FOOTPRINT_INGEST_ENDPOINT or footprint --set-endpoint) and retry.',
      errorWrongPassword: 'Incorrect superadmin password.',
      errorDisabled:
        'Endpoint unavailable: the superadmin session is disabled outside non-production environments.',
      errorGeneric: 'Could not open the superadmin session. Try again.',
      // Inspect (ADR-025) — attribution receipt for ALREADY-stored certifications.
      inspectIntro:
        'Audit the authorship evidence of already-stored certifications (read-only, non-production).',
      inspectEmailPrompt: 'Email whose certification(s) to inspect:',
      inspectNone: (email) => `No stored certifications for ${email}.`,
      inspectHeader: (count, email) => `${count} stored certification(s) for ${email}:`,
      inspectNote:
        'Attribution trail based on the git author (self-asserted); it is not cryptographic proof of authorship.',
      inspectLabels: {
        score: 'Score',
        dimensions: 'Dimensions',
        repo: 'Repo',
        commitRange: 'Commit range',
        sampledFiles: 'Sampled files',
        authorsConfirmed: 'Confirmed authors',
        authorsConsidered: 'Considered authors',
        model: 'Model',
        when: 'When',
        testOrigin: 'Test account',
      },
      inspectErrorGeneric: 'Could not inspect. Try again.',
    },
    // `sh-eval` REPL is the single entrypoint; this covers the prompt, the
    // in-shell command help and messages — the commands keep their own copy.
    // The STARTUP BANNER is intentionally NOT here: it's always English (a
    // brand/product surface, like the installer), built in src/repl-shell.js.
    repl: {
      prompt: 'ϟ sh-eval ›',
      goodbye: 'See you soon.',
      unknown: (cmd) => `Unknown command: "${cmd}". Type "help" to list the available commands.`,
      help:
        'Shakers — available commands\n\n'
        + '  footprint [options]   Scan this project + your machine; score your AI setup (T0-T7)\n'
        + '  certify   [options]   Certify your Skills from this project\'s code\n'
        + '  report    [options]   Build and open the full HTML report (footprint + certified Skills)\n'
        + '  share     [options]   Build a branded card of your footprint to share on LinkedIn\n'
        + '  help                  Show this help\n'
        + '  clear                 Clear the screen\n'
        + '  exit | quit           Close the shell\n\n'
        + 'Each command\'s flags still work inside the shell\n'
        + '(e.g. `footprint --root <dir>`, `footprint --roadmap`, `certify --all`). Use\n'
        + '`footprint --help` or `certify --help` for all their options.',
    },
  },
};

// Reverse map {Spanish text -> stable key}, built from the CATEGORIES
// catalog that detectors.js ALREADY exports (key -> Spanish text).
// detectors.js is not touched: only what it already exposes is read, so we
// can translate by key instead of by the Spanish string consumed by the
// scanner/HTML unchanged.
const CATEGORY_KEY_BY_LABEL_ES = Object.fromEntries(
  Object.entries(CATEGORIES).map(([key, label]) => [label, key]),
);

// Translates a tool's `category` (always in Spanish, as produced by the
// scanner) to the stable CATEGORIES key and from there to the requested
// language's catalog. If detectors.js were to add a new category in the
// future without registering its translation here, it degrades to the
// Spanish text as-is (never breaks rendering; the gap would be flagged for
// review, not hidden).
function categoryLabel(lang, categoryEs) {
  const key = CATEGORY_KEY_BY_LABEL_ES[categoryEs];
  const translated = key && catalogs[getResolvedLang(lang)].categories[key];
  return translated || categoryEs;
}

function getResolvedLang(lang) {
  return lang === 'es' || lang === 'en' ? lang : 'en';
}

// Resolution rule: only 'es' and 'en' supported. Any code that doesn't
// start with 'es' falls back to English (universal fallback).
function resolveLang(langCode) {
  return langCode && /^es/i.test(langCode) ? 'es' : 'en';
}

// Single entry point for report callers (bin/report.js): detects the OS
// language (see locale.js) and already returns the resolved catalog code
// ('es' or 'en').
function detectReportLang(env = process.env) {
  return resolveLang(detectLangCode(env));
}

function getCatalog(lang) {
  return catalogs[getResolvedLang(lang)];
}

// talents-ai-score, i18n audit: translates a T0-T7 tier KEY to its
// localized display name via the `tierNames` catalog above — the single
// place tier-engine.js's own (Spanish-only) `name` field should ever be
// bypassed for anything shown to the talent. Degrades to the bare
// `tierKey` (never tier-engine.js's raw Spanish name) if the key is
// somehow unrecognized, so a locale mismatch is visible/debuggable rather
// than silently leaking Spanish text.
function tierName(tierKey, lang) {
  const names = getCatalog(lang).tierNames;
  return (names && names[tierKey]) || tierKey;
}

module.exports = { detectReportLang, resolveLang, getCatalog, categoryLabel, tierName };
