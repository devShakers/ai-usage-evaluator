'use strict';

// Display-only authorship-transparency check (talents-ai-score).
//
// Warns the talent when their commits in the selected repos are authored under
// an email that is not their Shakers account email, so their own work would be
// attributed to nobody. This is a WARNING surface ONLY: it reads each repo's
// CONFIGURED commit identity (`git config user.email`) and compares counts the
// attribution path already produced — it NEVER feeds attribution/scoring.
// git-activity.js owns `authoredCommitCount`; nothing here changes any count.

const { execFileSync } = require('child_process');

// The repo's locally configured commit identity. A plain config read, NOT the
// authorship log parse — it only names who new commits here would be attributed to.
function readConfiguredEmail(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'config', '--get', 'user.email'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const value = String(out || '').trim();
    return value || null;
  } catch {
    return null;
  }
}

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

// Returns { accountEmail, emails: [configured emails that differ from the account] }
// when the talent's own commits are plausibly going unattributed, else null.
//
// Conservative on purpose (a false warning erodes trust more than a missed one):
// it fires only when the account email is known, the selection HAS commits, NONE
// are attributed to the account, and at least one repo is configured under a
// different email we can name.
function detectAuthorshipMismatch(toplevels, accountEmail, gitActivity, { readEmail = readConfiguredEmail } = {}) {
  const account = normalize(accountEmail);
  if (!account) return null;
  if (!gitActivity) return null;
  const commits = gitActivity.commitCount || 0;
  const authored = gitActivity.authoredCommitCount || 0;
  if (commits === 0 || authored > 0) return null;

  const emails = [];
  const seen = new Set();
  for (const root of Array.isArray(toplevels) ? toplevels : []) {
    const configured = readEmail(root);
    const key = normalize(configured);
    if (!key || key === account || seen.has(key)) continue;
    seen.add(key);
    emails.push(String(configured).trim());
  }
  if (emails.length === 0) return null;
  return { accountEmail: String(accountEmail).trim(), emails };
}

module.exports = { detectAuthorshipMismatch, readConfiguredEmail };
