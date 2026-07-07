# AI Footprint — Documento de traspaso (contexto para otro agente)

Este documento resume el proyecto, las decisiones tomadas y su estado, para que
otro agente pueda continuar sin el historial de la conversación.

## 1. Qué es y de dónde sale

Herramienta de línea de comandos que genera **en local** un perfil del uso de
herramientas de IA de un desarrollador: qué copilotos/agentes tiene, con cuánta
profundidad de configuración, y en qué nivel de madurez está (0 a 4).

Origen: se inspira en el repo `darnoux/claude-code-level-up` (escanear señales
locales y clasificar por nivel). Se descartó hacerlo como *skill* de Claude Code
porque ataría la herramienta a usuarios de Claude Code, y el objetivo explícito
es cubrir **cualquier** herramienta de IA, no solo Claude. Por eso es una CLI
independiente.

Contexto de negocio: la impulsa Shakers (marketplace de talento freelance). La
idea es que los "talentos" (freelancers) la ejecuten y, opcionalmente, compartan
su perfil con la plataforma para entender la adopción de IA en el pool.

## 2. Decisiones de diseño clave (con su porqué)

1. **Local primero, envío aparte y opt-in.** El repo original solo autodiagnostica
   y no envía nada. Aquí el informe se genera y se muestra siempre en local (es el
   gancho de valor para el talento). El envío a la plataforma es un paso separado,
   explícito, y solo tras mostrar el payload y pedir confirmación.

2. **Solo se envían señales derivadas, nunca contenido.** Se comparten booleanos
   (detectada sí/no), conteos (nº de MCP, skills, reglas) y nivel/score. Nunca el
   contenido de ficheros, rutas absolutas, variables de entorno ni credenciales.
   El único fichero que se parsea (`.mcp.json`) se abre solo para contar claves.
   Motivo: evitar construir un exfiltrador de secretos sin querer.

3. **Cero dependencias.** Todo con módulos nativos de Node. Un talento clona y
   ejecuta sin `npm install`. Motivo: confianza (no pedir que instale paquetes de
   terceros en una herramienta que le escanea el equipo).

4. **Persistencia en el home, no en el proyecto.** Los informes van a
   `~/.config/ai-footprint/`, nunca al repo escaneado, para que no se cuelen en un
   commit (sería una fuga, porque el informe lista su setup).

5. **Repo público, pero endpoint y secretos fuera del código.** La herramienta es
   pública y auditable (refuerza la confianza; el one-liner de instalación por
   `raw.githubusercontent` requiere repo público). La URL del endpoint NO está en
   el código: llega dentro de la credencial que se obtiene al enrolarse.

6. **Control de acceso en el endpoint, no en el repo.** Que cualquiera pueda USAR
   la herramienta es inevitable y no cuesta nada. Lo que se controla es quién puede
   ENVIAR. Se resuelve con enrolamiento por token: sin credencial válida, el envío
   se rechaza (401). Así no llegan reportes de desconocidos.

7. **Ciclo de vida del token controlado por la plataforma.** Emisión (código de un
   solo uso atado a un `talentId`), caducidad (TTL), revocación, y auditoría. Los
   tokens se guardan **hasheados** (nunca en claro); el secreto se entrega una sola
   vez al enrolar. La atribución del reporte la hace el servidor según el token, no
   según lo que diga el cliente (nadie envía en nombre de otro).

8. **Dashboard HTML con identidad propia.** Autocontenido (sin llamadas de red),
   estética de "consola de señales", para que sea presentable sin parecer genérico.

## 3. Arquitectura y ficheros

```
install.sh                    Instalador (curl | bash, o local si el repo está clonado)
package.json
README.md
HANDOFF.md                    Este documento
bin/report.js                 Orquestador CLI (flags y flujo)
src/detectors.js              Catálogo de 12 herramientas y sus señales
src/scanner.js                Motor de escaneo -> objeto reporte (solo booleanos/conteos)
src/maturity.js               Cálculo de nivel (0-4) y score (0-100)
src/render-terminal.js        Salida en terminal con colores ANSI
src/render-html.js            Dashboard HTML autocontenido
src/store.js                  Persistencia en ~/.config/ai-footprint/
src/share.js                  Enrolamiento, consentimiento y envío (opt-in)
reference-server/server.js    Servidor de referencia (STUB en memoria) con capa admin
```

Nota: `report.js` usa `require` relativos a su ubicación, así que la estructura
de carpetas debe preservarse (el instalador la respeta).

## 4. Detección y clasificación

Herramientas detectadas (12): Claude Code, Cursor, GitHub Copilot, Windsurf,
Aider, Continue, Cline, Gemini CLI, Codex CLI, Cody, Zed, Tabnine.

Señales: existencia de ficheros/directorios de config en el proyecto, config
global en el home, binarios en el PATH, y extensiones de editor instaladas.
Profundidad: conteos por herramienta (instrucciones, reglas, MCP, skills,
comandos, hooks).

