'use strict';

const { detectLangCode } = require('./locale');
const { toLowerLang } = require('./lang-codes');
const { CATEGORIES } = require('./detectors');
const { LEGAL } = require('./signup-copy');

// Localization of the report (HTML + terminal) and of the CLI notices tied to the report.

const catalogs = {
  es: {
    onboarding: {
      title: 'Registro en Shakers (onboarding)',
      askLinkedin: 'Tu URL de LinkedIn (obligatoria):',
      askCv: 'Ruta a tu CV en PDF (opcional, Enter para omitir):',
      askGithub: 'Tu URL de GitHub (opcional, Enter para omitir):',
      askWebsite: 'Tu web personal (opcional, Enter para omitir):',
      importStarted: 'Importando tu perfil en segundo plano mientras continuamos…',
      importError: 'No se pudo iniciar la importacion de tu perfil.',
      importUnavailable: 'No pudimos importar tu perfil ahora (servicio no disponible); seguimos con el registro, puedes reintentar el import mas tarde.',
      importChecking: 'Importando tu perfil…',
      importDone: 'Perfil importado correctamente.',
      importFailed: 'No se pudo completar la importacion de tu perfil. Puedes reintentarla mas tarde desde tu perfil.',
      importStillRunning: 'Tu perfil se sigue importando en segundo plano; estara listo en unos minutos.',
      professionalTitle: 'Tu situacion laboral',
      askWorkSituation: 'Cual es tu situacion laboral actual? Elige una opcion:',
      workSituationLabels: {
        FREELANCE: 'Freelance',
        EMPLOYED: 'Empleado/a',
        BETWEEN_JOBS: 'Entre proyectos',
        STUDYING: 'Estudiando',
        OTHER: 'Otro',
      },
      askEmploymentParticipation: 'Tu puesto es a jornada completa o parcial?',
      employmentParticipationLabels: {
        FULL_TIME: 'Jornada completa',
        PART_TIME: 'Media jornada',
      },
      askFreelanceOpinion: 'Cual es tu opinion sobre el freelance?',
      freelanceOpinionLabels: {
        WAS_FREELANCE_BEFORE: 'Ya he sido freelance',
        OPEN_TO_FREELANCE: 'Me plantearía ser freelance',
        NOT_INTERESTED: 'No me interesa',
      },
      askChangeMotivators: 'Que te motiva del freelance o de Shakers?',
      changeMotivatorLabels: {
        HIGHER_RATE: 'Conseguir mejor tarifa',
        SPECIFIC_PROJECT: 'Un proyecto concreto',
        LEARNING_CERTIFICATION: 'Seguir aprendiendo y certificarme',
        FLEXIBILITY: 'La flexibilidad de ser freelance',
        COMMUNITY: 'Pertenecer a una comunidad',
        LIFESTYLE_CHANGE: 'Cambiar de estilo de vida',
      },
      professionalSaved: 'Situación laboral guardada.',
      chooseMethodHeading: '¿Cómo quieres crear tu cuenta?',
      signupTitle: 'Crea tu cuenta de Shakers',
      askName: 'Nombre:',
      askLastName: 'Apellidos:',
      askEmail: 'Email (usa uno NUEVO; si ya existe te ofrecere iniciar sesion):',
      askPassword: 'Contrasena (minimo 8 caracteres):',
      askPasswordConfirm: 'Repite la contrasena:',
      passwordMismatch: 'Las contrasenas no coinciden. Intentalo de nuevo.',
      askFreelanceTypeSelect: 'Como trabajas? Elige una opcion:',
      freelanceTypeLabels: {
        FREELANCE: 'Freelance',
        EMPLOYEE: 'Empleado/a',
        AGENCY: 'Agencia o empresa',
        POTENTIAL_FREELANCE: 'Me planteo ser freelance',
      },
      invalidChoice: 'Opcion no valida.',
      askNewsletter: 'Quieres recibir la newsletter? (s/n):',
      weakPassword: 'La contrasena no cumple los requisitos (minimo 8 caracteres).',
      signupError: 'No se pudo crear la cuenta.',
      freelanceIntentRequired: 'Tu intencion freelance es obligatoria para ese tipo.',
      accountExists: 'Ya existe una cuenta con ese email. Vamos a iniciar sesion.',
      accountReady: 'Cuenta creada. Sesion iniciada.',
      sessionError: 'La cuenta se creo pero no se pudo iniciar sesion. Ejecuta `shakers login`.',
      pricingTitle: 'Tu precio por proyecto',
      pricingSaved: 'Precio guardado.',
      askPricingFullAmount: (cur) => `Precio por proyecto a jornada completa en ${cur} (numero, sin separadores de miles, p.ej. 60000):`,
      askPricingFullCurrency: 'Moneda:',
      askPricingPartSelect: 'Ofreces proyectos a media jornada? (s/n):',
      askPricingPartAmount: (cur) => `Precio por proyecto a media jornada en ${cur} (numero, sin separadores de miles, p.ej. 50):`,
      askPricingPartCurrency: 'Moneda:',
      pricingAmountInvalid: 'Importe no valido. Usa un numero sin separadores de miles, con maximo 2 decimales (p.ej. 60000 o 1500.50), entre 0 y 999999.99.',
      availabilityTitle: 'Tu disponibilidad y ubicacion',
      availabilityAsk: 'Quieres indicar tu disponibilidad y ubicacion ahora? (s/n):',
      availableAsk: 'Estas disponible para nuevos proyectos? (s/n):',
      monthlyHoursAsk: 'Cuantas horas al mes?',
      workModesAsk: 'En que modalidad quieres trabajar? (marca una o varias)',
      workModeLabels: { REMOTE: 'Remoto', HYBRID: 'Híbrido', IN_PERSON: 'Presencial' },
      workModesHint: 'Espacio para marcar/desmarcar · Enter para confirmar',
      onlyRemoteNote: 'Has marcado solo Remoto: no veras proyectos hibridos ni presenciales.',
      countryAsk: 'Pais (codigo ISO-2 de 2 letras, p.ej. ES):',
      countryInvalid: 'Codigo de pais no valido. Usa 2 letras (p.ej. ES, US, GB).',
      subdivisionAsk: 'Provincia o region (opcional, Enter para omitir):',
      timezoneAsk: (tz) => (tz ? `Zona horaria [${tz}] (Enter para aceptar, o escribe otra):` : 'Zona horaria (p.ej. Europe/Madrid):'),
      longFullTimeAsk: 'Abierto a proyectos largos a tiempo completo? (s/n):',
      phonePrefixAsk: 'Prefijo telefonico (opcional, p.ej. +34, Enter para omitir):',
      phoneNumberAsk: 'Numero de telefono (opcional, Enter para omitir):',
      phoneSaved: 'Teléfono guardado.',
      phoneUnavailable: 'No pudimos guardar tu telefono ahora. Puedes actualizarlo mas tarde.',
      availabilitySaved: 'Disponibilidad guardada.',
      availabilityUnavailable: 'No pudimos guardar tu disponibilidad ahora. Puedes actualizarla mas tarde.',
      availabilitySkipped: 'De acuerdo, puedes indicar tu disponibilidad mas tarde.',
      languagesTitle: 'Tus idiomas',
      languagesAsk: 'Quieres indicar los idiomas que hablas? (s/n):',
      askLanguageCode: 'Idioma:',
      languageNames: {
        es: 'Español',
        en: 'Inglés',
        fr: 'Francés',
        ca: 'Catalán',
        de: 'Alemán',
        eu: 'Euskera',
        it: 'Italiano',
        pt: 'Portugués',
      },
      askLanguageLevel: 'Tu nivel en ese idioma:',
      languageLevelLabels: {
        NATIVE: 'Nativo o bilingüe',
        ADVANCED: 'Fluido en el trabajo y el día a día',
        INTERMEDIATE: 'Puedo trabajar en él (hablado y escrito)',
        INTERMEDIATE_WRITTEN: 'Puedo trabajar en él, prefiero comunicación escrita',
      },
      askAnotherLanguage: 'Quieres anadir otro idioma? (s/n):',
      languagesSaved: 'Idiomas guardados.',
      languagesUnavailable: 'No pudimos guardar tus idiomas ahora. Puedes anadirlos mas tarde.',
      languagesSkipped: 'De acuerdo, puedes indicar tus idiomas mas tarde.',
      usageTitle: 'Evaluacion de tu uso de IA (opcional)',
      usageInfoAccessed: LEGAL.es.usageInfoAccessed,
      usageGoalDuration: LEGAL.es.usageGoalDuration,
      usageAccept: 'Quieres evaluar tu uso de IA ahora? (s/n):',
      usageSkippedEvidence: 'Ya tienes evidencia de uso de IA en Shakers; nos saltamos este paso.',
      interviewTitle: 'Entrevista de onboarding (opcional)',
      interviewOnlyTitle: 'Entrevista de onboarding',
      interviewInfoAccessed: LEGAL.es.interviewInfoAccessed,
      interviewGoalDuration: LEGAL.es.interviewGoalDuration,
      interviewAccept: 'Quieres hacer la entrevista ahora? (s/n):',
      interviewComplete: 'Entrevista completada. Gracias!',
      interviewAlreadyDone: 'Ya completaste la entrevista de onboarding; no se puede repetir desde la CLI. Puedes seguir ajustando tu perfil.',
      repeatWarnTitle: 'Repetir la entrevista de onboarding',
      repeatWarnBody: 'Repetir SOBREESCRIBE tu entrevista de onboarding anterior y NO se puede deshacer: la evaluación previa se descarta.',
      repeatConfirmPrompt: '¿Seguro que quieres repetir y sobreescribir tu onboarding?',
      repeatConfirmYes: 'Sí, repetir y sobreescribir',
      repeatConfirmNo: 'No, cancelar',
      repeatAborted: 'De acuerdo, no se repite el onboarding.',
      repeatRestarted: 'Onboarding reiniciado. Empecemos de nuevo.',
      repeatNotFound: 'No tienes un onboarding todavía. Haz `shakers onboarding` primero.',
      repeatAuthError: 'Tu sesión no permite esta acción. Inicia sesión de nuevo: shakers login',
      repeatFailed: (reason) => `No se pudo reiniciar el onboarding (${reason}). Inténtalo de nuevo.`,
      interviewAnswer: 'Tu respuesta:',
      questionHeading: (n) => `Pregunta ${n}`,
      interviewTurnError: 'No se pudo continuar la entrevista.',
      thinking: 'Alma esta pensando…',
      interviewIntro: 'Es una conversación; responde con naturalidad, sin prisa.',
      interviewTransition: 'Gracias. Sigamos:',
      interviewConnecting: 'Conectando con la entrevista...',
      livekitMissing: 'La entrevista necesita el paquete opcional @livekit/rtc-node, que no esta instalado.\n  Reejecuta el instalador de talento (SHAKERS_PROFILE=talent) para instalarlo, o hazlo a mano:\n    npm install --omit=dev --prefix ~/.shakers @livekit/rtc-node\n  (usa tu ruta de SHAKERS_CLI_HOME si instalaste el CLI en otro sitio).\n  Luego reejecuta:  shakers onboarding',
      livekitOld: 'El paquete @livekit/rtc-node instalado es demasiado antiguo para text-streams.\n  Actualizalo:  npm install --prefix ~/.shakers @livekit/rtc-node@latest',
      livekitConnectError: 'No se pudo conectar con la sala de la entrevista.',
      transcriptWarn: (reason) => `Aviso: no se pudo guardar la transcripcion de la entrevista (${reason}). Puede que no quede disponible para revisarla.`,
      finalizedGeneric: 'Onboarding completado.',
      finalizedAt: (pct) => `Onboarding completado. Tu perfil esta al ${pct}%.`,
      finalizeWarn: (reason) => `No se pudo marcar el onboarding como completado (${reason}). Puedes reintentarlo mas tarde.`,
      profileReadyNoUrl: 'Tu perfil esta listo. Puedes verlo en tu cuenta de Shakers.',
      profileReadyUrl: (url) => `Tu perfil esta listo: ${url}`,
      help: 'Uso: shakers onboarding [--lang es|en] [--accept-disclaimer]',
    },
    categories: {
      AGENTIC_CLI: 'CLI agéntica',
      AI_EDITOR: 'Editor con IA',
      IDE_ASSISTANT: 'Asistente en IDE',
      COMPLETION: 'Autocompletado',
      AI_TERMINAL: 'Terminal con IA',
    },
    mcpCategories: {
      data: 'Datos',
      comms: 'Comunicación',
      dev: 'Desarrollo',
      browser: 'Navegador',
      other: 'Otro',
    },
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
    ladder: {
      levelsHeading: 'Niveles de madurez (0-4)',
      // ADR-016: the ladder now groups tiers by SETUP LEVEL, not the 0-4 band.
      setupHeading: 'Nivel de setup',
      setupIntro:
        'Tu nivel de setup (S1–S3) resume tu uso de IA de un vistazo; el tier (T0-T7) es el eje '
        + 'fino del que se deriva. Ambos son deterministas. Abajo se marca lo que ya has superado (✓), '
        + 'dónde estás ahora (●) y lo que queda por delante (○) con el criterio exacto que lo desbloquea.',
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
        T4: 'Herramienta propia: has creado tus propios ficheros de skill, comandos o reglas.',
        T5: 'Operador agéntico: una CLI agéntica combina MCP y tus activos propios de punta a punta.',
        T6: 'Multi-agente: un equipo de 2+ agentes especializados.',
        T7: 'Taller orquestado: hooks automatizan el taller y los agentes se orquestan entre sí.',
      },
    },
    // Agent classification against the AI-agent catalog (skill-code-certification, report req 2) + the "how to improve" tips (req 3).
    classification: {
      label: 'Clasificación',
      noCategory: 'Sin categoría',
      // CUARTO ESTADO (2026-08-03): la llamada FUE BIEN y este agente se quedó fuera.
      agentEvalOmitted: 'fuera de esta ejecución',
      // `count` decide la concordancia (singular/plural) para que el aviso no
      // chirríe; vale para uno, algunos y todos.
      agentsEvalPartial: (names, count = 2) => (count === 1
        ? `Este agente se quedó fuera de esta ejecución: ${names}. La respuesta del modelo no llegó a cubrirlo, así que no es que no tenga categoría: es que no se llegó a evaluarlo. Vuelve a ejecutar \`usage\` para completarlo.`
        : `Estos agentes se quedaron fuera de esta ejecución: ${names}. La respuesta del modelo no llegó a cubrirlos, así que no es que no tengan categoría: es que no se llegó a evaluarlos. Vuelve a ejecutar \`usage\` para completarlos.`),
      // LA EVALUACIÓN FALLÓ ENTERA (issue 116).
      agentsEvalMissing: 'La categoría de tus agentes no se pudo calcular en esta ejecución: la evaluación no llegó a responder. No es que no tengan categoría. Vuelve a ejecutar `usage` para intentarlo otra vez.',
      // ADR-042 (issue 125) parte el aviso genérico en dos, y el motivo es que apuntan a sitios distintos.
      agentsEvalUnreachable: 'No se pudo conectar con Shakers, así que tus agentes salen sin categoría. Comprueba tu conexión y vuelve a ejecutar `usage`.',
      agentsEvalErrored: 'Shakers respondió con un error, así que tus agentes salen sin categoría. No es cosa de tu configuración; vuelve a intentarlo en un rato.',
      agentsEvalTimedOut: (count) => `La evaluación de tus agentes no respondió dentro del plazo, así que esta vez salen sin categoría. Ese tiempo crece con el número de agentes y tienes ${count}, así que volver a ejecutarlo tal cual probablemente acabe igual.`,
      improvementsHeading: 'Cómo mejorar este agente',
      // LAS OCHO CATEGORÍAS DEL CATÁLOGO DEL SERVICIO: siete especialidades y el SUELO (issue 120; el catálogo vive en el servicio, ADR-036/037).
      categories: {
        developer: 'Desarrollo',
        product: 'Producto',
        designer: 'Diseño',
        marketing: 'Marketing',
        data: 'Datos',
        finance: 'Finanzas',
        sales: 'Ventas',
        other: 'Otros / interno',
      },
      levels: {
        L1: 'L1 · operativo',
        L2: 'L2 · táctico',
        L3: 'L3 · estratégico',
      },
    },
    // LEGACY 0-4 band names — kept only for older persisted reports / the
    // unchanged sent payload (ADR-016); the report shows `setupLevels` instead.
    levelNames: {
      none: 'Sin rastro de IA',
      exploring: 'Explorando',
      integrated: 'Integrado',
      power: 'Power user',
      orchestrator: 'Orquestador',
    },
    // Setup Level (Talent Certification Framework, ADR-016): the 3-value rollup that REPLACES the 0-4 band on every surface.
    setupLevels: {
      none: {
        label: 'Sin certificar',
        desc: 'Sin setup de IA: no se detecta ninguna herramienta de IA en tu entorno.',
      },
      S1: {
        label: 'S1 · Asistido',
        desc: 'Asistido: usas IA con contexto persistente (instrucciones/configuración) en tus proyectos.',
      },
      S2: {
        label: 'S2 · Extendido',
        desc: 'Extendido: amplías la IA con MCP y activos propios (ficheros de skill, comandos o reglas).',
      },
      S3: {
        label: 'S3 · Orquestado',
        desc: 'Orquestado: operas CLIs agénticas, equipos de agentes y automatización de punta a punta.',
      },
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
      // ADR-016: Setup Level shown in the top bar (replaces the 0-4 level line).
      setupLevel: (label) => `Setup · ${label}`,
      // Current tier appended to the top bar, next to the level (report req 1 addendum).
      tierInline: (key, name) => ` · Tier ${key} · ${name}`,
      detectedHeading: 'Detectadas',
      activity: {
        heading: 'Actividad (repos analizados)',
        repos: (list) => `Repos: ${list}`,
        sessions: (n) => `${n} ${n === 1 ? 'sesión' : 'sesiones'} (raíz)`,
        subagents: (n) => `${n} ${n === 1 ? 'run' : 'runs'} de subagente`,
        hours: (h) => `${h} h activas (gap idle > 25 min = pausa)`,
        commits: (authored, total) => `${authored}/${total} commits tuyos`,
        lines: (added, deleted) => `+${added}/-${deleted} líneas`,
        velocity: (v) => `${v} commits/día`,
        workStreams: (streams, multiDay, maxSpan) =>
          `${streams} ${streams === 1 ? 'workstream' : 'workstreams'} (${multiDay} multi-día, máx ${maxSpan}d)`,
        tractionLabel: 'Actividad reciente',
        tSessions: (n) => `${n} sesiones (90d)`,
        tDays: (n) => `${n} días/semana`,
        tAgents: (d, p) => `${d} agentes detectados${p != null ? ` · ${p} en tu perfil` : ''}`,
        tTools: (list) => `herramientas: ${list}`,
      },
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
      roadmapHint: 'Ejecuta `usage --roadmap` para ver los pasos que te separan del siguiente nivel de uso de IA. No son pasos de esta herramienta: son cambios en tu forma de trabajar, para las próximas semanas.',
      aiProfileGenerating: 'Generando tu perfil de IA (matriz, visión y cómo trabajas)…',
      aiProfilePendingRetry: 'Tu perfil de IA (matriz, visión y cómo trabajas) se está generando; re-lanza `report` en un momento para verlo.',
      // issue 122 / ADR-044: se muestra cuando había una sesión y ha caducado, para que el talento entienda por qué vuelve a ver el informe completo.
      sessionExpiredNotice: 'Tu sesión ha caducado. Estás viendo el informe completo como usuario general; ejecuta `login` para volver a entrar.',
      nextStep: 'Siguiente paso para subir de nivel',
      files: (n) => `${n} ${n === 1 ? 'fichero' : 'ficheros'}`,
      lastModified: (label) => `última modificación: ${label}`,
      skillsHeading: 'Skills',
    },
    html: {
      lang: 'es',
      title: (setupLabel) => `Shakers · ${setupLabel}`,
      h1: 'Tu perfil de uso de IA',
      sub: 'Un vistazo local a qué herramientas de IA tienes y cuánto las has configurado.',
      levelOf: (level) => `Nivel ${level} de 4`,
      // ADR-016: hero label for the Setup Level (replaces the 0-4 "Nivel X de 4").
      setupLevelOf: 'Nivel de setup',
      // Current tier shown in the hero bar next to the level (report req 1 addendum).
      currentTier: (key, name) => `Tier ${key} · ${name}`,
      // Suffix only: the number is already bolded separately in the markup
      // (see render-html.js), so we avoid duplicating/parsing the translated string.
      detectedSuffix: (total) => `de ${total} herramientas detectadas`,
      maturity: 'Madurez',
      tools: 'Herramientas',
      // talents-ai-score: only DETECTED tools are listed now (undetected ones were pure noise — any relevant next step already lives in the tier roadmap section).
      toolsEmpty: 'No se ha detectado ninguna herramienta de IA en tu entorno.',
      configIntensity: 'intensidad de configuración',
      files: (n) => `${n}&nbsp;${n === 1 ? 'fichero' : 'ficheros'}`,
      lastModified: (dateStr) => `última modificación: ${dateStr}`,
      environment: 'Entorno',
      platform: 'Plataforma',
      architecture: 'Arquitectura',
      installedEditors: 'Editores instalados',
      noEditorsDetected: 'ninguno detectado',
      nextStep: 'Siguiente paso para subir de nivel',
      diagramHeading: 'Agentes',
      agentsEmpty: 'No se han detectado agentes de IA configurados (p. ej. .claude/agents/).',
      orchestratorLabel: 'Orchestrator',
      // Last-resort description fallback (talents-ai-score, real-browser user feedback: a card must NEVER show only name+model, no description at all).
      agentDescriptionFromName: (name) => `Agente "${name}" (sin descripción declarada en su fichero).`,
      // AI product an agent belongs to, derived from its source (proper nouns; same es/en).
      aiProducts: { 'claude-code': 'Claude Code' },
      // ADR-016 agent evaluation (HTML per-agent detail): definition-quality score + LLM rationale + local usage signal.
      agentScoreLabel: 'Calidad de la definición (0-100)',
      agentQualityLabel: 'Por qué:',
      agentUsageLabel: 'Uso local (historial de Claude Code)',
      agentUsedTimes: (n) => `usado ${n}×`,
      agentUnused: 'sin uso local',
      // Project technologies (talents-ai-score, ADR-012).
      technologiesHeading: 'Tecnologías del proyecto',
      technologiesEmpty: 'No se reconoció ningún framework o librería en los manifiestos de dependencias (package.json, requirements.txt, go.mod, pyproject.toml).',
      // MCP servers by name (talents-ai-score, issue 015).
      // Issue 110: esta clave existía desde la 015 y NO la pintaba nadie — los servidores MCP se detectaban, contaban para el tier y no se nombraban en ninguna superficie.
      mcpHeading: 'Servicios conectados por MCP',
      mcpEmpty: 'No se ha detectado ningún servidor MCP. Conectar uno es el criterio que te sube a T3 (Banco conectado).',
      mcpUnidentified: (n) => `${n} ${n === 1 ? 'servidor más, cuyo servicio no' : 'servidores más, cuyo servicio no'} hemos podido identificar por su nombre.`,
      roadmapHeading: 'Tu próximo nivel de uso de IA',
      // 083: subtitulo del bloque, para que quien entra directo con --roadmap lea
      // el registro antes que el contenido.
      roadmapSubheading: 'Lo que sigue lo haces tú en tu trabajo, no en esta herramienta. La herramienta solo te dice por dónde.',
      roadmapUpgradeWhenLabel: 'Subes de tier cuando:',
      roadmapUnlocksLabel: 'Qué desbloquea',
      roadmapStepsLabel: 'Pasos',
      roadmapSnippetLabel: 'Snippet copiable',
      roadmapTipsLabel: 'Tips de comunidad',
      roadmapMistakesLabel: 'Errores comunes',
      roadmapConsolidationLabel: 'Pasos de consolidación',
      roadmapHonestyLabel: 'Nota de honestidad',
      roadmapContentUnavailable: 'El contenido detallado de este nivel aún no está disponible en este idioma.',
      // ADR-015: shown only when the 4 prose gaps below were actually replaced by a validated, project-adapted response — never on fallback to the curated content.
      roadmapPersonalizedNotice: 'Contenido adaptado a tu proyecto.',
      // Issue 109: los dos avisos que faltaban, hermanos del `agentsEvalMissing` que añadió la 106.
      roadmapNotPersonalizedNotice: 'Este roadmap es el genérico de tu tier: esta vez no se ha podido adaptar a tu proyecto. Vuelve a ejecutar `usage` para intentarlo otra vez.',
      // Issue 084: el antes y el después del roadmap.
      roadmapNowLabel: 'De dónde partes',
      roadmapProjectionLabel: 'Dónde te deja esta ruta',
      roadmapProjectionTag: 'proyección',
      roadmapProjectionNote: 'Calculado con el mismo motor que tu evaluación, aplicando el mínimo que piden estos pasos. Es una proyección, no una promesa: la evaluación mide uso real, así que darlos es condición necesaria y no suficiente.',
      implementationPromptHeading: 'Prompt para implementar',
      implementationPromptHint: 'Copia este prompt y pégalo en tu IA de confianza (Claude Code, Cursor, ChatGPT...) para que lo implemente en tu proyecto.',
      // Copy-to-clipboard button (HTML report only — talents-ai-score): navigator.clipboard with a document.execCommand fallback, both inline, zero-network.
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
      // Reporting redesign (skill-code-certification): el HTML ya NO es opt-in (se retira --html).
      reportLink: (url) => `Abre tu informe en el navegador:\n  ${url}`,
      // `share` command (skill-code-certification): copy del CLI que envuelve a la tarjeta branded para LinkedIn.
      share: {
        help: 'share — crea una tarjeta branded con tu resultado de uso de IA (tier + nota) para compartir en LinkedIn.\n'
          + '  Usa `usage` primero; `share` toma el último uso de IA de este proyecto.\n'
          + '  Opciones: --root <dir>, --lang es|en',
        noFootprint: 'Aún no hay uso de IA para este proyecto. Ejecuta `usage` primero y luego `share`.',
        ready: (url) => `Tu tarjeta para compartir está lista — ábrela para descargar el PNG y publicarla:\n  ${url}`,
        hint: 'LinkedIn no permite adjuntar la imagen por URL: descarga el PNG desde la tarjeta y luego adjúntalo en tu publicación.',
        error: 'No se pudo generar la tarjeta para compartir.',
        disabled: '`share` está deshabilitado por ahora. Vuelve a intentarlo más adelante.',
      },
      accountReminder: {
        question: '¿Ya tienes cuenta?',
        hint: 'ai-usage es público. Iniciar sesión es opcional; flechas para moverte, enter para elegir.',
        yes: 'Sí, iniciar sesión',
        no: 'No, continuar sin cuenta',
      },
      // `report` command (ADR-016): genera y ABRE el informe HTML completo y compartible de este proyecto (uso de IA + Skills certificadas).
      report: {
        help: 'report — genera y abre el informe HTML completo de este proyecto (uso de IA + Skills certificadas) para compartir con tu equipo.\n'
          + '  Usa `usage` (y opcionalmente `certify`) primero; `report` reúne su resultado.\n'
          + '  Opciones: --root <dir>, --lang es|en, --no-open (no abre el navegador; solo imprime el enlace)',
        noData: 'Aún no hay nada que mostrar para este proyecto. Ejecuta `usage` primero (y opcionalmente `certify`), luego `report`.',
        ready: (url) => `Tu informe está listo:\n  ${url}`,
        opening: 'Abriéndolo en tu navegador…',
        error: 'No se pudo generar el informe.',
      },
      frameworkIntroUsage:
        'Esto mide tu fluidez con IA en dos ejes: Setup (madurez de tu tooling, T0–T7, determinista) y Usage (cómo lo usas, evaluado en entrevista + código). Te sitúa en el mapa 3×3 (Explorer → AI Native). Completarlo posiciona tu perfil agéntico para los proyectos que valoran cómo trabajas con IA.',
      // Terminal progress feedback (talents-ai-score): stderr-only status
      // during the two slow phases (see src/terminal-progress.js).
      scanningLabel: 'Escaneando entorno y detectores…',
      // Loader de la fase de agregación por repo seleccionado (git + sesiones + steering/decisiones + evidencia + org-chart de agentes).
      aggregatingLabel: 'Agregando señales de los repos seleccionados…',
      reposScopePromptHeader: '¿Qué quieres evaluar?',
      reposScopePromptHint: 'Flechas para moverte · enter para elegir',
      reposScopeOptionMachine: 'Toda la máquina (todos los repos con actividad de IA)',
      reposScopeOptionRepo: 'Repo actual (solo este directorio)',
      reposDetectedNote: (repoCount, unassigned) =>
        repoCount === 0
          ? 'No se detectaron repos con sesiones de IA en esta máquina.'
          : `${repoCount} ${repoCount === 1 ? 'repo' : 'repos'} con sesiones de IA detectado${repoCount === 1 ? '' : 's'}` +
            (unassigned > 0
              ? `; ${unassigned} ${unassigned === 1 ? 'sesión' : 'sesiones'} sin repo atribuible, excluida${unassigned === 1 ? '' : 's'}.`
              : '.'),
      reposFlagUnmatched: (list) => `Repos no encontrados, ignorados: ${list}.`,
      reposScopeCapped: (shown, total) =>
        `Evaluación de toda la máquina limitada a ${shown} de ${total} repos detectados (los más activos primero).`,
      reposScopeAll: 'Evaluando todo el uso de IA de la máquina.',
      synthesizingLabel: 'Sintetizando agentes con IA…',
      // Roadmap personalization (talents-ai-score, ADR-015): reuses the
      // same spinner mechanism as synthesizingLabel above.
      personalizingRoadmapLabel: 'Personalizando roadmap…',
      // ADR-016: agent definition-quality evaluation (ephemeral LLM call).
      evaluatingAgentsLabel: 'Evaluando la calidad de tus agentes…',
      // "Construir el siguiente nivel ahora" (issue 021): now a SECONDARY, opt-in alternative — the copyable implementation prompt (below) is the PRIMARY "how do I implement this" path.
      buildNextLevelHint: 'Alternativamente, ejecuta `usage --build-next-level` para generar el fichero de partida directamente en tu proyecto.',
      // Ayuda localizada (skill-code-certification / ADR-003): antes estaba hardcodeada en español en bin/report.js; ahora pasa por i18n y respeta la locale de la máquina.
      help:
        '\nShakers — perfil local de uso de herramientas de IA\n\n'
        + 'Uso:\n  usage [opciones]\n\n'
        + 'Opciones:\n'
        + '      --json             Imprime el informe en JSON por stdout\n'
        + '      --no-save          No guarda el estado del informe (solo muestra)\n'
        + '      --root DIR         Escanea DIR en vez del directorio actual\n'
        + '      --repos LIST       Evalúa solo estos repos (ids o rutas, separados por comas)\n'
        + '      --machine          Evalúa toda la máquina (todos los repos con actividad de IA)\n'
        + '      --repo             Evalúa solo el repo actual\n'
        + '      --scope machine|repo  Igual que --machine / --repo (salta el selector)\n'
        + '      --all-repos        Alias de --machine\n'
        + '      --roadmap          Muestra los pasos para subir tu nivel de uso de IA (oculto por defecto)\n'
        + '      --build-next-level Genera el starter del siguiente tier (alternativa secundaria)\n'
        + '      --force            Junto a --build-next-level, sobrescribe un fichero existente\n'
        + '      --lang es|en       Fuerza el idioma (informe + prompt) en vez de detectarlo del sistema\n'
        + '      --consent-status   Muestra tu decisión de guardado / correo / último envío\n'
        + '      --consent-revoke   Revoca el guardado (→ denegado); deja de enviar\n'
        + '      --consent-reset    Borra la decisión (→ sin decidir); vuelve a preguntar\n'
        + '      --consent-email C  Cambia el correo guardado, sin tocar la decisión\n'
        + '      --set-endpoint URL Guarda el endpoint de envío de Shakers en\n'
        + '                         ~/.config/shakers/config.json (un host no-local debe ser\n'
        + '                         https). La env var tiene prioridad\n'
        + '      --show-endpoint    Muestra el endpoint efectivo y de dónde sale\n'
        + '  -h, --help             Muestra esta ayuda\n\n'
        + 'El informe se genera y se muestra SIEMPRE en tu equipo. usage ya NO imprime\n'
        + 'un enlace: usa el comando `report` para generar y abrir el informe HTML completo\n'
        + '(uso de IA + Skills certificadas) que puedes compartir con tu equipo. Antes de\n'
        + 'mostrar el resultado, la primera vez se te pregunta si quieres GUARDARLO en Shakers\n'
        + '(con tu correo); se pregunta una sola vez. Reabre la pregunta con --consent-reset.\n\n'
        + 'El destino de envío se resuelve así: SHAKERS_CLI_INGEST_ENDPOINT (env) > el fichero\n'
        + 'de config (--set-endpoint) > ninguno. Sin endpoint, el informe se muestra pero no se\n'
        + 'envía a Shakers.\n',
    },
    cumulative: {
      title: 'Tu informe de Shakers',
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
    legalNotice: {
      label: 'AVISO LEGAL',
    },
    consent: {
      // talents-ai-score, ADR-011: the disclosure wall (what's sent / never sent, itemized) is RETIRED from the CLI — that content now lives in the repo's README.
      persistIntro:
        'Este informe se ha generado y mostrado en tu equipo, siempre. '
        + 'Guardarlo en Shakers es opcional y revocable en cualquier momento '
        + '(usage --consent-revoke): guarda tu nivel/tier y señales '
        + 'estructuradas derivadas (herramientas, MCP, memoria, '
        + 'automatizaciones, agentes, tecnologías) — nunca el contenido de '
        + 'tus ficheros, prompts, rutas ni credenciales. '
        + 'Esta misma decisión también autoriza, solo si aceptas, que un '
        + 'proveedor externo de observabilidad (Datadog) capture el contenido '
        + 'que envían las llamadas de IA opcionales de este CLI (código '
        + 'muestreado, definiciones de agentes, tus respuestas) — no se puede '
        + 'borrar selectivamente después. Si rechazas, no se captura nada. '
        + 'Dato indicativo, no '
        + 'verificado, no una cualificación oficial. Eres responsable de la '
        + 'información que decidas compartir; Shakers no asume responsabilidad '
        + 'por los datos que envíes. El uso indebido de estas herramientas —enviar '
        + 'o analizar código que no es tuyo o que no estás autorizado a analizar— '
        + 'puede acarrear penalizaciones en tu cuenta de Shakers, incluida la '
        + 'posible suspensión. Consulta el README de este repositorio para '
        + 'más detalle.',
      persistQuestion: '¿Guardar este informe en Shakers? (s/n):',
      invalidAnswer: 'Respuesta no reconocida. Responde "s" (sí) o "n" (no).',
      emailPrompt: 'Introduce tu correo:',
      emailPromptExternal: 'Déjanos tu email para que el equipo de Shakers pueda contactarte (no lo verificamos):',
      invalidEmail: 'Correo no válido, inténtalo de nuevo.',
      notObtained: 'No se ha podido registrar tu respuesta; se te volverá a preguntar la próxima vez.',
      // talents-ai-score, ADR-051: esta pregunta se pide ahora ANTES de cualquier llamada de IA/egress (agent-synthesis, agent-evaluation, personalización de roadmap), no después.
      noReportWithoutConsent: 'Sin tu consentimiento, este informe no incluirá síntesis, evaluación ni roadmap generados por IA esta vez (el resto del informe se muestra igual). Vuelve a ejecutar `usage` y acepta para incluirlos, o usa --consent-reset si quieres que se te pregunte de nuevo.',
      deniedSaved: 'Entendido, no se guardará nada. Puedes cambiar de opinión más adelante volviendo a ejecutar el comando.',
      grantedSaved: (email) => `Gracias. A partir de ahora este informe se guardará automáticamente en Shakers (correo: ${email}, máx. 1 vez por hora).`,
      grantedSavedExternal: (email) => `Gracias. Hemos guardado tu email (${email}) para que el equipo de Shakers pueda contactarte — no lo hemos verificado.`,
      // talents-ai-score, issue 130: un talento logueado NUNCA ve el prompt de email (su cuenta ya prueba su identidad).
      noSessionEmail: 'No hay un correo asociado a tu sesión todavía, así que no se puede guardar el informe esta vez. Se te preguntará de nuevo la próxima ejecución.',
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
        emailUnverifiedExternal: 'Correo autoafirmado, sin verificar (contacto para prospección; sí se guarda en Shakers).',
        lastSentAt: (value) => `Último guardado: ${value || '(nunca)'}`,
      },
      revoked: 'Consentimiento revocado. No se guardará nada más automáticamente.',
      reset: 'Decisión de consentimiento reiniciada. Se te preguntará de nuevo en la próxima ejecución.',
      emailChanged: (email) => `Correo actualizado a ${email}. Se usará en el próximo guardado.`,
      emailInvalidCli: 'Correo no válido. Uso: usage --consent-email tu@correo.com',
    },
    // Endpoint config (endpoint-config task): --set-endpoint / --show-endpoint copy.
    endpoint: {
      setOk: (url, path) => `Endpoint de ingesta guardado: ${url}\n  (en ${path}). La variable de entorno SHAKERS_CLI_INGEST_ENDPOINT, si está definida, tiene prioridad.`,
      errInsecureRemote: 'Endpoint rechazado: un host que no sea localhost/127.0.0.1 debe usar https:// (el endpoint decide adónde se envía tu código). Usa una URL https o un host local.',
      errInvalidUrl: 'Endpoint rechazado: URL no válida. Debe ser una URL http(s) completa, p.ej. https://tu-hub/api/v1/works/usage/reports',
      errEmpty: 'Endpoint rechazado: no se indicó ninguna URL. Uso: usage --set-endpoint https://tu-hub/api/v1/works/usage/reports',
      showEnv: (url) => `Endpoint de ingesta efectivo: ${url}\n  Origen: variable de entorno SHAKERS_CLI_INGEST_ENDPOINT.`,
      showConfigFile: (url, path) => `Endpoint de ingesta efectivo: ${url}\n  Origen: fichero de config (${path}).`,
      showConfigInvalid: (path) => `El fichero de config (${path}) tiene un endpoint no válido o inseguro; se ignora. Corrígelo con usage --set-endpoint <url>.`,
      showNone: 'No hay endpoint de ingesta configurado. Define SHAKERS_CLI_INGEST_ENDPOINT o usa usage --set-endpoint <url>. Sin él, el informe se sigue mostrando pero no se envía a Shakers.',
      // talents-ai-score, ADR-020/021: el CLI habla con una CADENA de dos backends — PRIMARIO (servicio de certificaciones, arriba) y FALLBACK (hub-backend, aquí).
      // ADR-042 retired the second backend, so the five `showFallback*`/ `setFallbackOk` strings that explained the chain are gone with it.
      showFallbackRetired: 'Nota: tu config.json todavía tiene `ingestEndpointFallback`. Ya no se usa: el CLI habla con un solo backend. Puedes borrar esa línea a mano; dejarla no afecta a nada.',
      confirmHostPrompt: (host) => `El host "${host}" no es localhost ni un dominio conocido de Shakers. Si continúas, tu código muestreado y tus señales de IA se enviarán ahí.\n  Escribe el hostname exacto para confirmar (déjalo en blanco para cancelar):`,
      confirmHostMismatch: 'No coincide con el hostname mostrado. Cancelado: no se ha guardado nada.',
      confirmHostCancelled: 'Cancelado: no se ha guardado nada.',
    },
    backendChain: {
      saved: () => 'Guardado en Shakers.',
    },
    // Why a footprint was NOT sent, in user language; null = stay silent.
    sendStatus: {
      reason: (reason) => {
        switch (reason) {
          case 'throttled':
            return 'No se ha reenviado tu informe: enviaste uno hace menos de una hora. Se enviará de nuevo más tarde.';
          case 'email-unverified':
            return 'No se ha enviado tu informe a Shakers: tu correo aún no está verificado.';
          case 'no-email':
            return 'No se ha enviado tu informe a Shakers: falta tu correo.';
          case 'no-endpoint-configured':
            return 'No se ha enviado tu informe: el envío a Shakers no está configurado.';
          case 'network-error':
            return 'No se pudo enviar tu informe a Shakers (problema de conexión). Inténtalo de nuevo más tarde.';
          case 'rate-limited':
          case 'service-unavailable':
            return 'No se pudo enviar tu informe a Shakers ahora mismo. Inténtalo de nuevo en unos minutos.';
          case 'consent-denied':
          case 'no-decision':
            return null;
          default:
            return 'No se pudo enviar tu informe a Shakers ahora mismo. Inténtalo de nuevo más tarde.';
        }
      },
    },
    // Email-ownership verification (skill-code-certification / ADR-006): the OTP "modo espera" copy, shared by both binaries.
    verify: {
      sent: (email) => `Te enviamos un código de verificación a ${email}.`,
      waitHint: 'Pega aquí el código. Pulsa "r" y Enter para reenviarlo, o Enter en blanco para cancelar.',
      codePrompt: 'Código de verificación:',
      verified: 'Correo verificado. Guardando tu informe en Shakers…',
      invalidCode: 'Código incorrecto. Revísalo y vuelve a pegarlo.',
      expired: 'El código ha caducado. Pulsa "r" y Enter para enviar uno nuevo.',
      resent: (email) => `Te reenviamos un código a ${email}.`,
      resendFailed: 'No se pudo reenviar el código. Inténtalo de nuevo en un momento.',
      requestFailed: 'No se pudo enviar el código de verificación a Shakers. No se guardará el informe; el reporte ya se te ha mostrado.',
      technicalError: 'No se pudo verificar el correo contra Shakers. No se guardará el informe; el reporte ya se te ha mostrado.',
      tooManyAttempts: 'Demasiados intentos fallidos. No se ha verificado el correo, así que no se guardará el informe.',
      cancelled: 'Verificación cancelada. No se guardará el informe (el reporte ya se te ha mostrado).',
      unavailable: 'La verificación de correo no está disponible ahora mismo; no se guardará el informe (el reporte ya se te ha mostrado).',
    },
    // Skill Code Certification (skill-code-certification, issues 004/006).
    // Copy for the SECOND binary `ai-certify` (resolve phase V1). Localized
    // like the consent flow — legal/disclaimer copy must not default to a
    // language the Talent may not read. Vocabulario CONTEXT: Talent, Skill.
    certifyDimension: {
      help:
        'certify - certifica una DIMENSIÓN de tu rol. La entrevista se hace en la web.\n\n'
        + 'Uso:\n'
        + '  certify [--lang es|en] [--dimension <clave|slug|n>]\n\n'
        + 'Requiere una sesión activa (ejecuta antes: shakers login).\n'
        + 'Eliges la dimensión aquí y te damos el enlace para certificarla en la web.\n',
      title: 'Certificar una dimensión',
      loginRequired: '"certify" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      discovering: 'Buscando las dimensiones que puedes certificar…',
      discoverFailed: (reason) => `No se pudieron obtener tus dimensiones (${reason}). Inténtalo de nuevo en un momento.`,
      unmatchedNote: (keys) => `Aviso: algunas dimensiones no tienen plantilla asociada y no se pueden ofrecer aquí (${keys}).`,
      noneOfferable: 'Ahora mismo no hay dimensiones certificables por aquí. Vuelve a intentarlo cuando tengas alguna disponible.',
      mainRole: (role) => `Tu rol principal: ${role}`,
      selectHeading: 'Elige la dimensión que quieres certificar:',
      selectHint: '↑/↓ para moverte, Enter para elegir, Esc para cancelar.',
      selectPrompt: (count) => `Escribe un número (1-${count}) o Enter para cancelar:`,
      selectNonInteractive: 'Modo no interactivo: indica la dimensión con --dimension <clave|slug|n>.',
      selectNoneChosen: 'No se eligió ninguna dimensión.',
      stateExpired: 'caducada',
      dimensionInvalid: 'Esa dimensión no está entre las certificables ahora mismo.',
      dimensionUsing: (slug) => `Dimensión elegida: ${slug}`,
      webHandoff: 'La entrevista de certificación se hace en la web.',
      webHandoffLink: (url) => `Ábrela aquí para certificar esta dimensión:\n  ${url}`,
      webHandoffNoLink: 'Entra en tu perfil de Shakers en la web y ve a Certificaciones para hacerla.',
    },
    findProjects: {
      help:
        'find-projects — lista los proyectos/posiciones disponibles para ti en Shakers.\n\n'
        + 'Uso:\n'
        + '  find-projects [--tab all|saved] [--page N] [--limit N]\n'
        + '                [--attendance remote|hybrid|in-person] [--country ES]\n'
        + '                [--recommended] [--lang es|en] [--json]\n\n'
        + 'Requiere una sesión activa (ejecuta antes: shakers login).\n'
        + 'Ordenadas por match descendente. --page para pasar página; --tab saved para las guardadas.\n'
        + '--recommended muestra solo las que tienen match (filtro local de esta página).\n',
      loginRequired: '"find-projects" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Proyectos disponibles',
      titleSaved: 'Proyectos guardados',
      loading: 'Buscando los proyectos disponibles para ti…',
      fetchFailed: (reason) => `No se pudieron obtener los proyectos (${reason}). Inténtalo de nuevo en un momento.`,
      noneAvailable: 'Ahora mismo no hay proyectos disponibles para ti. Vuelve a mirar más adelante.',
      noneOnPage: 'No hay más proyectos en esta página. Prueba con --page anterior.',
      untitled: 'Sin título',
      companyRestricted: 'empresa reservada',
      hoursPerMonth: (n) => `${n} h/mes`,
      budgetUnknown: 'presupuesto no disponible',
      matchScore: (n) => `match ${n}`,
      savedBadge: 'guardada',
      projectLabel: (name) => `Proyecto: ${name}`,
      attendanceIgnored: 'Aviso: --attendance no válido (usa remote|hybrid|in-person); filtro ignorado.',
      countryIgnored: 'Aviso: --country no válido (usa un código ISO de 2 letras, p. ej. ES); filtro ignorado.',
      showing: (from, to, total) => `Mostrando ${from}–${to} de ${total}`,
      morePages: (next) => `--page ${next} para ver más`,
      recommendedOnPage: (count) => `${count} recomendadas en esta página`,
      recommendedNoneFallback: 'No hay recomendadas para ti ahora mismo; te muestro las disponibles.',
      done: 'Listado completado.',
    },
    showProject: {
      help:
        'show-project — muestra el detalle de un proyecto/posición.\n\n'
        + 'Uso:\n  show-project <número|id> [--lang es|en] [--json]\n\n'
        + 'Requiere una sesión activa (ejecuta antes: shakers login).\n',
      loginRequired: '"show-project" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      idRequired: 'Falta el id. Uso: show-project <número|id>.',
      refNoCache: 'No hay un listado reciente. Ejecuta primero shakers find-projects y usa el número que aparece (o pasa un id).',
      refOutOfRange: (count) => `Ese número no está en el último listado (hay ${count}). Ejecuta shakers find-projects otra vez.`,
      loading: 'Cargando el detalle…',
      fetchFailed: (reason) => `No se pudo obtener el detalle (${reason}). Inténtalo de nuevo en un momento.`,
      notFound: 'No se encontró ese proyecto/posición.',
      notVisible: 'Ese proyecto no está disponible para ti ahora mismo.',
      untitled: 'Sin título',
      companyRestricted: 'empresa reservada',
      companyLine: (name) => `Empresa: ${name}`,
      projectLine: (name) => `Proyecto: ${name}`,
      hoursPerMonth: (n) => `${n} h/mes`,
      budgetUnknown: 'presupuesto no disponible',
      matchScore: (n) => `match ${n}`,
      skillsLine: (s) => `Skills: ${s}`,
      languagesLine: (s) => `Idiomas: ${s}`,
      savedBadge: 'guardada',
      appliedBadge: 'ya aplicaste',
      canApplyBadge: 'puedes aplicar',
      descriptionHeading: 'Descripción',
      goalsHeading: 'Objetivos',
      faqsHeading: 'Preguntas frecuentes',
      done: 'Detalle completado.',
    },
    savedPositions: {
      helpSave: 'save-project — guarda un proyecto/posición en tus guardados.\n\nUso:\n  save-project <número|id> [--json]\n\nRequiere una sesión activa (shakers login).',
      helpUnsave: 'unsave-project — quita un proyecto/posición de tus guardados.\n\nUso:\n  unsave-project <número|id> [--json]\n\nRequiere una sesión activa (shakers login).',
      loginRequired: 'Este comando requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      saveIdRequired: 'Falta el id. Uso: save-project <número|id>.',
      unsaveIdRequired: 'Falta el id. Uso: unsave-project <número|id>.',
      refNoCache: 'No hay un listado reciente. Ejecuta primero shakers find-projects y usa el número que aparece (o pasa un id).',
      refOutOfRange: (count) => `Ese número no está en el último listado (hay ${count}). Ejecuta shakers find-projects otra vez.`,
      saving: 'Guardando…',
      unsaving: 'Quitando de guardados…',
      notFound: 'No se encontró ese proyecto/posición.',
      failed: (reason) => `No se pudo completar (${reason}). Inténtalo de nuevo.`,
      saved: 'Guardado.',
      unsaved: 'Quitado de tus guardados.',
    },
    invitations: {
      help: 'invitations — tus invitaciones a proyectos sin leer.\n\nUso:\n  invitations [--lang es|en] [--json]\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"invitations" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tus invitaciones',
      loading: 'Buscando tus invitaciones…',
      fetchFailed: (reason) => `No se pudieron obtener las invitaciones (${reason}). Inténtalo de nuevo.`,
      none: 'No tienes invitaciones sin leer.',
      untitled: 'Proyecto sin nombre',
      hasChat: 'con chat',
      countNote: (n) => `Total: ${n}.`,
      done: 'Listado completado.',
    },
    certifications: {
      help: 'certifications — tus dimensiones certificadas, sin certificar y caducadas.\n\nUso:\n  certifications [--lang es|en] [--json]\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"certifications" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tus certificaciones',
      loading: 'Cargando tus certificaciones…',
      fetchFailed: (reason) => `No se pudieron obtener las certificaciones (${reason}). Inténtalo de nuevo.`,
      mainRole: (name) => `Rol principal: ${name}`,
      noMainRole: 'Aún no tienes un rol principal asignado.',
      noDimensions: 'No hay dimensiones para tu rol todavía.',
      untitled: 'Dimensión',
      headingCertified: 'Certificadas',
      headingExpired: 'Caducadas',
      headingUncertified: 'Sin certificar',
      done: 'Listado completado.',
    },
    roles: {
      addHelp: 'add-role — añade un rol a tu perfil (rol de crecimiento).\n\nUso:\n  add-role [--lang es|en]\n\nRequiere una sesión activa (shakers login).',
      changeHelp: 'change-role — cambia tu rol principal por uno de los que ya tienes.\n\nUso:\n  change-role [--lang es|en]\n\nRequiere una sesión activa (shakers login).',
      loginRequired: 'Este comando requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      selectHint: 'Usa ↑/↓ y Enter para elegir.',
      cancelled: 'Sin cambios.',
      loadingAvailable: 'Cargando roles disponibles…',
      loadingHeld: 'Cargando tus roles…',
      savingAdd: 'Añadiendo el rol…',
      savingMain: 'Guardando tu rol principal…',
      addTitle: 'Añadir un rol',
      addPrompt: '¿Qué rol quieres añadir a tu perfil?',
      noneAvailable: 'Ya tienes todos los roles disponibles.',
      addedOk: (name) => `Rol añadido: ${name}.`,
      alreadyAssigned: (name) => `Ya tenías ese rol: ${name}.`,
      addFailed: (reason) => `No se pudo añadir el rol (${reason}). Inténtalo de nuevo.`,
      changeTitle: 'Cambiar tu rol principal',
      changePrompt: '¿Cuál quieres como rol principal?',
      currentMain: (name) => `Rol principal actual: ${name}`,
      noOtherRoles: 'No tienes otros roles para elegir. Añade uno primero con: shakers add-role',
      mainRoleTitle: 'Tu rol principal',
      mainRolePrompt: 'Elige tu rol principal',
      mainRolePending: 'Todavía estamos preparando tus roles. Podrás fijar tu rol principal más tarde con: shakers change-role',
      mainRoleSkipped: 'De acuerdo, no cambiamos tu rol principal.',
      mainRoleUnchanged: (name) => `Tu rol principal sigue siendo: ${name}.`,
      mainSetOk: (name) => `Rol principal: ${name}.`,
      setMainFailed: (reason) => `No se pudo fijar el rol principal (${reason}). Inténtalo de nuevo.`,
    },
    profile: {
      help: 'me (alias profile) — tu resumen: rol, tarifa y tu trabajo con IA.\n\nUso:\n  me [--lang es|en] [--json]\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"me" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tu perfil',
      loading: 'Cargando tu resumen…',
      fetchFailed: (reason) => `No se pudo obtener tu resumen (${reason}). Inténtalo de nuevo.`,
      headline: (h) => `Titular: ${h}`,
      role: (name) => `Rol principal: ${name}`,
      freelanceType: (t) => `Modalidad: ${t}`,
      completion: (pct) => `Perfil completado: ${pct}%`,
      rate: (v) => `Tarifa por proyecto: ${v}`,
      rateNotSet: 'sin definir',
      availability: (open, hours) => `Disponibilidad: ${open} · ${hours} h/mes`,
      availYes: 'abierto a trabajar',
      availNo: 'no disponible',
      availUnknown: 'sin definir',
      languages: (codes) => `Idiomas: ${codes}`,
      skillsCount: (n) => `Skills: ${n}`,
      agentsCount: (n) => `Agentes: ${n}`,
      cell: (c) => `Celda de fluidez con IA: ${c}`,
      setup: (tier, level) => `Setup: ${tier} (${level})`,
      usage: (level) => `Uso: ${level}`,
      aiNative: 'AI-native',
      visionHeading: 'Tu visión sobre la IA',
      howIWorkHeading: 'Cómo trabajas con IA',
      noAiProfile: 'Aún no tienes perfil de trabajo con IA: se construye a partir de tu evaluación de AI-usage. Ejecuta `shakers ai-usage` para generarlo y vuelve a ejecutar esto.',
      done: 'Resumen completado.',
    },
    applications: {
      help: 'applications — los proyectos a los que has aplicado y su estado.\n\nUso:\n  applications [--lang es|en] [--json]\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"applications" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tus candidaturas',
      loading: 'Buscando tus candidaturas…',
      fetchFailed: (reason) => `No se pudieron obtener tus candidaturas (${reason}). Inténtalo de nuevo.`,
      none: 'Aún no has aplicado a ningún proyecto.',
      untitled: 'Proyecto sin nombre',
      statusLine: (s) => `Estado: ${s}`,
      statusUnknown: 'desconocido',
      countNote: (n) => `Total: ${n}.`,
      done: 'Listado completado.',
    },
    availability: {
      help: 'availability — ver o fijar tu disponibilidad.\n\nUso:\n  availability [--lang es|en] [--json]      ver\n  availability --set [--lang es|en]         fijar (interactivo, con confirmación)\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"availability" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tu disponibilidad',
      loading: 'Cargando tu disponibilidad…',
      fetchFailed: (reason) => `No se pudo obtener tu disponibilidad (${reason}). Inténtalo de nuevo.`,
      notFound: 'Aún no has definido tu disponibilidad.',
      openToWork: (v) => `Abierto a trabajar: ${v}`,
      monthlyHours: (v) => `Horas al mes: ${v}`,
      workModes: (v) => `Modalidad: ${v}`,
      location: (v) => `Ubicación: ${v}`,
      expires: (v) => `Caduca: ${v}`,
      yes: 'sí',
      no: 'no',
      unknown: 'sin definir',
      done: 'Listado completado.',
      setTitle: 'Fijar tu disponibilidad',
      setNeedsInteractive: 'Fijar la disponibilidad necesita una terminal interactiva (no se puede por tubería). Ejecútalo directamente en tu terminal.',
      askOpenToWork: '¿Estás abierto a trabajar?',
      askMonthlyHours: 'Horas al mes (número, p. ej. 40; Enter para no cambiar):',
      monthlyHoursInvalid: 'Horas no válidas. Escribe solo el número (p. ej. 40).',
      workModesAsk: 'En que modalidad quieres trabajar? (marca una o varias)',
      workModeLabels: { REMOTE: 'Remoto', HYBRID: 'Hibrido', IN_PERSON: 'Presencial' },
      workModesHint: 'Espacio para marcar/desmarcar · Enter para confirmar',
      onlyRemoteNote: 'Has marcado solo Remoto: no veras proyectos hibridos ni presenciales.',
      setDiff: (open, hours, modes) => `Nuevo: abierto=${open} · ${hours} h/mes · modalidad=${modes}`,
      setConfirm: 'Esto actualiza tu perfil. ¿Confirmas? (s/n):',
      setCancelled: 'Cancelado. No se cambió tu disponibilidad.',
      setSaving: 'Guardando tu disponibilidad…',
      setFailed: (reason) => `No se pudo guardar la disponibilidad (${reason}). Inténtalo de nuevo.`,
      setDone: 'Disponibilidad actualizada.',
    },
    mcpInstall: {
      title: 'Conectando el MCP de Shakers',
      clients: { claudeDesktop: 'Claude Desktop', claudeCode: 'Claude Code', cursor: 'Cursor', geminiCli: 'Gemini CLI', codex: 'Codex (y ChatGPT en modo Codex)', vscode: 'VS Code', windsurf: 'Windsurf' },
      status: {
        configured: 'conectado',
        unchanged: 'ya estaba conectado',
        'not-found': 'no instalado en esta máquina',
        'invalid-json': 'su configuración no es JSON válido; no la he tocado',
        failed: 'no se pudo conectar',
      },
      removedLegacy: 'Sustituye a la entrada antigua "shakers-ai-usage".',
      found: (apps) => `He encontrado: ${apps}.`,
      confirm: '¿Conecto Shakers a ellas para que puedas usarlo desde tu IA? [S/n]',
      declined: 'No he tocado nada. Para conectarlo más tarde, vuelve a ejecutar el instalador.',
      noTerminal: 'No hay una terminal donde preguntarte, así que no he tocado nada. Vuelve a ejecutar el instalador en tu terminal para conectarlo.',
      restart: 'Reinicia las apps que estén abiertas para que carguen Shakers.',
      noneFound: 'No he encontrado ninguna app de IA compatible en esta máquina.',
    },
    rate: {
      help: 'rate — ver o fijar tu tarifa por proyecto.\n\nUso:\n  rate [--lang es|en] [--json]      ver tu tarifa\n  rate --set [--lang es|en]         fijarla (interactivo, con confirmación)\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"rate" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tu tarifa por proyecto',
      loading: 'Cargando tu tarifa…',
      fetchFailed: (reason) => `No se pudo obtener la tarifa (${reason}). Inténtalo de nuevo.`,
      notFound: 'Aún no has definido tu tarifa.',
      notSet: 'sin definir',
      fullTime: (v) => `Proyecto a jornada completa: ${v}`,
      partTime: (v) => `Proyecto a media jornada: ${v}`,
      done: 'Listado completado.',
      setTitle: 'Fijar tu tarifa por proyecto',
      setNeedsInteractive: 'Fijar la tarifa necesita una terminal interactiva (no se puede por tubería). Ejecútalo directamente en tu terminal.',
      setWhich: '¿Qué modalidad quieres fijar?',
      modalityFull: 'jornada completa',
      modalityPart: 'media jornada',
      setAmount: (label) => `Importe para ${label} (solo el número):`,
      setAmountInvalid: 'Importe no válido. Debe ser un número entre 0 y 999999.99.',
      setCurrency: 'Moneda:',
      setDiff: (label, oldV, newV) => `${label}: ${oldV} → ${newV}`,
      setConfirm: 'Esto cambia tu precio. ¿Confirmas? (s/n):',
      setCancelled: 'Cancelado. No se cambió tu tarifa.',
      setSaving: 'Guardando tu tarifa…',
      setFailed: (reason) => `No se pudo guardar la tarifa (${reason}). Inténtalo de nuevo.`,
      setDone: (label, newV) => `Tarifa de ${label} actualizada: ${newV}.`,
    },
    lang: {
      help: 'lang — ver o fijar tus idiomas y nivel.\n\nUso:\n  lang [--lang es|en] [--json]      ver\n  lang --set [--lang es|en]         añadir/actualizar (interactivo, con confirmación)\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"lang" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tus idiomas',
      loading: 'Cargando tus idiomas…',
      loadingCatalog: 'Cargando el catálogo de idiomas…',
      fetchFailed: (reason) => `No se pudieron obtener tus idiomas (${reason}). Inténtalo de nuevo.`,
      catalogFailed: (reason) => `No se pudo cargar el catálogo de idiomas (${reason}). Inténtalo de nuevo.`,
      none: 'Aún no has añadido idiomas.',
      line: (name, level) => `${name}: ${level}`,
      unknownLang: 'idioma',
      unknownLevel: 'sin nivel',
      levelLabel: (v) => ({ NATIVE: 'nativo', ADVANCED: 'avanzado', INTERMEDIATE: 'intermedio', INTERMEDIATE_WRITTEN: 'intermedio (escrito)' }[v] || v),
      done: 'Listado completado.',
      setTitle: 'Fijar un idioma',
      setNeedsInteractive: 'Fijar idiomas necesita una terminal interactiva (no se puede por tubería). Ejecútalo directamente en tu terminal.',
      pickLanguage: 'Elige el idioma:',
      pickLevel: 'Elige el nivel:',
      setDiff: (name, level) => `Nuevo: ${name} → ${level}`,
      setConfirm: 'Esto actualiza tus idiomas. ¿Confirmas? (s/n):',
      setCancelled: 'Cancelado. No se cambiaron tus idiomas.',
      setSaving: 'Guardando tus idiomas…',
      setFailed: (reason) => `No se pudieron guardar los idiomas (${reason}). Inténtalo de nuevo.`,
      setDone: (name) => `Idioma actualizado: ${name}.`,
    },
    socials: {
      help: 'socials — ver o fijar tus enlaces sociales.\n\nUso:\n  socials [--lang es|en] [--json]      ver\n  socials --set [--lang es|en]         añadir/actualizar/quitar (interactivo, con confirmación)\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"socials" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tus enlaces sociales',
      loading: 'Cargando tus enlaces…',
      fetchFailed: (reason) => `No se pudieron obtener tus enlaces (${reason}). Inténtalo de nuevo.`,
      none: 'Aún no has añadido enlaces sociales.',
      line: (label, url) => `${label}: ${url}`,
      networkLabel: (k) => ({ linkedin: 'LinkedIn', github: 'GitHub', website: 'Web', twitter: 'Twitter/X', instagram: 'Instagram', facebook: 'Facebook', dribbble: 'Dribbble', behance: 'Behance' }[k] || k),
      done: 'Listado completado.',
      setTitle: 'Fijar un enlace social',
      setNeedsInteractive: 'Fijar enlaces necesita una terminal interactiva (no se puede por tubería). Ejecútalo directamente en tu terminal.',
      pickNetwork: 'Elige la red:',
      askUrl: (label) => `URL de ${label} (vacío para quitarlo):`,
      setDiffSet: (label, url) => `Nuevo: ${label} → ${url}`,
      setDiffClear: (label) => `Quitar: ${label}`,
      setConfirm: 'Esto actualiza tus enlaces. ¿Confirmas? (s/n):',
      setCancelled: 'Cancelado. No se cambiaron tus enlaces.',
      setSaving: 'Guardando tus enlaces…',
      setFailed: (reason) => `No se pudieron guardar los enlaces (${reason}). Inténtalo de nuevo.`,
      setDone: (label) => `${label} actualizado.`,
      setCleared: (label) => `${label} eliminado.`,
    },
    experiences: {
      help: 'experiences — tus experiencias laborales (solo lectura).\n\nUso:\n  experiences [--lang es|en] [--json]\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"experiences" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tus experiencias',
      loading: 'Cargando tus experiencias…',
      fetchFailed: (reason) => `No se pudieron obtener tus experiencias (${reason}). Inténtalo de nuevo.`,
      none: 'Aún no has añadido experiencias.',
      untitled: 'Sin título',
      current: 'actualidad',
      datesLabel: (r) => `Fechas: ${r}`,
      locationLabel: (l) => `Ubicación: ${l}`,
      skillsLabel: (s) => `Skills: ${s}`,
      countNote: (n) => `Total: ${n}.`,
      done: 'Listado completado.',
    },
    portfolios: {
      help: 'portfolios — tus piezas de portfolio (solo lectura).\n\nUso:\n  portfolios [--lang es|en] [--json]\n\nRequiere una sesión activa (shakers login).',
      loginRequired: '"portfolios" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
      title: 'Tu portfolio',
      loading: 'Cargando tu portfolio…',
      fetchFailed: (reason) => `No se pudo obtener tu portfolio (${reason}). Inténtalo de nuevo.`,
      none: 'Aún no has añadido piezas de portfolio.',
      untitled: 'Sin título',
      current: 'en curso',
      datesLabel: (r) => `Fechas: ${r}`,
      locationLabel: (l) => `Ubicación: ${l}`,
      skillsLabel: (s) => `Skills: ${s}`,
      countNote: (n) => `Total: ${n}.`,
      done: 'Listado completado.',
    },
    alma: {
      help: 'alma — mini-shell interactivo para conversar con Alma, tu asistente de IA de Shakers.\n\nUso:\n  alma                  abre la conversación (escribe línea a línea; "salir" para terminar)\n  alma --lang es|en\n\nRequiere una sesión activa (shakers login). La conversación mantiene el contexto entre turnos.',
      loginRequired: '`alma` necesita una sesión activa. Inicia sesión:  shakers login',
      needTty: '`alma` es interactivo y necesita una terminal.',
      title: 'Alma',
      tagline: 'tu asistente de IA de Shakers',
      replHint: 'Escribe tu mensaje y pulsa Enter. Escribe "salir" (o Enter en vacío) para terminar.',
      prompt: 'tú:',
      contextLabel: 'Leyendo tu proyecto…',
      contextConsentHeader: 'Alma puede usar un mapa (sin código) de este proyecto para responder mejor. ¿Lo compartimos?',
      contextConsentHint: 'Solo estructura: nombre, servicios, agentes, tecnologías. Nunca el código.',
      contextConsentYes: 'Sí, compartir el contexto del proyecto',
      contextConsentNo: 'No, chatear sin contexto',
      contextConsentDeclined: 'De acuerdo, hablaré con Alma sin el contexto del proyecto.',
      thinking: 'Alma pensando…',
      bye: 'Hasta luego.',
      confirmPrompt: '¿Confirmas esta acción?',
      confirmYes: 'Sí, adelante',
      confirmNo: 'No, cancela',
      irreversible: '⚠ Esta acción es irreversible.',
      webLink: (to) => `En la web esto abriría: ${to}`,
      failed: (reason) => `No se pudo hablar con Alma (${reason}). Inténtalo de nuevo en un momento.`,
    },
    certify: {
      // Aviso legal (ADR-001): asume el proyecto propiedad del Talent y le
      // atribuye la responsabilidad. Aceptación explícita obligatoria.
      disclaimer:
        'AVISO LEGAL — léelo antes de continuar:\n'
        + '  certify envía datos de tu proyecto a Shakers para certificar tus Skills TÉCNICAS\n'
        + '  (las de tu catálogo, a partir de tu código). No evalúa cómo orquestas agentes.\n'
        + '  En esta fase (resolve) se envían tu correo y los NOMBRES de las tecnologías\n'
        + '  detectadas; la fase de certificación posterior enviará fragmentos de código.\n'
        + '  Eres el ÚNICO responsable de asegurarte de que eres propietario del código de\n'
        + '  este proyecto o de que estás autorizado a analizarlo. Shakers no asume ninguna\n'
        + '  responsabilidad por el código que envíes. Enviar código que no es tuyo o que\n'
        + '  no estás autorizado a analizar es un uso indebido de esta herramienta y puede\n'
        + '  acarrear penalizaciones en tu cuenta de Shakers, incluida la posible suspensión.\n'
        + '  NO uses esta herramienta sobre código de un tercero (p. ej. un cliente bajo NDA).\n'
        + '  Las notas son indicativas y no verificadas, no una cualificación oficial.',
      disclaimerQuestion: '¿Aceptas y continúas? (s/n):',
      disclaimerAcceptedFlag: 'Aviso legal aceptado mediante --accept-disclaimer.',
      disclaimerNonInteractive:
        'Entrada no interactiva y sin --accept-disclaimer: no se puede obtener una '
        + 'aceptación explícita. Se cancela (no se ha enviado nada).',
      disclaimerDeclined: 'No has aceptado el aviso legal. No se ha enviado nada.',
      disclaimerInvalidAnswer: 'Respuesta no reconocida. Responde "s" (sí) o "n" (no).',
      disclaimerNoAnswer: 'No se ha obtenido respuesta. No se ha enviado nada.',
      // Certify report (terminal + HTML). Rúbrica anclada + agregación determinista (ADR-024).
      report: {
        heading: 'Resultado de certificación de Skills TÉCNICAS',
        noInterviewNote: 'Preliminar, sin entrevista: la certificación combinada de esta Skill requiere completar su entrevista.',
        disclaimer:
          'Nota: el nivel se determina con una rúbrica anclada y una fórmula fija, por lo que '
          + 'el cálculo es determinista: con las mismas valoraciones sale el mismo nivel. Solo '
          + 'los juicios por criterio del modelo pueden variar ligeramente entre ejecuciones. Es '
          + 'una valoración indicativa, no una certificación oficial de cara al Client.',
        partialSampleWarning:
          'Muestra parcial: por los límites de tamaño la valoración se basa en una muestra del '
          + 'código, no en todo el proyecto.',
        // ADR-016 skill levels (by decision power, NOT points) — replace the
        // numeric grade in the skill output. `key` from skillLevelForScore.
        levelLine: (label) => `Nivel: ${label}`,
        skillLevels: {
          middle: 'Middle',
          senior: 'Senior',
          expert: 'Expert',
          na: '—',
        },
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
        htmlTitle: 'Certificación de Skills técnicas · Shakers',
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
    // Branded mini-shell chrome (skill-code-certification / ADR-014).
    login: {
      intro: 'Inicia sesión con tu email y contraseña de Shakers.',
      sessionExpiredIntro: 'Tu sesión anterior caducó. Vuelve a iniciar sesión con tu email y contraseña.',
      alreadyLoggedIn: 'Ya has iniciado sesión. Usa `logout` si quieres cambiar de cuenta.',
      emailPrompt: 'Email:',
      passwordPrompt: 'Contraseña:',
      emailInvalid: 'Email no válido. Inténtalo de nuevo.',
      needInput: 'Se necesitan email y contraseña para iniciar sesión.',
      success: 'Sesión iniciada. Tu informe ya no incluye el roadmap ni las sugerencias de mejora: tu nivel sale de certificarte.',
      expiresAt: (iso) => `La sesión caduca: ${iso}. Cuando expire te lo diré y podrás volver a entrar con \`login\`.`,
      loggedOut: 'Sesión cerrada. Vuelves a ver el informe completo, con roadmap y sugerencias.',
      notLoggedIn: 'No había ninguna sesión iniciada. No hay nada que cerrar.',
      errorInvalidCredentials: 'Credenciales incorrectas: revisa tu email y contraseña e inténtalo otra vez.',
      errorNoEmailPassword: 'Esta cuenta existe pero no tiene contraseña de email: la registraste con Google o LinkedIn. Si fue con Google, usa `login --google`. Si fue con LinkedIn, entra desde la web para añadir una contraseña por ahora.',
      errorUpstream: 'El servidor de identidad de Shakers no responde ahora mismo. No es tu contraseña; inténtalo de nuevo en un rato.',
      errorUnreachable: 'No se pudo conectar con Shakers. Comprueba tu conexión y vuelve a ejecutar `login`.',
      errorConfig: 'La dirección del servidor no es válida. Revisa la configuración del endpoint (`usage --show-endpoint`).',
      errorNoEndpoint: 'No hay endpoint configurado. login usa la misma base que usage: define SHAKERS_CLI_INGEST_ENDPOINT o usa `usage --set-endpoint <url>`.',
      errorPersist: 'El inicio de sesión funcionó, pero no se pudo guardar la sesión en disco. Revisa los permisos de ~/.config/shakers y vuelve a intentarlo.',
      errorGeneric: 'No se pudo iniciar sesión. Inténtalo de nuevo.',
      // ADR-046 — login con Google por loopback (`login --google`).
      googleIntro: 'Inicia sesión con Google. Se abrirá tu navegador para autorizar; al terminar, vuelve aquí.',
      googleOpening: 'Abriendo el navegador para iniciar sesión con Google…',
      googlePasteUrl: 'Si el navegador no se abre solo, pega esta URL en él:',
      googleWaiting: 'Esperando a que completes el acceso en el navegador…',
      googleErrorConfigFailed: 'No se pudo obtener la configuración de login de Google desde Shakers. Comprueba tu conexión y el endpoint (`usage --show-endpoint`) e inténtalo de nuevo.',
      googleErrorConfigInvalid: 'La configuración de Google que devolvió Shakers está incompleta. Es un problema del servidor, no tuyo; inténtalo más tarde.',
      googleErrorPortInUse: 'El puerto local que usa el login de Google está ocupado por otro proceso. Ciérralo y vuelve a ejecutar `login --google`.',
      googleErrorTimeout: 'Se agotó el tiempo esperando a que completaras el acceso en el navegador. Vuelve a ejecutar `login --google` cuando estés listo.',
      googleErrorState: 'La respuesta del navegador no coincidió con lo esperado (posible interferencia). Por seguridad no se inició sesión; inténtalo de nuevo.',
      googleErrorDenied: 'Cancelaste el acceso en Google (o no se concedió). No se inició sesión.',
      googleErrorGeneric: 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
      // Google por device flow (RFC 8628): la config de Google la tiene el Hub; abres una URL y escribes un código.
      deviceIntro: (name) => `Inicia sesión con ${name}. Abre el enlace de abajo e introduce el código para autorizar; luego vuelve aquí.`,
      deviceVisit: 'Abre esta página en tu navegador:',
      deviceCodeLabel: (code) => `e introduce este código: ${code}`,
      deviceWaiting: 'Esperando a que autorices en el navegador…',
      deviceErrorExpired: 'La solicitud de acceso con Google caducó antes de autorizarse. Vuelve a ejecutar `login --google` cuando estés listo.',
      deviceErrorDenied: 'Se canceló el acceso con Google (o no se concedió). No se inició sesión.',
      deviceErrorGeneric: 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
      chooseMethodHeading: '¿Cómo quieres iniciar sesión?',
      methodEmail: 'Email y contraseña',
      methodGoogle: 'Google',
      methodLinkedin: 'LinkedIn',
      selectHint: 'Flechas ↑/↓ para moverte · enter para elegir · esc para cancelar',
      chooseMethodPrompt: (max) => `Número (1-${max}), vacío para cancelar: `,
    },
    // `start` (talents-ai-score, ADR-054/055): la herramienta para un talento YA registrado en Shakers que quiere completar su perfil agéntico.
    start: {
      help:
        'start — completa tu perfil de talento agéntico en Shakers: inicia sesión, evalúa tu uso de IA\n'
        + 'si todavía no lo has hecho, y desde un único menú añade o certifica skills y agentes.\n\n'
        + 'Uso:\n'
        + '  start [opciones]\n\n'
        + 'Opciones:\n'
        + '      --root DIR     Analiza DIR en vez del directorio actual\n'
        + '      --lang es|en   Fuerza el idioma de la salida\n'
        + '  -h, --help         Muestra esta ayuda (no inicia sesión, no escanea nada)\n\n'
        + 'Requiere que hayas iniciado sesión (o te la pedirá): usa las mismas credenciales de Shakers\n'
        + 'que `login`. Si es la primera vez que ejecutas la herramienta en este proyecto, se lanza\n'
        + 'automáticamente la evaluación de uso de IA (`usage`) antes de mostrar el menú.',
      intro:
        'Vamos allá: confirmamos tu sesión y, si es la primera vez en este proyecto, generamos tu evaluación de uso de IA antes de mostrarte el menú.',
      alreadyLoggedIn: (email) => `Ya has iniciado sesión${email ? ` como ${email}` : ''}.`,
      loginCancelled: 'No se ha iniciado sesión, así que no podemos continuar. Ejecuta `start` de nuevo cuando quieras entrar.',
      runningUsageFirst:
        'Todavía no tienes un informe de uso de IA para este proyecto — es la base de tu perfil agéntico. Lo generamos primero.',
      menuHeading: '¿Qué quieres hacer?',
      menuHint: 'Flechas ↑/↓ para moverte · enter para elegir · esc para cancelar',
      menuPrompt: (max) => `Número (1-${max}), vacío para cancelar: `,
      menuRerun: 'Volver a lanzar la evaluación de uso de IA',
      // dueño (2026-08-12): renombrado — el label decía "Añadir" pero la acción es declarar/subir lo detectado al PERFIL de Shakers, no crear algo nuevo desde cero.
      menuAddSkills: 'Subir skills a tu perfil',
      menuAddAgents: 'Subir agentes a tu perfil',
      // talents-ai-score, ADR-059: "Añadir proyecto al portfolio" — junto a las de skills/agentes, antes de certificar (declarar cosas de tu perfil, luego certificarlas).
      menuAddPortfolio: 'Añadir proyecto al portfolio',
      menuCertifySkills: 'Certificar skills',
      menuCertifyAgents: 'Certificar agentes',
      menuExit: 'Salir',
      menuExitDesc: 'Termina esta sesión de `start`. Ejecútalo de nuevo cuando quieras seguir completando tu perfil.',
      menuRerunDesc:
        'Re-escanea tu setup de IA y recalcula tu fluidez con IA. Obtienes tu posición actualizada en el mapa (de Explorer a AI Native) en tu perfil.',
      menuAddSkillsDesc:
        'Detecta las tecnologías de tu proyecto y declara en tu perfil las que aún no tienes. Obtienes más skills en tu perfil (declaradas, sin verificar) → apareces en más búsquedas.',
      menuAddAgentsDesc:
        'Detecta los agentes de IA que has construido y los declara en tu perfil. La IA pre-redacta qué hace y qué decides tú; los editas antes de guardar. Obtienes tus agentes como activos de tu perfil agéntico.',
      menuAddPortfolioDesc:
        'Añade este proyecto a tu portfolio de Shakers: título, tipo, descripción y skills, la mayoría pre-rellenados desde tu código y tu git. Obtienes una pieza más de tu trabajo visible en tu perfil.',
      menuCertifySkillsDesc:
        'Un reto sobre tu propio código valida tu nivel real en una skill. Obtienes la skill certificada en banda Middle/Senior/Expert → credibilidad y más peso en el matching.',
      menuCertifyAgentsDesc:
        'Un reto valida que el agente es real, es tuyo y lo operas con criterio. Obtienes el agente Certified con su tracción → la señal más fuerte de tu perfil agéntico.',
      menuCancelled: 'Cancelado. No se ha hecho nada.',
      // dueño (2026-08-12): cierre del BUCLE del menú — usado tanto al elegir "Salir" explícitamente como al cancelar (esc / respuesta vacía) DESDE DENTRO del bucle.
      menuGoodbye: 'Sesión de `start` terminada. Ejecuta `start` de nuevo cuando quieras seguir completando tu perfil.',
      addAgentsComingSoon:
        'Añadir agentes: próximamente. Tus agentes serán activos de tu perfil agéntico — todavía no existe esa ficha en Shakers, así que de momento no hay dónde guardarlos.',
      addSkillsNoTechnologies:
        'No se reconoció ninguna tecnología en este proyecto (package.json, requirements.txt, go.mod…). No hay skills que añadir desde aquí.',
      addSkillsErrorNoEndpoint:
        'No hay endpoint configurado. `start` usa la misma base que `usage`: define el endpoint con `usage --set-endpoint <url>` (o SHAKERS_CLI_INGEST_ENDPOINT).',
      addSkillsResolveErrorIntro: 'No se pudo leer tu inventario de AI-usage (si aún no has ejecutado `shakers ai-usage`, hazlo primero):',
      addSkillsNoneMatched:
        'Este paso necesita antes tu evaluación de AI-usage: es la que descubre las skills de tu setup. Ejecuta `shakers ai-usage` y vuelve a ejecutar este comando para añadirlas a tu perfil.',
      addSkillsNoHubToken:
        'Tu sesión no tiene el permiso necesario para añadir skills a tu perfil. Ejecuta `login` de nuevo e inténtalo otra vez.',
      addSkillsSelectHeading: 'Skills detectadas que aún no están en tu perfil (elige una o varias):',
      addSkillsSelectHint: 'Flechas ↑/↓ · espacio para marcar · "a" para marcar todas · enter para confirmar · esc para cancelar',
      addSkillsSelectPrompt: (max) => `Números separados por comas (1-${max}), vacío para cancelar: `,
      addSkillsNoneChosen: 'No has elegido ninguna skill. No se ha añadido nada a tu perfil.',
      addSkillsDeclaredOne: (skillName) => `✓ Añadida a tu perfil: ${skillName} (sin verificar).`,
      addSkillsDeclareFailed: (skillName, reason) => `✗ No se pudo añadir ${skillName}: ${reason}`,
      // Cierre de la visión (dueño, 2026-08-11): UNA vez, después del lote — no repetido por cada skill (issue 106/097's lección: repetir la misma frase por ítem es ruido, no refuerzo).
      addSkillsProfileBoost: 'Cada skill que añades suma a tu perfil: apareces en más búsquedas.',
      addSkillsHubSessionExpired: 'Tu sesión de Shakers ha caducado mientras añadíamos tus skills.',
      addSkillsOfferRelogin: '¿Quieres volver a iniciar sesión ahora para seguir? (s/n):',
      addSkillsRelaunchAfterRelogin: 'Sesión renovada. Reintentamos las skills que quedaban pendientes.',
      addSkillsRelaunchDeclined: 'Vale. Ejecuta `login` y vuelve a elegir "Añadir skills" cuando quieras.',
      addSkillsReloginFailed: 'No se pudo volver a iniciar sesión. Las skills pendientes no se han añadido.',
      addSkillsRelateNoPortfolios: 'Todavía no tienes proyectos en tu portfolio, así que las skills se han añadido sin relacionar. Puedes añadir uno con "Añadir proyecto al portfolio" y relacionarlas más tarde.',
      addSkillsRelateAsk: (skillName) => `¿Quieres relacionar "${skillName}" con una experiencia de tu perfil? (s/n):`,
      addSkillsRelateSelectHeading: (skillName) => `Relaciona "${skillName}" con una o varias experiencias:`,
      addSkillsRelateSelectHint: 'Flechas ↑/↓ · espacio para marcar · "a" para marcar todas · enter para confirmar · esc para cancelar',
      addSkillsRelateSelectPrompt: (max) => `Números separados por comas (1-${max}), vacío para omitir: `,
      addSkillsRelateSkipped: (skillName) => `"${skillName}" añadida sin relacionar.`,
      addSkillsRelated: (skillName, portfolioName) => `  ✓ "${skillName}" relacionada con "${portfolioName}".`,
      addSkillsRelateFailed: (skillName, portfolioName, reason) => `  ✗ No se pudo relacionar "${skillName}" con "${portfolioName}": ${reason}`,
      // talents-ai-score, ADR-059: "Añadir proyecto al portfolio".
      portfolioIntro:
        'Vamos a añadir este proyecto a tu portfolio de Shakers. La mayoría de los datos vienen pre-rellenados desde tu código y tu git: confirma o edita cada uno.',
      portfolioErrorNoEndpoint:
        'No hay endpoint configurado. `start` usa la misma base que `usage`: define el endpoint con `usage --set-endpoint <url>` (o SHAKERS_CLI_INGEST_ENDPOINT).',
      portfolioNoHubToken:
        'Tu sesión no tiene el permiso necesario para añadir proyectos a tu portfolio. Ejecuta `login` de nuevo e inténtalo otra vez.',
      portfolioDedupCheckingLabel: 'Comprobando tu portfolio…',
      portfolioDedupCheckFailed: (reason) => `No se pudo comprobar si ya tienes un proyecto con ese nombre en tu portfolio: ${reason} Seguimos, pero podrías acabar con un duplicado.`,
      portfolioDuplicateName: (name) => `Ya tienes un proyecto llamado "${name}" en tu portfolio. No se ha creado uno duplicado — vuelve a ejecutar esta opción con otro título si quieres añadir uno distinto.`,
      // (1) Título ← nombre del directorio, editable.
      portfolioTitlePrompt: (def) => `Título del proyecto [${def}]:`,
      // (2) Tipo ← PORTFOLIO/EXPERIENCE, obligatorio. Copy de visión (dueño):
      // qué significa cada tipo para tu perfil, mostrado SOLO al resaltar.
      portfolioTypeHeading: '¿Qué tipo de entrada es?',
      portfolioTypeHint: 'Flechas ↑/↓ para moverte · enter para elegir · esc para cancelar',
      portfolioTypePrompt: (max) => `Número (1-${max}): `,
      portfolioTypePortfolio: 'Portfolio',
      portfolioTypePortfolioDesc:
        'Lo añade a tu perfil como una pieza de portfolio: una muestra de tu trabajo que cualquiera que revise tu perfil puede ver.',
      portfolioTypeExperience: 'Experiencia',
      portfolioTypeExperienceDesc:
        'Lo añade a tu perfil como experiencia profesional (freelance o de plantilla): cuenta en tu trayectoria, no como una pieza para mostrar.',
      // (3) Descripción ← IA pre-redacta tras consentimiento (ADR-052/059).
      portfolioDescriptionConsentDisclaimer:
        'Para redactar un borrador de la descripción con IA, se enviarán a Shakers: el nombre del proyecto, las tecnologías detectadas y, si existen, el contenido del README y la descripción del package.json.',
      portfolioDescriptionDraftLabel: 'Borrador generado por IA:',
      portfolioDescriptionDraftingLabel: 'Redactando un borrador con IA…',
      // Editable; o free-text si declinas, si falla, o si no hay endpoint.
      portfolioDescriptionEditPrompt: 'Descripción (edítala o pulsa enter para dejar el borrador de arriba):',
      portfolioDescriptionFreeTextPrompt: 'Descripción (opcional, pulsa enter para dejarla en blanco):',
      // (4) URL ← remote git del repo, editable.
      portfolioUrlPrompt: (def) => (def ? `URL del repositorio [${def}]:` : 'URL del repositorio (opcional, no se detectó ninguna):'),
      // (5) Skills ← multi-select de las tecnologías detectadas, PRE-MARCADAS (puedes quitar, no añadir: son las que resolvimos a una skill de tu catálogo).
      portfolioSkillsResolvingLabel: 'Buscando las skills de este proyecto…',
      portfolioSkillsSelectHeading: 'Skills de este proyecto — se añaden a tu perfil y se muestran en la pieza (pre-marcadas; quita las que no apliquen):',
      portfolioSkillsSelectHint: 'Flechas ↑/↓ · espacio para marcar/desmarcar · "a" para marcar/desmarcar todas · enter para confirmar · esc para cancelar',
      portfolioSkillsSelectPrompt: (max) => `Números separados por comas (1-${max}) para cambiar la selección, vacío para dejar todas marcadas: `,
      portfolioSkillsSelectInvalid: 'No se entendió esa respuesta. Se mantienen todas las skills marcadas.',
      // (6) Cliente ← opcional, para freelance.
      portfolioClientPrompt: 'Cliente (opcional, para trabajo freelance; pulsa enter para dejarlo en blanco):',
      portfolioClientWebsitePrompt: 'Web del cliente (opcional, p.ej. acme.com; para su logo; pulsa enter para omitir):',
      portfolioCancelled: 'Cancelado. No se ha añadido nada a tu portfolio.',
      portfolioDeclaring: 'Añadiendo el proyecto a tu portfolio…',
      portfolioDeclaredSuccess: (name) => `✓ "${name}" añadido a tu portfolio.`,
      portfolioDeclareFailed: (reason) => `✗ No se pudo añadir el proyecto a tu portfolio: ${reason}`,
      portfolioHubSessionExpired: 'Tu sesión de Shakers ha caducado mientras añadíamos el proyecto a tu portfolio.',
      portfolioOfferRelogin: '¿Quieres volver a iniciar sesión ahora para seguir? (s/n):',
      portfolioRelaunchAfterRelogin: 'Sesión renovada. Reintentamos añadir el proyecto a tu portfolio.',
      portfolioRelaunchDeclined: 'Vale. Ejecuta `login` y vuelve a elegir "Añadir proyecto al portfolio" cuando quieras.',
      portfolioReloginFailed: 'No se pudo volver a iniciar sesión. El proyecto no se ha añadido a tu portfolio.',
      // talents-ai-score Phase 2: "Añadir agente al perfil".
      agentErrorNoEndpoint:
        'No hay endpoint configurado. `start` usa la misma base que `usage`: define el endpoint con `usage --set-endpoint <url>` (o SHAKERS_CLI_INGEST_ENDPOINT).',
      agentNoHubToken:
        'Tu sesión no tiene el permiso necesario para añadir agentes a tu perfil. Ejecuta `login` de nuevo e inténtalo otra vez.',
      agentNoAgentsDetected:
        'Este paso necesita antes tu evaluación de AI-usage: es la que descubre los agentes de IA de tu setup. Ejecuta `shakers ai-usage` y vuelve a ejecutar este comando para añadirlos a tu perfil.',
      agentInventoryError: (reason) => `No se pudo leer tu inventario de AI-usage: ${reason}. Si aún no lo has ejecutado, corre \`shakers ai-usage\` primero; si no, revisa tu conexión e inténtalo de nuevo.`,
      agentDedupCheckingLabel: 'Comprobando tus agentes…',
      agentDedupCheckFailed: (reason) => `No se pudo comprobar si ya tienes un agente con ese nombre en tu perfil: ${reason} Seguimos, pero podrías acabar con un duplicado.`,
      agentDuplicateName: (name) => `Ya tienes un agente llamado "${name}" en tu perfil. No se ha creado uno duplicado — vuelve a ejecutar esta opción con otro nombre si quieres añadir uno distinto.`,
      agentAlreadyAdded: (name) => `Ya tienes el agente "${name}" en tu perfil; puedes relacionarlo con tus experiencias.`,
      agentIntro:
        'Vamos a añadir uno de tus agentes a tu perfil de Shakers. Elige el agente; la IA pre-redacta qué hace y qué decides tú, y lo editas antes de guardar.',
      // (1) Elegir agente detectado.
      agentPickHeading: '¿Qué agente quieres añadir a tu perfil?',
      agentPickHint: 'Flechas ↑/↓ para moverte · enter para elegir · esc para cancelar',
      agentPickPrompt: (max) => `Número (1-${max}): `,
      agentCancelled: 'Cancelado. No se ha añadido ningún agente a tu perfil.',
      // (3) Nombre ← detectado, editable.
      agentNamePrompt: (def) => `Nombre del agente [${def}]:`,
      // (4) whatItDoes + humanDecides ← IA pre-redacta tras consentimiento (ADR-052).
      agentFieldsConsentDisclaimer:
        'Para redactar un borrador con IA de qué hace tu agente y qué decides tú, se enviarán a Shakers: el nombre del agente, sus herramientas/modelo/agente padre detectados y un resumen de su definición (sus propias instrucciones).',
      agentDraftingLabel: 'Redactando un borrador con IA…',
      agentWhatItDoesDraftLabel: 'Qué hace — borrador generado por IA:',
      agentWhatItDoesEditPrompt: 'Qué hace (edítalo o pulsa enter para dejar el borrador de arriba):',
      agentWhatItDoesFreeTextPrompt: 'Qué hace tu agente (opcional, pulsa enter para dejarlo en blanco):',
      agentHumanDecidesDraftLabel: 'Qué haces tú alrededor del agente (supervisión/validación) — borrador generado por IA:',
      agentHumanDecidesEditPrompt: 'Qué haces tú alrededor del agente (edítalo o pulsa enter para dejar el borrador de arriba):',
      agentHumanDecidesFreeTextPrompt: 'Qué haces tú alrededor del agente / cómo lo supervisas (opcional, pulsa enter para dejarlo en blanco):',
      // catalogId ← se incluye si un `usage` previo casó el agente con el catálogo.
      agentCatalogMatched: (role) => `Lo hemos casado con el catálogo de agentes de Shakers como: ${role}.`,
      agentDeclaring: 'Añadiendo el agente a tu perfil…',
      agentDeclaredSuccess: (name) => `✓ "${name}" añadido a tu perfil.`,
      agentDeclareFailed: (reason) => `✗ No se pudo añadir el agente a tu perfil: ${reason}`,
      agentHubSessionExpired: 'Tu sesión de Shakers ha caducado mientras añadíamos el agente a tu perfil.',
      agentRelateNoPortfolios: 'Todavía no tienes experiencias en tu perfil, así que el agente se ha añadido sin relacionar. Puedes añadir una con "Añadir proyecto al portfolio" y relacionarlo más tarde.',
      agentRelateAsk: (agentName) => `¿Quieres relacionar "${agentName}" con alguna de tus experiencias? (s/n):`,
      agentRelateSelectHeading: (agentName) => `Relaciona "${agentName}" con una o varias experiencias:`,
      agentRelateSkipped: (agentName) => `"${agentName}" añadido sin relacionar.`,
      agentRelated: (agentName, portfolioName) => `✓ "${agentName}" relacionado con "${portfolioName}".`,
      agentRelateFailed: (agentName, reason) => `✗ No se pudo relacionar "${agentName}" con tus experiencias: ${reason}`,
      portfolioAddSkillsResolvingLabel: 'Buscando otras skills para tu perfil…',
      portfolioAddSkillsIntro:
        'También detectamos otras skills en este proyecto que aún no están en tu perfil de Shakers (aparte de las que acabas de vincular al portfolio).',
      portfolioAddSkillsAllAlreadyDeclared: 'Todas las skills de este proyecto ya están en tu perfil.',
      portfolioAddSkillsHeading: 'Skills para tu perfil (pre-marcadas; quita las que no apliquen):',
      portfolioAddSkillsHint: 'Flechas ↑/↓ · espacio para marcar/desmarcar · "a" para marcar/desmarcar todas · enter para confirmar · esc para cancelar',
      portfolioAddSkillsPrompt: (max) => `Números separados por comas (1-${max}) para cambiar la selección, vacío para dejar todas marcadas: `,
      portfolioAddSkillsInvalid: 'No se entendió esa respuesta. Se mantienen todas las skills marcadas.',
      errorReason: {
        'no-endpoint': 'no hay endpoint configurado.',
        'no-hub-token': 'tu sesión no tiene el permiso de hub necesario; ejecuta `login` de nuevo.',
        'hub-session-expired': 'tu sesión de hub ha caducado.',
        'network-error': 'error de red.',
        timeout: 'se agotó el tiempo de espera.',
        'invalid-url': 'la URL del endpoint no es válida.',
        'bad-response': 'la respuesta del servidor no se pudo interpretar.',
        generic: 'no se pudo completar la operación.',
      },
      errorReasonHttp: (status) => `el servidor respondió con un error (HTTP ${status}).`,
    },
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
        'Ejecuta:  certify --email <cualquiera> --accept-disclaimer --skill <nombre>   ·   Para cerrarla:  superadmin --logout',
      loggedOut: 'Sesión de superadmin olvidada (token local eliminado).',
      // talents-ai-score, "conmutador de perfil vía superadmin" (dueño, 2026-08-12): conveniencia de dev/testing — cambia entre perfil talent/external sin reinstalar.
      profileMenuHeading: '¿Qué quieres hacer?',
      profileMenuHint: 'Flechas ↑/↓ para moverte · enter para elegir · esc para cancelar',
      profileMenuPrompt: (max) => `Número (1-${max}), vacío para cancelar: `,
      profileMenuTalent: 'Cambiar a perfil Talent',
      profileMenuTalentCurrent: 'Cambiar a perfil Talent 《actual》',
      profileMenuTalentDesc:
        'Superficie completa: start, login, certify (skills y agentes), añadir skills/portfolio. Purga el historial local (informe, consentimiento, sesión de talento) y surte efecto de inmediato en esta misma sesión, sin reiniciar.',
      profileMenuExternal: 'Cambiar a perfil External',
      profileMenuExternalCurrent: 'Cambiar a perfil External 《actual》',
      profileMenuExternalDesc:
        'Superficie pública pre-pivote: usage, report, share. Purga el historial local (informe, consentimiento, sesión de talento) y surte efecto de inmediato en esta misma sesión, sin reiniciar.',
      profileMenuCancelled: 'Cancelado. No se ha cambiado nada.',
      profileAlreadyOn: (profile) => `Ya estás en el perfil ${profile === 'talent' ? 'Talent' : 'External'}. No se ha cambiado ni purgado nada.`,
      profileSwitched: (profile) => `Perfil cambiado a ${profile === 'talent' ? 'Talent' : 'External'} · historial limpiado (informe, consentimiento, sesión de talento) · efecto inmediato, sin reiniciar.`,
      // talents-ai-score, ADR-020/021 (decisión del coordinador): superadmin es DELIBERADAMENTE single-hop, SOLO PRIMARIO (servicio de certificaciones) — nunca hub.
      queryingPrimary: (endpoint) => `Consultando Shakers: ${endpoint}`,
      errorNoEndpoint:
        'No hay endpoint configurado. Configura el backend (SHAKERS_CLI_INGEST_ENDPOINT o usage --set-endpoint) y reinténtalo.',
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
    repl: {
      prompt: 'ϟ shakers ›',
      // dueño (2026-08-12): el BANNER de arranque (src/repl-shell.js) ahora es profile-aware y localizado.
      bannerWelcome: 'Bienvenido a',
      bannerTalentLine1: 'Completa o actualiza tu perfil de talento',
      bannerTalentLine2: 'agéntico en Shakers: no solo qué sabes, sino',
      bannerTalentLine3: 'cómo trabajas con IA y los agentes que construyes.',
      bannerHowItWorksHeading: 'Cómo funciona',
      bannerTalentStep1Line1: '1. `start` analiza tu proyecto en local y',
      bannerTalentStep1Line2: '   detecta tu setup de IA, tus skills y agentes.',
      bannerTalentStep2Line1: '2. Añades o certificas tus skills y agentes en',
      bannerTalentStep2Line2: '   tu perfil de Shakers.',
      bannerTalentStep3Line1: '3. Un perfil más completo te posiciona para los',
      bannerTalentStep3Line2: '   proyectos que lo valoran.',
      // EXTERNAL: mismo estilo de siempre (título + lista de comandos) —
      // SOLO localizado. La lista nunca incluyó `certify`/`start`/`login`.
      bannerExternalLine1: 'Una CLI local-first que escanea tu equipo en busca de',
      bannerExternalLine2: 'herramientas de IA y te muestra un informe privado y local.',
      bannerCommandsHeading: 'Comandos',
      bannerExternalUsageDesc: 'escanea tu equipo + proyecto',
      bannerExternalMapDesc: 'informe LOCAL (grafo)',
      bannerExternalReportDesc: 'informe HTML compartible',
      bannerExternalShareDesc: 'tarjeta para LinkedIn',
      // FLUJO DE COMANDOS (issues 081 y 082) VOCABULARIO, y lo hereda la 083: aquí se habla de COMANDOS de la herramienta.
      completeNeeds: (cmd) => `(necesita: ${cmd})`,
      completeDone: '(ya ejecutado)',
      completeDoneStale: (days) => `(ya ejecutado, hace ${days} días)`,
      completeAlias: (cmd) => `(alias de ${cmd})`,
      // Los subcomandos de `certify`, con la calificacion de la 085: aqui es donde
      // el talento elige, asi que es donde no puede quedar ambiguo.
      completeSubSkills: 'Skills TÉCNICAS, desde tu código',
      completeSubAgents: 'dominio de UN agente',
      flowHeading: 'En qué orden usar la herramienta',
      flowIntro: 'Los comandos se apoyan unos en otros. Este es el orden recomendado, y si te saltas una dependencia te aviso antes de ejecutar nada.',
      flowStepFree: (n, cmd, what) => `${n}. ${cmd} — ${what}`,
      flowStepNeeds: (n, cmd, what, needs) => `${n}. ${cmd} — ${what} (necesita: ${needs})`,
      flowWhat: {
        usage: 'escanea tu entorno y puntúa tu setup de IA. Es la raíz de todo lo demás, y además deja tu identidad verificada',
        certify: 'certifica una dimensión de tu rol con una entrevista por LiveKit',
        report: 'genera el informe compartible (uso de IA + certificaciones)',
        share: 'crea la tarjeta branded para LinkedIn',
      },
      // El bloqueo dice tres cosas: qué falta, POR QUÉ este comando lo necesita, y
      // el comando exacto que lo desbloquea.
      blockedHeading: (cmd) => `\`${cmd}\` no se puede ejecutar todavía.`,
      blockedWhyFootprint: (cmd) => `Le falta el uso de IA de este proyecto: \`${cmd}\` se construye a partir de lo que detectó el escaneo, así que sin escaneo no hay nada de donde partir.`,
      blockedWhyIdentity: (cmd) => `Le falta tu identidad verificada: \`${cmd}\` abre una sesión en el servicio a tu nombre y sin correo verificado el servicio la rechaza.`,
      blockedFix: (fix) => `Ejecuta \`${fix}\` y vuelve a intentarlo.`,
      blockedNoBypass: 'No hay forma de saltarse esta comprobación: el comando fallaría igual unos segundos después, solo que sin explicación.',
      // "Ejecutado y fallido" NO está aquí a propósito: no se persiste nada en el
      // camino de fallo, así que afirmarlo sería inventarlo.
      staleFootprint: (days) => `El uso de IA de este proyecto tiene ${days} días. Si has cambiado de herramientas o de agentes, vuelve a ejecutar \`usage\` antes de compartir nada.`,
      nextCommand: (cmd, what) => `Siguiente comando de la herramienta: \`${cmd}\` — ${what}`,
      journeyDone: 'Has completado el recorrido de la herramienta: no queda ningún comando por ejecutar. Los siguientes pasos para subir tu nivel de uso de IA son otra cosa y están en `usage --roadmap`.',
      goodbye: 'Hasta pronto.',
      unknown: (cmd) => `Comando no reconocido: "${cmd}". Escribe "help" para ver los comandos disponibles.`,
      // ORDEN: lo declara src/command-graph.js (issue 081).
      help:
        'Shakers — comandos disponibles\n\n'
        + '  usage     [opciones]   Escanea este proyecto y tu equipo; puntúa tu setup de IA (T0-T7)\n'
        + '  certify   [opciones]   Certifica una dimensión de tu rol (entrevista por LiveKit)\n'
        + '  report    [opciones]   Genera y abre el informe compartible (uso de IA + Skills certificadas)\n'
        + '                         Necesita un `usage` de este proyecto\n'
        + '  share     [opciones]   Crea una tarjeta branded de tu uso de IA para compartir en LinkedIn\n'
        + '                         Necesita un `usage` de este proyecto\n'
        + '  login                  Inicia sesión como talento registrado (email + contraseña)\n'
        + '  logout                 Cierra tu sesión\n'
        + '  help                   Muestra esta ayuda\n'
        + '  clear                  Limpia la pantalla\n'
        + '  exit | quit            Cierra la shell\n\n'
        + 'Los flags de cada comando siguen funcionando dentro de la shell\n'
        + '(p.ej. `usage --root <dir>`, `usage --roadmap`, `certify --dimension <clave>`). Usa\n'
        + '`usage --help` o `certify --help` para ver todas sus opciones.',
      helpExternal:
        'shakers — comandos disponibles\n\n'
        + '  usage     [opciones]   Escanea este proyecto y tu equipo; genera un informe LOCAL de tu setup de IA\n'
        + '  report    [opciones]   Abre el informe HTML compartible de este proyecto en tu navegador\n'
        + '                         Necesita un `usage` de este proyecto\n'
        + '  share     [opciones]   Crea una tarjeta branded de tu uso de IA para compartir en LinkedIn\n'
        + '                         Necesita un `usage` de este proyecto\n'
        + '  help                   Muestra esta ayuda\n'
        + '  clear                  Limpia la pantalla\n'
        + '  exit | quit            Cierra la shell\n\n'
        + 'Los flags de cada comando siguen funcionando dentro de la shell\n'
        + '(p.ej. `usage --root <dir>`, `usage --json`). Usa `usage --help` para ver todas sus opciones.',
      // Sustituye al bloque de flujo (081) cuando solo hay UN comando visible: no hay orden que anunciar.
      externalIntro: 'Escribe `usage` para escanear este proyecto y tu máquina; el informe se muestra siempre en local, y nada sale de tu equipo salvo que tú decidas compartirlo.',
    },
    // The SHAREABLE project report (src/render-sheet.js + its src/templates/report-sheet.html).
    sheet: {
      reportTitle: 'Informe de uso de IA',
      footprint: 'Uso de IA',
      certs: 'Certificaciones',
      ladderT: 'Nivel de setup',
      ladderS: 'Tu nivel de uso de IA: S1–S3.',
      toolsT: 'Herramientas detectadas',
      toolsS: 'Clientes de IA presentes en tu entorno.',
      techT: 'Tecnologías del proyecto',
      techS: 'Stack reconocido en el repositorio.',
      // Issue 110: los SERVICIOS detrás de los MCP.
      mcpT: 'Servicios conectados por MCP',
      mcpS: 'Productos a los que tu IA tiene acceso.',
      mcpEmpty: 'No se ha detectado ningún servidor MCP. Conectar uno es el criterio que te sube a T3 (Banco conectado).',
      mcpUnidentified: (n) => `${n} ${n === 1 ? 'servidor cuyo servicio no' : 'servidores cuyo servicio no'} hemos podido identificar por su nombre.`,
      // 085: la pestaña decía "Skills" a secas junto a una de "Agentes", que es
      // la colisión exacta que la issue nombra.
      skills: 'Skills técnicas',
      // ---- Agentes DETECTADOS, columna izquierda (issue 089) --------------
      agentsT: 'Agentes detectados',
      agentsS: 'Todos los agentes que hay configurados en tu entorno. Certificar es otra cosa y está en la columna de la derecha.',
      agentsEmpty: 'No se ha detectado ningún agente configurado (p. ej. en .claude/agents/). Si tienes agentes y no salen aquí, es que la herramienta no los ha encontrado, no que no cuenten.',
      agentNoModel: 'sin modelo declarado',
      agentNoCategory: 'sin categoría',
      // 106: TRES estados, no dos.
      agentNotEvaluated: 'sin evaluar',
      agentsEvalMissing: 'La clasificación de estos agentes no se ha podido calcular en esta ejecución, así que no es que no tengan categoría: es que no se ha llegado a preguntar. Vuelve a ejecutar `usage` para intentarlo otra vez.',
      agentOrchestrates: 'orquesta otros agentes',
      valoracion: 'Valoración',
      comoMejorar: 'Cómo mejorar',
      bandLine: (label) => `Nivel de setup <b>${label}</b>.`,
      hereYouAre: 'Estás aquí',
      noFoot: 'Aún no hay uso de IA. Ejecuta usage en este proyecto.',
      noSkills: 'Aún no hay Skills técnicas certificadas. Ejecuta certify skills.',
      // Agent certifications were removed from the report (ADR-033); the sheet's agent-cert tab, its empty state and its detected-vs-certified copy went with it.
      footer: 'Informe generado localmente · Shakers',
      // Template chrome that used to be hardcoded Spanish in report-sheet.html (including inside its inline <script>), so an English report shipped Spanish controls.
      themeToggle: 'Cambiar tema',
      themeDark: 'Oscuro',
      themeLight: 'Claro',
      copied: 'Copiado ✓',
      expandAll: 'Expandir todo',
      collapseAll: 'Colapsar todo',
    },
  },
  en: {
    onboarding: {
      title: 'Shakers registration (onboarding)',
      askLinkedin: 'Your LinkedIn URL (required):',
      askCv: 'Path to your CV PDF (optional, Enter to skip):',
      askGithub: 'Your GitHub URL (optional, Enter to skip):',
      askWebsite: 'Your personal website (optional, Enter to skip):',
      importStarted: 'Importing your profile in the background while we continue…',
      importError: 'Could not start your profile import.',
      importUnavailable: 'We could not import your profile right now (service unavailable); we are continuing with your registration, you can retry the import later.',
      importChecking: 'Importing your profile…',
      importDone: 'Profile imported successfully.',
      importFailed: 'We could not finish importing your profile. You can retry it later from your profile.',
      importStillRunning: 'Your profile is still importing in the background; it will be ready in a few minutes.',
      professionalTitle: 'Your work situation',
      askWorkSituation: "What's your current work situation? Choose one:",
      workSituationLabels: {
        FREELANCE: 'Freelance',
        EMPLOYED: 'Employed',
        BETWEEN_JOBS: 'Between jobs',
        STUDYING: 'Studying',
        OTHER: 'Other',
      },
      askEmploymentParticipation: 'Is your role full-time or part-time?',
      employmentParticipationLabels: {
        FULL_TIME: 'Full-time',
        PART_TIME: 'Part-time',
      },
      askFreelanceOpinion: 'What is your opinion on freelancing?',
      freelanceOpinionLabels: {
        WAS_FREELANCE_BEFORE: 'I have been freelance',
        OPEN_TO_FREELANCE: 'I would consider becoming freelance',
        NOT_INTERESTED: 'Not interested',
      },
      askChangeMotivators: 'What inspires you about freelancing or Shakers?',
      changeMotivatorLabels: {
        HIGHER_RATE: 'Get a higher rate',
        SPECIFIC_PROJECT: 'A specific project',
        LEARNING_CERTIFICATION: 'Continue learning and get certified',
        FLEXIBILITY: 'The flexibility of being freelance',
        COMMUNITY: 'Belonging to a community',
        LIFESTYLE_CHANGE: 'I want to change my lifestyle',
      },
      professionalSaved: 'Work situation saved.',
      chooseMethodHeading: 'How do you want to create your account?',
      signupTitle: 'Create your Shakers account',
      askName: 'First name:',
      askLastName: 'Last name:',
      askEmail: 'Email (use a NEW one; if it already exists I will offer to sign in):',
      askPassword: 'Password (at least 8 characters):',
      askPasswordConfirm: 'Repeat the password:',
      passwordMismatch: 'The passwords do not match. Try again.',
      askFreelanceTypeSelect: 'How do you work? Choose one:',
      freelanceTypeLabels: {
        FREELANCE: 'Freelance',
        EMPLOYEE: 'Employed',
        AGENCY: 'Agency or company',
        POTENTIAL_FREELANCE: 'Considering freelancing',
      },
      invalidChoice: 'Invalid option.',
      askNewsletter: 'Do you want the newsletter? (y/n):',
      weakPassword: 'The password does not meet the requirements (at least 8 characters).',
      signupError: 'Could not create the account.',
      freelanceIntentRequired: 'Your freelance intent is required for that type.',
      accountExists: 'An account with that email already exists. Signing you in.',
      accountReady: 'Account created. Signed in.',
      sessionError: 'The account was created but sign-in failed. Run `shakers login`.',
      pricingTitle: 'Your per-project price',
      pricingSaved: 'Price saved.',
      askPricingFullAmount: (cur) => `Full-time project price in ${cur} (number, no thousands separators, e.g. 60000):`,
      askPricingFullCurrency: 'Currency:',
      askPricingPartSelect: 'Do you offer part-time projects? (y/n):',
      askPricingPartAmount: (cur) => `Part-time project price in ${cur} (number, no thousands separators, e.g. 50):`,
      askPricingPartCurrency: 'Currency:',
      pricingAmountInvalid: 'Invalid amount. Use a number with no thousands separators and at most 2 decimals (e.g. 60000 or 1500.50), between 0 and 999999.99.',
      availabilityTitle: 'Your availability and location',
      availabilityAsk: 'Do you want to set your availability and location now? (y/n):',
      availableAsk: 'Are you available for new projects? (y/n):',
      monthlyHoursAsk: 'How many hours per month?',
      workModesAsk: 'Which work modes do you want? (select one or more)',
      workModeLabels: { REMOTE: 'Remote', HYBRID: 'Hybrid', IN_PERSON: 'On-site' },
      workModesHint: 'Space to toggle · Enter to confirm',
      onlyRemoteNote: 'You selected Remote only: you will not see hybrid or on-site projects.',
      countryAsk: 'Country (2-letter ISO-2 code, e.g. ES):',
      countryInvalid: 'Invalid country code. Use 2 letters (e.g. ES, US, GB).',
      subdivisionAsk: 'State or province (optional, Enter to skip):',
      timezoneAsk: (tz) => (tz ? `Timezone [${tz}] (Enter to accept, or type another):` : 'Timezone (e.g. Europe/Madrid):'),
      longFullTimeAsk: 'Open to long full-time projects? (y/n):',
      phonePrefixAsk: 'Phone dialling code (optional, e.g. +34, Enter to skip):',
      phoneNumberAsk: 'Phone number (optional, Enter to skip):',
      phoneSaved: 'Phone saved.',
      phoneUnavailable: 'We could not save your phone right now. You can update it later.',
      availabilitySaved: 'Availability saved.',
      availabilityUnavailable: 'We could not save your availability right now. You can update it later.',
      availabilitySkipped: 'OK, you can set your availability later.',
      languagesTitle: 'Your languages',
      languagesAsk: 'Do you want to add the languages you speak? (y/n):',
      askLanguageCode: 'Language:',
      languageNames: {
        es: 'Spanish',
        en: 'English',
        fr: 'French',
        ca: 'Catalan',
        de: 'German',
        eu: 'Basque',
        it: 'Italian',
        pt: 'Portuguese',
      },
      askLanguageLevel: 'Your level in that language:',
      languageLevelLabels: {
        NATIVE: 'Native or bilingual',
        ADVANCED: 'Fluent at work and daily life',
        INTERMEDIATE: 'Can work in it (speaking and writing)',
        INTERMEDIATE_WRITTEN: 'Can work in it, prefer written communication',
      },
      askAnotherLanguage: 'Do you want to add another language? (y/n):',
      languagesSaved: 'Languages saved.',
      languagesUnavailable: 'We could not save your languages right now. You can add them later.',
      languagesSkipped: 'OK, you can add your languages later.',
      usageTitle: 'Evaluate your AI usage (optional)',
      usageInfoAccessed: LEGAL.en.usageInfoAccessed,
      usageGoalDuration: LEGAL.en.usageGoalDuration,
      usageAccept: 'Do you want to evaluate your AI usage now? (y/n):',
      usageSkippedEvidence: 'You already have AI-usage evidence on Shakers; skipping this step.',
      interviewTitle: 'Onboarding interview (optional)',
      interviewOnlyTitle: 'Onboarding interview',
      interviewInfoAccessed: LEGAL.en.interviewInfoAccessed,
      interviewGoalDuration: LEGAL.en.interviewGoalDuration,
      interviewAccept: 'Do you want to take the interview now? (y/n):',
      interviewComplete: 'Interview complete. Thank you!',
      interviewAlreadyDone: 'You already completed the onboarding interview; it cannot be repeated from the CLI. You can keep refining your profile.',
      repeatWarnTitle: 'Repeat the onboarding interview',
      repeatWarnBody: 'Repeating OVERWRITES your previous onboarding interview and CANNOT be undone: the previous evaluation is discarded.',
      repeatConfirmPrompt: 'Are you sure you want to repeat and overwrite your onboarding?',
      repeatConfirmYes: 'Yes, repeat and overwrite',
      repeatConfirmNo: 'No, cancel',
      repeatAborted: 'OK, not repeating the onboarding.',
      repeatRestarted: 'Onboarding reset. Let us start again.',
      repeatNotFound: 'You have no onboarding yet. Run `shakers onboarding` first.',
      repeatAuthError: 'Your session does not allow this action. Sign in again: shakers login',
      repeatFailed: (reason) => `Could not reset the onboarding (${reason}). Try again.`,
      interviewAnswer: 'Your answer:',
      questionHeading: (n) => `Question ${n}`,
      interviewTurnError: 'Could not continue the interview.',
      thinking: 'Alma is thinking…',
      interviewIntro: 'This is a conversation; answer naturally, take your time.',
      interviewTransition: 'Thanks. Let us continue:',
      interviewConnecting: 'Connecting to the interview...',
      livekitMissing: 'The interview needs the optional @livekit/rtc-node package, which is not installed.\n  Re-run the talent installer (SHAKERS_PROFILE=talent) to install it, or do it by hand:\n    npm install --omit=dev --prefix ~/.shakers @livekit/rtc-node\n  (use your SHAKERS_CLI_HOME path if you installed the CLI elsewhere).\n  Then re-run:  shakers onboarding',
      livekitOld: 'The installed @livekit/rtc-node is too old for text streams.\n  Update it:  npm install --prefix ~/.shakers @livekit/rtc-node@latest',
      livekitConnectError: 'Could not connect to the interview room.',
      transcriptWarn: (reason) => `Warning: could not save the interview transcript (${reason}). It may not be available to review later.`,
      finalizedGeneric: 'Onboarding complete.',
      finalizedAt: (pct) => `Onboarding complete. Your profile is at ${pct}%.`,
      finalizeWarn: (reason) => `Could not mark onboarding as complete (${reason}). You can retry later.`,
      profileReadyNoUrl: 'Your profile is ready. You can view it in your Shakers account.',
      profileReadyUrl: (url) => `Your profile is ready: ${url}`,
      help: 'Usage: shakers onboarding [--lang es|en] [--accept-disclaimer]',
    },
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
        t2Blocking: (n) => `To reach T2 (Bench with notes) you need at least one persistent context file (instructions, config or rules) — currently \`context = ${n}\`.`,
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
      // ADR-016: the ladder now groups tiers by SETUP LEVEL, not the 0-4 band.
      setupHeading: 'Setup Level',
      setupIntro:
        'Your setup level (S1–S3) sums up your AI usage at a glance; the tier (T0-T7) is the '
        + 'fine-grained axis it is derived from. Both are deterministic. Below marks what you have '
        + 'already passed (✓), where you are now (●), and what lies ahead (○) with the exact criterion '
        + 'that unlocks it.',
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
        none: 'No AI usage: no AI tool detected in your environment.',
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
        T4: 'Own tooling: you have built your own skill files, commands or rules.',
        T5: 'Agentic operator: an agentic CLI drives MCP and your own assets end to end.',
        T6: 'Multi-agent: a team of 2+ specialized agents.',
        T7: 'Orchestrated workshop: hooks automate the workshop and agents orchestrate each other.',
      },
    },
    // Agent classification + improvement tips (skill-code-certification req 2/3) — see the es block.
    classification: {
      label: 'Classification',
      noCategory: 'No category',
      // FOURTH STATE — see the Spanish catalog for why it is not "not assessed" and
      // why it lives here rather than in the per-surface sections.
      agentEvalOmitted: 'left out of this run',
      // Wording holds for one, for some and for ALL — see the Spanish catalog.
      agentsEvalPartial: (names, count = 2) => (count === 1
        ? `This agent was left out of this run: ${names}. The model's response did not cover it, so it is not that it has no category: it was never assessed. Run \`usage\` again to complete it.`
        : `These agents were left out of this run: ${names}. The model's response did not cover them, so it is not that they have no category: they were never assessed. Run \`usage\` again to complete them.`),
      // Whole call lost, not a partial one — and split by cause, because a deadline that scales with agent count makes "try again" a false suggestion.
      agentsEvalMissing: "Your agents' category could not be computed this run: the assessment never answered. It is not that they have no category. Run `usage` again to retry.",
      // See the Spanish catalog: the two point the talent at different places.
      agentsEvalUnreachable: "Shakers could not be reached, so your agents show no category. Check your connection and run `usage` again.",
      agentsEvalErrored: "Shakers answered with an error, so your agents show no category. This is not your setup; try again in a while.",
      agentsEvalTimedOut: (count) => `The assessment of your agents did not answer within its deadline, so they show no category this run. That time grows with the number of agents and you have ${count}, so running it again unchanged will most likely end the same way.`,
      improvementsHeading: 'How to improve this agent',
      // Seven specialities plus the FLOOR (`other`) — see the Spanish catalog for
      // why the floor needs a label AND must keep the neutral badge.
      categories: {
        developer: 'Development',
        product: 'Product',
        designer: 'Design',
        marketing: 'Marketing',
        data: 'Data',
        finance: 'Finance',
        sales: 'Sales',
        other: 'Other / internal',
      },
      levels: {
        L1: 'L1 · operational',
        L2: 'L2 · tactical',
        L3: 'L3 · strategic',
      },
    },
    // LEGACY 0-4 band names — kept only for older persisted reports / the
    // unchanged sent payload (ADR-016); the report shows `setupLevels` instead.
    levelNames: {
      none: 'No AI usage',
      exploring: 'Exploring',
      integrated: 'Integrated',
      power: 'Power user',
      orchestrator: 'Orchestrator',
    },
    // Setup Level (Talent Certification Framework, ADR-016): the 3-value rollup that REPLACES the 0-4 band on every surface.
    setupLevels: {
      none: {
        label: 'Not certified',
        desc: 'No AI setup: no AI tool detected in your environment.',
      },
      S1: {
        label: 'S1 · Assisted',
        desc: 'Assisted: you use AI with persistent context (instructions/config) across your projects.',
      },
      S2: {
        label: 'S2 · Extended',
        desc: 'Extended: you extend AI with MCP and your own assets (skill files, commands or rules).',
      },
      S3: {
        label: 'S3 · Orchestrated',
        desc: 'Orchestrated: you run agentic CLIs, agent teams and end-to-end automation.',
      },
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
      // ADR-016: Setup Level shown in the top bar (replaces the 0-4 level line).
      setupLevel: (label) => `Setup · ${label}`,
      // Current tier appended to the top bar, next to the level (report req 1 addendum).
      tierInline: (key, name) => ` · Tier ${key} · ${name}`,
      detectedHeading: 'Detected',
      activity: {
        heading: 'Activity (analyzed repos)',
        repos: (list) => `Repos: ${list}`,
        sessions: (n) => `${n} ${n === 1 ? 'session' : 'sessions'} (root)`,
        subagents: (n) => `${n} subagent ${n === 1 ? 'run' : 'runs'}`,
        hours: (h) => `${h} active h (idle gap > 25 min = pause)`,
        commits: (authored, total) => `${authored}/${total} commits by you`,
        lines: (added, deleted) => `+${added}/-${deleted} lines`,
        velocity: (v) => `${v} commits/day`,
        workStreams: (streams, multiDay, maxSpan) =>
          `${streams} ${streams === 1 ? 'workstream' : 'workstreams'} (${multiDay} multi-day, max ${maxSpan}d)`,
        tractionLabel: 'Traction',
        tSessions: (n) => `${n} sessions (90d)`,
        tDays: (n) => `${n} days/week`,
        tAgents: (d, p) => `${d} agents detected${p != null ? ` · ${p} on your profile` : ''}`,
        tTools: (list) => `tools: ${list}`,
      },
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
      roadmapHint: 'Run `usage --roadmap` to see the steps between you and the next AI-usage level. These are not steps in this tool: they are changes to how you work, over the coming weeks.',
      aiProfileGenerating: 'Generating your AI profile (matrix, vision and how you work)…',
      aiProfilePendingRetry: 'Your AI profile (matrix, vision and how you work) is still being generated; re-run `report` in a moment to see it.',
      // issue 122 / ADR-044: shown when a session existed and has expired. Opens
      // with "Your session has expired" — see the Spanish catalog.
      sessionExpiredNotice: 'Your session has expired. You are seeing the full report as a general user; run `login` to sign in again.',
      nextStep: 'Next step to level up',
      files: (n) => `${n} ${n === 1 ? 'file' : 'files'}`,
      lastModified: (label) => `last modified: ${label}`,
      // dueño (2026-08-12): "Project technologies" is renamed "Skills" for the TALENT profile only (naming unicity with the rest of the talent surface).
      skillsHeading: 'Skills',
    },
    html: {
      lang: 'en',
      title: (setupLabel) => `Shakers · ${setupLabel}`,
      h1: 'Your AI usage profile',
      sub: 'A local snapshot of which AI tools you have and how deeply you have configured them.',
      levelOf: (level) => `Level ${level} of 4`,
      // ADR-016: hero label for the Setup Level (replaces the 0-4 "Level X of 4").
      setupLevelOf: 'Setup Level',
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
      nextStep: 'Next step to level up',
      diagramHeading: 'Agents',
      agentsEmpty: 'No configured AI agents detected (e.g. .claude/agents/).',
      orchestratorLabel: 'Orchestrator',
      agentDescriptionFromName: (name) => `"${name}" agent (no description declared in its file).`,
      // AI product an agent belongs to, derived from its source (proper nouns; same es/en).
      aiProducts: { 'claude-code': 'Claude Code' },
      // ADR-016 agent evaluation (HTML per-agent detail): definition-quality score + LLM rationale + local usage signal.
      agentScoreLabel: 'Definition quality (0-100)',
      agentQualityLabel: 'Why:',
      agentUsageLabel: 'Local usage (Claude Code history)',
      agentUsedTimes: (n) => `used ${n}×`,
      agentUnused: 'no local use',
      // Project technologies (talents-ai-score, ADR-012). Refined: shows
      // recognized FRAMEWORKS/LIBRARIES only, not a raw dependency dump.
      technologiesHeading: 'Project technologies',
      technologiesEmpty: 'No recognized framework or library was found in the dependency manifests (package.json, requirements.txt, go.mod, pyproject.toml).',
      // MCP servers by name (talents-ai-score, issue 015).
      mcpHeading: 'Services connected over MCP',
      mcpEmpty: 'No MCP server detected. Connecting one is the criterion that takes you to T3 (Connected bench).',
      mcpUnidentified: (n) => `${n} more server${n === 1 ? '' : 's'} whose service we could not identify from its name.`,
      roadmapHeading: 'Your next AI-usage level',
      roadmapSubheading: 'What follows is yours to do at work, not in this tool. The tool only tells you where to aim.',
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
      // Issue 109 — see the Spanish catalog for why these say what was lost
      // rather than what went wrong, and when they are allowed to show.
      roadmapNotPersonalizedNotice: 'This roadmap is the generic one for your tier: it could not be adapted to your project this run. Run `usage` again to retry.',
      // Issue 084 — see the Spanish catalog for why the tag sits next to the
      // heading instead of in a footnote.
      roadmapNowLabel: 'Where you start from',
      roadmapProjectionLabel: 'Where this path leaves you',
      roadmapProjectionTag: 'projection',
      roadmapProjectionNote: 'Computed with the same engine as your evaluation, applying the minimum these steps ask for. It is a projection, not a promise: the evaluation measures real use, so taking them is necessary and not sufficient.',
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
      // Reporting redesign (skill-code-certification): HTML is no longer opt-in (--html retired).
      reportLink: (url) => `Open your report in your browser:\n  ${url}`,
      // `share` command (skill-code-certification): CLI copy wrapping the branded LinkedIn card.
      share: {
        help: 'share — build a branded card with your AI usage result (tier + score) to post on LinkedIn.\n'
          + '  Run `usage` first; `share` uses this project\'s latest AI usage.\n'
          + '  Options: --root <dir>, --lang es|en',
        noFootprint: 'No AI usage for this project yet. Run `usage` first, then `share`.',
        ready: (url) => `Your shareable card is ready — open it to download the PNG and post it:\n  ${url}`,
        hint: 'LinkedIn can\'t attach an image from a URL: download the PNG from the card, then attach it to your post.',
        error: 'Could not generate the shareable card.',
        disabled: '`share` is currently disabled. Please try again later.',
      },
      accountReminder: {
        question: 'Do you already have an account?',
        hint: 'ai-usage is public. Signing in is optional; arrows to move, enter to choose.',
        yes: 'Yes, sign in',
        no: 'No, continue without an account',
      },
      // `report` command (ADR-016): builds and OPENS the full, shareable HTML report for this project (AI usage + certified Skills).
      report: {
        help: 'report — build and open the full HTML report for this project (AI usage + certified Skills) to share with your team.\n'
          + '  Run `usage` (and optionally `certify`) first; `report` gathers their result.\n'
          + '  Options: --root <dir>, --lang es|en, --no-open (do not open the browser; just print the link)',
        noData: 'Nothing to show for this project yet. Run `usage` first (and optionally `certify`), then `report`.',
        ready: (url) => `Your report is ready:\n  ${url}`,
        opening: 'Opening it in your browser…',
        error: 'Could not generate the report.',
      },
      frameworkIntroUsage:
        'This measures your AI fluency across two axes: Setup (your tooling\'s maturity, T0–T7, deterministic) and Usage (how you use it, assessed via interview + code). It places you on the 3×3 map (Explorer → AI Native). Completing it positions your agentic profile for projects that value how you work with AI.',
      scanningLabel: 'Scanning environment and detectors…',
      // Loader for the per-selected-repo aggregation phase (git + sessions + steering/decisions + evidence + agent org chart).
      aggregatingLabel: 'Aggregating signals across the selected repos…',
      reposScopePromptHeader: 'What do you want to evaluate?',
      reposScopePromptHint: 'Arrows to move · enter to choose',
      reposScopeOptionMachine: 'Whole machine (every repo with AI activity)',
      reposScopeOptionRepo: 'Current repo (this directory only)',
      reposDetectedNote: (repoCount, unassigned) =>
        repoCount === 0
          ? 'No repos with AI sessions detected on this machine.'
          : `${repoCount} ${repoCount === 1 ? 'repo' : 'repos'} with AI sessions detected` +
            (unassigned > 0
              ? `; ${unassigned} ${unassigned === 1 ? 'session' : 'sessions'} with no attributable repo, excluded.`
              : '.'),
      reposFlagUnmatched: (list) => `Repos not found, ignored: ${list}.`,
      reposScopeCapped: (shown, total) =>
        `Whole-machine evaluation capped to ${shown} of ${total} detected repos (most active first).`,
      reposScopeAll: 'Evaluating all AI usage on this machine.',
      synthesizingLabel: 'Synthesizing agents with AI…',
      personalizingRoadmapLabel: 'Personalizing roadmap…',
      // ADR-016: agent definition-quality evaluation (ephemeral LLM call).
      evaluatingAgentsLabel: 'Evaluating your agents’ quality…',
      buildNextLevelHint: 'Alternatively, run `usage --build-next-level` to generate the starter file directly in your project.',
      // Localized help (skill-code-certification / ADR-003): previously hardcoded Spanish in bin/report.js; now routed through i18n so it respects the machine locale.
      help:
        '\nShakers — local profile of your AI-tool usage\n\n'
        + 'Usage:\n  usage [options]\n\n'
        + 'Options:\n'
        + '      --json             Print the report as JSON on stdout\n'
        + '      --no-save          Do not persist the report state (show only)\n'
        + '      --root DIR         Scan DIR instead of the current directory\n'
        + '      --repos LIST       Evaluate only these repos (ids or paths, comma-separated)\n'
        + '      --machine          Evaluate the whole machine (every repo with AI activity)\n'
        + '      --repo             Evaluate the current repo only\n'
        + '      --scope machine|repo  Same as --machine / --repo (skips the picker)\n'
        + '      --all-repos        Alias of --machine\n'
        + '      --roadmap          Show the steps to raise your AI-usage level (hidden by default)\n'
        + '      --build-next-level Generate the next tier starter (secondary alternative)\n'
        + '      --force            With --build-next-level, overwrite an existing file\n'
        + '      --lang es|en       Force the language (report + prompt) instead of OS detection\n'
        + '      --consent-status   Show your save decision / email / last send\n'
        + '      --consent-revoke   Revoke saving (→ denied); stops sending\n'
        + '      --consent-reset    Clear the decision (→ undecided); asks again\n'
        + '      --consent-email C  Change the stored email, decision untouched\n'
        + '      --set-endpoint URL Save the Shakers send endpoint to\n'
        + '                         ~/.config/shakers/config.json (a non-local host must be\n'
        + '                         https). The env var takes precedence\n'
        + '      --show-endpoint    Show the effective endpoint and where it comes from\n'
        + '  -h, --help             Show this help\n\n'
        + 'The report is ALWAYS generated and shown on your machine. usage no longer\n'
        + 'prints a link: use the `report` command to build and open the full HTML report\n'
        + '(AI usage + certified Skills) you can share with your team. Before showing the\n'
        + 'result, the first time you are asked whether to SAVE it in Shakers (with your\n'
        + 'email); you are asked only once. Reopen the question with --consent-reset.\n\n'
        + 'The send destination resolves as: SHAKERS_CLI_INGEST_ENDPOINT (env) > the config\n'
        + 'file (--set-endpoint) > none. Without an endpoint, the report is shown but not sent\n'
        + 'to Shakers.\n',
    },
    // Cumulative report (skill-code-certification, reporting redesign) — English mirror.
    cumulative: {
      title: 'Your Shakers report',
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
    // talents-ai-score: mirrors the es catalog's `legalNotice` — see its comment.
    legalNotice: {
      label: 'LEGAL NOTICE',
    },
    consent: {
      // talents-ai-score, ADR-011: the disclosure wall (itemized sends / never sends) is RETIRED from the CLI — that content now lives in the repo's README.
      persistIntro:
        'This report has already been generated and shown on your machine, '
        + 'always. Saving it in Shakers is optional and revocable at any '
        + "time (usage --consent-revoke): it saves your level/tier and "
        + 'structured signals derived across categories (tools, MCP, memory, '
        + 'automations, agents, technologies) — never the content of your '
        + 'files, prompts, paths or credentials. '
        + 'This same decision also authorizes, only if you accept, a '
        + 'third-party observability provider (Datadog) to capture the '
        + "content these optional AI calls send (sampled code, agent "
        + 'definitions, your answers) — it cannot be selectively deleted '
        + 'afterwards. If you decline, nothing is captured. '
        + 'Indicative data, not verified, '
        + 'not an official qualification. You are responsible for the information '
        + 'you choose to share; Shakers assumes no liability for the data you '
        + 'submit. Misuse of these tools —submitting or analyzing code that is not '
        + 'yours or that you are not authorized to analyze— may result in penalties '
        + "on your Shakers account, up to and including suspension. See this "
        + "repository's README for more detail.",
      persistQuestion: 'Save this report in Shakers? (y/n):',
      invalidAnswer: 'Answer not recognized. Reply "y" (yes) or "n" (no).',
      emailPrompt: 'Enter your email:',
      emailPromptExternal: "Leave us your email so the Shakers team can reach out (we don't verify it):",
      invalidEmail: 'Invalid email, try again.',
      notObtained: "Couldn't record your answer; you'll be asked again next time.",
      // talents-ai-score, ADR-051: this question is now asked BEFORE any AI/egress call (agent-synthesis, agent-evaluation, roadmap personalization), not after.
      noReportWithoutConsent: 'Without your consent, this report will not include AI-generated synthesis, evaluation, or roadmap this time (the rest of the report is shown as usual). Run `usage` again and accept to include them, or use --consent-reset if you want to be asked again.',
      deniedSaved: 'Understood, nothing will be saved. You can change your mind later by running the command again.',
      grantedSaved: (email) => `Thanks. From now on this report will be saved in Shakers automatically (email: ${email}, max. once per hour).`,
      grantedSavedExternal: (email) => `Thanks. We've saved your email (${email}) so the Shakers team can reach out — we haven't verified it.`,
      // talents-ai-score, issue 130: a logged-in Talent is NEVER asked for an email (their account already proves identity).
      noSessionEmail: "There's no email on file for your session yet, so this report can't be saved this time. You'll be asked again next run.",
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
        emailUnverifiedExternal: 'Self-affirmed email, unverified (contact for prospecting; it IS saved in Shakers).',
        lastSentAt: (value) => `Last saved: ${value || '(never)'}`,
      },
      revoked: 'Consent revoked. Nothing will be saved automatically anymore.',
      reset: 'Consent decision reset. You will be asked again on the next run.',
      emailChanged: (email) => `Email updated to ${email}. It will be used on the next save.`,
      emailInvalidCli: 'Invalid email. Usage: usage --consent-email you@example.com',
    },
    // Endpoint config (endpoint-config task): --set-endpoint / --show-endpoint copy.
    endpoint: {
      setOk: (url, path) => `Ingest endpoint saved: ${url}\n  (at ${path}). The SHAKERS_CLI_INGEST_ENDPOINT environment variable, if set, takes precedence.`,
      errInsecureRemote: 'Endpoint rejected: a host other than localhost/127.0.0.1 must use https:// (the endpoint decides where your code is sent). Use an https URL or a local host.',
      errInvalidUrl: 'Endpoint rejected: invalid URL. It must be a full http(s) URL, e.g. https://your-hub/api/v1/works/usage/reports',
      errEmpty: 'Endpoint rejected: no URL provided. Usage: usage --set-endpoint https://your-hub/api/v1/works/usage/reports',
      showEnv: (url) => `Effective ingest endpoint: ${url}\n  Source: SHAKERS_CLI_INGEST_ENDPOINT environment variable.`,
      showConfigFile: (url, path) => `Effective ingest endpoint: ${url}\n  Source: config file (${path}).`,
      showConfigInvalid: (path) => `The config file (${path}) has an invalid or insecure endpoint; it is ignored. Fix it with usage --set-endpoint <url>.`,
      showNone: 'No ingest endpoint configured. Set SHAKERS_CLI_INGEST_ENDPOINT or use usage --set-endpoint <url>. Without it, the report is still shown but not sent to Shakers.',
      // talents-ai-score, ADR-020/021: the CLI now talks to a CHAIN of two backends — PRIMARY (certifications service, above) and FALLBACK (hub-backend, here).
      showFallbackRetired: 'Note: your config.json still has `ingestEndpointFallback`. It is no longer used: the CLI talks to a single backend. You can delete that line by hand; leaving it changes nothing.',
      confirmHostPrompt: (host) => `The host "${host}" is not localhost or a known Shakers domain. If you continue, your sampled code and AI signals will be sent there.\n  Type the exact hostname to confirm (leave blank to cancel):`,
      confirmHostMismatch: "That didn't match the hostname shown. Cancelled: nothing was saved.",
      confirmHostCancelled: 'Cancelled: nothing was saved.',
    },
    backendChain: {
      saved: () => 'Saved to Shakers.',
    },
    // Why a footprint was NOT sent, in user language; null = stay silent.
    sendStatus: {
      reason: (reason) => {
        switch (reason) {
          case 'throttled':
            return 'Your report was not re-sent: you sent one less than an hour ago. It will be sent again later.';
          case 'email-unverified':
            return 'Your report was not sent to Shakers: your email is not verified yet.';
          case 'no-email':
            return 'Your report was not sent to Shakers: your email is missing.';
          case 'no-endpoint-configured':
            return 'Your report was not sent: sending to Shakers is not configured.';
          case 'network-error':
            return 'Could not send your report to Shakers (connection problem). Try again later.';
          case 'rate-limited':
          case 'service-unavailable':
            return 'Could not send your report to Shakers right now. Try again in a few minutes.';
          case 'consent-denied':
          case 'no-decision':
            return null;
          default:
            return 'Could not send your report to Shakers right now. Try again later.';
        }
      },
    },
    // Email-ownership verification (skill-code-certification / ADR-006): the OTP "wait mode" copy, shared by both binaries.
    verify: {
      sent: (email) => `We sent a verification code to ${email}.`,
      waitHint: 'Paste the code here. Press "r" then Enter to resend it, or Enter on a blank line to cancel.',
      codePrompt: 'Verification code:',
      verified: 'Email verified. Saving your report in Shakers…',
      invalidCode: 'Incorrect code. Check it and paste it again.',
      expired: 'The code has expired. Press "r" then Enter to send a new one.',
      resent: (email) => `We resent a code to ${email}.`,
      resendFailed: 'Could not resend the code. Please try again in a moment.',
      requestFailed: 'Could not send the verification code to Shakers. The report will not be saved; it has already been shown to you.',
      technicalError: 'Could not verify the email against Shakers. The report will not be saved; it has already been shown to you.',
      tooManyAttempts: 'Too many failed attempts. The email was not verified, so the report will not be saved.',
      cancelled: 'Verification cancelled. The report will not be saved (it has already been shown to you).',
      unavailable: 'Email verification is not available right now; the report will not be saved (it has already been shown to you).',
    },
    // Skill Code Certification (skill-code-certification, issues 004/006) —
    // English mirror of the `certify` catalog. Same content/invariants.
    certifyDimension: {
      help:
        'certify - certify a DIMENSION of your role. The interview is done on the web.\n\n'
        + 'Usage:\n'
        + '  certify [--lang es|en] [--dimension <key|slug|n>]\n\n'
        + 'Requires an active session (run `shakers login` first).\n'
        + 'You pick the dimension here and we hand you the link to certify it on the web.\n',
      title: 'Certify a dimension',
      loginRequired: '"certify" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      discovering: 'Looking up the dimensions you can certify…',
      discoverFailed: (reason) => `Could not fetch your dimensions (${reason}). Try again in a moment.`,
      unmatchedNote: (keys) => `Note: some dimensions have no matching template and can't be offered here (${keys}).`,
      noneOfferable: 'There are no dimensions you can certify here right now. Check back when one becomes available.',
      mainRole: (role) => `Your main role: ${role}`,
      selectHeading: 'Pick the dimension you want to certify:',
      selectHint: '↑/↓ to move, Enter to pick, Esc to cancel.',
      selectPrompt: (count) => `Type a number (1-${count}) or Enter to cancel:`,
      selectNonInteractive: 'Non-interactive mode: pass the dimension with --dimension <key|slug|n>.',
      selectNoneChosen: 'No dimension chosen.',
      stateExpired: 'expired',
      dimensionInvalid: 'That dimension is not among the certifiable ones right now.',
      dimensionUsing: (slug) => `Chosen dimension: ${slug}`,
      webHandoff: 'The certification interview is done on the web.',
      webHandoffLink: (url) => `Open it here to certify this dimension:\n  ${url}`,
      webHandoffNoLink: 'Open your Shakers profile on the web and go to Certifications to take it.',
    },
    findProjects: {
      help:
        'find-projects — list the Projects/Positions available to you on Shakers.\n\n'
        + 'Usage:\n'
        + '  find-projects [--tab all|saved] [--page N] [--limit N]\n'
        + '                [--attendance remote|hybrid|in-person] [--country ES]\n'
        + '                [--recommended] [--lang es|en] [--json]\n\n'
        + 'Requires an active session (run `shakers login` first).\n'
        + 'Ordered by match desc. Use --page to paginate; --tab saved for your bookmarks.\n'
        + '--recommended shows only the ones with a match (client-side filter of this page).\n',
      loginRequired: '"find-projects" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Available projects',
      titleSaved: 'Saved projects',
      loading: 'Looking up the projects available to you…',
      fetchFailed: (reason) => `Could not fetch the projects (${reason}). Try again in a moment.`,
      noneAvailable: 'There are no projects available to you right now. Check back later.',
      noneOnPage: 'No more projects on this page. Try a lower --page.',
      untitled: 'Untitled',
      companyRestricted: 'company withheld',
      hoursPerMonth: (n) => `${n} h/month`,
      budgetUnknown: 'budget not available',
      matchScore: (n) => `match ${n}`,
      savedBadge: 'saved',
      projectLabel: (name) => `Project: ${name}`,
      attendanceIgnored: 'Note: invalid --attendance (use remote|hybrid|in-person); filter ignored.',
      countryIgnored: 'Note: invalid --country (use a 2-letter ISO code, e.g. ES); filter ignored.',
      showing: (from, to, total) => `Showing ${from}–${to} of ${total}`,
      morePages: (next) => `--page ${next} to see more`,
      recommendedOnPage: (count) => `${count} recommended on this page`,
      recommendedNoneFallback: 'No recommended for you right now; showing the available ones.',
      done: 'Listing complete.',
    },
    showProject: {
      help:
        'show-project — show the detail of a project/position.\n\n'
        + 'Usage:\n  show-project <number|id> [--lang es|en] [--json]\n\n'
        + 'Requires an active session (run `shakers login` first).\n',
      loginRequired: '"show-project" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      idRequired: 'Missing id. Usage: show-project <number|id>.',
      refNoCache: 'No recent listing. Run shakers find-projects first and use the number shown (or pass an id).',
      refOutOfRange: (count) => `That number is not in the last listing (there are ${count}). Run shakers find-projects again.`,
      loading: 'Loading the detail…',
      fetchFailed: (reason) => `Could not fetch the detail (${reason}). Try again in a moment.`,
      notFound: 'That project/position was not found.',
      notVisible: 'That project is not available to you right now.',
      untitled: 'Untitled',
      companyRestricted: 'company withheld',
      companyLine: (name) => `Company: ${name}`,
      projectLine: (name) => `Project: ${name}`,
      hoursPerMonth: (n) => `${n} h/month`,
      budgetUnknown: 'budget not available',
      matchScore: (n) => `match ${n}`,
      skillsLine: (s) => `Skills: ${s}`,
      languagesLine: (s) => `Languages: ${s}`,
      savedBadge: 'saved',
      appliedBadge: 'already applied',
      canApplyBadge: 'you can apply',
      descriptionHeading: 'Description',
      goalsHeading: 'Goals',
      faqsHeading: 'FAQs',
      done: 'Detail complete.',
    },
    savedPositions: {
      helpSave: 'save-project — bookmark a project/position.\n\nUsage:\n  save-project <number|id> [--json]\n\nRequires an active session (shakers login).',
      helpUnsave: 'unsave-project — remove a project/position from your saved list.\n\nUsage:\n  unsave-project <number|id> [--json]\n\nRequires an active session (shakers login).',
      loginRequired: 'This command requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      saveIdRequired: 'Missing id. Usage: save-project <number|id>.',
      unsaveIdRequired: 'Missing id. Usage: unsave-project <number|id>.',
      refNoCache: 'No recent listing. Run shakers find-projects first and use the number shown (or pass an id).',
      refOutOfRange: (count) => `That number is not in the last listing (there are ${count}). Run shakers find-projects again.`,
      saving: 'Saving…',
      unsaving: 'Removing from saved…',
      notFound: 'That project/position was not found.',
      failed: (reason) => `Could not complete (${reason}). Try again.`,
      saved: 'Saved.',
      unsaved: 'Removed from your saved list.',
    },
    invitations: {
      help: 'invitations — your unread project invitations.\n\nUsage:\n  invitations [--lang es|en] [--json]\n\nRequires an active session (shakers login).',
      loginRequired: '"invitations" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your invitations',
      loading: 'Looking up your invitations…',
      fetchFailed: (reason) => `Could not fetch the invitations (${reason}). Try again.`,
      none: 'You have no unread invitations.',
      untitled: 'Unnamed project',
      hasChat: 'with chat',
      countNote: (n) => `Total: ${n}.`,
      done: 'Listing complete.',
    },
    certifications: {
      help: 'certifications — your certified, uncertified and expired dimensions.\n\nUsage:\n  certifications [--lang es|en] [--json]\n\nRequires an active session (shakers login).',
      loginRequired: '"certifications" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your certifications',
      loading: 'Loading your certifications…',
      fetchFailed: (reason) => `Could not fetch the certifications (${reason}). Try again.`,
      mainRole: (name) => `Main role: ${name}`,
      noMainRole: 'You have no main role assigned yet.',
      noDimensions: 'No dimensions for your role yet.',
      untitled: 'Dimension',
      headingCertified: 'Certified',
      headingExpired: 'Expired',
      headingUncertified: 'Uncertified',
      done: 'Listing complete.',
    },
    roles: {
      addHelp: 'add-role — add a role to your profile (a growth role).\n\nUsage:\n  add-role [--lang es|en]\n\nRequires an active session (shakers login).',
      changeHelp: 'change-role — switch your main role to one you already have.\n\nUsage:\n  change-role [--lang es|en]\n\nRequires an active session (shakers login).',
      loginRequired: 'This command requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      selectHint: 'Use ↑/↓ and Enter to choose.',
      cancelled: 'No changes.',
      loadingAvailable: 'Loading available roles…',
      loadingHeld: 'Loading your roles…',
      savingAdd: 'Adding the role…',
      savingMain: 'Saving your main role…',
      addTitle: 'Add a role',
      addPrompt: 'Which role do you want to add to your profile?',
      noneAvailable: 'You already have every available role.',
      addedOk: (name) => `Role added: ${name}.`,
      alreadyAssigned: (name) => `You already had that role: ${name}.`,
      addFailed: (reason) => `Could not add the role (${reason}). Try again.`,
      changeTitle: 'Change your main role',
      changePrompt: 'Which one do you want as your main role?',
      currentMain: (name) => `Current main role: ${name}`,
      noOtherRoles: 'You have no other roles to choose from. Add one first with: shakers add-role',
      mainRoleTitle: 'Your main role',
      mainRolePrompt: 'Choose your main role',
      mainRolePending: 'We are still preparing your roles. You can set your main role later with: shakers change-role',
      mainRoleSkipped: 'OK, we did not change your main role.',
      mainRoleUnchanged: (name) => `Your main role stays: ${name}.`,
      mainSetOk: (name) => `Main role: ${name}.`,
      setMainFailed: (reason) => `Could not set the main role (${reason}). Try again.`,
    },
    profile: {
      help: 'me (alias profile) — your summary: role, rate and your work with AI.\n\nUsage:\n  me [--lang es|en] [--json]\n\nRequires an active session (shakers login).',
      loginRequired: '"me" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your profile',
      loading: 'Loading your summary…',
      fetchFailed: (reason) => `Could not fetch your summary (${reason}). Try again.`,
      headline: (h) => `Headline: ${h}`,
      role: (name) => `Main role: ${name}`,
      freelanceType: (t) => `Work modality: ${t}`,
      completion: (pct) => `Profile completed: ${pct}%`,
      rate: (v) => `Per-project rate: ${v}`,
      rateNotSet: 'not set',
      availability: (open, hours) => `Availability: ${open} · ${hours} h/month`,
      availYes: 'open to work',
      availNo: 'not available',
      availUnknown: 'not set',
      languages: (codes) => `Languages: ${codes}`,
      skillsCount: (n) => `Skills: ${n}`,
      agentsCount: (n) => `Agents: ${n}`,
      cell: (c) => `AI fluency cell: ${c}`,
      setup: (tier, level) => `Setup: ${tier} (${level})`,
      usage: (level) => `Usage: ${level}`,
      aiNative: 'AI-native',
      visionHeading: 'Your vision on AI',
      howIWorkHeading: 'How you work with AI',
      noAiProfile: "You don't have an AI-work profile yet — it's built from your AI-usage evaluation. Run `shakers ai-usage` to generate it, then run this again.",
      done: 'Summary complete.',
    },
    applications: {
      help: 'applications — the projects you applied to and their status.\n\nUsage:\n  applications [--lang es|en] [--json]\n\nRequires an active session (shakers login).',
      loginRequired: '"applications" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your applications',
      loading: 'Looking up your applications…',
      fetchFailed: (reason) => `Could not fetch your applications (${reason}). Try again.`,
      none: 'You have not applied to any project yet.',
      untitled: 'Unnamed project',
      statusLine: (s) => `Status: ${s}`,
      statusUnknown: 'unknown',
      countNote: (n) => `Total: ${n}.`,
      done: 'Listing complete.',
    },
    availability: {
      help: 'availability — view or set your availability.\n\nUsage:\n  availability [--lang es|en] [--json]      view\n  availability --set [--lang es|en]         set (interactive, with confirmation)\n\nRequires an active session (shakers login).',
      loginRequired: '"availability" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your availability',
      loading: 'Loading your availability…',
      fetchFailed: (reason) => `Could not fetch your availability (${reason}). Try again.`,
      notFound: 'You have not set your availability yet.',
      openToWork: (v) => `Open to work: ${v}`,
      monthlyHours: (v) => `Monthly hours: ${v}`,
      workModes: (v) => `Work modes: ${v}`,
      location: (v) => `Location: ${v}`,
      expires: (v) => `Expires: ${v}`,
      yes: 'yes',
      no: 'no',
      unknown: 'not set',
      done: 'Listing complete.',
      setTitle: 'Set your availability',
      setNeedsInteractive: 'Setting availability needs an interactive terminal (not a pipe). Run it directly in your terminal.',
      askOpenToWork: 'Are you open to work?',
      askMonthlyHours: 'Monthly hours (number, e.g. 40; Enter to keep):',
      monthlyHoursInvalid: 'Invalid hours. Type only the number (e.g. 40).',
      workModesAsk: 'Which work modes do you want? (select one or more)',
      workModeLabels: { REMOTE: 'Remote', HYBRID: 'Hybrid', IN_PERSON: 'On-site' },
      workModesHint: 'Space to toggle · Enter to confirm',
      onlyRemoteNote: 'You selected Remote only: you will not see hybrid or on-site projects.',
      setDiff: (open, hours, modes) => `New: open=${open} · ${hours} h/month · work modes=${modes}`,
      setConfirm: 'This updates your profile. Confirm? (y/n):',
      setCancelled: 'Cancelled. Your availability was not changed.',
      setSaving: 'Saving your availability…',
      setFailed: (reason) => `Could not save the availability (${reason}). Try again.`,
      setDone: 'Availability updated.',
    },
    mcpInstall: {
      title: 'Connecting the Shakers MCP',
      clients: { claudeDesktop: 'Claude Desktop', claudeCode: 'Claude Code', cursor: 'Cursor', geminiCli: 'Gemini CLI', codex: 'Codex (and ChatGPT in Codex mode)', vscode: 'VS Code', windsurf: 'Windsurf' },
      status: {
        configured: 'connected',
        unchanged: 'already connected',
        'not-found': 'not installed on this machine',
        'invalid-json': 'its config is not valid JSON; left untouched',
        failed: 'could not connect',
      },
      removedLegacy: 'Replaces the old "shakers-ai-usage" entry.',
      found: (apps) => `Found: ${apps}.`,
      confirm: 'Connect Shakers to them so you can use it from your AI? [Y/n]',
      declined: 'Nothing touched. To connect it later, run the installer again.',
      noTerminal: 'There is no terminal to ask you on, so nothing was touched. Run the installer again in your terminal to connect it.',
      restart: 'Restart any of these apps that is open so it loads Shakers.',
      noneFound: 'Found no supported AI app on this machine.',
    },
    rate: {
      help: 'rate — view or set your per-project rate.\n\nUsage:\n  rate [--lang es|en] [--json]      view your rate\n  rate --set [--lang es|en]         set it (interactive, with confirmation)\n\nRequires an active session (shakers login).',
      loginRequired: '"rate" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your per-project rate',
      loading: 'Loading your rate…',
      fetchFailed: (reason) => `Could not fetch the rate (${reason}). Try again.`,
      notFound: 'You have not set your rate yet.',
      notSet: 'not set',
      fullTime: (v) => `Full-time project: ${v}`,
      partTime: (v) => `Part-time project: ${v}`,
      done: 'Listing complete.',
      setTitle: 'Set your per-project rate',
      setNeedsInteractive: 'Setting the rate needs an interactive terminal (not a pipe). Run it directly in your terminal.',
      setWhich: 'Which modality do you want to set?',
      modalityFull: 'full-time',
      modalityPart: 'part-time',
      setAmount: (label) => `Amount for ${label} (number only):`,
      setAmountInvalid: 'Invalid amount. It must be a number between 0 and 999999.99.',
      setCurrency: 'Currency:',
      setDiff: (label, oldV, newV) => `${label}: ${oldV} → ${newV}`,
      setConfirm: 'This changes your price. Confirm? (y/n):',
      setCancelled: 'Cancelled. Your rate was not changed.',
      setSaving: 'Saving your rate…',
      setFailed: (reason) => `Could not save the rate (${reason}). Try again.`,
      setDone: (label, newV) => `${label} rate updated: ${newV}.`,
    },
    lang: {
      help: 'lang — view or set your languages and level.\n\nUsage:\n  lang [--lang es|en] [--json]      view\n  lang --set [--lang es|en]         add/update (interactive, with confirmation)\n\nRequires an active session (shakers login).',
      loginRequired: '"lang" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your languages',
      loading: 'Loading your languages…',
      loadingCatalog: 'Loading the language catalog…',
      fetchFailed: (reason) => `Could not fetch your languages (${reason}). Try again.`,
      catalogFailed: (reason) => `Could not load the language catalog (${reason}). Try again.`,
      none: 'You have not added any languages yet.',
      line: (name, level) => `${name}: ${level}`,
      unknownLang: 'language',
      unknownLevel: 'no level',
      levelLabel: (v) => ({ NATIVE: 'native', ADVANCED: 'advanced', INTERMEDIATE: 'intermediate', INTERMEDIATE_WRITTEN: 'intermediate (written)' }[v] || v),
      done: 'Listing complete.',
      setTitle: 'Set a language',
      setNeedsInteractive: 'Setting languages needs an interactive terminal (not a pipe). Run it directly in your terminal.',
      pickLanguage: 'Pick the language:',
      pickLevel: 'Pick the level:',
      setDiff: (name, level) => `New: ${name} → ${level}`,
      setConfirm: 'This updates your languages. Confirm? (y/n):',
      setCancelled: 'Cancelled. Your languages were not changed.',
      setSaving: 'Saving your languages…',
      setFailed: (reason) => `Could not save the languages (${reason}). Try again.`,
      setDone: (name) => `Language updated: ${name}.`,
    },
    socials: {
      help: 'socials — view or set your social links.\n\nUsage:\n  socials [--lang es|en] [--json]      view\n  socials --set [--lang es|en]         add/update/remove (interactive, with confirmation)\n\nRequires an active session (shakers login).',
      loginRequired: '"socials" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your social links',
      loading: 'Loading your links…',
      fetchFailed: (reason) => `Could not fetch your links (${reason}). Try again.`,
      none: 'You have not added any social links yet.',
      line: (label, url) => `${label}: ${url}`,
      networkLabel: (k) => ({ linkedin: 'LinkedIn', github: 'GitHub', website: 'Website', twitter: 'Twitter/X', instagram: 'Instagram', facebook: 'Facebook', dribbble: 'Dribbble', behance: 'Behance' }[k] || k),
      done: 'Listing complete.',
      setTitle: 'Set a social link',
      setNeedsInteractive: 'Setting links needs an interactive terminal (not a pipe). Run it directly in your terminal.',
      pickNetwork: 'Pick the network:',
      askUrl: (label) => `${label} URL (empty to remove it):`,
      setDiffSet: (label, url) => `New: ${label} → ${url}`,
      setDiffClear: (label) => `Remove: ${label}`,
      setConfirm: 'This updates your links. Confirm? (y/n):',
      setCancelled: 'Cancelled. Your links were not changed.',
      setSaving: 'Saving your links…',
      setFailed: (reason) => `Could not save the links (${reason}). Try again.`,
      setDone: (label) => `${label} updated.`,
      setCleared: (label) => `${label} removed.`,
    },
    experiences: {
      help: 'experiences — your work experiences (read-only).\n\nUsage:\n  experiences [--lang es|en] [--json]\n\nRequires an active session (shakers login).',
      loginRequired: '"experiences" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your experiences',
      loading: 'Loading your experiences…',
      fetchFailed: (reason) => `Could not fetch your experiences (${reason}). Try again.`,
      none: 'You have not added any experiences yet.',
      untitled: 'Untitled',
      current: 'present',
      datesLabel: (r) => `Dates: ${r}`,
      locationLabel: (l) => `Location: ${l}`,
      skillsLabel: (s) => `Skills: ${s}`,
      countNote: (n) => `Total: ${n}.`,
      done: 'Listing complete.',
    },
    portfolios: {
      help: 'portfolios — your portfolio pieces (read-only).\n\nUsage:\n  portfolios [--lang es|en] [--json]\n\nRequires an active session (shakers login).',
      loginRequired: '"portfolios" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
      title: 'Your portfolio',
      loading: 'Loading your portfolio…',
      fetchFailed: (reason) => `Could not fetch your portfolio (${reason}). Try again.`,
      none: 'You have not added any portfolio pieces yet.',
      untitled: 'Untitled',
      current: 'ongoing',
      datesLabel: (r) => `Dates: ${r}`,
      locationLabel: (l) => `Location: ${l}`,
      skillsLabel: (s) => `Skills: ${s}`,
      countNote: (n) => `Total: ${n}.`,
      done: 'Listing complete.',
    },
    alma: {
      help: 'alma — interactive mini-shell to converse with Alma, your Shakers AI assistant.\n\nUsage:\n  alma                  open the conversation (type line by line; "exit" to quit)\n  alma --lang es|en\n\nRequires an active session (shakers login). The conversation keeps its context across turns.',
      loginRequired: '`alma` needs an active session. Sign in:  shakers login',
      needTty: '`alma` is interactive and needs a terminal.',
      title: 'Alma',
      tagline: 'your Shakers AI assistant',
      replHint: 'Type your message and press Enter. Type "exit" (or Enter on an empty line) to quit.',
      prompt: 'you:',
      contextLabel: 'Reading your project…',
      contextConsentHeader: 'Alma can use a (code-free) map of this project to answer better. Share it?',
      contextConsentHint: 'Structure only: name, services, agents, technologies. Never your code.',
      contextConsentYes: 'Yes, share the project context',
      contextConsentNo: 'No, chat without context',
      contextConsentDeclined: 'OK, I will talk to Alma without the project context.',
      thinking: 'Alma is thinking…',
      bye: 'See you soon.',
      confirmPrompt: 'Confirm this action?',
      confirmYes: 'Yes, go ahead',
      confirmNo: 'No, cancel',
      irreversible: '⚠ This action is irreversible.',
      webLink: (to) => `On the web this would open: ${to}`,
      failed: (reason) => `Could not reach Alma (${reason}). Try again in a moment.`,
    },
    certify: {
      disclaimer:
        'LEGAL DISCLAIMER — read before continuing:\n'
        + '  certify sends data about your project to Shakers to certify your TECHNICAL\n'
        + '  Skills (the ones in your catalog, from your code). It does NOT assess how you\n'
        + '  orchestrate agents.\n'
        + '  In this phase (resolve) it sends your email and the NAMES of the detected\n'
        + '  technologies; the later certification phase will send code snippets.\n'
        + '  You are SOLELY responsible for ensuring you own, or are authorized to analyze,\n'
        + "  this project's code. Shakers assumes no liability for the code you submit.\n"
        + '  Submitting code that is not yours or that you are not authorized to analyze is\n'
        + '  a misuse of these tools and may result in penalties on your Shakers account, up\n'
        + '  to and including suspension. Do NOT use this tool on a third party\'s code\n'
        + '  (e.g. a client under NDA). Skill scores are indicative and unverified, not an\n'
        + '  official qualification.',
      disclaimerQuestion: 'Do you accept and continue? (y/n):',
      disclaimerAcceptedFlag: 'Disclaimer accepted via --accept-disclaimer.',
      disclaimerNonInteractive:
        'Non-interactive input and no --accept-disclaimer: cannot obtain explicit '
        + 'acceptance. Aborting (nothing was sent).',
      disclaimerDeclined: 'You did not accept the disclaimer. Nothing was sent.',
      disclaimerInvalidAnswer: 'Answer not recognized. Reply "y" (yes) or "n" (no).',
      disclaimerNoAnswer: 'No answer obtained. Nothing was sent.',
      report: {
        heading: 'TECHNICAL Skill certification result',
        noInterviewNote: 'Preliminary, no interview: this Skill\'s combined certification requires completing its interview.',
        disclaimer:
          'Note: the level is determined from an anchored rubric with a fixed formula, so the '
          + 'aggregation is deterministic — the same per-dimension judgments always yield the '
          + 'same level. Only the model’s per-criterion judgments may vary slightly between '
          + 'runs. It is an indicative assessment, not an official Client-facing certification.',
        partialSampleWarning:
          'Partial sample: due to size limits the assessment is based on a sample of the code, '
          + 'not the whole project.',
        // ADR-016 skill levels (by decision power, NOT points) — replace the
        // numeric grade in the skill output. `key` from skillLevelForScore.
        levelLine: (label) => `Level: ${label}`,
        skillLevels: {
          middle: 'Middle',
          senior: 'Senior',
          expert: 'Expert',
          na: '—',
        },
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
        htmlTitle: 'Technical Skill Certification · Shakers',
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
    // Branded mini-shell chrome (skill-code-certification / ADR-014).
    login: {
      intro: 'Log in with your Shakers email and password.',
      sessionExpiredIntro: 'Your previous session expired. Log in again with your email and password.',
      alreadyLoggedIn: 'You are already logged in. Use `logout` if you want to switch accounts.',
      emailPrompt: 'Email:',
      passwordPrompt: 'Password:',
      emailInvalid: 'Invalid email. Try again.',
      needInput: 'Email and password are required to log in.',
      success: 'Logged in. Your report no longer includes the roadmap or the improvement suggestions: your level comes from certifying.',
      expiresAt: (iso) => `The session expires: ${iso}. When it does I will tell you, and you can log in again with \`login\`.`,
      loggedOut: 'Logged out. You are back to the full report, with roadmap and suggestions.',
      notLoggedIn: 'No session was active. Nothing to log out of.',
      errorInvalidCredentials: 'Wrong credentials: check your email and password and try again.',
      errorNoEmailPassword: 'This account exists but has no email password: you registered with Google or LinkedIn. If it was Google, use `login --google`. If it was LinkedIn, sign in on the web to add a password for now.',
      errorUpstream: "Shakers' identity server is not responding right now. It is not your password; try again in a while.",
      errorUnreachable: 'Could not reach Shakers. Check your connection and run `login` again.',
      errorConfig: 'The server address is invalid. Check the endpoint configuration (`usage --show-endpoint`).',
      errorNoEndpoint: 'No endpoint configured. login uses the same base as usage: set SHAKERS_CLI_INGEST_ENDPOINT or use `usage --set-endpoint <url>`.',
      errorPersist: 'Login succeeded, but the session could not be saved to disk. Check the permissions of ~/.config/shakers and try again.',
      errorGeneric: 'Could not log in. Try again.',
      // ADR-046 — Google login by loopback (`login --google`).
      googleIntro: 'Log in with Google. Your browser will open to authorize; when you are done, come back here.',
      googleOpening: 'Opening your browser to log in with Google…',
      googlePasteUrl: 'If your browser does not open on its own, paste this URL into it:',
      googleWaiting: 'Waiting for you to finish signing in in the browser…',
      googleErrorConfigFailed: "Could not fetch the Google login configuration from Shakers. Check your connection and the endpoint (`usage --show-endpoint`) and try again.",
      googleErrorConfigInvalid: 'The Google configuration Shakers returned is incomplete. This is a server-side problem, not yours; try again later.',
      googleErrorPortInUse: 'The local port the Google login uses is busy with another process. Close it and run `login --google` again.',
      googleErrorTimeout: 'Timed out waiting for you to finish signing in in the browser. Run `login --google` again when you are ready.',
      googleErrorState: 'The browser response did not match what was expected (possible interference). For safety no session was started; try again.',
      googleErrorDenied: 'You cancelled access in Google (or it was not granted). No session was started.',
      googleErrorGeneric: 'Could not log in with Google. Try again.',
      // Google via device flow (RFC 8628): the Hub owns Google config; you open a URL and type a code.
      deviceIntro: (name) => `Sign in with ${name}. Open the link below and enter the code to authorize; then come back here.`,
      deviceVisit: 'Open this page in your browser:',
      deviceCodeLabel: (code) => `and enter this code: ${code}`,
      deviceWaiting: 'Waiting for you to authorize in the browser…',
      deviceErrorExpired: 'The Google sign-in request expired before it was authorized. Run `login --google` again when you are ready.',
      deviceErrorDenied: 'The Google sign-in was cancelled or not granted. No session was started.',
      deviceErrorGeneric: 'Could not sign in with Google. Try again.',
      // Interactive method picker (`login` with no --email/--google/--provider): reuses the SAME single-select picker `certify agents` uses to choose an agent (src/interactive-select.js).
      chooseMethodHeading: 'How do you want to log in?',
      methodEmail: 'Email and password',
      methodGoogle: 'Google',
      methodLinkedin: 'LinkedIn',
      selectHint: 'Arrows ↑/↓ to move · enter to pick · esc to cancel',
      chooseMethodPrompt: (max) => `Number (1-${max}), empty to cancel: `,
    },
    // `start` (talents-ai-score, ADR-054/055): the tool for a talent ALREADY registered in Shakers who wants to complete their agentic profile.
    start: {
      help:
        'start — complete your agentic talent profile in Shakers: log in, run the AI-usage\n'
        + "evaluation if you haven't already, and from a single menu add or certify skills and agents.\n\n"
        + 'Usage:\n'
        + '  start [options]\n\n'
        + 'Options:\n'
        + '      --root DIR     Analyze DIR instead of the current directory\n'
        + '      --lang es|en   Force the output language\n'
        + '  -h, --help         Show this help (does not log in, does not scan anything)\n\n'
        + 'Requires an active login session (or it will ask you to log in): the same Shakers\n'
        + 'credentials `login` uses. If this is the first time you run the tool in this project, the\n'
        + 'AI-usage evaluation (`usage`) runs automatically before the menu is shown.',
      intro:
        "Let's get started: we'll confirm your session, and if this is the first run for this project, we'll generate your AI-usage evaluation before showing the menu.",
      alreadyLoggedIn: (email) => `You are already logged in${email ? ` as ${email}` : ''}.`,
      loginCancelled: 'No session was started, so we cannot continue. Run `start` again whenever you want to log in.',
      runningUsageFirst:
        "You don't have an AI-usage report for this project yet — it's the foundation of your agentic profile. We'll generate it first.",
      menuHeading: 'What do you want to do?',
      menuHint: 'Arrows ↑/↓ to move · enter to pick · esc to cancel',
      menuPrompt: (max) => `Number (1-${max}), empty to cancel: `,
      menuRerun: 'Run the AI-usage evaluation again',
      // dueño (2026-08-12): renamed — the label said "Add" but the action is declaring/uploading what was DETECTED to the Shakers profile, not creating something new from scratch.
      menuAddSkills: 'Upload skills to profile',
      menuAddAgents: 'Upload agents to profile',
      // talents-ai-score, ADR-059: "Add project to portfolio" — grouped with skills/agents, before certifying (declare things on your profile, then certify them).
      menuAddPortfolio: 'Add project to portfolio',
      menuCertifySkills: 'Certify skills',
      menuCertifyAgents: 'Certify agents',
      menuExit: 'Exit',
      menuExitDesc: 'Ends this `start` session. Run it again whenever you want to keep completing your profile.',
      // Per-option descriptions (dueño, 2026-08-11): shown ONLY for the HIGHLIGHTED item in the interactive picker (or compactly in the numbered fallback) — never all at once.
      menuRerunDesc:
        'Re-scans your AI setup and recomputes your AI fluency. You get your updated position on the map (Explorer → AI Native) on your profile.',
      menuAddSkillsDesc:
        "Detects your project's technologies and declares the ones you don't have yet. You get more skills on your profile (declared, unverified) → you show up in more searches.",
      menuAddAgentsDesc:
        "Detects the AI agents you've built and declares them on your profile. AI pre-drafts what it does and what you decide; you edit before saving. You get your agents as assets of your agentic profile.",
      menuAddPortfolioDesc:
        "Adds this project to your Shakers portfolio: title, type, description and skills, most of it pre-filled from your code and your git history. You get one more piece of your work visible on your profile.",
      menuCertifySkillsDesc:
        'A challenge on your own code validates your real level in a skill. You get the skill certified at Middle/Senior/Expert → credibility and more weight in matching.',
      menuCertifyAgentsDesc:
        'A challenge validates the agent is real, is yours, and you run it with judgment. You get the agent Certified with its traction → the strongest signal of your agentic profile.',
      menuCancelled: 'Cancelled. Nothing was done.',
      // dueño (2026-08-12): closes the menu LOOP — used both when "Exit" is explicitly chosen and when cancelling (esc / empty answer) FROM INSIDE the loop.
      menuGoodbye: '`start` session ended. Run `start` again whenever you want to keep completing your profile.',
      addAgentsComingSoon:
        "Add agents: coming soon. Your agents will become assets of your agentic profile — that record doesn't exist in Shakers yet, so there's nowhere to save them for now.",
      addSkillsNoTechnologies:
        'No technology was recognized in this project (package.json, requirements.txt, go.mod…). No skills to add from here.',
      addSkillsErrorNoEndpoint:
        'No endpoint configured. `start` uses the same base as `usage`: set the endpoint with `usage --set-endpoint <url>` (or SHAKERS_CLI_INGEST_ENDPOINT).',
      addSkillsResolveErrorIntro: 'Could not read your AI-usage inventory (if you have not run `shakers ai-usage` yet, do that first):',
      addSkillsNoneMatched:
        "This step needs your AI-usage evaluation first — it's what discovers the skills in your setup. Run `shakers ai-usage`, then run this command again to add them to your profile.",
      addSkillsNoHubToken:
        'Your session is missing the permission needed to add skills to your profile. Run `login` again and try once more.',
      addSkillsSelectHeading: 'Detected skills not yet in your profile (pick one or several):',
      addSkillsSelectHint: 'Arrows ↑/↓ · space to mark · "a" to mark all · enter to confirm · esc to cancel',
      addSkillsSelectPrompt: (max) => `Comma-separated numbers (1-${max}), empty to cancel: `,
      addSkillsNoneChosen: 'No skill was chosen. Nothing was added to your profile.',
      addSkillsDeclaredOne: (skillName) => `✓ Added to your profile: ${skillName} (unverified).`,
      addSkillsDeclareFailed: (skillName, reason) => `✗ Could not add ${skillName}: ${reason}`,
      // Vision close (dueño, 2026-08-11): ONCE, after the batch — not repeated per skill (issue 106/097's lesson: the same line repeated per item is noise, not reinforcement).
      addSkillsProfileBoost: 'Every skill you add counts toward your profile: you show up in more searches.',
      addSkillsHubSessionExpired: 'Your Shakers session expired while we were adding your skills.',
      addSkillsOfferRelogin: 'Do you want to log in again now to continue? (y/n):',
      addSkillsRelaunchAfterRelogin: 'Session renewed. Retrying the skills that were still pending.',
      addSkillsRelaunchDeclined: 'OK. Run `login` and pick "Add skills" again whenever you want.',
      addSkillsReloginFailed: 'Could not log in again. The pending skills were not added.',
      addSkillsRelateNoPortfolios: "You don't have any portfolio projects yet, so the skills were added without a relation. Add one with \"Add project to portfolio\" and relate them later.",
      addSkillsRelateAsk: (skillName) => `Do you want to relate "${skillName}" to an experience in your profile? (y/n):`,
      addSkillsRelateSelectHeading: (skillName) => `Relate "${skillName}" to one or more experiences:`,
      addSkillsRelateSelectHint: 'Arrows ↑/↓ · space to mark · "a" to mark all · enter to confirm · esc to cancel',
      addSkillsRelateSelectPrompt: (max) => `Comma-separated numbers (1-${max}), empty to skip: `,
      addSkillsRelateSkipped: (skillName) => `"${skillName}" added without a relation.`,
      addSkillsRelated: (skillName, portfolioName) => `  ✓ "${skillName}" related to "${portfolioName}".`,
      addSkillsRelateFailed: (skillName, portfolioName, reason) => `  ✗ Could not relate "${skillName}" to "${portfolioName}": ${reason}`,
      // talents-ai-score, ADR-059: "Add project to portfolio".
      portfolioIntro:
        "Let's add this project to your Shakers portfolio. Most of the data is pre-filled from your code and your git history: confirm or edit each one.",
      portfolioErrorNoEndpoint:
        'No endpoint configured. `start` uses the same base as `usage`: set the endpoint with `usage --set-endpoint <url>` (or SHAKERS_CLI_INGEST_ENDPOINT).',
      portfolioNoHubToken:
        'Your session is missing the permission needed to add projects to your portfolio. Run `login` again and try once more.',
      portfolioDedupCheckingLabel: 'Checking your portfolio…',
      portfolioDedupCheckFailed: (reason) => `Could not check whether you already have a project with that name in your portfolio: ${reason} Continuing, but you might end up with a duplicate.`,
      portfolioDuplicateName: (name) => `You already have a project named "${name}" in your portfolio. No duplicate was created — run this option again with a different title if you want to add a distinct one.`,
      // (1) Title ← directory name, editable.
      portfolioTitlePrompt: (def) => `Project title [${def}]:`,
      // (2) Type ← PORTFOLIO/EXPERIENCE, obligatorio. Vision copy (dueño):
      // what each type means for your profile, shown ONLY on highlight.
      portfolioTypeHeading: 'What type of entry is this?',
      portfolioTypeHint: 'Arrows ↑/↓ to move · enter to pick · esc to cancel',
      portfolioTypePrompt: (max) => `Number (1-${max}): `,
      portfolioTypePortfolio: 'Portfolio',
      portfolioTypePortfolioDesc:
        'Adds it to your profile as a portfolio piece: a sample of your work that anyone reviewing your profile can see.',
      portfolioTypeExperience: 'Experience',
      portfolioTypeExperienceDesc:
        "Adds it to your profile as professional experience (freelance or in-house): counts toward your track record, not as a piece to show.",
      // (3) Description ← AI pre-drafts after consent (ADR-052/059).
      portfolioDescriptionConsentDisclaimer:
        'To draft a description with AI, this will send to Shakers: the project name, the detected technologies, and — if present — the README content and the package.json description.',
      portfolioDescriptionDraftLabel: 'AI-drafted description:',
      portfolioDescriptionDraftingLabel: 'Drafting a description with AI…',
      // Editable; or free-text if you decline, if it fails, or if there's no
      // endpoint.
      portfolioDescriptionEditPrompt: 'Description (edit it or press enter to keep the draft above):',
      portfolioDescriptionFreeTextPrompt: 'Description (optional, press enter to leave it blank):',
      // (4) URL ← the repo's git remote, editable.
      portfolioUrlPrompt: (def) => (def ? `Repository URL [${def}]:` : 'Repository URL (optional, none detected):'),
      // (5) Skills ← multi-select of the detected technologies, PRE-MARKED (you can remove, not add — these are the ones already resolved to a skill in your catalog).
      portfolioSkillsResolvingLabel: "Looking up this project's skills…",
      portfolioSkillsSelectHeading: "Skills for this project — added to your profile and shown on the piece (pre-marked; remove the ones that don't apply):",
      portfolioSkillsSelectHint: 'Arrows ↑/↓ · space to mark/unmark · "a" to mark/unmark all · enter to confirm · esc to cancel',
      portfolioSkillsSelectPrompt: (max) => `Comma-separated numbers (1-${max}) to change the selection, empty to keep all marked: `,
      portfolioSkillsSelectInvalid: "That answer wasn't understood. All skills stay marked.",
      // (6) Client ← optional, for freelance work.
      portfolioClientPrompt: 'Client (optional, for freelance work; press enter to leave it blank):',
      portfolioClientWebsitePrompt: 'Client website (optional, e.g. acme.com; used for its logo; press enter to skip):',
      portfolioCancelled: 'Cancelled. Nothing was added to your portfolio.',
      portfolioDeclaring: 'Adding the project to your portfolio…',
      portfolioDeclaredSuccess: (name) => `✓ "${name}" added to your portfolio.`,
      portfolioDeclareFailed: (reason) => `✗ Could not add the project to your portfolio: ${reason}`,
      portfolioHubSessionExpired: 'Your Shakers session expired while we were adding the project to your portfolio.',
      portfolioOfferRelogin: 'Do you want to log in again now to continue? (y/n):',
      portfolioRelaunchAfterRelogin: 'Session renewed. Retrying adding the project to your portfolio.',
      portfolioRelaunchDeclined: 'OK. Run `login` and pick "Add project to portfolio" again whenever you want.',
      portfolioReloginFailed: 'Could not log in again. The project was not added to your portfolio.',
      // talents-ai-score Phase 2: "Add agent to profile". Same model as the
      // portfolio (ADR-059): AI pre-drafts, the talent edits.
      agentErrorNoEndpoint:
        'No endpoint configured. `start` uses the same base as `usage`: set the endpoint with `usage --set-endpoint <url>` (or SHAKERS_CLI_INGEST_ENDPOINT).',
      agentNoHubToken:
        'Your session is missing the permission needed to add agents to your profile. Run `login` again and try once more.',
      agentNoAgentsDetected:
        "This step needs your AI-usage evaluation first — it's what discovers the AI agents in your setup. Run `shakers ai-usage`, then run this command again to add them to your profile.",
      agentInventoryError: (reason) => `Could not read your AI-usage inventory: ${reason}. If you have not run it yet, run \`shakers ai-usage\` first; otherwise check your connection and try again.`,
      agentDedupCheckingLabel: 'Checking your agents…',
      agentDedupCheckFailed: (reason) => `Could not check whether you already have an agent with that name on your profile: ${reason} Continuing, but you might end up with a duplicate.`,
      agentDuplicateName: (name) => `You already have an agent named "${name}" on your profile. No duplicate was created — run this option again with a different name if you want to add a distinct one.`,
      agentAlreadyAdded: (name) => `You already have the agent "${name}" on your profile; you can relate it to your experiences.`,
      agentIntro:
        "Let's add one of your agents to your Shakers profile. Pick the agent; AI pre-drafts what it does and what you decide, and you edit before saving.",
      // (1) Pick a detected agent.
      agentPickHeading: 'Which agent do you want to add to your profile?',
      agentPickHint: 'Arrows ↑/↓ to move · enter to pick · esc to cancel',
      agentPickPrompt: (max) => `Number (1-${max}): `,
      agentCancelled: 'Cancelled. No agent was added to your profile.',
      // (3) Name ← detected, editable.
      agentNamePrompt: (def) => `Agent name [${def}]:`,
      // (4) whatItDoes + humanDecides ← AI pre-drafts after consent (ADR-052).
      agentFieldsConsentDisclaimer:
        "To draft what your agent does and what you decide with AI, this will send to Shakers: the agent name, its detected tools/model/parent, and a summary of its definition (its own instructions).",
      agentDraftingLabel: 'Drafting with AI…',
      agentWhatItDoesDraftLabel: 'What it does — AI-generated draft:',
      agentWhatItDoesEditPrompt: 'What it does (edit it or press enter to keep the draft above):',
      agentWhatItDoesFreeTextPrompt: 'What your agent does (optional, press enter to leave it blank):',
      agentHumanDecidesDraftLabel: 'What you do around the agent (supervision/validation) — AI-generated draft:',
      agentHumanDecidesEditPrompt: 'What you do around the agent (edit it or press enter to keep the draft above):',
      agentHumanDecidesFreeTextPrompt: 'What you do around the agent / how you supervise it (optional, press enter to leave it blank):',
      // catalogId ← included if a prior `usage` matched the agent to the catalog.
      agentCatalogMatched: (role) => `We matched it to the Shakers agent catalog as: ${role}.`,
      agentDeclaring: 'Adding the agent to your profile…',
      agentDeclaredSuccess: (name) => `✓ "${name}" added to your profile.`,
      agentDeclareFailed: (reason) => `✗ Could not add the agent to your profile: ${reason}`,
      agentHubSessionExpired: 'Your Shakers session expired while we were adding the agent to your profile.',
      // ADR-041: AFTER the agent is declared, offer to relate it to the experiences/projects the talent already declared (portfolioId only).
      agentRelateNoPortfolios: "You don't have any experiences in your profile yet, so the agent was added without a relation. Add one with \"Add project to portfolio\" and relate it later.",
      agentRelateAsk: (agentName) => `Do you want to relate "${agentName}" to any of your experiences? (y/n):`,
      agentRelateSelectHeading: (agentName) => `Relate "${agentName}" to one or more experiences:`,
      agentRelateSkipped: (agentName) => `"${agentName}" added without a relation.`,
      agentRelated: (agentName, portfolioName) => `✓ "${agentName}" related to "${portfolioName}".`,
      agentRelateFailed: (agentName, reason) => `✗ Could not relate "${agentName}" to your experiences: ${reason}`,
      portfolioAddSkillsResolvingLabel: 'Looking up other skills for your profile…',
      portfolioAddSkillsIntro:
        "We also detected other skills in this project that aren't in your Shakers profile yet (besides the ones you just linked to the portfolio).",
      portfolioAddSkillsAllAlreadyDeclared: "All this project's skills are already on your profile.",
      portfolioAddSkillsHeading: "Skills for your profile (pre-marked; remove the ones that don't apply):",
      portfolioAddSkillsHint: 'Arrows ↑/↓ · space to mark/unmark · "a" to mark/unmark all · enter to confirm · esc to cancel',
      portfolioAddSkillsPrompt: (max) => `Comma-separated numbers (1-${max}) to change the selection, empty to keep all marked: `,
      portfolioAddSkillsInvalid: "That answer wasn't understood. All skills stay marked.",
      errorReason: {
        'no-endpoint': 'no endpoint configured.',
        'no-hub-token': 'your session is missing the hub permission needed; run `login` again.',
        'hub-session-expired': 'your hub session expired.',
        'network-error': 'network error.',
        timeout: 'the request timed out.',
        'invalid-url': 'the endpoint URL is invalid.',
        'bad-response': "the server's response could not be parsed.",
        generic: 'could not complete the operation.',
      },
      errorReasonHttp: (status) => `the server answered with an error (HTTP ${status}).`,
    },
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
        'Run:  certify --email <anyone> --accept-disclaimer --skill <name>   ·   To end it:  superadmin --logout',
      loggedOut: 'Superadmin session forgotten (local token removed).',
      // talents-ai-score, "profile switch via superadmin" (dueño, 2026-08-12): a dev/testing convenience — flips between the talent/ external profile without reinstalling.
      profileMenuHeading: 'What do you want to do?',
      profileMenuHint: 'Arrows ↑/↓ to move · enter to pick · esc to cancel',
      profileMenuPrompt: (max) => `Number (1-${max}), empty to cancel: `,
      profileMenuTalent: 'Switch to Talent profile',
      profileMenuTalentCurrent: 'Switch to Talent profile 《current》',
      profileMenuTalentDesc:
        'Full surface: start, login, certify (skills and agents), add skills/portfolio. Purges local history (report, consent, talent session) and takes effect IMMEDIATELY in this same session, no restart needed.',
      profileMenuExternal: 'Switch to External profile',
      profileMenuExternalCurrent: 'Switch to External profile 《current》',
      profileMenuExternalDesc:
        'Pre-pivot public surface: usage, report, share. Purges local history (report, consent, talent session) and takes effect IMMEDIATELY in this same session, no restart needed.',
      profileMenuCancelled: 'Cancelled. Nothing was changed.',
      profileAlreadyOn: (profile) => `You are already on the ${profile === 'talent' ? 'Talent' : 'External'} profile. Nothing was changed or purged.`,
      profileSwitched: (profile) => `Profile switched to ${profile === 'talent' ? 'Talent' : 'External'} · history cleared (report, consent, talent session) · takes effect immediately, no restart needed.`,
      // talents-ai-score, ADR-020/021 (coordinator ruling): superadmin is DELIBERATELY single-hop, PRIMARY (certifications service) ONLY — never hub.
      queryingPrimary: (endpoint) => `Querying Shakers: ${endpoint}`,
      errorNoEndpoint:
        'No endpoint configured. Set the backend (SHAKERS_CLI_INGEST_ENDPOINT or usage --set-endpoint) and retry.',
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
    // `shakers` REPL is the single entrypoint; this covers the prompt, the in-shell command help and messages — the commands keep their own copy.
    repl: {
      prompt: 'ϟ shakers ›',
      // dueño (2026-08-12): the startup BANNER (src/repl-shell.js) is now profile-aware and localized.
      bannerWelcome: 'Welcome to',
      bannerTalentLine1: 'Complete or update your agentic talent',
      bannerTalentLine2: "profile on Shakers: it's not just what you know,",
      bannerTalentLine3: "it's how you work with AI and the agents you build.",
      bannerHowItWorksHeading: 'How it works',
      bannerTalentStep1Line1: '1. `start` analyzes your project locally and',
      bannerTalentStep1Line2: '   detects your AI setup, skills, and agents.',
      bannerTalentStep2Line1: '2. You add or certify your skills and agents',
      bannerTalentStep2Line2: '   on your Shakers profile.',
      bannerTalentStep3Line1: '3. A more complete profile positions you for',
      bannerTalentStep3Line2: '   the projects that value it.',
      // EXTERNAL: same style as always (title + command list) — ONLY localized (the parity pass).
      bannerExternalLine1: 'A local-first CLI that scans this machine for AI',
      bannerExternalLine2: 'tooling and shows you a private, local usage report.',
      bannerCommandsHeading: 'Commands',
      bannerExternalUsageDesc: 'scan this machine + project',
      bannerExternalMapDesc: 'LOCAL report (graph)',
      bannerExternalReportDesc: 'shareable HTML report',
      bannerExternalShareDesc: 'card for LinkedIn',
      // COMMAND FLOW (issues 081 and 082) VOCABULARY, inherited by issue 083: this is about the tool's COMMANDS.
      completeNeeds: (cmd) => `(needs: ${cmd})`,
      completeDone: '(already run)',
      completeDoneStale: (days) => `(already run, ${days} days ago)`,
      completeAlias: (cmd) => `(alias of ${cmd})`,
      // `certify`'s subcommands, carrying the issue-085 qualification: this is
      // where the Talent chooses, so this is where it cannot stay ambiguous.
      completeSubSkills: 'TECHNICAL Skills, from your code',
      completeSubAgents: 'command of ONE agent',
      flowHeading: 'What order to use the tool in',
      flowIntro: 'The commands build on each other. This is the recommended order, and if you skip a dependency I tell you before anything runs.',
      flowStepFree: (n, cmd, what) => `${n}. ${cmd} — ${what}`,
      flowStepNeeds: (n, cmd, what, needs) => `${n}. ${cmd} — ${what} (needs: ${needs})`,
      flowWhat: {
        usage: 'scans your environment and scores your AI setup. It is the root of everything else, and it also leaves your identity verified',
        certify: 'certify a dimension of your role with a LiveKit interview',
        report: 'builds the shareable report (AI usage + certifications)',
        share: 'creates the branded card for LinkedIn',
      },
      blockedHeading: (cmd) => `\`${cmd}\` cannot run yet.`,
      blockedWhyFootprint: (cmd) => `It is missing this project\u2019s AI usage: \`${cmd}\` is built from what the scan detected, so with no scan there is nothing to build from.`,
      blockedWhyIdentity: (cmd) => `It is missing your verified identity: \`${cmd}\` opens a session with the service in your name, and without a verified email the service refuses it.`,
      blockedFix: (fix) => `Run \`${fix}\` and try again.`,
      blockedNoBypass: 'There is no way to skip this check: the command would fail seconds later anyway, only without an explanation.',
      staleFootprint: (days) => `This project\u2019s AI usage is ${days} days old. If your tools or agents have changed, run \`usage\` again before sharing anything.`,
      nextCommand: (cmd, what) => `Next tool command: \`${cmd}\` — ${what}`,
      journeyDone: 'You have completed the tool\u2019s flow: there is no command left to run. The next steps for raising your AI-usage level are a different thing, and they live in `usage --roadmap`.',
      goodbye: 'See you soon.',
      unknown: (cmd) => `Unknown command: "${cmd}". Type "help" to list the available commands.`,
      // ORDER: declared by src/command-graph.js (issue 081).
      help:
        'Shakers — available commands\n\n'
        + '  usage     [options]   Scan this project + your machine; score your AI setup (T0-T7)\n'
        + '  certify   [options]   Certify a dimension of your role (LiveKit interview)\n'
        + '  report    [options]   Build and open the shareable report (AI usage + certified Skills)\n'
        + '                        Needs a `usage` for this project\n'
        + '  share     [options]   Build a branded card of your AI usage to share on LinkedIn\n'
        + '                        Needs a `usage` for this project\n'
        + '  login                 Log in as a registered talent (email + password)\n'
        + '  logout                Log out\n'
        + '  help                  Show this help\n'
        + '  clear                 Clear the screen\n'
        + '  exit | quit           Close the shell\n\n'
        + 'Each command\'s flags still work inside the shell\n'
        + '(e.g. `usage --root <dir>`, `usage --roadmap`, `certify --dimension <clave>`). Use\n'
        + '`usage --help` or `certify --help` for all their options.',
      helpExternal:
        'shakers — available commands\n\n'
        + '  usage     [options]   Scan this project + your machine; build a LOCAL report of your AI setup\n'
        + '  report    [options]   Open the shareable HTML report for this project in your browser\n'
        + '                        Needs a `usage` for this project\n'
        + '  share     [options]   Build a branded card of your AI usage to share on LinkedIn\n'
        + '                        Needs a `usage` for this project\n'
        + '  help                  Show this help\n'
        + '  clear                 Clear the screen\n'
        + '  exit | quit           Close the shell\n\n'
        + 'Each command\'s flags still work inside the shell\n'
        + '(e.g. `usage --root <dir>`, `usage --json`). Use `usage --help` for all its options.',
      // Replaces the flow block (081) when there is only ONE visible command: there is no order to announce.
      externalIntro: 'Type `usage` to scan this project and your machine; the report always shows locally, and nothing leaves your machine unless you choose to share it.',
    },
    // See the es.sheet header.
    sheet: {
      reportTitle: 'AI usage report',
      footprint: 'AI usage',
      certs: 'Certifications',
      ladderT: 'Setup Level',
      ladderS: 'Your AI-usage level: S1–S3.',
      toolsT: 'Detected tools',
      toolsS: 'AI clients present in your environment.',
      techT: 'Project technologies',
      techS: 'Stack recognized in the repository.',
      // Issue 110 — see the Spanish catalog for why the service is shown and the
      // server name never is, and why the empty state carries the T3 criterion.
      mcpT: 'Services connected over MCP',
      mcpS: 'Products your AI has access to.',
      mcpEmpty: 'No MCP server detected. Connecting one is the criterion that takes you to T3 (Connected bench).',
      mcpUnidentified: (n) => `${n} server${n === 1 ? '' : 's'} whose service we could not identify from its name.`,
      // 085: the tab said a bare "Skills" next to an "Agents" one, which is the
      // exact collision the issue names.
      skills: 'Technical Skills',
      // ---- DETECTED agents, left column (issue 089) -----------------------
      agentsT: 'Detected agents',
      agentsS: 'Every agent configured in your environment. Certifying is a different thing, and it lives in the right-hand column.',
      agentsEmpty: 'No configured agent detected (e.g. under .claude/agents/). If you have agents and they are not here, the tool did not find them — it is not that they do not count.',
      agentNoModel: 'no model declared',
      agentNoCategory: 'no category',
      // 106: THREE states, not two — see the Spanish catalog for the reasoning.
      agentNotEvaluated: 'not assessed',
      agentsEvalMissing: 'The classification for these agents could not be computed in this run, so it is not that they have no category: it is that we never got to ask. Run `usage` again to retry.',
      agentOrchestrates: 'orchestrates other agents',
      valoracion: 'Assessment',
      comoMejorar: 'How to improve',
      bandLine: (label) => `Setup Level <b>${label}</b>.`,
      hereYouAre: 'You are here',
      noFoot: 'No AI usage yet. Run usage in this project.',
      noSkills: 'No certified technical Skills yet. Run certify skills.',
      // Agent certifications were removed from the report (ADR-033); the sheet's agent-cert tab, its empty state and its detected-vs-certified copy went with it.
      footer: 'Report generated locally · Shakers',
      themeToggle: 'Toggle theme',
      themeDark: 'Dark',
      themeLight: 'Light',
      copied: 'Copied ✓',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
    },
  },
};

// Reverse map {Spanish text -> stable key}, built from the CATEGORIES catalog that detectors.js ALREADY exports (key -> Spanish text).
const CATEGORY_KEY_BY_LABEL_ES = Object.fromEntries(
  Object.entries(CATEGORIES).map(([key, label]) => [label, key]),
);

// Translates a tool's `category` (always in Spanish, as produced by the scanner) to the stable CATEGORIES key and from there to the requested language's catalog.
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

// Explicit user preference (SHAKERS_CLI_LANG env > config.json `lang`) wins over OS detection; null when unset.
function preferredUiLang(env = process.env) {
  return require('./config').getUiLang(env);
}

// Single entry point for report callers (bin/report.js): explicit preference > OS language (see locale.js), resolved to the catalog code ('es' or 'en').
// `sys` overrides the macOS/Intl readers (tests inject nulls to exercise the env path deterministically).
function detectReportLang(env = process.env, sys) {
  return resolveLang(preferredUiLang(env) || detectLangCode(env, sys));
}

function detectFlowLang(env = process.env, sys) {
  return toLowerLang(preferredUiLang(env) || detectLangCode(env, sys));
}

function getCatalog(lang) {
  return catalogs[getResolvedLang(lang)];
}

function tierName(tierKey, lang) {
  const names = getCatalog(lang).tierNames;
  return (names && names[tierKey]) || tierKey;
}

// Defensive i18n lookup (talents-ai-score — ported from d7c4d23, adapted).
function label(value, fallback) {
  return typeof value === 'string' && value ? value : fallback;
}

module.exports = { detectReportLang, detectFlowLang, resolveLang, getCatalog, categoryLabel, tierName, label };
