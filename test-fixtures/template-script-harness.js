'use strict';

/*
 * TEST FIXTURE — a `vm` double for EXECUTING the inline `<script>`(s) shipped
 * inside `src/templates/*.html` (issue 067). Not shipped (not under `src/`, not
 * in `install.sh`'s FILES/ASSETS), not picked up by `node --test` (not under a
 * directory named `test`) — same two reasons `ingest-service-fake.js` lives
 * here instead of `src/` or `test/` (see AGENTS.md, "Test layout").
 *
 * WHY THIS EXISTS: `src/templates/*.html` is asserted by its markup everywhere
 * else in the suite, and the JavaScript inside its `<script>` tags never runs.
 * Issues 052 and 066 each built a ONE-OFF `vm`/`Function` sandbox to execute a
 * FEW named functions extracted from the rendered output (052:
 * `test/graph-report-xss.test.js`'s `esc`/`clip`/`openDetail`; 066:
 * `test/report-store.test.js`'s `paintRing`/`countUp`). Issue 067 is about the
 * CLASS, not two more one-off extractions: this fixture generalizes the same
 * technique — extract the REAL script text from the REAL rendered output, run
 * it against a document/window double, never a reimplementation of it — into
 * one shared place, so a script can be executed WHOLE (every statement, not
 * just the ones someone thought to name) and reused by any future template.
 *
 * The document double is built FROM THE RENDERED HTML STRING: only the ids
 * that string actually contains get a stub node; every other id resolves to
 * `null`, exactly like a real DOM. This is what lets a test express "no
 * footprint" as data (render without footprint) rather than as sandbox
 * plumbing (hand-picking which ids to stub) — the absence of `#ringFill` in a
 * certification-only report falls out of the SAME renderer real Talents get,
 * not a second, parallel description of it.
 *
 * `requestAnimationFrame` deliberately advances a fake clock rather than
 * invoking its callback with a fixed timestamp: `report-sheet.html`'s
 * `countUp()` recurses via `requestAnimationFrame` until enough time has
 * "passed", and a callback invoked synchronously with the SAME timestamp loops
 * forever (verified empirically while building this fixture — a real browser
 * never calls it recursively inside itself, so this is only a hazard of
 * running it synchronously in a sandbox, not a fact about the shipped script).
 */

const vm = require('vm');

// Every `<script>...</script>` block, in document order (so a template that
// vendors a library before its own app code — graph-report.html's dagre-lib —
// can run the library first, into the SAME sandbox, before the app script that
// depends on it runs).
function extractScripts(html) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add(...c) { c.forEach((x) => set.add(x)); },
    remove(...c) { c.forEach((x) => set.delete(x)); },
    toggle(c, force) {
      if (force === undefined) { if (set.has(c)) set.delete(c); else set.add(c); return set.has(c); }
      if (force) set.add(c); else set.delete(c);
      return force;
    },
    contains(c) { return set.has(c); },
  };
}

// A generic stub element: enough surface for both templates' scripts
// (style/classList/dataset/attributes/addEventListener/appendChild/rects),
// deliberately NOT a real DOM — this executes the TEMPLATE'S code, not a
// reimplementation of the browser.
// `style` needs both plain property assignment (`el.style.strokeDasharray =
// x`, used throughout both templates) AND `setProperty`/`getPropertyValue`
// (used for the `--len` CSS custom property on SVG edges in
// graph-report.html) — a plain `{}` only supports the former.
function makeStyle() {
  return {
    setProperty(k, v) { this[k] = v; },
    getPropertyValue(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : ''; },
    removeProperty(k) { delete this[k]; },
  };
}

function makeNode(tag, initialClasses) {
  const listeners = {};
  return {
    tagName: (tag || 'div').toUpperCase(),
    style: makeStyle(),
    dataset: {},
    attrs: {},
    children: [],
    classList: makeClassList(initialClasses),
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      if (!listeners[ev]) return;
      listeners[ev] = listeners[ev].filter((f) => f !== fn);
    },
    // test-only escape hatch: fire a listener registered on THIS node.
    _fire(ev, evt) { (listeners[ev] || []).forEach((fn) => fn(evt || {})); },
    appendChild(c) { this.children.push(c); return c; },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; },
    setPointerCapture() {},
    getTotalLength() { return 0; },
    // Real `textContent`/`innerHTML` coerce to string on assignment (so
    // `el.textContent = 0` reads back `"0"`, not `""`) — `|| ''` here would
    // treat a falsy-but-real value (0, in particular the SCORE-0 case) as
    // "never set". Initialized to '' so an untouched node reads empty, like a
    // real one.
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get offsetLeft() { return 0; },
    get offsetWidth() { return 100; },
  };
}

