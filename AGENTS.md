# AGENTS.md

Contract for any agent or developer who **modifies** this repo.

`README.md` is the document that talks to the Talent who *installs and runs*
`shakers`. This file talks to whoever *changes it*. Where the README already
explains something well, this file links instead of copying: read
[`README.md`](./README.md) for what the commands do, the endpoint chain and its
fallback triggers, the consent/disclosure flow, and local end-to-end testing.

Every rule below is stated with **its consequence**. A rule without its reason
gets broken with the best of intentions.

## What this repo is, in one paragraph

A public, zero-dependency Node CLI (`shakers`) distributed by `curl | bash`
straight onto a Talent's own machine. It scans a project locally, classifies the
AI-tool setup, and can send *sampled source code* to a backend model for skill
and agent certification. Two properties dominate every decision here: **it is
public** and **it runs on other people's machines with their code**. A mistake
does not fail a test, it publishes something to every Talent, or egresses code
that should never have left.

## Read these before you touch anything

1. `README.md` (the shipped surface: commands, endpoint chain, consent).
2. `package.json` (there is deliberately no `dependencies` field).
3. `install.sh` (what actually gets published, and the pre-deployment placeholders).
4. `src/config.js` (endpoint validation, allowlist, config precedence).
5. The unit of work in the meta-repo: `active-work/talents-ai-score/`
   (`status.yml`, `build/specs.md`, `build/issues/`, `decisions.md`). Domain
   decisions live there as ADRs, not here.

## Hard invariants

### Zero dependencies, and what a new package would cost

`package.json` has no `dependencies` field at all. Only Node builtins are used
(`http`, `crypto`, `fs`, `path`, `os`, `readline`).

**Consequence:** this repo is public and installed by piping a shell script from
a raw URL. `install.sh` copies files and verifies them against a SHA-256
manifest it generates itself; there is no `npm install` step and no lockfile
audit anywhere in the install path. Adding one package means either teaching the
installer to fetch and verify third-party code on a Talent's machine, or
vendoring that code into this repo and owning it. Both are real work with a
security review attached. **Do not add a dependency; ask first.** If you need a
utility, write it in `src/` or use a builtin.

### `engines: node >=18` is a floor you cannot feel locally

**Consequence 1:** the global `WebSocket` is not available on the floor (it
lands unflagged in Node 22). This is a stated reason the agent-certification
interview is plain HTTP over the session routes rather than the WebSocket
gateway that already exists in the service. See the rationale block above
`fetchInterviewState` in `src/agent-certification-client.js`. Do not "upgrade"
the transport to a socket; resume is a `GET` plus a server-side cursor, which is
a feature nobody has to write.

**Consequence 2, the one that bites:** development machines here run Node 22
(and the installed toolchain offers only 20 and 24 — there is no Node 18 on this
machine at all). `node --test` going green locally does **not** prove Node 18
compatibility, and **there is no CI in this repo** (no `.github/`, no
`.gitlab-ci.yml`) to catch it either. If you use anything newer than Node 18, you
have shipped a break you cannot see.

**You can actually check it, in one command** (issue 047 did; before that nobody
had). Run the suite on the floor in a container, against a read-only mount so the
working tree cannot be touched:

```bash
docker run --rm -v "$PWD":/src:ro node:18 bash -c '
  mkdir -p /work && cp -r /src/. /work/ && chown -R node:node /work
  su node -c "cd /work && export HOME=/home/node \
    && git config --global user.email t@t.com && git config --global user.name T \
    && git config --global init.defaultBranch main \
    && npm test"'
```

Three details, each learned the hard way:
- **`node:18`, not `node:18-slim`.** Slim has no `git`, and the ADR-017
  authorship tests shell out to it — without git you get failures that look like
  Node-version breaks and are not.
- **Run as the non-root `node` user.** As root the suite reports one failure,
  `install: a failed re-install (corrupted source) leaves the PREVIOUS install
  fully intact (atomic swap)`: that test forces a read failure with
  `chmod 0o000`, and **root ignores the permission bit**, so the install
  succeeds where the test needs it to fail. That failure is a container artifact,
  not a Node 18 incompatibility. Do not "fix" the test for it.
- **The container needs a git identity.** The fixtures run `git commit`; with no
  `user.email`/`user.name` configured, git refuses and the certify tests fail for
  a reason that has nothing to do with the code.

When in doubt about a specific API, still check its availability rather than
trusting any green run — the container proves the tests pass on 18, not that an
untested code path is safe.

### `install.sh` decides what reaches every Talent's machine

It packages three things: an **explicit `FILES` list** (`package.json`,
`README.md`, and the `bin/*.js` entry points), **every `src/*.js` discovered at
run time** (listed live from the directory locally, via the GitHub contents API
remotely, precisely so a new module can never be left off a hardcoded list), and
an explicit `ASSETS` list for the two non-JS templates under `src/templates/`.
It stages everything, generates `MANIFEST.sha256`, and re-verifies the manifest
after the swap. `PIN_REF` (overridable per run via `SHAKERS_CLI_INSTALL_REF`)
pins an install to an immutable commit instead of whatever `BRANCH` currently is.

**Consequence, said out loud: anything you leave in `src/` is published to every
Talent's machine.** Not "might be", *is*: the discovery is automatic and
unfiltered beyond the `.js` extension. Test doubles, scratch files, debug
helpers and dead experiments do not belong in `src/`. This is why the in-process
backend fake lives in `test-fixtures/`, not `src/` (see the test layout rule
below, which has a second, independent reason).

