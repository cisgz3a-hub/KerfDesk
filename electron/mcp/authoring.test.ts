// @vitest-environment node
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KerfDeskMcpError, type KerfDeskMcpBackend } from './backend.js';
import { MCP_ARRANGE_ACTIONS } from './authoring-schemas.js';
import {
  MCP_MAX_RESULT_BYTES,
  MCP_WRITE_COMMANDS,
  MCP_CONTROL_COMMANDS,
  mcpCommandScope,
  type KerfDeskMcpCommand,
} from './input-schemas.js';
import { createKerfDeskMcpServer, type KerfDeskMcpToolMetadata } from './server.js';
import { KERFDESK_WORKSPACE_UI_MIME, KERFDESK_WORKSPACE_UI_URI } from './workspace-ui.js';

const admission = {
  expectedRevision: 'workspace-1',
  requestId: '12345678-1234-4234-8234-123456789abc',
};
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6foAAAAASUVORK5CYII=';
const readyPreview = {
  revision: 'workspace-1',
  status: 'ready',
  preview: { mimeType: 'image/png', data: png, widthPx: 1, heightPx: 1 },
  bounds: { xMm: -2, yMm: 3, widthMm: 20, heightMm: 10 },
};
const closers: Array<() => Promise<void>> = [];
const readTools = [
  'get_workspace',
  'get_machine',
  'get_app_status',
  'list_material_recipes',
  'review_job',
  'get_workspace_preview',
  'list_fonts',
  'get_text',
  'get_machine_status',
  'get_control_operation',
] as const;
const editTools = [
  'set_selection',
  'add_text',
  'add_rectangle',
  'add_ellipse',
  'add_polyline',
  'transform_artwork',
  'update_operation',
  'update_text',
  'arrange_artwork',
  'undo',
  'redo',
] as const;
const controlTools = [
  'jog_machine',
  'frame_job',
  'review_machine_job',
  'start_job',
  'abort_job',
] as const;

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function clientFor(
  backend: KerfDeskMcpBackend,
  modern: boolean,
  metadata?: KerfDeskMcpToolMetadata,
): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const entry = serveStdio(() => createKerfDeskMcpServer(backend, metadata), {
    transport: serverTransport,
  });
  const client = new Client(
    { name: 'authoring-contract-test', version: '1.0.0' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  closers.push(async () => {
    await client.close();
    await entry.close();
  });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: CallToolResult): string {
  return result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

describe.each([false, true])('authoring SDK contract (modern=%s)', (modern) => {
  it('returns a bounded image without copying its bytes into model-facing text', async () => {
    const client = await clientFor(
      {
        request: async () => ({
          ...readyPreview,
          ownerSecret: 'private-owner',
          preview: { ...readyPreview.preview, sourceFile: 'C:/private/job.svg' },
          bounds: { ...readyPreview.bounds, licenceKey: 'private-licence' },
        }),
      },
      modern,
    );
    const result = await client.callTool({ name: 'get_workspace_preview', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(readyPreview);
    expect(result.content.filter((part) => part.type === 'image')).toEqual([
      { type: 'image', mimeType: 'image/png', data: png },
    ]);
    expect(textOf(result)).not.toContain(png);
    expect(JSON.parse(textOf(result))).toMatchObject({
      revision: 'workspace-1',
      status: 'ready',
      preview: { mimeType: 'image/png', widthPx: 1, heightPx: 1 },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-owner|private-licence|sourceFile/);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(
      MCP_MAX_RESULT_BYTES,
    );
  });

  it('serves the static MCP Apps resource and keeps its OAuth metadata', async () => {
    const securitySchemes = [{ type: 'oauth2', scopes: ['kerfdesk:read'] }];
    const request = vi.fn(async () => ({ revision: 'workspace-1', status: 'disabled' }));
    const client = await clientFor({ request }, modern, {
      get_workspace_preview: { securitySchemes },
    });
    const tools = (await client.listTools()).tools;
    const preview = tools.find((tool) => tool.name === 'get_workspace_preview');
    expect(preview?._meta).toEqual({
      securitySchemes,
      ui: { resourceUri: KERFDESK_WORKSPACE_UI_URI, visibility: ['model', 'app'] },
    });
    const resources = await client.listResources();
    expect(resources.resources).toEqual([
      expect.objectContaining({
        uri: KERFDESK_WORKSPACE_UI_URI,
        mimeType: KERFDESK_WORKSPACE_UI_MIME,
      }),
    ]);
    const result = await client.readResource({ uri: KERFDESK_WORKSPACE_UI_URI });
    expect(result.contents).toHaveLength(1);
    const resource = result.contents[0];
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource._meta).toEqual({
      ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
    });
    expect('text' in resource ? resource.text : '').toContain('ui/initialize');
    expect('text' in resource ? resource.text : '').not.toMatch(
      /ownerSecret|access_token|localhost/,
    );
    await expect(client.readResource({ uri: 'file:///C:/private/job.svg' })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps read, artwork-edit and machine-control permissions distinct', async () => {
    const client = await clientFor({ request: async () => ({}) }, modern);
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(26);
    expect(new Set(tools.map((tool) => tool.name))).toEqual(
      new Set([...readTools, ...editTools, ...controlTools]),
    );
    const writes = tools.filter((tool) => !tool.annotations?.readOnlyHint).map((tool) => tool.name);
    expect(writes).toEqual([...editTools, ...controlTools]);
    expect(MCP_WRITE_COMMANDS).toEqual(new Set(editTools));
    expect(MCP_CONTROL_COMMANDS).toEqual(new Set(controlTools));
    const edits = new Set<string>(editTools);
    const controls = new Set<string>(controlTools);
    for (const tool of tools) {
      const control = controls.has(tool.name);
      const readOnly = !control && !edits.has(tool.name);
      expect(mcpCommandScope(tool.name as KerfDeskMcpCommand)).toBe(
        control ? 'control' : readOnly ? 'read' : 'edit',
      );
      expect(tool.annotations).toEqual({
        readOnlyHint: readOnly,
        destructiveHint:
          control ||
          (!readOnly &&
            !['set_selection', 'add_text', 'add_rectangle', 'add_ellipse', 'add_polyline'].includes(
              tool.name,
            )),
        idempotentHint: readOnly,
        openWorldHint: false,
      });
    }
  });

  it('admits all layout actions and valid text patches without changing admission identifiers', async () => {
    const request = vi.fn(async () => ({
      revision: 'workspace-2',
      changedArtworkIds: ['art-1'],
      changedFields: ['text', 'fontId', 'letterSpacing'],
      history: { canUndo: true, canRedo: false, privateStack: ['secret'] },
    }));
    const client = await clientFor({ request }, modern);
    for (const action of MCP_ARRANGE_ACTIONS) {
      const args = { ...admission, artworkIds: ['art-1'], action };
      const result = await client.callTool({ name: 'arrange_artwork', arguments: args });
      expect(result.isError).not.toBe(true);
      expect(request).toHaveBeenLastCalledWith(
        'arrange_artwork',
        args,
        expect.any(AbortSignal),
        expect.anything(),
      );
      expect(result.structuredContent?.history).toEqual({ canUndo: true, canRedo: false });
    }
    const args = {
      ...admission,
      artworkId: 'art-1',
      patch: {
        text: 'New\nText <script> literal',
        fontId: 'Inter',
        fontSizeMm: 12,
        alignment: 'center',
        lineHeight: 1.5,
        letterSpacing: -0.25,
      },
    };
    const result = await client.callTool({ name: 'update_text', arguments: args });
    expect(result.isError).not.toBe(true);
    expect(request).toHaveBeenLastCalledWith(
      'update_text',
      args,
      expect.any(AbortSignal),
      expect.anything(),
    );
    expect(JSON.stringify(result)).not.toContain('privateStack');
  });

  it('keeps Pro-copy and privacy refusal errors generic and does not retry a mutation', async () => {
    const request = vi.fn(async () => {
      throw new KerfDeskMcpError('needs_pro');
    });
    const client = await clientFor({ request }, modern);
    const result = await client.callTool({
      name: 'arrange_artwork',
      arguments: { ...admission, artworkIds: ['art-1'], action: 'duplicate' },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({ code: 'needs_pro' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('bounded authoring arguments', () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['get_workspace_preview', { includeFile: 'C:/private/job.svg' }],
    ['list_fonts', { systemFonts: true }],
    ['get_text', { artworkId: '' }],
    ['get_text', { artworkId: 'art-1', includeOutline: true }],
    ['update_text', { ...admission, artworkId: 'art-1', patch: {} }],
    ['update_text', { ...admission, artworkId: 'art-1', patch: { text: '' } }],
    ['update_text', { ...admission, artworkId: 'art-1', patch: { text: 'a'.repeat(4097) } }],
    ['update_text', { ...admission, artworkId: 'art-1', patch: { fontSizeMm: 0 } }],
    ['update_text', { ...admission, artworkId: 'art-1', patch: { lineHeight: 21 } }],
    ['update_text', { ...admission, artworkId: 'art-1', patch: { letterSpacing: -2 } }],
    ['update_text', { ...admission, artworkId: 'art-1', patch: { fontFile: '/private.ttf' } }],
    ['arrange_artwork', { ...admission, artworkIds: [], action: 'delete' }],
    ['arrange_artwork', { ...admission, artworkIds: ['art-1'], action: 'start' }],
    ['undo', { ...admission, count: 2 }],
    ['redo', { expectedRevision: admission.expectedRevision }],
  ];
  it.each(invalid)('rejects %s arguments before forwarding', async (name, args) => {
    const request = vi.fn(async () => ({}));
    const client = await clientFor({ request }, false);
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid tool arguments.');
    expect(textOf(result)).not.toContain('private');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('preview output boundary', () => {
  const invalid = [
    { ...readyPreview, preview: undefined },
    { ...readyPreview, status: 'disabled' },
    { ...readyPreview, preview: { ...readyPreview.preview, mimeType: 'image/svg+xml' } },
    { ...readyPreview, preview: { ...readyPreview.preview, widthPx: 1025 } },
    { ...readyPreview, preview: { ...readyPreview.preview, heightPx: 0 } },
    { ...readyPreview, preview: { ...readyPreview.preview, widthPx: 2 } },
    {
      ...readyPreview,
      preview: { ...readyPreview.preview, data: 'https://private.example/image' },
    },
    { ...readyPreview, preview: { ...readyPreview.preview, data: png + '=' } },
    { ...readyPreview, preview: { ...readyPreview.preview, data: png + 'A'.repeat(65_536) } },
  ];
  it.each(invalid)('refuses malformed or oversized preview %#', async (raw) => {
    const client = await clientFor({ request: async () => raw }, false);
    const result = await client.callTool({ name: 'get_workspace_preview', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({ code: 'failed' });
    expect(result.content.every((part) => part.type === 'text')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private.example');
  });
});
