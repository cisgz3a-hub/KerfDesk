// @vitest-environment node
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import type { KerfDeskMcpBackend } from './backend.js';
import { MCP_MAX_RESULT_BYTES } from './input-schemas.js';
import { createKerfDeskMcpServer } from './server.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function clientFor(backend: KerfDeskMcpBackend, modern: boolean): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const entry = serveStdio(() => createKerfDeskMcpServer(backend), {
    transport: serverTransport,
  });
  const client = new Client(
    { name: 'media-result-test', version: '1.0.0' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  closers.push(async () => {
    await client.close();
    await entry.close();
  });
  await client.connect(clientTransport);
  await client.listTools();
  return client;
}

const textOf = (result: CallToolResult) =>
  result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

describe.each([false, true])('camera image protocol (modern=%s)', (modern) => {
  it('supplies an image to model hosts and retains the structured image for the app', async () => {
    const data = '/9j/' + 'A'.repeat(120_000);
    const snapshot = {
      revision: 'r'.repeat(200),
      status: 'ready',
      image: { mimeType: 'image/jpeg', data, widthPx: 1024, heightPx: 768 },
    };
    const client = await clientFor(
      {
        request: async () => ({
          ...snapshot,
          cameraAddress: 'private-camera-address',
          image: { ...snapshot.image, credential: 'private-camera-credential' },
        }),
      },
      modern,
    );
    const result = await client.callTool({ name: 'get_camera_snapshot', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(snapshot);
    const images = result.content.filter((part) => part.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({ type: 'image', mimeType: 'image/jpeg', data });
    expect(JSON.parse(textOf(result))).toEqual({
      revision: snapshot.revision,
      status: 'ready',
      image: { mimeType: 'image/jpeg', widthPx: 1024, heightPx: 768 },
    });
    expect(textOf(result)).not.toContain(data);
    expect(JSON.stringify(result)).not.toContain('private-camera');
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(MCP_MAX_RESULT_BYTES);
  });

  it.each(['disabled', 'unavailable'])('returns no pixels for a %s camera', async (status) => {
    const snapshot = { revision: 'r', status, message: 'No shared camera picture.' };
    const client = await clientFor({ request: async () => snapshot }, modern);
    const result = await client.callTool({ name: 'get_camera_snapshot', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(snapshot);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(snapshot) }]);
  });

  it.each(['disabled', 'unavailable', 'ready'])(
    'fails safely on contradictory or oversized %s camera output',
    async (status) => {
      const client = await clientFor(
        {
          request: async () => ({
            revision: 'r',
            status,
            image: {
              mimeType: 'image/jpeg',
              data: '/9j/' + 'A'.repeat(status === 'ready' ? 200_000 : 100),
              widthPx: 1,
              heightPx: 1,
            },
          }),
        },
        modern,
      );
      const result = await client.callTool({ name: 'get_camera_snapshot', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({ code: 'failed' });
      expect(result.content.every((part) => part.type === 'text')).toBe(true);
      expect(textOf(result)).not.toContain('/9j/');
    },
  );
});

describe('scene sharing boundary', () => {
  it.each(['disabled', 'unavailable'])(
    'does not disclose image footprints in a %s scene',
    async (status) => {
      const client = await clientFor(
        {
          request: async () => ({
            revision: 'r',
            status,
            images: [
              {
                id: 'private-image',
                unitId: 'private-image',
                editable: true,
                corners: [0, 0, 10, 0, 10, 10, 0, 10],
              },
            ],
          }),
        },
        false,
      );
      const result = await client.callTool({ name: 'get_workspace_scene', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({ code: 'failed' });
      expect(JSON.stringify(result)).not.toContain('private-image');
    },
  );
});