Niveles de madurez: 0 Sin rastro · 1 Explorando (hay herramientas sin config de
proyecto) · 2 Integrado (hay instrucciones/reglas de proyecto) · 3 Power user
(MCP, o skills/comandos/reglas propias, o 3+ herramientas) · 4 Orquestador (CLI
agéntica + MCP + personalización propia).

## 5. Flujo de datos y payload

El escáner produce un objeto reporte ya saneado. Para el envío, `share.js`
aplica un whitelist estricto (`derivePayload`) y solo manda:
`schemaVersion, generatedAt, anonId, platform, level, levelName, score,
totalDetected, categories, tools[{id, detected, depth{conteos}}]`.
El `anonId` es un hash no reversible de hostname+usuario (solo para deduplicar).

## 6. Ciclo de vida para el talento

Una sola vez: (1) recibe su comando `ai-footprint --enroll=...` desde su panel de
Shakers, (2) instala con el one-liner o clonando, (3) ejecuta el `--enroll` una
vez, que canjea el código por un token guardado en `~/.config/ai-footprint/`.

Cada vez que quiera: ejecuta `ai-footprint` (o `--html`) desde la carpeta de su
proyecto y ve su informe en local. Esto NO requiere enrolamiento ni envía nada.

Compartir (opcional): `ai-footprint --share` muestra el payload exacto, pide
confirmación y envía con el token guardado.

Re-enrolar: solo si el token caduca (TTL) o se revoca. El siguiente `--share` da
401 con mensaje de "vuelve a enrolarte". Instalar no hace falta otra vez.

El escáner mira la carpeta actual (config de proyecto) y el home (config global),
por eso se ejecuta desde dentro del proyecto.

## 7. Contrato del servidor

Rutas de talento:
- `GET /health`
- `POST /enroll {code}` -> `{token, endpoint, talentId, expiresAt}`
- `POST /reports` (con `Authorization: Bearer`) -> 201 / 401 / 429 / 400

Rutas de administración (cabecera `X-Admin-Key`):
- `POST /admin/enroll-codes {talentId, ttlHours?}` -> devuelve `code`, `enrollString` y el `command` listo para el panel
- `GET /admin/tokens` -> lista `{id, talentId, issuedAt, lastUsedAt, expiresAt, revoked}` (nunca el token)
- `POST /admin/revoke {id}` -> revoca por id público

## 8. Estado actual (probado)

Todo lo siguiente se ha verificado end to end en local:
- Escaneo + clasificación (nivel 0 en entorno vacío; nivel 4 en un fixture con
  Claude Code, Cursor, Copilot, Windsurf, Gemini, Codex).
- Instalación por copia (repo clonado) y desinstalación (`install.sh --uninstall`).
- Dashboard HTML autocontenido (verificado: sin ninguna llamada de red).
- Enrolamiento, consentimiento con payload exacto, envío y atribución.
- Rechazos del servidor: 401 token inválido/revocado/caducado, 404 código
  desconocido, 409 código ya usado, 429 rate limit (5/hora).
- Ciclo de control: admin emite código -> talento enrola y envía -> admin audita
  token (ve último uso) -> admin revoca -> siguiente envío da 401. Admin sin clave: 401.
- Tokens guardados hasheados (el listado nunca expone el secreto).

## 9. Es un STUB: qué falta para producción

El servidor de referencia es un ejemplo mínimo. Antes de producción:
- Sustituir almacenes EN MEMORIA por base de datos (códigos, tokens, reportes).
- Guardar tokens hasheados en la BD (el stub ya hashea, pero en memoria).
- Rate limiting sobre Redis o equivalente (ventana deslizante), no en memoria.
- Poner la superficie `/admin` detrás del auth interno real, no una sola `ADMIN_KEY`.
- TLS en la pasarela/balanceador.
- El panel de Shakers debe generar los códigos de enrolamiento por talento
  (formato de la cadena `--enroll`: base64url de `{enrollUrl, code}`).

## 10. Configuración pendiente de rellenar

- `install.sh`: variables `OWNER`, `REPO`, `BRANCH` con el repo real (ahora `TU-ORG`).
- Servidor: `ADMIN_KEY`, `PUBLIC_URL`, `PORT` por entorno.
- Crear el repo público en GitHub y subir estos ficheros.

## 11. Aviso legal (no técnico, importante)

Enviar datos sobre cómo trabaja una persona es tratamiento de datos personales
(RGPD, consentimiento, transparencia), y los talentos suelen estar en la UE.
El envío debe validarse con un experto legal/laboral antes de activarse en
producción. El diseño ya es opt-in y transparente (muestra el payload), pero eso
no sustituye la base jurídica ni la información previa.

## 12. Próximos pasos sugeridos

- Conectar la emisión de códigos de enrolamiento con el panel de Shakers (cerrar
  el primer paso del talento).
- Definir las métricas de agregación del lado servidor para explotar los reportes.
- Endurecer el servidor de referencia hacia producción (sección 9).
