#!/usr/bin/env node
'use strict';

// Claude Desktop's built-in Node imports this entry from its own host, so it starts without a require.main check.
require('./mcp').run();
