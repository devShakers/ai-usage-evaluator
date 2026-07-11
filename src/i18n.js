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
      roadmapPendingTranslation: 'Contenido en proceso de traducción — mostrando en español.',
      privacyNote:
        'Este informe se ha generado en local. Solo registra qué herramientas '
        + 'existen, cuántas configuraciones tienes y tu nivel: nunca el contenido '
        + 'de tus ficheros, rutas ni credenciales.',
      metaLine: (dateStr, anonId, platform) =>
        `Generado ${dateStr} · id anónimo <code>${anonId}</code> · plataforma ${platform}`,
      rawData: 'Ver los datos exactos de este informe (JSON)',
    },
    cli: {
      saved: (dir) => `Guardado en ${dir}`,
      useHtmlHint: 'Usa --html para abrir el dashboard visual.',
      tempDashboard: (file) => `Dashboard temporal: ${file}`,
      // Terminal progress feedback (talents-ai-score): stderr-only status
      // during the two slow phases (see src/terminal-progress.js).
      scanningLabel: 'Escaneando entorno y detectores…',
      synthesizingLabel: 'Sintetizando agentes con IA…',
      // "Construir el siguiente nivel ahora" (issue 021): announced from the
      // terminal roadmap section whenever there's a next tier to build.
      buildNextLevelHint: 'Ejecuta `ai-footprint --build-next-level` para construir tu siguiente paso.',
    },
    // "Construir el siguiente nivel ahora" (talents-ai-score, issue 021):
    // optional, explicit phase — writes the deterministic starter for the
    // NEXT tier from the curated roadmap's own snippets, never LLM-generated.
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
        + 'verificado. Consulta el README de este repositorio para más detalle.',
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
        + 'Usa --consent-status para verlo o --consent-revoke para cambiarlo.',
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
      emailChanged: (email) => `Correo actualizado a ${email}. Se usará en el próximo guardado.`,
      emailInvalidCli: 'Correo no válido. Uso: ai-footprint --consent-email tu@correo.com',
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
      roadmapPendingTranslation: 'Content pending translation — showing in Spanish.',
      privacyNote:
        'This report was generated locally. It only records which tools exist, '
        + 'how many configurations you have and your level: never the content of '
        + 'your files, paths or credentials.',
      metaLine: (dateStr, anonId, platform) =>
        `Generated ${dateStr} · anonymous id <code>${anonId}</code> · platform ${platform}`,
      rawData: "View this report's exact data (JSON)",
    },
    cli: {
      saved: (dir) => `Saved to ${dir}`,
      useHtmlHint: 'Use --html to open the visual dashboard.',
      tempDashboard: (file) => `Temporary dashboard: ${file}`,
      scanningLabel: 'Scanning environment and detectors…',
      synthesizingLabel: 'Synthesizing agents with AI…',
      buildNextLevelHint: 'Run `ai-footprint --build-next-level` to build your next step.',
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
        + 'files, prompts, paths or credentials. Indicative data, not '
        + 'verified. See this repository\'s README for more detail.',
      persistQuestion: 'Save this report in Shakers? (y/n):',
      invalidAnswer: 'Answer not recognized. Reply "y" (yes) or "n" (no).',
      emailPrompt: 'Enter your email:',
      invalidEmail: 'Invalid email, try again.',
      notObtained: "Couldn't record your answer; you'll be asked again next time.",
      deniedSaved: 'Understood, nothing will be saved. You can change your mind later by running the command again.',
      grantedSaved: (email) => `Thanks. From now on this report will be saved in Shakers automatically (email: ${email}, max. once per hour).`,
      skipAlreadyDecided: (decision, path) =>
        `Consent already answered (${decision}) — stored at ${path}. `
        + 'Use --consent-status to view it or --consent-revoke to change it.',
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
      emailChanged: (email) => `Email updated to ${email}. It will be used on the next save.`,
      emailInvalidCli: 'Invalid email. Usage: ai-footprint --consent-email you@example.com',
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

module.exports = { detectReportLang, resolveLang, getCatalog, categoryLabel };
