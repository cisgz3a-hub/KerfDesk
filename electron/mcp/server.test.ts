// @vitest-environment node
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KerfDeskMcpError, mcpErrorMessages, type KerfDeskMcpBackend } from './backend.js';
import { type KerfDeskMcpCommand, MCP_MAX_RESULT_BYTES } from './input-schemas.js';
import { createKerfDeskMcpServer } from './server.js';
const writeAdmission = {
  expectedRevision: 'revision-1',
  requestId: '12345678-1234-4234-8234-123456789abc',
};

const toolExamples: Record<KerfDeskMcpCommand, Record<string, unknown>> = {
  get_workspace: {},
  get_machine: {},
  get_app_status: {},
  list_material_recipes: {},
  review_job: {},
  set_selection: { ...writeAdmission, artworkIds: ['art-1'] },
  add_text: { ...writeAdmission, xMm: 10, yMm: 20, widthMm: 30, text: 'Hello', fontSizeMm: 5 },
  add_rectangle: { ...writeAdmission, xMm: 10, yMm: 20, widthMm: 30, heightMm: 40 },
  transform_artwork: {
    ...writeAdmission,
    artworkIds: ['art-1'],
    transform: { type: 'move', dxMm: -5, dyMm: 3 },
  },
  update_operation: { ...writeAdmission, operationId: 'op-1', patch: { powerPercent: 30 } },
};

const bounds = { xMm: 10, yMm: 20, widthMm: 30, heightMm: 40 };
const readResults: Partial<Record<KerfDeskMcpCommand, Record<string, unknown>>> = {
  get_workspace: {
    revision: 'revision-1',
    mode: 'laser',
    name: 'Untitled',
    dirty: true,
    selection: ['art-1'],
    artwork: [{ id: 'art-1', type: 'rectangle', name: 'Rectangle', bounds, operationId: 'op-1' }],
    operations: [
      { id: 'op-1', type: 'line', enabled: true, powerPercent: 30, speedMmPerMin: 1500, passes: 1 },
    ],
    totalArtwork: 1,
    totalOperations: 1,
    truncated: false,
  },
  get_machine: {
    revision: 'revision-1',
    machine: {
      id: 'machine-1',
      name: 'My laser',
      controller: 'grbl',
      mode: 'laser',
      bedWidthMm: 300,
      bedHeightMm: 200,
      units: 'mm',
    },
  },
  get_app_status: {
    revision: 'revision-1',
    app: { name: 'KerfDesk', version: '1.0.4', platform: 'desktop' },
    edition: { mode: 'free' },
    updates: { available: false },
  },
  list_material_recipes: {
    revision: 'revision-1',
    recipes: [
      {
        id: 'recipe-1',
        name: 'My measured recipe',
        powerPercent: 25,
        speedMmPerMin: 1200,
        passes: 1,
        notes: 'User saved values',
      },
    ],
    total: 1,
    truncated: false,
  },
  review_job: {
    revision: 'revision-1',
    status: 'ready',
    mode: 'laser',
    summary: { artworkCount: 1, operationCount: 1, estimatedSeconds: 12, bounds },
    warnings: [{ code: 'user-check', message: 'Review the material setup.', severity: 'warning' }],
    frame: { required: true, complete: false },
  },
};

