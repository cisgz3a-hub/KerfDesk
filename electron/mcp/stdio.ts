import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { type KerfDeskMcpBackend } from './backend.js';
import { createKerfDeskMcpServer } from './server.js';

/** Node-only entry: keeps streams/process dependencies out of the portable server builder. */
export function serveKerfDeskMcpStdio(backend: KerfDeskMcpBackend): StdioServerHandle {
  return serveStdio(() => createKerfDeskMcpServer(backend));
}