**Also:** `install.sh` carries a block marked `PRE-DEPLOYMENT PLACEHOLDERS, MUST
CHANGE BEFORE PUBLIC DISTRIBUTION`, with loopback default endpoints that are
safe only because nothing is deployed yet, and `BRANCH="release"`, which must match
the branch actually published or the `curl | bash` one-liner breaks. Do not
change branch/ref semantics casually, and do not silently "fix" the loopback
defaults; that is a deployment decision with a human owner.

### The endpoint allowlist is empty on purpose

`src/config.js` has `const SHAKERS_DOMAINS = [];`. Loopback (`localhost`,
`127.0.0.1`, `::1`) is exempt from both the `https` requirement and the
confirmation prompt. Every other host must be `https`, and costs the Talent one
typed confirmation.

**Consequence:** the emptiness is the safe state, not an oversight, and it is
documented as such in the file. An unverified domain in that list would look
authoritative while silently accepting source-code egress the day someone
registers or repurposes that name. Adding an entry is a one-line change that
removes a human confirmation from a code-egress path, so it needs explicit human
sign-off before it ships. Do not add one to make a test or a demo more
convenient.

### `scrubSecrets` is aggressive with ordinary engineering prose

`scrubSecrets` (defined in `src/agent-synthesis.js`, used across
`certify-*`/`agent-*`/`share`/`render-html`) is a deliberately broad,
best-effort net, not a precise one. Beyond real key shapes (JWT, `Bearer`,
`sk-`/`AKIA`/`ghp_`/`AIza`/SendGrid, PEM blocks, `scheme://user:pass@`), it also
redacts: **any Unix path of two or more segments** (`UNIX_PATH_RE`), Windows
paths, **any alphanumeric run of 32+ characters**, base64-ish blobs of 40+, and
**email addresses**.

**Consequence 1:** a Talent writing a normal sentence like "the handler lives in
/src/modules/auth" gets `[REDACTED]` in the middle of it. That is accepted
behaviour, not a bug to loosen. If you are debugging "why did my text change",
this is why.

**Consequence 2, the ordering rule:** **every length cap is measured on the
scrubbed text, never the raw text**, because the scrubbed string is what goes on
the wire and therefore what the backend DTO's `@MaxLength` sees. And scrubbing
can *grow* text (a 4-character `/a/b` becomes a 10-character `[REDACTED]`), so
input that looked fine raw can legitimately exceed the cap. Always scrub, then
measure, then slice, so a secret straddling the cut cannot leak a fragment.

**Consequence 3:** client caps mirror backend DTO constants exactly
(`MAX_AGENT_CERT_DEFINITION_CHARS`, `MAX_INTERVIEW_ANSWER_CHARS`) and are
counted in UTF-16 code units, because that is what `@MaxLength` counts. The
agent definition is re-sent on **every turn**, so a cap that disagrees with the
server does not fail at the opening, it fails at turn 3 with the interview
already in progress. If you change a cap here, change it with the server.

### Local state is written atomically, mode 0600

Introduced by issue 039 (`src/interview-session-store.js`); **this pattern did
not exist in the repo before it**, so do not assume older files model it. The
recipe: serialize first, open a fresh temp file **in the same directory** with
`openSync(tmp, 'wx', 0o600)`, `fsync` it, then `renameSync` over the target, and
unlink the temp on any failure.

**Consequences, each one load-bearing:**
- Same directory, because `rename` is only atomic within a filesystem.
- No `chmodSync` after the rename: `rename` replaces the directory entry, so the
  surviving inode is always the one created with `0600`, with no window where the
  file exists more permissive.
- A crash leaves either the old file or the new one, never a half-written one.
- `0600` is not optional here: the file holds a session token and the Talent's
  own prose. `src/config.js` and `src/share.js` also write `0600`.

Any new file this CLI writes into the Talent's home directory follows this.

### The report gate enumerates a list, so the list is named and swept

`materializeProjectReport` (`src/report-store.js`) decides whether a project has
anything worth rendering. It used to test `usage` and `certifications`
inline; `persistAgentCertification` later added a **third** persisted key,
`agentCertifications`, and nobody touched the gate. `render-sheet` and
`graph-certs` painted it all along, so for the whole life of that feature a
Talent who certified an agent **without** running `usage` or certifying a
Skill was told *"Saved. Run `report`…"* and then told by `report` that there was
nothing to show (issue 066).

**Consequence:** the decision now lives in one named table, `RENDERED_DATA`, and
**`GATE_INVENTORY` in `test/report-store.test.js` IS the inventory** — one row per
key the store persists, each with its `gates` verdict, plus a test that compares
the table against the keys a project entry actually carries. **Persisting a new
key fails that test** until someone adds a row and decides. `backendAcceptance`
is the row that gates `false`, on purpose: no renderer reads it, so a project
carrying only that one has a blank report and must keep the actionable message.

Two things the shape of this bug teaches, beyond the key it was about: **what the
CLI says it saved, the report must show** — a "Saved" message and a "nothing to
show" answer about the same write is worse than either failure alone. And a
document shape that is **unreachable** has never been rendered, so it is where a
second defect waits: making the agent-cert-only report reachable immediately
exposed an unguarded `#ringFill` lookup in the template's `load` handler (see the
comment at `paintRing`), which had also been breaking the **skills-only** report
in silence, because a broken inline script fails no test.

### Test layout: `node --test` decides where doubles can live

Tests are `node --test` (`npm test` runs `node --test test/*.test.js`). No
framework, no mocking library, `node:test` + `node:assert/strict` only.

