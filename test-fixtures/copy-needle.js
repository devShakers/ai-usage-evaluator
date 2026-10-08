'use strict';

const assert = require('node:assert/strict');

/*
 * `needle()` — the guard for every assertion whose HAYSTACK is rendered output and
 * whose NEEDLE comes from the i18n catalog (issue 097).
 *
 * ## The bug it exists for
 *
 *     assert.ok(html.includes(catalog.someCopyKey))
 *
 * `includes(undefined)` coerces to `includes("undefined")`, and a rendered document
 * can contain that literal string — `templates/report-sheet.html` does, and any
 * flow that interpolates a missing catalog value into its own output produces it
 * too. So the assertion above SURVIVES DELETING `someCopyKey`: it silently stops
 * checking copy and starts checking that the word "undefined" is somewhere on the
 * page, which it always is.
 *
 * That is the worst failure mode a guard can have, and it was found in the one
 * place it matters most: this surface has already lost two blocks with every suite
 * green (issues 086 and 089).
 *
 * ## Why a shared module and not a local helper
 *
 * Because it was written three times in three files during issue 089 before anyone
 * noticed, which is the same "third place that knows the same thing" smell the
 * command graph (issue 081) and the colour gate (issue 079) were built to remove.
 * One implementation, required by every test that asserts copy.
 *
 * ## How to use it
 *
 *     assert.ok(html.includes(needle(c.agentsT)));
 *     assert.match(out, new RegExp(needle(ca.questionHeading(1))));
 *
 * It returns the value unchanged when the value is a usable string, so it composes
 * with `.replace()`, template literals and regex escaping. Wrap the CATALOG
 * expression, not the transformed one: `needle(ca.foo).replace(...)`, so a missing
 * key fails with this message rather than with a `TypeError` from `.replace`.
 */
function needle(value, label = 'catalog value') {
  assert.equal(
    typeof value, 'string',
    `${label}: the needle is ${typeof value}, not a string — a needle of "undefined" matches any document that contains that word, so this assertion would pass with the copy deleted`,
  );
  assert.ok(value.length > 0, `${label}: the needle is an empty string, which matches everything`);
  return value;
}

module.exports = { needle };
