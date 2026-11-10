// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KerfDeskMcpError, type KerfDeskMcpBackend } from './backend.js';
import { MCP_MAX_RESULT_BYTES } from './input-schemas.js';
import { mcpOutputSchemas } from './output-schemas.js';
import {
  closeClients,
  connectedClient,
  readResults,
  successfulBackend,
  toolExamples,
} from './server.test-support.js';

afterEach(closeClients);

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

  // ADR-584 Amendment 1: an Undo or Redo that changed the machine setup says so.
  it('keeps the machine notice an Undo or Redo receipt carries', async () => {
    const notices = [
      {
        level: 'warning',
        message: "Undo brought back the opened file's machine, and the PC asks again.",
      },
    ];
    const client = await connectedClient({
      request: async () => ({
        revision: 'revision-2',
        changedArtworkIds: [],
        history: { canUndo: false, canRedo: true },
        notices,
      }),
    });
    for (const name of ['undo', 'redo'] as const) {
      const result = await client.callTool({ name, arguments: toolExamples[name] });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ notices });
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
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      revision: 'revision-1',
      total: 200,
      truncated: true,
    });
    const bounded = mcpOutputSchemas.list_material_recipes.parse(result.structuredContent);
    expect(bounded.recipes.length).toBeGreaterThan(0);
    expect(bounded.recipes.length).toBeLessThan(200);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(MCP_MAX_RESULT_BYTES);
  });

  it('still refuses oversized output from other tools', async () => {
    const client = await connectedClient({
      request: async () => ({
        ...readResults.list_fonts,
        fonts: Array.from({ length: 200 }, (_, index) => ({
          id: `font-${index}`,
          geometry: 'outline',
          style: 'sans',
          name: '材'.repeat(512),
        })),
        total: 200,
      }),
    });
    const result = await client.callTool({ name: 'list_fonts', arguments: {} });
    expect(result.isError).toBe(true);
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
        return new Promise(() => {
          // Never settles: only the abort ends this request.
        });
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
