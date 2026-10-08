'use strict';

const { spawn } = require('child_process');

// Zero-dependency, best-effort "open this file in the OS default app" (ADR-016, used by the `report` command to open the generated HTML in the browser).
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
