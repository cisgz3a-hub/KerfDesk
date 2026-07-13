import type { EmbeddedFont } from '../../core/scene';
import { MAX_EMBEDDED_FONT_BYTES } from '../../core/text';
import { isObject } from './project-shape-primitives';

export const MAX_EMBEDDED_FONTS = 32;

export function validateEmbeddedFonts(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > MAX_EMBEDDED_FONTS) {
    return `invalid embeddedFonts: expected at most ${MAX_EMBEDDED_FONTS} fonts`;
  }
  const keys = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const error = validateEmbeddedFont(value[index], index, keys);
    if (error !== null) return error;
    const key = (value[index] as Record<string, unknown>)['key'] as string;
    keys.add(key);
  }
  return null;
}

function validateEmbeddedFont(
  value: unknown,
  index: number,
  keys: ReadonlySet<string>,
): string | null {
  if (!isObject(value)) return `invalid embeddedFonts[${index}]`;
  const key = value['key'];
  if (typeof key !== 'string' || !key.startsWith('embedded:') || keys.has(key)) {
    return `invalid embeddedFonts[${index}].key`;
  }
  const fileName = value['fileName'];
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 255) {
    return `invalid embeddedFonts[${index}].fileName`;
  }
  const data = value['dataBase64'];
  if (typeof data !== 'string' || !isCanonicalBase64(data)) {
    return `invalid embeddedFonts[${index}].dataBase64`;
  }
  return estimatedDecodedBytes(data) > MAX_EMBEDDED_FONT_BYTES
    ? `embeddedFonts[${index}] exceeds ${MAX_EMBEDDED_FONT_BYTES} bytes`
    : null;
}

function isCanonicalBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function embeddedFontByKey(
  fonts: ReadonlyArray<EmbeddedFont> | undefined,
  key: string,
): EmbeddedFont | null {
  return fonts?.find((font) => font.key === key) ?? null;
}

function estimatedDecodedBytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}