**The detail nobody deduces by reading the repo, verified empirically here:**
`node --test` treats **any `.js` file under a directory named `test` as a test
file**, not just files matching `*.test.js`. A helper dropped in `test/helpers/`
is executed and counted as a (usually empty, passing) test file, which silently
inflates the suite count and makes baseline comparisons lie.

**Consequence:** shared test doubles live in **`test-fixtures/`** at the root.
That location satisfies two independent constraints at once: `node --test` does
not pick it up (the directory is not named `test`), and `install.sh` does not
ship it (it is not `src/`, not `bin/`, not in `FILES`/`ASSETS`). Do not move
fixtures into either `test/` or `src/`.

`test-fixtures/ingest-service-fake.js` is the in-process backend fake. It is a
**test double, not a server**: it binds no port, has no `require.main` launcher,
and implements only what assertions in `test/` need. It replaced the old
`reference-server/`, retired in issue 044 because it still answered routes the
service had dropped and had no interview route at all. Do not add routes to it
"for documentation", and do not teach it interview semantics: reimplementing
session state, the `seq` cursor, per-turn idempotency, the stop condition and
anchoring would be a second implementation of the most delicate logic in the
system, and it would lie the moment it drifted. Test the interview against the
real service, or against a per-test inline server as
`test/agent-certification-client.test.js` does.

### Inline template scripts are executed, not just their markup

`src/templates/*.html` (`report-sheet.html`, `graph-report.html`) is asserted
by its markup everywhere else in the suite; the JavaScript inside its
`<script>` tags used to never run. Issue 052 (`test/graph-report-xss.test.js`)
and issue 066 (`test/report-store.test.js`) each built a one-off `vm`/`Function`
sandbox to execute a FEW named functions extracted from the rendered output.
Issue 067 found the pattern is a **class**, not two isolated cases:
`report-sheet.html`'s `load` handler chains four unrelated init steps
(`paintRing(); countUp(); moveInd(...); syncExpandLabel();`) as a plain
sequence, so the FIRST one throwing — as `paintRing()` did, pre-066, on its own
unguarded `#ringFill` lookup — silently killed every sibling after it. A broken
inline script fails no test on its own; this is why it took three appearances
in one day to get its own harness instead of a third one-off extraction.

**`test-fixtures/template-script-harness.js`** generalizes the same technique
(extract the REAL script text from the REAL rendered output, run it against a
document/window double — never a reimplementation) so a script executes
WHOLE, not function-by-function. The document double is built FROM the
rendered HTML string: only the ids that string actually contains resolve to a
stub node, everything else resolves to `null` — so "no AI usage" is expressed
as data (render without it) rather than as sandbox plumbing (hand-picking
which ids to stub). `test/render-sheet-script.test.js` and
`test/render-graph-report-script.test.js` use it.

