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
      // skill-code-certification / ADR-009: la NOTA mide el setup de IA de ESTE
      // proyecto (por eso proyectos distintos dan notas distintas); el nivel/tier
      // refleja tu setup global como desarrollador (proyecto ∪ home).
      scoreScopeNote: 'La nota mide el setup de IA de este proyecto; el nivel refleja tu setup global.',
      detectedHeading: 'Detectadas',
      none: '(ninguna)',
      environment: 'Entorno',
      editors: 'editores',
      noEditorsDetected: 'ninguno detectado',
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
      // Terminal progress feedback (talents-ai-score): stderr-only status
      // during the two slow phases (see src/terminal-progress.js).
      scanningLabel: 'Escaneando entorno y detectores…',
      synthesizingLabel: 'Sintetizando agentes con IA…',
      // Roadmap personalization (talents-ai-score, ADR-015): reuses the
      // same spinner mechanism as synthesizingLabel above.
      personalizingRoadmapLabel: 'Personalizando roadmap…',
      // "Construir el siguiente nivel ahora" (issue 021): now a SECONDARY,
      // opt-in alternative — the copyable implementation prompt (below) is
      // the PRIMARY "how do I implement this" path.
      buildNextLevelHint: 'Alternativamente, ejecuta `ai-footprint --build-next-level` para generar el fichero de partida directamente en tu proyecto.',
      // Ayuda localizada (skill-code-certification / ADR-003): antes estaba
      // hardcodeada en español en bin/report.js; ahora pasa por i18n y respeta
      // la locale de la máquina.
      help:
        '\nAI Footprint — perfil local de uso de herramientas de IA\n\n'
        + 'Uso:\n  ai-footprint [opciones]\n\n'
        + 'Opciones:\n'
        + '      --json             Imprime el informe en JSON por stdout\n'
        + '      --no-save          No escribe el informe en disco (solo muestra)\n'
        + '      --root DIR         Escanea DIR en vez del directorio actual\n'
        + '      --build-next-level Genera el starter del siguiente tier (alternativa secundaria)\n'
        + '      --force            Junto a --build-next-level, sobrescribe un fichero existente\n'
        + '      --lang es|en       Fuerza el idioma (informe + prompt) en vez de detectarlo del sistema\n'
        + '      --consent-status   Muestra tu decisión de guardado / correo / último envío\n'
        + '      --consent-revoke   Revoca el guardado (→ denegado); deja de enviar\n'
        + '      --consent-reset    Borra la decisión (→ sin decidir); vuelve a preguntar\n'
        + '      --consent-email C  Cambia el correo guardado, sin tocar la decisión\n'
        + '  -h, --help             Muestra esta ayuda\n\n'
        + 'El informe se genera y se muestra SIEMPRE en tu equipo, y se guarda un informe\n'
        + 'HTML acumulado en local cuyo enlace se imprime en cada ejecución. Antes de\n'
        + 'mostrarlo, la primera vez se te pregunta si quieres GUARDARLO en Shakers (con tu\n'
        + 'correo); se pregunta una sola vez. Reabre la pregunta con --consent-reset.\n',
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
        + '(ai-footprint --consent-revoke): guarda tu nivel/tier y señales '
        + 'estructuradas derivadas (herramientas, MCP, memoria, '
        + 'automatizaciones, agentes, tecnologías) — nunca el contenido de '
        + 'tus ficheros, prompts, rutas ni credenciales. Dato indicativo, no '
        + 'verificado, no una cualificación oficial. Eres responsable de la '
        + 'información que decidas compartir; Shakers no asume responsabilidad '
        + 'por los datos que envíes. Consulta el README de este repositorio para '
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
        lastSentAt: (value) => `Último guardado: ${value || '(nunca)'}`,
      },
      revoked: 'Consentimiento revocado. No se guardará nada más automáticamente.',
      reset: 'Decisión de consentimiento reiniciada. Se te preguntará de nuevo en la próxima ejecución.',
      emailChanged: (email) => `Correo actualizado a ${email}. Se usará en el próximo guardado.`,
      emailInvalidCli: 'Correo no válido. Uso: ai-footprint --consent-email tu@correo.com',
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
      help:
        'AI Certify — certifica Skills de tu catálogo de Shakers analizando tu proyecto local\n\n'
        + 'Uso:\n'
        + '  ai-certify [opciones]\n\n'
        + 'Opciones:\n'
        + '      --root DIR           Analiza DIR en vez del directorio actual\n'
        + '      --email CORREO       Tu correo de Talent (si no, se usa el guardado o se te pregunta)\n'
        + '      --lang es|en         Fuerza el idioma de la salida\n'
        + '      --accept-disclaimer  Acepta el aviso legal de forma no interactiva (aceptación explícita)\n'
        + '      --all                Certifica TODAS las Skills certificables (sin selección interactiva)\n'
        + '      --skills 1,3         Certifica las Skills en esas posiciones (sin selección interactiva)\n'
        + '  -h, --help               Muestra esta ayuda\n\n'
        + 'Fase 1 (resolve): detecta las tecnologías de tu proyecto y consulta al Hub de\n'
        + 'Shakers qué Skills son certificables. Requiere AI_FOOTPRINT_CERTIFY_ENDPOINT\n'
        + 'configurado. Antes de cualquier envío se muestra un aviso legal que debes aceptar.',
      scanningLabel: 'Detectando tecnologías del proyecto…',
      resolvingLabel: 'Consultando Skills certificables…',
      // Aviso legal (ADR-001): asume el proyecto propiedad del Talent y le
      // atribuye la responsabilidad. Aceptación explícita obligatoria.
      disclaimer:
        'AVISO LEGAL — léelo antes de continuar:\n'
        + '  ai-certify envía datos de tu proyecto a Shakers para certificar tus Skills.\n'
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
        notCertifiable: 'no es certificable',
      },
      errorNoEndpoint:
        'No hay endpoint de certificación configurado. Define AI_FOOTPRINT_CERTIFY_ENDPOINT '
        + 'con la URL del Hub de Shakers y vuelve a ejecutar ai-certify. (No hay certificación '
        + 'en local: el catálogo de Skills y el análisis viven en el Hub.)',
      errorIntro: 'No se han podido resolver las Skills certificables:',
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
      // Interactive Skill selection (certify phase, issue 005).
      selectHeading: 'Selecciona las Skills que quieres certificar:',
      selectHint: 'Flechas ↑/↓ para moverte · espacio para marcar/desmarcar · a = todas · enter para confirmar · esc para cancelar',
      selectPrompt: 'Introduce los números separados por comas (o "todas"):',
      selectInvalid: 'Selección no válida. Introduce números de la lista (o "todas").',
      selectNonInteractive: 'Entrada no interactiva sin --skills/--all: no se pueden seleccionar Skills. Se cancela (no se ha enviado código).',
      selectNothing: 'No hay Skills certificables que seleccionar.',
      selectNoneChosen: 'No se ha seleccionado ninguna Skill. No se ha enviado código.',
      selectOption: (index, skillName, technology) => `  ${index}) ${skillName}${technology ? ` (${technology})` : ''}`,
      certifyingLabel: 'Analizando el código de tus Skills…',
      // Reporting redesign: el HTML ya no es opt-in; cada certificación se
      // añade al informe acumulado y se imprime SIEMPRE su enlace file://.
      reportLink: (url) => `Abre tu informe en el navegador:\n  ${url}`,
      // Certify report (terminal + HTML). Nota orientativa/no reproducible.
      report: {
        heading: 'Resultado de certificación de Skills',
        disclaimer:
          'Nota: la puntuación es orientativa y NO reproducible — es un juicio libre del '
          + 'modelo (sin rúbrica) y puede variar entre ejecuciones. No es una certificación '
          + 'oficial de cara al Client.',
        partialSampleWarning:
          'Muestra parcial: por los límites de tamaño no se ha enviado todo el código; '
          + 'la valoración se basa en una muestra.',
        scoreLine: (score) => `Puntuación: ${score == null ? 'n/d' : `${score}/100`}`,
        rationaleLabel: 'Por qué',
        improvementsLabel: 'Mejoras sugeridas',
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
          'Nota de coste: se analiza más código por Skill (hasta ~150k tokens/Skill, ~500k/run), '
          + 'lo que aumenta el coste por ejecución.',
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
      // skill-code-certification / ADR-009: the SCORE measures THIS project's AI
      // setup (so different projects score differently); the level/tier reflects
      // your global developer setup (project ∪ home).
      scoreScopeNote: "The score measures this project's AI setup; the level reflects your global setup.",
      detectedHeading: 'Detected',
      none: '(none)',
      environment: 'Environment',
      editors: 'editors',
      noEditorsDetected: 'none detected',
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
      scanningLabel: 'Scanning environment and detectors…',
      synthesizingLabel: 'Synthesizing agents with AI…',
      personalizingRoadmapLabel: 'Personalizing roadmap…',
      buildNextLevelHint: 'Alternatively, run `ai-footprint --build-next-level` to generate the starter file directly in your project.',
      // Localized help (skill-code-certification / ADR-003): previously
      // hardcoded Spanish in bin/report.js; now routed through i18n so it
      // respects the machine locale.
      help:
        '\nAI Footprint — local profile of your AI-tool usage\n\n'
        + 'Usage:\n  ai-footprint [options]\n\n'
        + 'Options:\n'
        + '      --json             Print the report as JSON on stdout\n'
        + '      --no-save          Do not write the report to disk (show only)\n'
        + '      --root DIR         Scan DIR instead of the current directory\n'
        + '      --build-next-level Generate the next tier starter (secondary alternative)\n'
        + '      --force            With --build-next-level, overwrite an existing file\n'
        + '      --lang es|en       Force the language (report + prompt) instead of OS detection\n'
        + '      --consent-status   Show your save decision / email / last send\n'
        + '      --consent-revoke   Revoke saving (→ denied); stops sending\n'
        + '      --consent-reset    Clear the decision (→ undecided); asks again\n'
        + '      --consent-email C  Change the stored email, decision untouched\n'
        + '  -h, --help             Show this help\n\n'
        + 'The report is ALWAYS generated and shown on your machine, and a cumulative HTML\n'
        + 'report is saved locally whose link is printed on every run. Before showing it,\n'
        + 'the first time you are asked whether to SAVE it in Shakers (with your email);\n'
        + 'you are asked only once. Reopen the question with --consent-reset.\n',
    },
    // Cumulative report (skill-code-certification, reporting redesign) —
    // English mirror. Same content/invariants as the Spanish catalog.
    cumulative: {
      title: 'Your Shakers report',
      subtitle: 'Your AI report for this project.',
      footprintHeading: 'AI Footprint',
      certificationHeading: 'Skill certification',
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
        + "time (ai-footprint --consent-revoke): it saves your level/tier and "
        + 'structured signals derived across categories (tools, MCP, memory, '
        + 'automations, agents, technologies) — never the content of your '
        + 'files, prompts, paths or credentials. Indicative data, not verified, '
        + 'not an official qualification. You are responsible for the information '
        + 'you choose to share; Shakers assumes no liability for the data you '
        + "submit. See this repository's README for more detail. "
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
        lastSentAt: (value) => `Last saved: ${value || '(never)'}`,
      },
      revoked: 'Consent revoked. Nothing will be saved automatically anymore.',
      reset: 'Consent decision reset. You will be asked again on the next run.',
      emailChanged: (email) => `Email updated to ${email}. It will be used on the next save.`,
      emailInvalidCli: 'Invalid email. Usage: ai-footprint --consent-email you@example.com',
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
      help:
        'AI Certify — certify Skills from your Shakers catalog by analyzing your local project\n\n'
        + 'Usage:\n'
        + '  ai-certify [options]\n\n'
        + 'Options:\n'
        + '      --root DIR           Analyze DIR instead of the current directory\n'
        + '      --email EMAIL        Your Talent email (else the stored one, else you are asked)\n'
        + '      --lang es|en         Force the output language\n'
        + '      --accept-disclaimer  Accept the legal disclaimer non-interactively (explicit acceptance)\n'
        + '      --all                Certify ALL certifiable Skills (no interactive selection)\n'
        + '      --skills 1,3         Certify the Skills at these positions (no interactive selection)\n'
        + '  -h, --help               Show this help\n\n'
        + 'Phase 1 (resolve): detects your project technologies and asks the Shakers Hub\n'
        + 'which Skills are certifiable. Requires AI_FOOTPRINT_CERTIFY_ENDPOINT to be set.\n'
        + 'A legal disclaimer is shown and must be accepted before anything is sent.',
      scanningLabel: 'Detecting project technologies…',
      resolvingLabel: 'Resolving certifiable Skills…',
      disclaimer:
        'LEGAL DISCLAIMER — read before continuing:\n'
        + '  ai-certify sends data about your project to Shakers to certify your Skills.\n'
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
        notCertifiable: 'not certifiable',
      },
      errorNoEndpoint:
        'No certification endpoint configured. Set AI_FOOTPRINT_CERTIFY_ENDPOINT to the '
        + 'Shakers Hub URL and run ai-certify again. (There is no local-only certification: '
        + 'the Skill catalog and the analysis live on the Hub.)',
      errorIntro: 'Could not resolve certifiable Skills:',
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
      // Interactive Skill selection (certify phase, issue 005).
      selectHeading: 'Select the Skills you want to certify:',
      selectHint: 'Arrows ↑/↓ to move · space to toggle · a = all · enter to confirm · esc to cancel',
      selectPrompt: 'Enter the numbers separated by commas (or "all"):',
      selectInvalid: 'Invalid selection. Enter numbers from the list (or "all").',
      selectNonInteractive: 'Non-interactive input without --skills/--all: cannot select Skills. Aborting (no code was sent).',
      selectNothing: 'There are no certifiable Skills to select.',
      selectNoneChosen: 'No Skill selected. No code was sent.',
      selectOption: (index, skillName, technology) => `  ${index}) ${skillName}${technology ? ` (${technology})` : ''}`,
      certifyingLabel: 'Analyzing your Skills’ code…',
      // Reporting redesign: HTML is no longer opt-in; each certification is
      // added to the cumulative report and its file:// link is ALWAYS printed.
      reportLink: (url) => `Open your report in your browser:\n  ${url}`,
      report: {
        heading: 'Skill certification result',
        disclaimer:
          'Note: the score is indicative and NOT reproducible — it is the model’s free '
          + 'judgment (no rubric) and may vary between runs. It is not an official '
          + 'Client-facing certification.',
        partialSampleWarning:
          'Partial sample: due to size limits not all code was sent; the assessment is '
          + 'based on a sample.',
        scoreLine: (score) => `Score: ${score == null ? 'n/a' : `${score}/100`}`,
        rationaleLabel: 'Why',
        improvementsLabel: 'Suggested improvements',
        sampleSummary: (included, candidate, estTokens) =>
          `Sample: ${included}/${candidate} files · ~${estTokens} tokens`,
        partialTag: '(partial sample)',
        notCertified: 'This Skill could not be certified in this run.',
        notSampleableNote: (technology) =>
          `No sampling is defined for the technology "${technology}": it can't be code-certified yet.`,
        htmlTitle: 'Skill Certification · Shakers',
        noItems: 'No certification results to show.',
        costNote:
          'Cost note: more code is analyzed per Skill (up to ~150k tokens/Skill, ~500k/run), '
          + 'which increases the cost per run.',
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
