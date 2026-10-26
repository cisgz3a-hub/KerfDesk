// @vitest-environment node
import { expect, it } from 'vitest';
import { mcpOutputSchemas } from './output-schemas';
import { boundedWorkspaceToolResult, structuredToolResult, toolResultBytes } from './tool-result';
import { MCP_MAX_RESULT_BYTES } from './input-schemas';

function workspace(count: number, name: string) {
  return mcpOutputSchemas.get_workspace.parse({
    revision: 'current-workspace',
    mode: 'laser',
    name: 'Current workspace',
    dirty: true,
    selection: [`art-${count - 1}`],
    totalSelected: 1,
    selectionTruncated: false,
    artwork: Array.from({ length: count }, (_, index) => ({
      id: `art-${index}`,
      type: 'imported-svg',
      operationId: `op-${index}`,
      bounds: { xMm: index, yMm: 10, widthMm: 15, heightMm: 20 },
    })),
    operations: Array.from({ length: count }, (_, index) => ({
      id: `op-${index}`,
      type: 'line',
      name,
      enabled: true,
      powerPercent: 20,
      speedMmPerMin: 2000,
      passes: 1,
    })),
    totalArtwork: count,
    totalOperations: count,
    truncated: false,
  });
}

it('bounds both UTF-8 MCP representations without changing selection or record identities', () => {
  const original = workspace(200, '材料设置'.repeat(128));
  expect(toolResultBytes(structuredToolResult(original))).toBeGreaterThan(MCP_MAX_RESULT_BYTES);
  const result = boundedWorkspaceToolResult(original);
  const bounded = mcpOutputSchemas.get_workspace.parse(result.structuredContent);
  expect(toolResultBytes(result)).toBeLessThanOrEqual(MCP_MAX_RESULT_BYTES);
  expect(bounded).toMatchObject({
    totalArtwork: 200,
    totalOperations: 200,
    truncated: true,
    selection: ['art-199'],
    totalSelected: 1,
    selectionTruncated: false,
  });
  expect(bounded.artwork.length).toBeGreaterThan(0);
  expect(bounded.artwork.length).toBeLessThan(200);
  expect(bounded.artwork).toEqual(original.artwork.slice(0, bounded.artwork.length));
  expect(bounded.operations).toEqual(original.operations.slice(0, bounded.operations.length));
  expect(bounded.artwork.map((item) => item.operationId)).toEqual(
    bounded.operations.map((item) => item.id),
  );
});

it('retains the full result when it fits', () => {
  const original = workspace(2, 'Cut');
  expect(boundedWorkspaceToolResult(original)).toEqual(structuredToolResult(original));
});
