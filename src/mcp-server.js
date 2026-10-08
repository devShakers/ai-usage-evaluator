'use strict';

const readline = require('readline');

const JSONRPC = '2.0';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
// A talent answering a dialog takes human time; past this the tool falls back to asking in the chat.
const ELICITATION_TIMEOUT_MS = 5 * 60 * 1000;
const ELICITATION_ACTIONS = new Set(['accept', 'decline', 'cancel']);

const ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

function isResponse(msg) {
  return !!msg && msg.jsonrpc === JSONRPC && msg.method === undefined && msg.id !== undefined && msg.id !== null && ('result' in msg || 'error' in msg);
}

function isNotification(msg) {
  return !msg || msg.id === undefined || msg.id === null;
}

function resultResponse(id, result) {
  return { jsonrpc: JSONRPC, id, result };
}

function errorResponse(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: JSONRPC, id: id === undefined ? null : id, error };
}

function createMcpServer({ tools = [], prompts = [], serverInfo = {}, protocolVersion, beforeCall = null, instructions = null, elicitationTimeoutMs = ELICITATION_TIMEOUT_MS } = {}) {
  const registry = new Map();
  for (const t of tools) {
    if (!t || !t.name || typeof t.handler !== 'function') {
      throw new Error('each tool needs a name and a handler function');
    }
    registry.set(t.name, t);
  }

  const promptRegistry = new Map();
  for (const p of prompts) {
    if (!p || !p.name || typeof p.buildMessages !== 'function') {
      throw new Error('each prompt needs a name and a buildMessages function');
    }
    promptRegistry.set(p.name, p);
  }

  const advertisedVersion = protocolVersion || DEFAULT_PROTOCOL_VERSION;

  let clientCapabilities = {};
  let send = null;
  let lastRequestId = 0;
  const pending = new Map();

  function request(method, params, timeoutMs) {
    if (!send) return Promise.reject(new Error('no transport to the client'));
    lastRequestId += 1;
    const id = `shakers-${lastRequestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      send({ jsonrpc: JSONRPC, id, method, params });
    });
  }

  function settle(msg) {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.error) waiter.reject(new Error((msg.error && msg.error.message) || 'client error'));
    else waiter.resolve(msg.result);
  }

  function rejectPending(reason) {
    for (const [id, waiter] of pending) {
      pending.delete(id);
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
  }

  // An `elicitation` capability without `form` but with `url` only opens links, so it cannot ask a closed question.
  function canElicitForm() {
    const e = clientCapabilities.elicitation;
    return !!e && typeof e === 'object' && (e.form !== undefined || e.url === undefined);
  }

  // MCP elicitation/create: the client's { action, content }, or null when it has no dialog or the exchange failed.
  async function elicit({ message, requestedSchema }) {
    if (!send || !canElicitForm()) return null;
    try {
      const result = await request('elicitation/create', { message, requestedSchema }, elicitationTimeoutMs);
      return result && ELICITATION_ACTIONS.has(result.action) ? result : null;
    } catch {
      return null;
    }
  }

  function shapeTool(t) {
    return {
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object' },
    };
  }

  function listTools() {
    return { tools: [...registry.values()].map(shapeTool) };
  }

  function shapePrompt(p) {
    const out = { name: p.name, description: p.description || '' };
    if (Array.isArray(p.arguments)) out.arguments = p.arguments;
    return out;
  }

  function listPrompts() {
    return { prompts: [...promptRegistry.values()].map(shapePrompt) };
  }

  function getPrompt(params) {
    const name = params && params.name;
    const prompt = name && promptRegistry.get(name);
    if (!prompt) {
      const err = new Error(`unknown prompt: ${name}`);
      err.rpcCode = ERROR.INVALID_PARAMS;
      throw err;
    }
    return { description: prompt.description || '', messages: prompt.buildMessages((params && params.arguments) || {}) };
  }

  async function listAvailableTools() {
    const out = [];
    for (const t of registry.values()) {
      if (typeof t.available === 'function') {
        let visible = true;
        try {
          visible = (await t.available()) !== false;
        } catch {
          visible = true;
        }
        if (!visible) continue;
      }
      out.push(shapeTool(t));
    }
    return { tools: out };
  }

  async function callTool(params) {
    const name = params && params.name;
    const tool = name && registry.get(name);
    if (!tool) {
      const err = new Error(`unknown tool: ${name}`);
      err.rpcCode = ERROR.INVALID_PARAMS;
      throw err;
    }
    const args = (params && params.arguments) || {};
    // Optional per-call hook (auth-agnostic): the MCP server is long-lived, so this is where the email session's hub JWT gets refreshed before each tool runs.
    if (typeof beforeCall === 'function') {
      try { await beforeCall(name); } catch { /* hook must never break a tool call */ }
    }
    try {
      const value = await tool.handler(args, { elicit, elicitation: !!send && canElicitForm() });
      return {
        content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        isError: false,
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `${name} tool error: ${e && e.message ? e.message : String(e)}` }],
        isError: true,
      };
    }
  }

  async function handleMessage(msg) {
    if (isResponse(msg)) {
      settle(msg);
      return null;
    }
    if (!msg || msg.jsonrpc !== JSONRPC || typeof msg.method !== 'string') {
      if (isNotification(msg)) return null;
      return errorResponse(msg && msg.id, ERROR.INVALID_REQUEST, 'invalid JSON-RPC request');
    }

    const { method, id } = msg;

    if (method.startsWith('notifications/')) {
      return null;
    }

    try {
      switch (method) {
        case 'initialize': {
          const requested = msg.params && msg.params.protocolVersion;
          clientCapabilities = (msg.params && msg.params.capabilities) || {};
          const text = typeof instructions === 'function' ? instructions({ elicitation: canElicitForm() }) : instructions;
          return resultResponse(id, {
            protocolVersion: requested || advertisedVersion,
            capabilities: {
              tools: { listChanged: false },
              ...(promptRegistry.size ? { prompts: { listChanged: false } } : {}),
            },
            serverInfo: {
              name: serverInfo.name || 'shakers-mcp',
              version: serverInfo.version || '0.0.0',
            },
            // Server-level guidance the client keeps in the model's context even
            // when it loads tool schemas lazily (Claude Code defers MCP tools).
            ...(typeof text === 'string' && text ? { instructions: text } : {}),
          });
        }
        case 'ping':
          return resultResponse(id, {});
        case 'tools/list':
          return resultResponse(id, await listAvailableTools());
        case 'tools/call':
          return resultResponse(id, await callTool(msg.params));
        case 'prompts/list':
          return resultResponse(id, listPrompts());
        case 'prompts/get':
          return resultResponse(id, getPrompt(msg.params));
        default:
          if (isNotification(msg)) return null;
          return errorResponse(id, ERROR.METHOD_NOT_FOUND, `method not found: ${method}`);
      }
    } catch (e) {
      if (isNotification(msg)) return null;
      const code = (e && e.rpcCode) || ERROR.INTERNAL;
      return errorResponse(id, code, e && e.message ? e.message : 'internal error');
    }
  }

  function start({ input = process.stdin, output = process.stdout, onError } = {}) {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    const write = (obj) => output.write(`${JSON.stringify(obj)}\n`);
    send = write;
    rl.on('close', () => {
      send = null;
      rejectPending('the client closed the connection');
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        write(errorResponse(null, ERROR.PARSE, 'parse error: invalid JSON'));
        return;
      }
      try {
        const response = await handleMessage(msg);
        if (response) write(response);
      } catch (e) {
        if (onError) onError(e);
        if (!isNotification(msg)) {
          write(errorResponse(msg.id, ERROR.INTERNAL, e && e.message ? e.message : 'internal error'));
        }
      }
    });

    return rl;
  }

  return { handleMessage, listTools, listAvailableTools, callTool, start };
}

module.exports = { createMcpServer, ERROR, DEFAULT_PROTOCOL_VERSION };
