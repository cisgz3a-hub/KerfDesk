export const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const metadataBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function parseEnvelope(message: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(message);
    return plainObject(value) && value.v === 1 && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}
