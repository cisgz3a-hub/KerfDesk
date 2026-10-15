// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createKerfDeskMcpServer } from './server.js';
import { mcpInputSchemas } from './input-schemas.js';
import { mcpBatchEditSchemas } from './design-schemas.js';
import { mcpOutputSchemas } from './output-schemas.js';
import { validateCommand } from '../../src/ui/remote-control/validation';
import { batchItemSchemas } from '../../src/ui/remote-control/design-validation';

const admission = {
  expectedRevision: 'current',
  requestId: '12345678-1234-4234-8234-123456789abc',
};

describe('portable and desktop selection contracts agree', () => {
  it.each([
    { artworkIds: [] },
    { artworkIds: ['a'] },
    ...['replace', 'add', 'remove', 'toggle'].map((mode) => ({ mode, artworkIds: ['a', 'b'] })),
    { mode: 'all' },
    { mode: 'clear' },
    { mode: 'all', artworkIds: [] },
    { mode: 'clear', artworkIds: [] },
  ])('accepts single and batch arguments %j', (args) => {
    const single = { ...admission, ...args };
    expect(mcpInputSchemas.set_selection.safeParse(single).success).toBe(true);
    expect(() => validateCommand('set_selection', single)).not.toThrow();
    expect(mcpBatchEditSchemas.set_selection.safeParse(args).success).toBe(true);
    expect(batchItemSchemas.set_selection.safeParse(args).success).toBe(true);
  });

  it.each([
    {},
    { mode: 'replace' },
    { mode: 'add' },
    { mode: 'remove' },
    { mode: 'toggle' },
    { mode: 'all', artworkIds: ['a'] },
    { mode: 'clear', artworkIds: ['a'] },
    { mode: 'unknown', artworkIds: [] },
    { artworkIds: ['a', 'a'] },
    { artworkIds: Array.from({ length: 201 }, (_, index) => `a-${index}`) },
    { artworkIds: [], extra: true },
    { artworkIds: [null] },
  ])('refuses single and batch arguments %j', (args) => {
    const single = { ...admission, ...args };
    expect(mcpInputSchemas.set_selection.safeParse(single).success).toBe(false);
    expect(() => validateCommand('set_selection', single)).toThrow();
    expect(mcpBatchEditSchemas.set_selection.safeParse(args).success).toBe(false);
    expect(batchItemSchemas.set_selection.safeParse(args).success).toBe(false);
  });

  it('retains selection completeness and capability hints without requiring them from old desktops', () => {
    const legacy = {
      revision: 'current',
      mode: 'laser',
      name: 'Workspace',
      dirty: false,
      selection: [],
      artwork: [],
      operations: [],
      totalArtwork: 0,
      totalOperations: 0,
      truncated: false,
    };
    expect(mcpOutputSchemas.get_workspace.safeParse(legacy).success).toBe(true);
    const current = {
      ...legacy,
      totalSelected: 201,
      selectionTruncated: true,
      capabilities: { touchEditing: true, selectionModes: true },
    };
    expect(mcpOutputSchemas.get_workspace.parse(current)).toEqual(current);
  });

  it('advertises modes over MCP and forwards clear without requiring fabricated target IDs', async () => {
    const requests: unknown[] = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const entry = serveStdio(
      () =>
        createKerfDeskMcpServer({
          request: async (command, args) => {
            requests.push({ command, args });
            return { revision: 'next', selection: [] };
          },
        }),
      { transport: serverTransport },
    );
    const client = new Client({ name: 'selection-contract-test', version: '1.0.0' });
    try {
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(
        tools.tools.find((tool) => tool.name === 'set_selection')?.inputSchema.properties?.['mode'],
      ).toMatchObject({ enum: ['replace', 'add', 'remove', 'toggle', 'all', 'clear'] });
      const result = await client.callTool({
        name: 'set_selection',
        arguments: { ...admission, mode: 'clear' },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ revision: 'next', selection: [] });
      expect(requests).toEqual([
        { command: 'set_selection', args: { ...admission, mode: 'clear' } },
      ]);
      const invalid = await client.callTool({
        name: 'set_selection',
        arguments: { ...admission, mode: 'all', artworkIds: ['a'] },
      });
      expect(invalid.isError).toBe(true);
      expect(requests).toHaveLength(1);
    } finally {
      await client.close();
      await entry.close();
    }
  });
});
