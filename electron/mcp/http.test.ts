// @vitest-environment node
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { KerfDeskMcpError } from './backend.js';
import { createKerfDeskMcpServer } from './server.js';

describe.each([false, true])('portable HTTP factory (modern=%s)', (modern) => {
  it('connects an official client and calls through a Web Standard HTTP handler', async () => {
    const request = vi.fn(async () => ({
      revision: 'workspace-1',
      app: { name: 'KerfDesk', version: '1.0.4', platform: 'desktop' },
      edition: { mode: 'free', licenceKey: 'secret-key' },
      updates: { available: false },
    }));
    const handler = createMcpHandler(() => createKerfDeskMcpServer({ request }), {
      maxRequestBodySize: 32 * 1024,
      keepAliveMs: 0,
    });
    const client = new Client(
      { name: 'http-protocol-test', version: '1.0.0' },
      modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
    );
    try {
      const transport = new StreamableHTTPClientTransport(new URL('https://paired.test/mcp'), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      });
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(10);
      const result = await client.callTool({ name: 'get_app_status', arguments: {} });
      expect(result.structuredContent).toMatchObject({ revision: 'workspace-1' });
      expect(JSON.stringify(result)).not.toContain('secret-key');
      expect(request).toHaveBeenCalledWith('get_app_status', {}, expect.any(AbortSignal));
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it('delivers a generic backend error without invalidating the advertised success schema', async () => {
    const handler = createMcpHandler(
      () =>
        createKerfDeskMcpServer({
          request: async () => {
            throw new KerfDeskMcpError('unavailable');
          },
        }),
      { keepAliveMs: 0 },
    );
    const client = new Client(
      { name: 'http-error-test', version: '1.0.0' },
      modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL('https://paired.test/mcp'), {
          fetch: (url, init) => handler.fetch(new Request(url, init)),
        }),
      );
      await client.listTools();
      const result = await client.callTool({ name: 'get_workspace', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: { code: 'unavailable' } });
      const invalid = await client.callTool({
        name: 'get_workspace',
        arguments: { 'private-key': 'private-value' },
      });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid)).toContain('Invalid tool arguments.');
      expect(JSON.stringify(invalid)).not.toContain('private');
    } finally {
      await client.close();
      await handler.close();
    }
  });
});

it('rejects oversized HTTP bodies before constructing a server or contacting a desktop', async () => {
  const factory = vi.fn(() => createKerfDeskMcpServer({ request: async () => ({}) }));
  const handler = createMcpHandler(factory, { maxRequestBodySize: 256 });
  try {
    const response = await handler.fetch(
      new Request('https://paired.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { arguments: { text: 's'.repeat(300) } },
        }),
      }),
    );
    expect(response.status).toBe(413);
    expect(factory).not.toHaveBeenCalled();
  } finally {
    await handler.close();
  }
});
