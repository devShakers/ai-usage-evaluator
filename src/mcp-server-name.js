'use strict';

const SERVER_NAME = 'shakers';
const LEGACY_SERVER_NAME = 'shakers-ai-usage';
const OWN_MCP_SERVER_NAMES = new Set([SERVER_NAME, LEGACY_SERVER_NAME]);

module.exports = { SERVER_NAME, LEGACY_SERVER_NAME, OWN_MCP_SERVER_NAMES };
