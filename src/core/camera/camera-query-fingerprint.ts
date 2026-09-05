import { sha256Hex } from '../relief/sha256';

/** Keep URL query resource identity without retaining its potentially secret text. */
export function cameraQueryFingerprint(raw: string): string | undefined {
  try {
    const query = new URL(raw.trim()).search;
    return query === '' ? undefined : `sha256:${sha256Hex([new TextEncoder().encode(query)])}`;
  } catch {
    return undefined;
  }
}