/*
 * Builds a `document` stub from a RENDERED html string. `getElementById`
 * returns a stub for an id that is actually present in `html`, `null`
 * otherwise — this is what lets "no footprint" be expressed as an absent
 * `#ringFill` in the rendered output, not a hand-picked sandbox affordance.
 * `activeTab`/`activeTabPanel`/`extraSelectors` cover the handful of
 * class-selector lookups (`.tab.active`, `.tabpanel.show`) the templates make
 * for markup that is unconditionally present (see the inventory in
 * test/render-sheet-script.test.js) — everything else through
 * `querySelector`/`querySelectorAll` returns nothing, which is also
 * behaviourally correct: neither template queries a class that can be
 * data-dependent through anything OTHER than `getElementById`.
 */
function buildDocumentStub(html, { querySelectorMap = {} } = {}) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const registry = new Map();
  for (const id of ids) registry.set(id, makeNode());
  return {
    documentElement: makeNode('html'),
    getElementById: (id) => registry.get(id) || null,
    querySelector: (sel) => (Object.prototype.hasOwnProperty.call(querySelectorMap, sel) ? querySelectorMap[sel] : null),
    querySelectorAll: () => [],
    addEventListener() {},
    createElementNS: (ns, tag) => makeNode(tag),
    _registry: registry, // test-only: lets a test fire a click on a real id.
  };
}

/*
 * Builds the sandbox WITHOUT running any script yet — split out from
 * `runTemplateScripts` so a test can run a template's scripts ONE AT A TIME
 * (needed to patch a stub node's behaviour BETWEEN two script blocks, e.g.
 * making `graph-report.html`'s #stage throw on `getBoundingClientRect()`
 * right before its app script runs, to prove `fit()` failing does not also
 * take `applyHash()`/`window.__READY__` down with it — see
 * test/render-graph-report-script.test.js).
 */
function buildSandbox(html, { sandbox: extraSandbox = {}, querySelectorMap = {} } = {}) {
  const documentStub = buildDocumentStub(html, { querySelectorMap });
  let rafClock = 0;
  const sandbox = Object.assign({
    document: documentStub,
    console,
    Math, Array, Object, JSON, Set, Map,
    // Advances a fake clock rather than replaying a fixed timestamp — see the
    // fixture's file docstring for why a fixed timestamp loops forever here.
    requestAnimationFrame: (fn) => { rafClock += 10000; fn(rafClock); },
    setTimeout: () => {},
    matchMedia: () => ({ matches: false }),
    navigator: { clipboard: null },
    location: { hash: '' },
    structuredClone: typeof structuredClone === 'function' ? structuredClone : undefined,
  }, extraSandbox);
  sandbox.window = sandbox; // `window.addEventListener('load', …)` == `addEventListener` on the sandbox global, like a real global scope.
  const windowListeners = {};
  const originalAddEventListener = sandbox.addEventListener;
  sandbox.addEventListener = function (ev, fn) {
    (windowListeners[ev] = windowListeners[ev] || []).push(fn);
    if (typeof originalAddEventListener === 'function') originalAddEventListener.call(this, ev, fn);
  };
  vm.createContext(sandbox);
  return { sandbox, documentStub, windowListeners };
}

// Runs ONE script body (already extracted) into an existing, already-created
// sandbox context.
function runScript(scriptText, sandbox) {
  vm.runInContext(scriptText, sandbox);
}

/*
 * Convenience for the common case: build the sandbox AND run every
 * `<script>` block found in `html`, IN ORDER, into it — so a vendored library
 * script (graph-report.html's dagre-lib) executes before the app script that
 * calls into it, exactly as a browser would parsing the document top to
 * bottom. Returns the sandbox (for asserting on captured listeners / side
 * effects) — a script's throw is NOT swallowed here; a test decides whether
 * that throw is expected.
 */
function runTemplateScripts(html, opts = {}) {
  const { sandbox, documentStub, windowListeners } = buildSandbox(html, opts);
  for (const script of extractScripts(html)) runScript(script, sandbox);
  return { sandbox, documentStub, windowListeners };
}

// Fires every listener registered for `name` via `window.addEventListener`
// (e.g. 'load', 'resize'). Lets exceptions propagate — a test decides whether
// a throw here is a regression.
function fireWindowEvent(windowListeners, name, evt) {
  for (const fn of windowListeners[name] || []) fn(evt || {});
}

module.exports = {
  extractScripts, buildDocumentStub, makeNode,
  buildSandbox, runScript, runTemplateScripts, fireWindowEvent,
};
