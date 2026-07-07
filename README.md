# AI Footprint

> **Estado: prueba de concepto (PoC) — solo distribución.** Esta rama
> (`feat/talents-ai-score`) publica únicamente el CLI. El informe local
> funciona al 100%. `--enroll` / `--share` (compartir con la plataforma) están
> **inertes**: no hay ningún servidor desplegado detrás. Ver la sección
> ["Compartir el informe con la plataforma" ↓](#compartir-el-informe-con-la-plataforma-opt-in-todavía-no-disponible-en-esta-poc)
> para el detalle.

Herramienta de línea de comandos que genera, **en local**, un perfil del uso de
herramientas de IA de un desarrollador: qué copilotos y agentes tiene
configurados, con cuánta profundidad, y en qué nivel de madurez está (0–4).

Inspirada en el mecanismo de `claude-code-level-up` (escanear señales locales y
clasificar por nivel), pero extendida a las principales herramientas de IA del
mercado, no solo Claude.

## Instalación

Una sola línea:

```bash
curl -fsSL https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/feat/talents-ai-score/install.sh | bash
```

> Nota (PoC): el one-liner apunta a la rama `feat/talents-ai-score` porque es
> la única que existe hoy en el repo. Cuando esta rama se mergee a `main`, la
> URL de referencia pasará a usar `main` — revisa `install.sh` para la versión
> vigente si este README queda desactualizado.

El instalador comprueba que tienes Node 18+, coloca la herramienta en
`~/.ai-footprint/` y deja el comando `ai-footprint` en `~/.local/bin`.
Cero dependencias: no ejecuta `npm install` ni descarga paquetes de terceros.

Alternativa clonando el repo (mismo resultado, pero puedes revisar el código
antes de instalar, que es lo recomendable):

```bash
git clone https://github.com/devShakers/ai-usage-evaluator
cd ai-usage-evaluator
git checkout feat/talents-ai-score
./install.sh
```

Desinstalar: `./install.sh --uninstall`.

## Uso

```bash
ai-footprint                  # informe en la terminal
ai-footprint --html           # además genera y abre el dashboard visual
ai-footprint --json           # informe en JSON por stdout
ai-footprint --root ../otro   # escanea otro directorio
ai-footprint --no-save        # no escribe nada en disco
```

Sin instalar, desde una copia del repo, equivale a `node bin/report.js [opciones]`.

## Compartir el informe con la plataforma (opt-in) — TODAVÍA NO DISPONIBLE EN ESTA POC

> **Inerte en esta PoC.** `--enroll` y `--share` existen en el código y están
> documentados abajo porque describen el diseño completo, pero **no hay ningún
> servidor de Shakers desplegado en producción todavía**. El código de
> enrolamiento (`--enroll=...`) se emite desde un panel de Shakers que **no
> está en marcha**, así que hoy no existe forma de obtener uno real. Si
> ejecutas `ai-footprint --share` sin haberte enrolado, la herramienta te lo
> dice y no envía nada — no hay endpoint al que conectarse. **No prometemos
> envío funcional en esta fase**, solo el informe local (que sí funciona al
> 100%).

Diseño (para cuando el servidor exista): el envío es opcional, requiere estar
enrolado y muestra el payload exacto antes de mandar nada. El repo público
**no contiene ningún endpoint ni secreto**: la URL de destino llegaría dentro
de la credencial que se obtiene al enrolarse.

Flujo previsto del talento (una vez el servidor esté desplegado):

```bash
# 1) Enrolar (el código personalizado se obtendría del panel de Shakers)
ai-footprint --enroll=CODIGO_DE_TU_PANEL

# 2) Ver el informe y enviarlo (pide confirmación tras mostrar el payload)
ai-footprint --share
```

Qué se enviaría: solo datos derivados (nivel, score, herramientas detectadas
sí/no y conteos por herramienta). Nunca contenido de ficheros, rutas ni
credenciales. La credencial se guardaría en
`~/.config/ai-footprint/credentials.json` (permisos 600).

## Servidor de referencia (NO desplegado en esta PoC)

> Fuera de alcance de esta PoC (ADR-002, `active-work/talents-ai-score`): el
> código de `reference-server/` vive en el repo como documentación del
> contrato y para revisión, pero **no se ejecuta ni se despliega**. No hay
> ninguna instancia corriendo en Shakers a la que este CLI se conecte.

`reference-server/server.js` es un **stub sin dependencias** que ilustra el
contrato: canjea un código de enrolamiento de un solo uso por un token
revocable, e ingesta informes validando el token, atribuyéndolos al talento y
aplicando rate limiting. Es un ejemplo en memoria; tu equipo lo reimplementa
sobre la infraestructura real (BD, tokens hasheados, TLS en la pasarela).

```bash
node reference-server/server.js
# imprime un código de demo y una cadena --enroll lista para probar el cliente
```

Rutas: `GET /health`, `POST /enroll {code}`, `POST /reports` (con `Bearer`).
Control de acceso: un desconocido que clone el repo obtiene un escáner que le
muestra su informe local pero no tiene credencial válida, así que su envío se
rechaza con 401. Solo los talentos que enroles pueden mandar reportes.

### Control de tokens (administración)

Los tokens se guardan **hasheados** (nunca en claro) y tienen ciclo de vida
completo. Las rutas de administración requieren la cabecera `X-Admin-Key`:

```bash
# Emitir un código de enrolamiento para un talento (devuelve el comando a mostrar en su panel)
curl -X POST http://localhost:8787/admin/enroll-codes \
  -H "X-Admin-Key: TU_CLAVE" -H "Content-Type: application/json" \
  -d '{"talentId":"talent_123"}'

# Auditar: lista todos los tokens con talento, emisión, último uso, caducidad y estado
curl http://localhost:8787/admin/tokens -H "X-Admin-Key: TU_CLAVE"

# Revocar un token por su id público (corta el acceso; el siguiente envío da 401)
curl -X POST http://localhost:8787/admin/revoke \
  -H "X-Admin-Key: TU_CLAVE" -H "Content-Type: application/json" \
  -d '{"id":"tok_abc123..."}'
```

Cómo controlas cada fase:

- **Emisión**: sin un código emitido por ti (atado a un `talentId`) no hay token.
- **Caducidad**: cada token nace con expiración (TTL); al caducar, el talento re-enrola.
- **Revocación**: `/admin/revoke` corta el acceso al instante.
- **Almacenamiento**: solo se guarda el hash del token; el secreto se entrega una
  sola vez al enrolar y lo conserva el talento.
- **Auditoría**: `/admin/tokens` muestra de quién es cada token, cuándo se usó por
  última vez y si sigue activo.

En producción, esta superficie de administración vive detrás de vuestro auth
interno y sobre una base de datos, no sobre los almacenes en memoria del stub.

> Aviso: enviar datos sobre cómo trabaja una persona implica tratar datos
> personales (RGPD, consentimiento). Valídalo con un experto legal/laboral antes
> de activar el envío en producción.

## Uso (referencia rápida)

```bash
ai-footprint                  # informe en la terminal
ai-footprint --html           # además genera y abre el dashboard visual
ai-footprint --json           # informe en JSON por stdout
ai-footprint --root ../otro   # escanea otro directorio
ai-footprint --no-save        # no escribe nada en disco
ai-footprint --enroll=CODIGO  # enrola este equipo
ai-footprint --share          # envía el informe (opt-in, con confirmación)
```

Los resultados se guardan en `~/.config/ai-footprint/` (`latest.json`,
`report.html` y un histórico por fecha en `history/`). **Nunca** se escribe nada
en el proyecto escaneado, para que el informe no acabe en un commit por error.

## Herramientas que detecta

Claude Code, Cursor, GitHub Copilot, Windsurf, Aider, Continue, Cline,
Gemini CLI, Codex CLI, Cody, Zed y Tabnine.

La detección se basa en la existencia de ficheros/directorios de configuración,
binarios en el `PATH` y extensiones de editor instaladas. La "profundidad" mide
cuánto se ha configurado cada herramienta (instrucciones de proyecto, reglas,
servidores MCP, skills, comandos, hooks).

## Niveles de madurez

| Nivel | Nombre | Criterio |
|------|--------|----------|
| 0 | Sin rastro de IA | ninguna herramienta detectada |
| 1 | Explorando | hay herramientas, pero sin configuración de proyecto |
| 2 | Integrado | existe al menos un fichero de instrucciones/reglas de proyecto |
| 3 | Power user | hay MCP, skills/comandos/reglas propias, o 3+ herramientas |
| 4 | Orquestador | CLI agéntica + MCP + personalización propia (automatización profunda) |

## Diseño de privacidad (importante)

Esta herramienta está pensada para poder, en una segunda fase, compartir el
perfil con la plataforma. Por eso el diseño separa con cuidado lo que se ve en
local de lo que podría enviarse:

- **Solo se registran señales derivadas**: booleanos (detectada sí/no), conteos
  (cuántos MCP, cuántas skills) y categorías. **Nunca** se lee ni se guarda el
  *contenido* de tus ficheros, ni rutas absolutas, ni variables de entorno, ni
  credenciales.
- El único fichero que se parsea (`.mcp.json`) se abre **solo para contar
  claves**; no se guarda ningún nombre ni valor.
- El `id anónimo` es un hash no reversible de hostname + usuario, útil solo para
  deduplicar, no para identificar a la persona.
- **No hay envío de datos.** El módulo de compartición es un paso aparte,
  todavía no implementado, y cuando lo esté deberá ser *opt-in* y mostrar al
  usuario el payload exacto antes de mandar nada.

Si vas a desplegar esto entre terceros (p. ej. talentos de una plataforma),
recuerda que recopilar datos sobre cómo trabaja una persona tiene implicaciones
de RGPD y consentimiento: conviene validarlo con un experto legal/laboral antes
de activar cualquier envío.

## Cómo añadir una herramienta nueva

Edita `src/detectors.js` y añade una entrada con sus señales:

```js
{
  id: 'mi-tool',
  name: 'Mi Tool',
  vendor: 'Vendor',
  category: CATEGORIES.AGENTIC_CLI,
  signals: [
    { type: 'projectPath', path: '.mitool' },
    { type: 'bin', name: 'mitool' },
  ],
}
```

Si quieres medir profundidad, añade una sonda en `src/scanner.js` dentro de
`probes` que devuelva **solo números**.

## Estructura

```
bin/report.js            Orquestador CLI
src/detectors.js         Catálogo de herramientas y señales
src/scanner.js           Motor de escaneo (produce el objeto reporte)
src/maturity.js          Cálculo de nivel y score
src/render-terminal.js   Salida en terminal
src/render-html.js       Dashboard HTML autocontenido
src/store.js             Persistencia en el home del usuario
src/share.js             Enrolamiento, consentimiento y envío (opt-in)
reference-server/server.js  Servidor de referencia (stub) de enrolamiento e ingesta
install.sh               Instalador (curl | bash o local)
```