**The production fix, alongside the harness: `safeStep`, one per template.**
Both `load`/tail init sequences (`report-sheet.html`'s `load`/`resize`/theme
click; `graph-report.html`'s `fit(); applyHash(); window.__READY__=true;` tail)
now wrap each independent step so one throwing does not prevent its siblings
from running. Two things this is deliberately NOT:
- **Not one `try/catch` around the whole handler.** That still never reaches
  the statements after the first failing one — same bug, quieter.
- **Not an `if(!node) return;` guard added to every function that touches a
  DOM node.** That only defangs the SPECIFIC lookup someone thought to guard
  (issue 067's own words: "grepping for `if(!fill)` would work, and would be
  useless") — it does nothing for a step that fails for any OTHER reason.
  Isolating the SEQUENCE, not the dereference, is what keeps a sibling step
  alive regardless of *why* one of them broke.

**Verified non-tautological the same way issue 052 did**: with the two
`#ringFill`/`#scoreNum` guards stripped BY HAND from the rendered script text
(not the shipped source), the isolation tests still pass — proving the
isolation holds independently of those two guards — while
`test/report-store.test.js`'s pre-existing 066 test (which extracts
`paintRing`/`countUp` by name) still fails on the same strip, so the two
mechanisms are complementary, not redundant: one pins the specific guards, the
other pins that a failure anywhere in the sequence cannot cascade.

`graph-report.html`'s DOM, unlike `report-sheet.html`'s, is **fully static
markup** — `render-graph.js#buildPayload` is the single choke point every
payload goes through and always normalizes `usage`/`certs` to non-null
objects specifically so the template's unconditional `DATA.footprint`/
`DATA.certs` reads never throw. So its "missing node" axis (criterion 3 in
issue 067) genuinely does not apply; what protects it instead is the same
tail-sequence isolation, verified by forcing `fit()`'s first statement to
throw.

### A datum the Talent SEES needs a test on the SURFACE that shows it

Four disappearances in 48 hours (086 the orchestration root, 088 a prompt fix
applied to one reader and not its twin, 089 the entire agents section of the
shared report, 091 nine fields painted by nobody) and **not one suite went red**.
They share one shape: there were tests on the **helpers that compute** and none
on the **surfaces that paint**. `agentCardsSection` carried thirteen assertions
while being unreachable from any live code path.

So, for anything a Talent reads:

1. **Assert the OUTPUT, not the call.** The needle is the string in the rendered
   terminal output or the generated HTML. A spy that proves a function ran stays
   green while its result is dropped — that is exactly how 089 survived.
2. **Feed it the object the REAL pipeline produces.** A real `scan()` of a real
   temporary project; `parseAgentDescriptions` for descriptions; the real client
   (`requestAgentEvaluation` against a local `http` server) for anything that
   comes off the wire, so the normalizer builds the shape. A hand-written fixture
   agrees with the test and not with production — issue 106's bug exactly.
3. **Assert the LOCALIZED value where there is one.** Asserting the raw key
   (`developer`) passes while a Spanish report shows a bare English key.
4. **Prove the test is load-bearing.** Delete or neuter what it protects, in a
   scratchpad copy, and check it goes red — and look at what stays green, which
   is where the next gap is.
5. **State what you left out.** Coverage of every pixel is not the goal; the goal
   is the data whose disappearance nobody would notice. Write down the exclusions
   (see the header of `test/talent-visible-surfaces.test.js`).

Two files carry this today and are the ones to extend rather than duplicate:
`test/talent-visible-surfaces.test.js` (the agent card and its classification)
and `test/render-talent-text-invisibles.test.js` (the field-by-field,
bidirectional inventory, whose `UNPAINTED_SINCE_090` list fails when a field
comes back to the report and nobody updates it).

**One honest measurement, so nobody over-claims this:** when 092 was written it
said the classification painting was covered by nothing. Verified by mutation
(making `agentClassLine` return `''`), two pre-existing tests DO catch it — the
106 provenance test and the invisibles inventory — but only as a side effect;
neither is about the classification, and both stay green if the category is
painted as a raw key instead of its localized label. "Covered by accident" is
what this rule exists to convert into "covered on purpose".

### A template comment is PUBLISHED — write it as if a client will read it

`src/templates/*.html` ships verbatim to every Talent, and the HTML it renders
is the artefact a Talent **shares**: with a client, on LinkedIn, with whoever
they like. Until issue 098 nothing removed the comments, so 42 of ours travelled
in `report-sheet.html` and 60 in `graph-report.html` — ten of them naming issue
numbers, ADRs, a commit hash and `src/` paths, inside documents we do not
control the distribution of. **This is the inverted expectation to know before
you type a comment in there:** in most pipelines a template comment is private,
and here it was the opposite.

**What protects it now, and what does not.** `src/strip-internal-comments.js`
sweeps HTML, block and whole-line comments in each renderer's `template()`
loader, and `test/shared-report-has-no-internal-notes.test.js` fails if an issue
reference, a commit hash, an ADR or a `src/` path reaches either rendered
document. The sweep runs on the TEMPLATE, before any Talent data is in the
string — deliberately not on the rendered output, which by then contains Talent
text that may legitimately contain `/*` (an agent description reading
`fix the /* legacy */ parser` would be silently mangled). So:

- The sweep guarantees a comment is **not published**.
- It does **not** guarantee a comment is harmless. Anything you inject as a
  string from `src/*.js` (a CSS blob, a `<script>` fragment) is NOT swept — the
  test is what catches that, and it will fail loudly.

The rejected alternative, recorded so it is not re-proposed as new: clean the
ten offending comments and rely on the discipline of never writing another.
Rejected because it leaves the vector open, and because this repo spent one week
proving that an unwritten rule does not survive (079, 088, 097 were each "we
know not to do that" until something did it).

### A copy assertion MUST wrap its needle in `needle()`

`includes(undefined)` is **true** whenever the haystack contains the literal
string `"undefined"` — and rendered documents do. `templates/report-sheet.html`
ships that word in its inlined script, and any flow that interpolates a missing
catalog value into its own output prints it too. So the obvious way to guard copy:

```js
assert.ok(html.includes(catalog.someCopyKey));      // WRONG
```

**survives deleting `someCopyKey`.** It quietly stops checking copy and starts
checking that the page contains the word "undefined", which it always does. A
green guard that protects nothing is worse than no guard, and this repo has
already lost two rendered blocks with every suite green (issues 086 and 089).

**The rule:** every assertion whose needle comes from the i18n catalog wraps it in
`needle()` from `test-fixtures/copy-needle.js`.

```js
const { needle } = require('../test-fixtures/copy-needle');

assert.ok(html.includes(needle(c.agentsT)));
assert.match(out, new RegExp(needle(ca.turnHeading(1))));
assert.match(out, new RegExp(needle(ca.retryingTurn).replace(RE, '\\$&')));  // wrap BEFORE the transform
```

Wrap the **catalog expression**, not the transformed one, so a missing key fails
with the helper's message instead of a `TypeError` from `.replace`.

**How to check the whole suite still honours it** (issue 097's collective control):
blank every catalog string and run the copy tests. Anything still green is lying.

```js
// preload: replace every string leaf of getCatalog() with undefined
node --require ./blank-catalog.js --test test/<file>.test.js
```

**Second family, same failure:** a fixture using a value that is not in a closed
vocabulary exercises the FALLBACK branch while claiming to test the real one. The
localized vocabularies are `classification.categories`
(`developer|product|designer|marketing|data`), `classification.levels`
(`L1|L2|L3` — NOT the credential's `P1..P5`), `certifyAgents.areaNames`
(`purpose_fit|design_ownership|boundaries_guardrails|failure_handling|operation_evolution`)
and `certifyAgents.tagLabels`. Issue 097 found an i18n audit whose area keys did
not exist, so it swept raw fallback text instead of localized names. If a fixture
uses an out-of-vocabulary value ON PURPOSE (to test the unknown branch), say so in
a comment next to it.

### User-facing text is bilingual and machine-enforced

All user-facing copy lives in `src/i18n.js` as two catalogs, `es` and `en`.
Two tests enforce it: `test/i18n-catalog-parity.test.js` (the catalogs must
agree on keys) and `test/i18n-no-spanish-audit.test.js` (rendered English output
must not leak Spanish).

**Consequence:** adding a string to one catalog only, or hardcoding user-facing
text inside a module, fails the suite. Add copy to both catalogs and read it
through `i18n`, never inline.

**The audit now covers all three renderers, including the shareable sheet.**
Issue 047 found that `materializeProjectReport({ lang: 'en' })` emitted hardcoded
Spanish (document + header title, theme toggle, copy feedback, expand/collapse,
and the Spanish *tier name*); issue 048 fixed it and closed the hole. The sweep
now renders `renderHtml`, `renderTerminal` **and `renderSheet`** at `lang: 'en'`
and fails on Spanish — the sheet in both a populated and an empty project, since
the empty states are their own copy path.

**Two things the audit still cannot do for you:**
- **It is blind to unaccented Spanish unless the string is listed.** The main net
  is `SPANISH_CHAR_RE` (accents + `¡¿`), and every string 048 fixed —
  `Informe de uso de IA`, `Expandir todo`, `Cambiar tema`, `Oscuro`, `Claro`,
  `Copiado` — has no accent at all. They are caught only because they are named
  in `KNOWN_SPANISH_STRINGS_UNACCENTED`. If you add accent-free Spanish copy, add
  it to that list too or nothing will see it.
- **It only sweeps what it renders.** A fourth renderer would be invisible again.
  If you add one, add it to the sweep in the same commit.

**Where sheet copy lives.** `src/render-sheet.js` used to hold its own inline
`COPY` object; 048 moved it into `catalog.sheet` in `src/i18n.js`, because
`i18n-catalog-parity.test.js` only walks the catalogs — copy kept anywhere else
can be added in one language only without failing anything. The template
`src/templates/report-sheet.html` carries **no literal copy at all**: every
user-facing string is a `__PLACEHOLDER__` filled from the catalog, including the
three inside its inline `<script>` (which are JS-escaped via `jsStr`, because a
broken script does not fail a test — it silently kills the tabs and accordions in
a report someone is reading). A test asserts no `__PLACEHOLDER__` survives into
the output.

**And translate tier/level names by KEY, never by passing the value through.**
`src/tier-engine.js` names tiers in Spanish and `maturity.tierName` carries that
verbatim; `buildFootprintDrawer` takes no `lang`. All three renderers must do
`t.tierNames[tierKey] || rawName`. The sheet did not, which is how "Banco con
notas" appeared mid-sentence in an English report.

### A credential carries VERBATIM Talent text, so the renderer marks invisibles

Three fields of an agent certification are literal text the Talent typed, on
purpose: `agentName`, and the two anchored quotes (`areas[].transcriptQuote` /
`definitionQuote`). The backend deliberately does not normalize the quotes' shape
— a quote whose whole value is being verbatim cannot be an approximation edited
by us — and it says so on its response DTO. So a credential can arrive carrying
bidi controls (`U+202E` and friends) and zero-width characters.

**Consequence:** a `U+202E` inside a quote makes the text a human READS differ
from the text that is STORED, on the exact field a proficiency level is defended
or disputed with. `esc()` does not help: that is markup escaping, and a bidi
override needs no markup. Everything painted goes through
**`sanitizeRenderText`** (`src/sanitize-network-text.js`), which strips C0
controls *and* replaces each invisible with a visible `[U+202E]` token. It
**marks rather than deletes**: deleting would also hide information — the reader
would see plausible text and never learn it had been tampered with.

Fixing this on the way IN is the wrong layer, in both repos: the row, the API
response and the local `report-store` copy all keep the literal.

**Three surfaces paint credential text today**, and the render-invisibles sweep
covers all three (the graph-report cert drawer was retired with the `map` command):

| Surface | Entry point |
|---|---|
| Terminal summary after a verdict | `src/render-certify-agents.js` |
| Cumulative HTML report card | `src/render-html.js` (`agentCertificationItemHtml`, `certAreaQuotesHtml`, `deriveCertEvidence`) |
| Shareable sheet | `src/render-sheet.js` over `graph-certs.buildCertsPayload` |

**The one thing that sweep cannot do for you**, same shape as the i18n audit: **it
only covers what it renders.** A fifth surface is invisible again — literally. Add
it to the sweep in the same commit.

### The rule is wider than credentials: NOTHING we did not author is painted raw

Issue 055 re-ran the sweep instead of trusting the two fields its own issue named,
and that was the point: 052 had already learned the dangerous field was not the
assumed one. The re-run found the gap was repo-wide, not credential-shaped.

**The rule, stated so a reviewer can check it mechanically rather than
re-deriving provenance:** a string painted by any renderer goes through
`sanitizeRenderText` **unless it is a literal in this repo's own source or i18n
catalog**. Talent-authored (their agent files, their git config, their directory
names) and off-the-wire (model prose, backend fields) are both in; our own copy is
out.

`test/render-talent-text-invisibles.test.js` is that sweep, and **the table in it
IS the inventory** — table-driven on purpose, one tagged poison per field, so a
failure names the exact field and the exact surface. Adding a field to the table is
how you extend it. What it covers today, by cluster:

| Cluster | Fields | Shaping layer that neutralises them |
|---|---|---|
| AI usage agent cards | `name`, `parent`, `tools[]`, `whatItDoes`, `symbolicName`, `rationale`, `improvements[]`, `classification.role` | `buildAgentCardTree` (`render-html.js`) — **shared with `render-terminal.js`, so one pass covers both** |
| MCP servers | `mcp.servers[].name` (+ category fallback) | `mcpSection` (`render-html.js`) |
| Tools / technologies / editors | `tools[].name`, `.vendor`, `.version`, `technologies[]`, `environment.editorsInstalled[]` | paint sites in `render-html.js` / `render-terminal.js`, and `buildFootprintDrawer` (`graph-scan.js`) for the sheet + graph drawer |
| Skill certification | `skillName`, `technology`, `result.rationale`, `result.improvements[]`, remediation prompt | `render-certification.js` (both terminal and HTML) and `graph-certs.buildCertsPayload` |
| ADR-025 authorship receipt | `repository`, `fileAttribution[].path`, `fileAttribution[].authors[]`, `authorEmails[].email` | `render-certification.js` |
| Roadmap personalization | `unlocks`, `steps[].text`, `steps[].estimate`, `tips[]`, `commonMistakes[]` — **only these four are model-rewritten** (`mergeRoadmapPersonalization`); every other `entry.*` is curated content | paint sites in `render-html.js` / `render-terminal.js` |
| Project identity | the basename of the Talent's own directory | `render-sheet.js` |

**`render-certification.js` no longer imports `stripControlChars`.** It used to
import only that, which removes the C0 bytes and does nothing about bidi — and it
paints the ADR-025 receipt, i.e. the part of the report whose entire purpose is to
be *evidence*. A bidi override in a receipt row makes the file a human READS differ
from the file that was sampled and attributed: the exact spoof the receipt exists
to rule out.

**Two traps this created, both with a test pinning them:**

- **Sanitizing a JOIN KEY.** `buildAgentCardTree` marks `name` **and** `parent`
  because `childrenByParent` is keyed by one and looked up with the other (and
  `visited` cycle guards use `name`). Marking one side only silently flattens the
  hierarchy for exactly the agents whose name carries an invisible — the hostile
  case. `sanitizeRenderText` is idempotent, so passing both sides through it keeps
  every join intact. Same reasoning already applies to `render-sheet`'s
  `improvementsByName`.
- **NOT sanitizing the other kind of key.** Graph node `id`s, edge endpoints and
  the `#n/<id>` deep link stay raw: marking them would break the graph rather than
  protect it, and an id is never painted as prose on its own. Only `label`/`sub`/
  `detail`/`sourceRef` are marked.

**The raw-data disclosure gets a DIFFERENT treatment, and the difference is the
point.** The HTML report's `<details>` block is a `JSON.stringify` dump whose whole
promise is "exactly what was collected" — and `JSON.stringify` escapes control
characters but **not** bidi or zero-width ones, so it was the likeliest place for an
invisible to pass unseen. `[U+202E]` markers would make it visible at the cost of
it no longer being a faithful dump, so it uses
**`jsonEscapeInvisibleChars`** instead: a JSON `\uXXXX` escape is readable ASCII
**and** parses back to the identical value. Same principle (mark, never delete) in
the representation this medium already understands. Apply it to the **serialized
string**, never to the values going in.

**Two declared exceptions, deliberately left raw, with a test pinning their
shape** so the day either becomes free text the exception fails loudly instead of
quietly opening a hole:

- `report.anonId` — `sha256(hostname::username)` hex, sliced to 12 (`scanner.js`).
- `commitRange` — `git rev-parse --short` output joined by `..` (`authorship.js`).

Routing either through the sanitizer would imply the value could be prose. It
cannot.

**One accepted cost, so nobody "fixes" it:** `graph-generator`/`graph-assemble`
clamp `label`/`sub`/`detail` to a pixel budget (`CAPS`) and the sanitizing pass runs
**after**, so a marked label can exceed that budget. The ordering is deliberate —
the other way round the clamp could cut a `[U+202E]` marker in half and lose the
signal. A hostile name costs layout, not the warning. The terminal's `summarize()`
truncation has the same shape and the same answer.

### The two quotes ARE painted now, and the `quoteVerified` policy is one function

Issue 052 found the quotes were painted by NOBODY (they travelled in the verdict,
were persisted locally, and only the model's `evidence` note was displayed) and
pinned that absence with a tripwire. **Issue 054 paints them on all four
surfaces**, so the tripwire is gone and its subject lives in positive assertions
in the same file, plus `test/render-credential-quotes.test.js` for attribution and
policy. Three rules, each with its consequence:

- **A quote is always painted next to its own area and tag**, inside that area's
  `<li>` / row / terminal block. A quote detached from the claim it substantiates
  explains nothing, so this is a correctness property and the tests assert it
  structurally (they locate the quote *within* its area element), not by presence
  anywhere in the output.
- **The two are labelled BY SOURCE and the labels differ.** `transcriptQuote`
  proves the Talent SAID it (the `claimed` half); `definitionQuote` proves the
  artefact CONFIRMS it (the half that makes it `verified`) — AMPLIACIÓN de
  ADR-032. Painting them interchangeably re-creates the exact bug that amendment
  fixed. The LABEL is the load-bearing distinction, not the colour or the rail:
  colour dies in a pipe, a greyscale screenshot and `NO_COLOR`, the label does
  not. Copy lives in `certifyAgents.quoteTranscriptLabel` /
  `quoteDefinitionLabel` / `quoteWithheldNote`, both catalogs.
- **`quoteVerified` is honoured only when it is literally `true`, and the policy
  lives in exactly one place: `src/credential-quotes.js` (`areaQuotes`).** It
  mirrors the server on purpose rather than inventing a second rule: the service's
  `anchorAreaAssessment` already drops BOTH quotes when either side fails to
  anchor. So the normal degraded case arrives with both quotes `null` and paints
  nothing — no note, no noise on every `claimed` area. The case the function
  exists for is text present with the anchor NOT verified (legacy row, server
  drift, hand-edited local store): the text is **withheld** and its absence is
  **announced**. Painting an unanchored quote unmarked would give the model's
  reproduction a credential's authority, which is what issue 043 removed;
  dropping it silently would hide a contract violation on the field the
  credential rests on. Do not "simplify" this into a truthiness check —
  `normalizeArea` yields `null` for anything non-boolean and an unknown verdict
  must fail closed.

One presentation detail with a real reason behind it: the terminal collapses the
`\n`/`\t` that `sanitizeRenderText` legitimately keeps (`oneLine`). A quote
containing a newline otherwise prints unprefixed extra lines that read as the
CLI's own chrome — a small spoofing surface of its own, on the field whose entire
job is to be trustworthy. HTML collapses that whitespace by itself.

### A failure message may never name a cause it does not know

Issue 058 cost a full diagnosis session: `certify agents` printed the same two
lines for `403 talent_not_registered` and `403 email_not_verified`, so a Talent
who was registered and ACTIVE was told they were not registered, and the effort
went into fixing an account that was already fine. **A message that names a false
cause is worse than a generic one**, because it directs work somewhere specific
with confidence.

**Consequence, and it is mechanical rather than a matter of taste:** the mapping
from a business `code` to its text lives in exactly one place,
`src/interview-failure-copy.js`, and **the table in
`test/interview-failure-copy.test.js` IS the inventory** — one row per code
reachable on the four interview routes, verified against the service's
`UsageExceptionFilter.codeMap` and its throw sites. The sweep fails if any
code has no message or if two codes share one, in either catalog. Adding a row is
how you extend it.

**Two rules that come with it:**
- **An unrecognised code gets NO dedicated message and falls back to the generic
  "(reason)".** This repo is public and installed by `curl | bash`, so an old CLI
  meets new codes constantly. Guessing a cause for one is the same bug again.
- **A status with no `code` in the body gets a message only when the status alone
  is unambiguous** (401, 404, 429). A bare `403` deliberately stays generic: with
  no code there is no cause to name.

Note the direction of travel here — issue 056 fixed a `@Catch()`-all filter on the
service that was turning every business exception into a 500, so this CLI now
receives codes it had **never seen before**. If you touch this area, re-derive the
reachable set from the service instead of trusting the previous list.

### Eligibility is checked before anything is asked, and it must not widen egress

`certify agents` checks LOCALLY (issue 062, `src/certify-preconditions.js`) that
the Talent has a durably verified email before asking for an address or an agent;
the legal disclosure still runs first, because the check sends nothing and the
remediation does.

**The trap, and it is worth the paragraph:** the first version gated on a
`granted` consent decision. `share.js#hasTraceContentConsent()` is that same
`granted` check, and every interview call reads it (ADR-028) — so requiring it
would have made the flag **always true** on this flow: every transcript captured by
a third-party processor for its full, non-erasable retention, with the
disclosure's "with no consent nothing is captured" branch made unreachable. A test
caught it. **Tightening a precondition must never silently widen what leaves the
machine.** The gate therefore mirrors what the SERVER gates on (registered +
verified) and nothing more.

The local `emailVerified` flag is a MIRROR, not the authority — the service checks
its own row against a TTL — so the pre-flight cannot be the only guard, and the
in-place recovery on `email_not_verified` at the opening stays.

### The legal and consent disclosure text is not free prose

The code-egress disclaimer, the consent/persistence copy and the third-party
processor disclosure (Datadog retention) appear in both the CLI and
`install.sh`, and carry an explicit marker that they are **pending review by a
legal/labor expert and are NOT FINAL**.

**Consequence:** do not reword, shorten or "clean up" that text as a style pass.
It states what leaves the Talent's machine, who retains it and for how long.
Changes need a human owner and legal validation before shipping.

## Preexisting failing tests: NONE. The suite is green

**As of issue 067 the suite is 1149 tests, 1149 pass, 0 fail, 0 skipped, 0 todo**
(047 left it green at 1048; 048 added 4 tests, all sheet-i18n sweeps; 052 added 10,
the render-invisibles sweep over the four credential surfaces; 054 added 15, the
quote attribution + `quoteVerified` policy file — 052's tripwire *became* one of its
positive tests rather than being added to; 055 added 12, the repo-wide literal-text
sweep whose table is the inventory; 062 added 24, the eligibility pre-flight —
12 flow-level, 12 on the pure classifier; 058 added 21, of which 15 are the
code→message injectivity sweep; 060 added 2, the per-area turn counts and the
"what is being judged" line; 066 added 6 — the report gate: the agent-cert-only
path at store and CLI level, the `GATE_INVENTORY` sweep whose table is the
inventory of persisted-vs-gated keys, the clean render of that document shape,
and the template's ring guard; 067 added 7 — executing the WHOLE inline
`<script>` of both `src/templates/*.html` templates, not just the two named
functions 066 extracted: 4 for `report-sheet.html` across every AI-usage/
skills/agents combination the store can produce (including the fully empty
project), 3 for `graph-report.html`'s dagre-lib + app script, plus the
`load`/tail-sequence isolation (`safeStep`) proven independently of whether
the `#ringFill`/`#scoreNum` guards regress — see "Inline template scripts are
executed, not just their markup" below)
— verified on both Node 22 and Node 18 (see the floor recipe below), under both
`node --test` and `npm test`. The 20 long-standing failures this section used to
list (17 in `test/bin-certify-cli.test.js`, 3 in
`test/render-roadmap-personalization.test.js`) were reconciled test by test in
047: stale expectations were re-anchored, and one genuine defect they were
pointing at got fixed in `bin/certify.js` (`--help` was swallowed by the
subcommand router).

**Consequence: a red test now means something.** There is no known-bad set to
diff against and no excuse for a failure. If a test fails, you either broke it or
you found a bug — do not look for it on a list, and do not let anyone tell you
"those were already red".

Still measure a baseline before you change anything; it costs one command and it
is how you tell "I broke this" from "this was already broken":

```bash
node --test 2>&1 | grep -E "^not ok" > /tmp/before.txt   # expect an EMPTY file
```

If that file is not empty on a clean checkout, the suite regressed and that is
the first thing to report — not something to work around.

**What 047 learned, so the next person does not re-learn it:**
- **Stale facts stack, and the first one hides the rest.** All 17 certify tests
  failed at the subcommand router, which masked a *second*, unrelated staleness
  underneath: the test's hardcoded endpoint path was still the hub-fallback base
  (`/works/usage/...`) while the fixture had moved to the primary's
  (`/usage/...`), so every request 404'd. Fix the first cause and re-run
  before you believe you understand the failure.
- **A test name can lie about its file.** The 3 roadmap failures are named
  `renderTerminal: …` but live in `render-roadmap-personalization.test.js`, not
  in `render-terminal.test.js` (which passes in isolation). Trust
  `node --test <file>`, not the name.
- **A test that asserts an absence can rot into a tautology.** Those 3 asserted
  that certain prose was *absent* from the terminal while also failing to render
  any roadmap at all (it moved behind `--roadmap`/`{ showRoadmap: true }`), so
  their negative assertions would have "passed" against empty output. When a
  test checks that X is missing, make it also check that the surrounding output
  is actually there.

## Git workflow

- **Never commit on `develop` or `release`.** Work happens on the unit-of-work branch named in
  the meta-repo's `active-work/<slug>/status.yml`
  (`cycles.build.pull_requests[].branch`). A `PreToolUse` hook in the meta-repo
  hard-blocks commits and pushes on trunk across every declared sub-repo.
- **Branches here are STACKED, and the merge order is mandatory.** A branch is
  frequently based on another unmerged branch rather than on `origin/develop`.
  Before you assume anything, read the stack from `status.yml` and run
  `git log --oneline origin/develop..HEAD`.
- **Do not rebase onto `origin/develop`, and do not recreate a branch that already
  exists.** On a stacked branch a rebase reorders or duplicates the commits
  underneath you and destroys the merge order. If the base looks wrong, stop and
  ask.
- **Do not amend or force-push commits you did not write.**
- **Do not push.** The human pushes, over SSH. Commit on the branch and report
  the hash. Offer the commit; do not commit unasked, and never use `--no-verify`
  without explicit approval.
- Conventional Commits. Recent history on this line of work is written in
  Spanish; match the surrounding commits.

## Verifying your change without side effects

**Tests:** the suite is green (see the section above), so the bar is simply
1142/1142 with **zero** failures — capture the baseline anyway to prove the
starting point. Run **both** `npm test` and a bare `node --test`: they use
different discovery, and if the two disagree on the test **count** you have put a
file somewhere `node --test` treats as a test. Also check the count did not
*drop*: a deleted or silently skipped test turns green without earning it, so
compare `# tests`, `# skipped` and `# todo`, not just `# fail`. And run it on the
Node 18 floor, not only on the machine's 22 (recipe in the `engines` invariant
above).

**Grep sweeps must include untracked files.** `.gitignore` keeps `.ai-usage/`
and the two `mockup-report*.html` scratch files out of the index while they sit
on disk, so a `git grep` alone can miss a reference. Use a plain recursive grep
excluding `.git` when you rename or remove something. (Those mockups are already
ported into `src/templates/`; do not restore them there.)

**Running `install.sh` mutates your machine unless you contain it.** It writes
into `~/.shakers`, drops a launcher in `~/.local/bin`, can write
`~/.config/shakers/config.json`, and `ensure_on_path` **appends an export
line to your shell rc file**. To exercise the real installer with no side
effects, redirect all three locations and pre-add the bin dir to `PATH` so
`ensure_on_path` early-returns before it can touch any rc file:

```bash
export SHAKERS_CLI_HOME="$TMP/home/.shakers"
export SHAKERS_CLI_BIN="$TMP/bin"
export SHAKERS_CLI_CONFIG_DIR="$TMP/config"
export PATH="$TMP/bin:$PATH"
mkdir -p "$SHAKERS_CLI_BIN" && bash ./install.sh
```

Then verify the result rather than trusting the installer's own output: recompute
every SHA-256 in `$SHAKERS_CLI_HOME/MANIFEST.sha256` against the installed
files, and confirm nothing unexpected (fixtures, tests, scratch files) landed in
the tree. Any change to `install.sh`, to `src/` file membership, or to a removal
that touches the shipped surface, gets this check.

## Out of scope for an agent working here

- Adding a runtime dependency.
- Adding a domain to `SHAKERS_DOMAINS`.
- Rewriting the legal, consent or third-party-processor disclosure text.
- Changing the loopback default endpoints or `BRANCH`/`PIN_REF` semantics in
  `install.sh`.
- Leaving the suite red. There is no preexisting-failures allowance any more
  (issue 047 closed it): if your change ends with a failure, it is yours.
- Pushing, merging, opening PRs, or rebasing a stacked branch.
- Writing production secrets, real Talent data, or machine-specific absolute
  paths into this repo. It is public.
