import type { CallToolResult } from '@modelcontextprotocol/server';
import { MCP_MAX_RESULT_BYTES } from './input-schemas.js';
import type { KerfDeskMcpResult } from './output-schemas.js';

export function structuredToolResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function toolResultBytes(result: CallToolResult): number {
  return new TextEncoder().encode(JSON.stringify(result)).byteLength;
}

/** Budget both protocol representations; retain complete recipe records in their original order. */
export function boundedRecipeToolResult(
  data: KerfDeskMcpResult<'list_material_recipes'>,
): CallToolResult {
  const full = structuredToolResult(data);
  if (toolResultBytes(full) <= MCP_MAX_RESULT_BYTES) return full;

  const prefix = (count: number) =>
    structuredToolResult({ ...data, recipes: data.recipes.slice(0, count), truncated: true });
  let low = 0;
  // Drop a record even if changing only the truncation flag would make the full list fit.
  let high = Math.max(0, data.recipes.length - 1);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (toolResultBytes(prefix(middle)) <= MCP_MAX_RESULT_BYTES) low = middle;
    else high = middle - 1;
  }
  return prefix(low);
}
