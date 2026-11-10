// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KerfDeskMcpError, mcpErrorMessages } from './backend.js';
import { type KerfDeskMcpCommand } from './input-schemas.js';
import { KERFDESK_WORKSPACE_APP_URI as KERFDESK_WORKSPACE_UI_URI } from './workspace-app-ui.js';
import { mcpMachineToolInfo } from './machine-tool-info.js';
import {
  closeClients,
  connectedClient,
  listedTools,
  readResults,
  responseText,
  successfulBackend,
  toolExamples,
  writeAdmission,
} from './server.test-support.js';

afterEach(closeClients);

describe.each([false, true])('official client protocol (modern=%s)', (modern) => {
  it('forwards each actual wire request ID with its own concurrent backend call', async () => {
    const backend = successfulBackend();
    const request = vi.spyOn(backend, 'request');
    const wireCalls = new Map<string, string | number>();
    const client = await connectedClient(backend, modern, wireCalls);
    await Promise.all([
      client.callTool({ name: 'get_workspace', arguments: {} }),
      client.callTool({ name: 'get_app_status', arguments: {} }),
    ]);
    expect(wireCalls.size).toBe(2);
    expect(request).toHaveBeenCalledTimes(2);
    for (const [command, args, signal, id] of request.mock.calls) {
      expect(args).toEqual({});
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(id).toBe(wireCalls.get(command));
    }
    expect(new Set(request.mock.calls.map((call) => call[3])).size).toBe(2);
  });
  it('initialises, lists the bounded schema and calls every permitted tool', async () => {
    const backend = successfulBackend();
    const request = vi.spyOn(backend, 'request');
    const client = await connectedClient(backend, modern);
    expect(client.getServerVersion()).toMatchObject({ name: 'kerfdesk-desktop', version: '1.3.0' });
    const listing = await client.listTools();
    expect(listing.tools.map((tool) => tool.name)).toEqual(listedTools);
    for (const tool of listing.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect(tool.annotations?.readOnlyHint).toBe(tool.name in readResults);
      if (
        ['get_workspace', 'get_workspace_scene', 'get_workspace_preview'].includes(tool.name) ||
        Object.hasOwn(mcpMachineToolInfo, tool.name)
      ) {
        expect(tool._meta).toEqual({
          ui: { resourceUri: KERFDESK_WORKSPACE_UI_URI, visibility: ['model', 'app'] },
        });
      } else expect(tool._meta).toBeUndefined();
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
    expect(request).toHaveBeenCalledTimes(listedTools.length);
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
        expect.anything(),
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
