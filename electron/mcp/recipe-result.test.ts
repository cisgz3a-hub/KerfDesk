// @vitest-environment node
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import { createKerfDeskMcpServer } from './server.js';
import { MCP_MAX_RESULT_BYTES } from './input-schemas.js';
import { mcpOutputSchemas, type KerfDeskMcpResult } from './output-schemas.js';

type Recipes = KerfDeskMcpResult<'list_material_recipes'>;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function read(raw: Record<string, unknown>, modern = false): Promise<CallToolResult> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const entry = serveStdio(() => createKerfDeskMcpServer({ request: async () => raw }), {
    transport: serverTransport,
  });
  const client = new Client(
    { name: 'recipe-budget-test', version: '1' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  closers.push(async () => {
    await client.close();
    await entry.close();
  });
  await client.connect(clientTransport);
  return client.callTool({ name: 'list_material_recipes', arguments: {} });
}

function envelope(data: Recipes): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const recipe = (index: number, label = 'Birch plywood') => ({
  id: `recipe-${index}`,
  name: label,
  materialName: label,
  powerPercent: 30,
  speedMmPerMin: 1500,
  passes: 1,
});
function data(count: number, label?: string): Recipes {
  return {
    revision: 'recipe-revision',
    recipes: Array.from({ length: count }, (_, index) => recipe(index, label)),
    total: count,
    truncated: false,
  };
}

function expectBoundedPrefix(result: CallToolResult, original: Recipes): Recipes {
  expect(result.isError).not.toBe(true);
  const parsed = mcpOutputSchemas.list_material_recipes.parse(result.structuredContent);
  expect(parsed.recipes.length).toBeGreaterThan(0);
  expect(parsed.recipes.length).toBeLessThan(original.recipes.length);
  expect(parsed.recipes).toEqual(original.recipes.slice(0, parsed.recipes.length));
  expect(parsed).toMatchObject({
    revision: original.revision,
    total: original.total,
    truncated: true,
  });
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(parsed) }]);
  expect(bytes(result)).toBeLessThanOrEqual(MCP_MAX_RESULT_BYTES);
  const nextCount = parsed.recipes.length + 1;
  const next = {
    ...parsed,
    recipes: original.recipes.slice(0, nextCount),
    truncated: nextCount === original.recipes.length ? original.truncated : true,
  };
  expect(bytes(envelope(next))).toBeGreaterThan(MCP_MAX_RESULT_BYTES);
  return parsed;
}

describe('recipe tool complete-envelope budget', () => {
  it.each([false, true])('returns a maximal Unicode recipe prefix (modern=%s)', async (modern) => {
    const original = data(200, '材料设置'.repeat(32));
    expect(bytes(original)).toBeLessThan(MCP_MAX_RESULT_BYTES);
    expect(bytes(envelope(original))).toBeGreaterThan(MCP_MAX_RESULT_BYTES);
    expectBoundedPrefix(await read(original, modern), original);
  });

  it('counts UTF-8 and JSON escaping in both representations', async () => {
    const original = data(200, '材料"\\\n'.repeat(40));
    expect(mcpOutputSchemas.list_material_recipes.safeParse(original).success).toBe(true);
    expectBoundedPrefix(await read(original), original);
  });

  it.each([data(0), data(3), { ...data(4), total: 300, truncated: true }])(
    'keeps a fitting full, empty or already partial result unchanged %#',
    async (original) => {
      expect(await read(original)).toEqual(envelope(original));
    },
  );

  it('keeps the original total and truncation when an already partial list needs more trimming', async () => {
    const original = { ...data(200, '材料设置'.repeat(32)), total: 450, truncated: true };
    expectBoundedPrefix(await read(original), original);
  });

  it('keeps an exact-limit response and truthfully truncates when one extra character exceeds it', async () => {
    const original: Recipes = {
      ...data(200, ''),
      recipes: data(200, '').recipes.map((item) => ({ ...item, notes: '' })),
    };
    let remaining = (MCP_MAX_RESULT_BYTES - bytes(envelope(original))) / 2;
    expect(Number.isInteger(remaining)).toBe(true);
    for (const item of original.recipes) {
      const length = Math.min(2048, remaining);
      item.notes = 'n'.repeat(length);
      remaining -= length;
    }
    expect(remaining).toBe(0);
    expect(bytes(envelope(original))).toBe(MCP_MAX_RESULT_BYTES);
    expect(await read(original)).toEqual(
      envelope(mcpOutputSchemas.list_material_recipes.parse(original)),
    );
    const over = {
      ...original,
      recipes: original.recipes.map((item, index) =>
        index === 199 ? { ...item, notes: `${item.notes}n` } : item,
      ),
    };
    expect(bytes(envelope(over))).toBe(MCP_MAX_RESULT_BYTES + 2);
    expectBoundedPrefix(await read(over), over);
  });

  it('returns a maximum-schema single record unchanged', async () => {
    const original: Recipes = {
      revision: 'r'.repeat(200),
      recipes: [
        {
          id: 'i'.repeat(128),
          name: '材'.repeat(512),
          materialName: '料'.repeat(512),
          machineName: '机'.repeat(512),
          notes: '\u0000'.repeat(2048),
          powerPercent: 100,
          speedMmPerMin: 100_000,
          passes: 1000,
        },
      ],
      total: 1,
      truncated: false,
    };
    expect(mcpOutputSchemas.list_material_recipes.safeParse(original).success).toBe(true);
    expect(bytes(envelope(original))).toBeLessThan(MCP_MAX_RESULT_BYTES);
    expect(await read(original)).toEqual(
      envelope(mcpOutputSchemas.list_material_recipes.parse(original)),
    );
  });

  it('validates omitted tail records before truncating an oversized list', async () => {
    const original = data(200, '材料设置'.repeat(32));
    const invalid = {
      ...original,
      recipes: [...original.recipes.slice(0, -1), { id: 'bad-tail' }],
    };
    const result = await read(invalid);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'failed' } });
    expect(bytes(result)).toBeLessThan(MCP_MAX_RESULT_BYTES);
  });

  it('refuses oversized fields rather than hiding them in a truncated tail', async () => {
    const original = data(200, '材料设置'.repeat(32));
    const result = await read({
      ...original,
      recipes: original.recipes.map((item, index) =>
        index === 199 ? { ...item, notes: '材'.repeat(2049) } : item,
      ),
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'failed' } });
  });

  it('strips private unknown fields before sizing and returning a prefix', async () => {
    const original = data(200, '材料设置'.repeat(32));
    const raw = {
      ...original,
      licenceKey: 'private-licence',
      recipes: original.recipes.map((item) => ({ ...item, sourcePath: 'C:/private/materials' })),
    };
    const result = await read(raw);
    expectBoundedPrefix(result, original);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
