'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO = path.join(__dirname, '..');

// Claude Desktop's built-in Node imports the manifest entry from its own host script, so require.main is never the entry.
test('the .mcpb entry point answers initialize when a host imports it instead of running it', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'packaging/mcpb/manifest.json'), 'utf8'));
  const entry = path.join(REPO, manifest.server.entry_point);
  assert.equal(manifest.server.mcp_config.args[0], `\${__dirname}/${manifest.server.entry_point}`);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-entry-'));
  const child = spawn(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(entry).href)})`], {
    env: { ...process.env, SHAKERS_CLI_CONFIG_DIR: configDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  try {
    const reply = new Promise((resolve) => {
      let out = '';
      child.stdout.on('data', (d) => { out += d; if (out.includes('\n')) resolve(JSON.parse(out.split('\n')[0])); });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '0.1.0' } } }) + '\n');
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('no initialize reply in 5 s')), 5000));
    const msg = await Promise.race([reply, timeout]);
    assert.equal(msg.id, 0);
    assert.equal(msg.result.serverInfo.name, 'Shakers');
  } finally {
    child.kill();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
