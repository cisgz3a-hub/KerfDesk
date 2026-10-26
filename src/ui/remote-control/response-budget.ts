/** Reserve room for revision and transport metadata below MCP's 256 KiB result limit. */
const RESULT_BYTE_BUDGET = 240_000;

/** MCP sends both structured data and its JSON text, including escaped text and UTF-8. */
export function fitsRemoteResponse(data: Record<string, unknown>): boolean {
  const result = {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength <= RESULT_BYTE_BUDGET;
}

/** Keep complete ordered summary records; selection identity is independent of list truncation. */
export function boundedWorkspaceResponse<
  T extends {
    artwork: readonly unknown[];
    operations: readonly unknown[];
    truncated: boolean;
  },
>(data: T): T {
  if (fitsRemoteResponse(data)) return data;
  const prefix = (count: number): T => ({
    ...data,
    artwork: data.artwork.slice(0, count),
    operations: data.operations.slice(0, count),
    truncated: true,
  });
  let low = 0;
  let high = Math.max(data.artwork.length, data.operations.length);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fitsRemoteResponse(prefix(middle))) low = middle;
    else high = middle - 1;
  }
  return prefix(low);
}
