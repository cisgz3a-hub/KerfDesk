import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createKerfDeskMcpServer } from '../../../electron/mcp/server';
import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas';
import { MCP_MAX_RESULT_BYTES } from '../../../electron/mcp/input-schemas';
import { toolResultBytes } from '../../../electron/mcp/tool-result';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state/store';
import { workspaceProjection } from './projections';
import { testAdapter } from './authoring-test-support';
import { boundedWorkspaceResponse, fitsRemoteResponse } from './response-budget';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = testAdapter({ canShareArtwork: () => true });
});
afterEach(() => adapter.dispose());

function createOperations(count: number, name: string) {
  for (let index = 0; index < count; index += 1) {
    const color = `#${index.toString(16).padStart(6, '0')}`;
    useStore.getState().createManualLayer(color);
    useStore.getState().renameOperation(color, name);
  }
}

it.each([
  { count: 200, name: '材料设置'.repeat(32), truncated: true, legacy: false },
  { count: 200, name: '材料设置'.repeat(32), truncated: true, legacy: true },
  { count: 2, name: 'Ordinary operation', truncated: false, legacy: false },
])(
  'reads $count operations through the official MCP SDK (legacy=$legacy)',
  async ({ count, name, truncated, legacy }) => {
    createOperations(count, name);
    expect(deserializeProject(serializeProject(useStore.getState().project)).kind).toBe('ok');
    const original = workspaceProjection(useStore.getState(), true);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const entry = serveStdio(
      () =>
        createKerfDeskMcpServer({
          async request(command, args) {
            if (legacy) return { ...original, revision: adapter.getRevision() };
            const read = await adapter.execute(command, args);
            if (!read.ok) throw new Error('Expected the current renderer projection');
            return { ...read.data, revision: read.revision };
          },
        }),
      { transport: serverTransport },
    );
    const client = new Client({ name: 'workspace-budget-integration', version: '1' });
    try {
      await client.connect(clientTransport);
      const projection = await adapter.execute('get_workspace', {});
      expect(projection.ok).toBe(true);
      if (!projection.ok) throw new Error('Expected a readable workspace');
      const raw = { ...projection.data, revision: projection.revision };
      expect(new TextEncoder().encode(JSON.stringify(raw)).byteLength).toBeLessThan(
        MCP_MAX_RESULT_BYTES,
      );
      const result = await client.callTool({ name: 'get_workspace', arguments: {} });
      expect(result.isError).not.toBe(true);
      const bounded = mcpOutputSchemas.get_workspace.parse(result.structuredContent);
      expect(bounded).toMatchObject({
        revision: projection.revision,
        totalOperations: count,
        truncated,
      });
      expect(bounded.operations.length).toBeGreaterThan(0);
      if (truncated) expect(bounded.operations.length).toBeLessThan(count);
      else expect(bounded.operations).toEqual(original.operations);
      expect(bounded.operations).toEqual(original.operations.slice(0, bounded.operations.length));
      expect(toolResultBytes(result)).toBeLessThanOrEqual(MCP_MAX_RESULT_BYTES);
    } finally {
      await client.close();
      await entry.close();
    }
  },
);

it('retains the complete admitted selection even when its artwork summaries do not fit', () => {
  const selection = Array.from({ length: 200 }, (_, index) => `${'字'.repeat(124)}${index}`);
  const data = {
    selection,
    totalSelected: 200,
    selectionTruncated: false,
    artwork: selection.map((id, index) => ({
      id,
      operationId: `op-${index}`,
      type: 'imported-svg',
    })),
    operations: selection.map((_, index) => ({
      id: `op-${index}`,
      name: '材料'.repeat(256),
      enabled: true,
    })),
    totalArtwork: 200,
    totalOperations: 200,
    truncated: false,
  };
  expect(fitsRemoteResponse(data)).toBe(false);
  const bounded = boundedWorkspaceResponse(data);
  expect(fitsRemoteResponse(bounded)).toBe(true);
  expect(bounded).toMatchObject({
    selection,
    totalSelected: 200,
    selectionTruncated: false,
    totalArtwork: 200,
    totalOperations: 200,
    truncated: true,
  });
  expect(bounded.artwork.length).toBeLessThan(200);
  expect(bounded.artwork).toEqual(data.artwork.slice(0, bounded.artwork.length));
  expect(bounded.operations).toEqual(data.operations.slice(0, bounded.operations.length));
});