function successfulBackend(): KerfDeskMcpBackend {
  return {
    request: async (command) =>
      structuredClone(
        readResults[command as KerfDeskMcpCommand] ?? {
          revision: 'revision-2',
          changedArtworkIds: ['art-1'],
          selection: ['art-1'],
        },
      ),
  };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** Real SDK handshake and dispatch through the recommended dual-era serving entry. */
async function connectedClient(backend: KerfDeskMcpBackend, modern = false): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const entry = serveStdio(() => createKerfDeskMcpServer(backend), { transport: serverTransport });
  const client = new Client(
    { name: 'kerfdesk-protocol-test', version: '1.0.0' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  closers.push(async () => {
    await client.close();
    await entry.close();
  });
  await client.connect(clientTransport);
  return client;
}

function responseText(result: CallToolResult): string {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

describe.each([false, true])('official client protocol (modern=%s)', (modern) => {
  it('initialises, lists the bounded schema and calls every permitted tool', async () => {
    const backend = successfulBackend();
    const request = vi.spyOn(backend, 'request');
    const client = await connectedClient(backend, modern);
    expect(client.getServerVersion()).toMatchObject({ name: 'kerfdesk-desktop', version: '1.0.0' });
    const listing = await client.listTools();
    expect(listing.tools.map((tool) => tool.name)).toEqual(Object.keys(toolExamples));
    for (const tool of listing.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect(tool.annotations?.readOnlyHint).toBe(tool.name in readResults);
      expect(tool._meta).toBeUndefined();
      const result = await client.callTool({
        name: tool.name,
        arguments: toolExamples[tool.name as KerfDeskMcpCommand],
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        revision: expect.stringMatching(/^revision-/),
      });
      expect(JSON.parse(responseText(result))).toEqual(result.structuredContent);
    }
    expect(request).toHaveBeenCalledTimes(10);
    expect(request.mock.calls.every((call) => call[2] instanceof AbortSignal)).toBe(true);
  });

  it('accepts supported transforms and zero power/disabled operation values', async () => {
    const request = vi.fn(successfulBackend().request);
    const client = await connectedClient({ request }, modern);
    for (const transform of [
      { type: 'move', dxMm: -100_000, dyMm: 100_000 },
      { type: 'resize', widthMm: 1, heightMm: 100_000 },
      { type: 'rotate', angleDeg: -36_000 },
    ]) {
      const result = await client.callTool({
        name: 'transform_artwork',
        arguments: { ...writeAdmission, artworkIds: ['art-1'], transform },
      });
      expect(result.isError).not.toBe(true);
      expect(request).toHaveBeenLastCalledWith(
        'transform_artwork',
        { ...writeAdmission, artworkIds: ['art-1'], transform },
        expect.any(AbortSignal),
      );
    }
    const result = await client.callTool({
      name: 'update_operation',
      arguments: {
        ...writeAdmission,
        operationId: 'op-1',
        patch: { powerPercent: 0, speedMmPerMin: 1, passes: 1, enabled: false },
      },
    });
    expect(result.isError).not.toBe(true);
    expect(
      (
        await client.callTool({
          name: 'set_selection',
          arguments: { ...writeAdmission, artworkIds: [] },
        })
      ).isError,
    ).not.toBe(true);
  });

  it('never forwards an unregistered machine or arbitrary-code command', async () => {
    const request = vi.fn(successfulBackend().request);
    const client = await connectedClient({ request }, modern);
    for (const name of ['start', 'frame', 'send_gcode', 'execute_shell', 'read_file']) {
      await expect(client.callTool({ name, arguments: {} })).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
});

describe('input admission before the desktop bridge', () => {
  const invalidCases: Array<[KerfDeskMcpCommand, Record<string, unknown>]> = [
    ['get_app_status', { licenceKey: 'secret-value' }],
    ['set_selection', { artworkIds: [] }],
    ['set_selection', { ...writeAdmission, requestId: 'not-a-uuid', artworkIds: [] }],
    ['set_selection', { ...writeAdmission, expectedRevision: '', artworkIds: [] }],
    [
      'set_selection',
      { ...writeAdmission, artworkIds: Array.from({ length: 201 }, () => 'art-1') },
    ],
    ['add_text', { ...toolExamples.add_text, text: '' }],
    ['add_text', { ...toolExamples.add_text, text: 'a'.repeat(4097) }],
    ['add_text', { ...toolExamples.add_text, fontFile: 'C:/private/font.ttf' }],
    ['add_text', { ...toolExamples.add_text, fontSizeMm: 1001 }],
    ['add_rectangle', { ...toolExamples.add_rectangle, widthMm: 0 }],
    ['add_rectangle', { ...toolExamples.add_rectangle, yMm: -100_001 }],
    ['add_rectangle', { ...toolExamples.add_rectangle, xMm: Infinity }],
    ['transform_artwork', { ...toolExamples.transform_artwork, artworkIds: [] }],
    [
      'transform_artwork',
      { ...toolExamples.transform_artwork, transform: { type: 'rotate', angleDeg: 36_001 } },
    ],
    [
      'transform_artwork',
      {
        ...toolExamples.transform_artwork,
        transform: { type: 'move', dxMm: 1, dyMm: 2, gcode: 'M3' },
      },
    ],
    ['update_operation', { ...toolExamples.update_operation, patch: {} }],
    ['update_operation', { ...toolExamples.update_operation, patch: { powerPercent: 101 } }],
    ['update_operation', { ...toolExamples.update_operation, patch: { speedMmPerMin: 0 } }],
    ['update_operation', { ...toolExamples.update_operation, patch: { passes: 1.5 } }],
    ['update_operation', { ...toolExamples.update_operation, patch: { vCarve: true } }],
  ];

  it.each(invalidCases)(
    'rejects invalid %s input without calling the backend',
    async (name, args) => {
      const request = vi.fn(successfulBackend().request);
      const client = await connectedClient({ request });
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(responseText(result)).toContain('Invalid tool arguments.');
      expect(responseText(result)).not.toContain('secret-value');
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('keeps malicious unknown-key validation errors small and redacted', async () => {
    const request = vi.fn(successfulBackend().request);
    const client = await connectedClient({ request });
    const secretKey = `licence-key-${'s'.repeat(100_000)}`;
    const result = await client.callTool({
      name: 'get_workspace',
      arguments: { [secretKey]: 'private' },
    });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(512);
    expect(responseText(result)).not.toContain('licence-key');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('backend failures', () => {
  it.each(Object.keys(mcpErrorMessages))('returns only whitelisted %s errors', async (code) => {
    const client = await connectedClient({
      request: async () => {
        throw { code, message: 'C:/private/key secret-stack', licenceKey: 'private-secret' };
      },
    });
    const result = await client.callTool({ name: 'get_workspace', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: { code, message: mcpErrorMessages[code as keyof typeof mcpErrorMessages] },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|secret-stack/);
  });

  it.each([
    new Error('private-stack C:/secret'),
    { code: 'unknown_secret', message: 'private-key' },
    'private-token',
    {
      get code() {
        throw new Error('private-getter');
      },
    },
  ])('redacts unknown backend exception %#', async (error) => {
    const client = await connectedClient({
      request: async () => {
        throw error;
      },
    });
    const result = await client.callTool({ name: 'get_app_status', arguments: {} });
    expect(result.structuredContent).toEqual({
      error: { code: 'failed', message: mcpErrorMessages.failed },
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('preserves unavailable and stale-revision codes without claiming a mutation', async () => {
    const client = await connectedClient({
      request: async () => {
        throw new KerfDeskMcpError('stale_revision');
      },
    });
    const result = await client.callTool({
      name: 'add_rectangle',
      arguments: toolExamples.add_rectangle,
    });
    expect(result.structuredContent).toMatchObject({ error: { code: 'stale_revision' } });
    expect(result.structuredContent).not.toHaveProperty('changedArtworkIds');
  });
});

describe('projected and bounded desktop responses', () => {
  it('strips unknown credentials and identifiers from nested status and machine objects', async () => {
    const client = await connectedClient({
      request: async (name) => {
        if (name === 'get_machine')
          return {
            ...readResults.get_machine,
            cameraCredentials: 'camera-secret',
            machine: {
              ...(readResults.get_machine?.machine as object),
              port: 'COM-private',
              cameraUrl: 'rtsp://secret',
              deviceId: 'private-device',
            },
          };
        return {
          ...readResults.get_app_status,
          licenceKey: 'private-licence',
          app: { ...(readResults.get_app_status?.app as object), nativePath: 'C:/private' },
          edition: {
            mode: 'pro',
            licenceKey: 'private-key',
            email: 'private@example.com',
            deviceId: 'private-device',
          },
          updates: {
            available: true,
            version: '1.0.5',
            highlights: ['Clearer update notes'],
            token: 'private-token',
          },
        };
      },
    });
    for (const name of ['get_machine', 'get_app_status']) {
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/private|rtsp|cameraCredentials/);
    }
  });

  it('strips unknown fields from workspace records and operation results', async () => {
    const client = await connectedClient({
      request: async (name) =>
        name === 'get_workspace'
          ? {
              ...readResults.get_workspace,
              rawGcode: 'private-gcode',
              artwork: [
                {
                  id: 'art-1',
                  type: 'rectangle',
                  bounds: { xMm: 1, yMm: 2, widthMm: 3, heightMm: 4, nativePath: 'private-path' },
                  sourceFile: 'private-source',
                },
              ],
              operations: [
                { id: 'op-1', type: 'line', enabled: true, rawCommand: 'private-command' },
              ],
            }
          : {
              revision: 'revision-2',
              changedFields: ['powerPercent'],
              operationId: 'op-1',
              licenceKey: 'private-key',
            },
    });
    for (const name of ['get_workspace', 'update_operation'] as const) {
      const result = await client.callTool({ name, arguments: toolExamples[name] });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain('private');
    }
  });

  it.each([
    {
      revision: 'revision-1',
      app: { name: 'KerfDesk', version: '1.0.4', platform: 'web' },
      edition: { mode: 'free' },
      updates: { available: false },
    },
    {
      ...readResults.get_workspace,
      artwork: Array.from({ length: 201 }, () => ({ id: 'art-1', type: 'rectangle' })),
    },
    { ...readResults.review_job, frame: { required: false, complete: true } },
  ])('fails closed on malformed desktop response %#', async (raw) => {
    const client = await connectedClient({ request: async () => raw });
    const name =
      'app' in raw ? 'get_app_status' : 'artwork' in raw ? 'get_workspace' : 'review_job';
    const result = await client.callTool({ name, arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'failed' } });
  });

  it('bounds the whole response including UTF-8 text and structured content', async () => {
    const client = await connectedClient({
      request: async () => ({
        revision: 'revision-1',
        total: 200,
        truncated: false,
        recipes: Array.from({ length: 200 }, (_, index) => ({
          id: `recipe-${index}`,
          name: 'Saved',
          notes: '材料'.repeat(1000),
        })),
      }),
    });
    const result = await client.callTool({ name: 'list_material_recipes', arguments: {} });
    expect(result.structuredContent).toMatchObject({ error: { code: 'failed' } });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(MCP_MAX_RESULT_BYTES);
  });
});

describe('official protocol cancellation', () => {
  it.each([false, true])(
    'forwards cancellation and ignores a late backend response (modern=%s)',
    async (modern) => {
      let finish: ((value: Record<string, unknown>) => void) | undefined;
      let backendSignal: AbortSignal | undefined;
      const request = vi.fn<KerfDeskMcpBackend['request']>((_command, _args, signal) => {
        backendSignal = signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const client = await connectedClient({ request }, modern);
      const controller = new AbortController();
      const call = client.callTool(
        { name: 'add_text', arguments: toolExamples.add_text },
        { signal: controller.signal },
      );
      const rejected = expect(call).rejects.toThrow();
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      controller.abort();
      await rejected;
      await vi.waitFor(() => expect(backendSignal?.aborted).toBe(true));
      finish?.({ revision: 'late-revision', changedArtworkIds: ['late-art'] });
      await Promise.resolve();
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('allows a later read after a cancelled request with a new signal', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    let attempt = 0;
    const client = await connectedClient({
      request: (_command, _args, signal) => {
        signals.push(signal);
        if (++attempt > 1) return successfulBackend().request('get_app_status', {}, signal);
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new KerfDeskMcpError('cancelled')), {
            once: true,
          }),
        );
      },
    });
    const controller = new AbortController();
    const call = client.callTool(
      { name: 'get_app_status', arguments: {} },
      { signal: controller.signal },
    );
    const rejected = expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();
    await rejected;
    const next = await client.callTool({ name: 'get_app_status', arguments: {} });
    expect(next.structuredContent).toEqual(readResults.get_app_status);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('aborts pending bridge work when the client connection closes', async () => {
    let signal: AbortSignal | undefined;
    const client = await connectedClient({
      request: (_command, _args, requestSignal) => {
        signal = requestSignal;
        return new Promise(() => {});
      },
    });
    const call = client.callTool({ name: 'get_workspace', arguments: {} });
    const rejected = expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(signal).toBeDefined());
    await client.close();
    await rejected;
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
});
