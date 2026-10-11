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
