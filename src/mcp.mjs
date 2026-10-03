// A stdio MCP server over the command table: newline-delimited JSON-RPC, no SDK. Every command is a
// tool; its description and input schema come from the table, so the two cannot drift apart.

import { createInterface } from 'node:readline';
import { FramError, Store } from './store.mjs';
import { commands, run } from './commands.mjs';

const INSTRUCTIONS = 'Framery is a design studio: pages of frames (html screens), groups, flowchart nodes and arrows. Call outline first to read a page, then edit with the other tools. Give the person link(...) to look at your work.';

export function mcp({ root }) {
  const store = new Store(root);
  const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  const fault = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

  async function handle(message) {
    const { id, method, params } = message;
    if (id === undefined) return; // a notification, nothing to answer
    if (method === 'initialize') {
      return reply(id, { protocolVersion: params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'framery', version: '0.1.0' }, instructions: INSTRUCTIONS });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') {
      return reply(id, { tools: Object.entries(commands).map(([name, c]) => ({ name, description: c.description, inputSchema: c.input })) });
    }
    if (method === 'tools/call') {
      try {
        const out = await run(store, params.name, params.arguments ?? {});
        return reply(id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }] });
      } catch (error) {
        const known = error instanceof FramError;
        return reply(id, { isError: true, content: [{ type: 'text', text: known ? error.message : `internal error: ${error.message}` }] });
      }
    }
    return fault(id, -32601, `unknown method ${method}`);
  }

  createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return fault(null, -32700, 'parse error');
    }
    handle(message).catch((error) => fault(message.id ?? null, -32603, error.message));
  });
}
