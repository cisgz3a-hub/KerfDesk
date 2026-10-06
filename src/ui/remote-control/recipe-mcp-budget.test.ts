import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { expect, it } from 'vitest';
import { createRemoteControlAdapter } from './adapter';
import { useStore } from '../state/store';
import { createLayer } from '../../core/scene';
import { captureMaterialRecipe } from '../../core/material-library';
import { deserializeMaterialLibrary } from '../../io/material-library';
import { createKerfDeskMcpServer } from '../../../electron/mcp/server';
import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas';
import { MCP_MAX_RESULT_BYTES } from '../../../electron/mcp/input-schemas';

it('reads an imported multilingual material library through the real renderer and official SDK', async () => {
  useStore.setState(useStore.getInitialState(), true);
  const materialName = '材料设置'.repeat(32);
  const library = deserializeMaterialLibrary(
    JSON.stringify({
      format: 'laserforge-material-library',
      librarySchemaVersion: 2,
      libraryId: 'multilingual-library',
      name: 'Saved workshop materials',
      entries: Array.from({ length: 200 }, (_, index) => ({
        id: `recipe-${index}`,
        materialName,
        thicknessMm: 3,
        description: 'Stored material recipe',
        revision: '1',
        recipe: captureMaterialRecipe(createLayer({ id: 'operation', color: '#000000' })),
      })),
    }),
  );
  expect(library.kind).toBe('ok');
  if (library.kind !== 'ok') throw new Error('Expected a valid imported library');
  useStore.setState({ materialLibrary: library.library });
  const adapter = createRemoteControlAdapter({
    canWrite: () => false,
    getAppStatus: () => ({
      app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
      edition: { mode: 'free' },
      updates: { available: false },
    }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const entry = serveStdio(
    () =>
      createKerfDeskMcpServer({
        async request(command, args) {
          const read = await adapter.execute(command, args);
          if (!read.ok) throw new Error('Expected the current renderer projection');
          return { ...read.data, revision: read.revision };
        },
      }),
    { transport: serverTransport },
  );
  const client = new Client({ name: 'material-library-integration', version: '1' });
  try {
    await client.connect(clientTransport);
    const projection = await adapter.execute('list_material_recipes', {});
    expect(projection.ok).toBe(true);
    if (!projection.ok) throw new Error('Expected a readable library');
    const original = { ...projection.data, revision: projection.revision };
    const parsed = mcpOutputSchemas.list_material_recipes.parse(original);
    expect(new TextEncoder().encode(JSON.stringify(original)).byteLength).toBeLessThan(
      MCP_MAX_RESULT_BYTES,
    );
    const result = await client.callTool({ name: 'list_material_recipes', arguments: {} });
    expect(result.isError).not.toBe(true);
    const bounded = mcpOutputSchemas.list_material_recipes.parse(result.structuredContent);
    expect(bounded).toMatchObject({ revision: projection.revision, total: 200, truncated: true });
    expect(bounded.recipes.length).toBeGreaterThan(0);
    expect(bounded.recipes.length).toBeLessThan(200);
    expect(bounded.recipes).toEqual(parsed.recipes.slice(0, bounded.recipes.length));
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      MCP_MAX_RESULT_BYTES,
    );
  } finally {
    await client.close();
    await entry.close();
    adapter.dispose();
    useStore.setState(useStore.getInitialState(), true);
  }
});
