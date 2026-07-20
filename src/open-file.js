'use strict';

const { spawn } = require('child_process');

/*
 * Zero-dependency, best-effort "open this file in the OS default app" (ADR-016,
 * used by the `report` command to open the generated HTML in the browser).
 *
 * It NEVER throws and NEVER blocks: the platform opener is spawned DETACHED and
 * its stdio ignored, so a headless machine (no `xdg-open`, no display) or a
 * missing opener degrades silently. Failing to open is not a failure of the
 * command — the caller still prints the clickable file:// link. Returns whether
 * the spawn was even attempted (not whether the app actually opened — that is
 * asynchronous and out of our hands).
 */
function openPath(target) {
  let cmd;
  let args;
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [target];
  } else if (process.platform === 'win32') {
    // `start` needs an (empty) title arg first when the target may be quoted.
    cmd = 'cmd';
    args = ['/c', 'start', '', target];
  } else {
    cmd = 'xdg-open';
    args = [target];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    // An absent opener (ENOENT) surfaces as an async 'error' — swallow it so it
    // never becomes an unhandled exception that breaks the REPL.
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { openPath };
