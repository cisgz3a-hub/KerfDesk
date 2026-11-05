import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodeEmbeddedFont } from '../../core/text';

const KEY = 'embedded:shared-document-key';
const A = encodeEmbeddedFont({
  key: KEY,
  fileName: 'A.ttf',
  buffer: new Uint8Array([0, 1, 0, 0, 1]).buffer,
});
const B = encodeEmbeddedFont({
  key: KEY,
  fileName: 'B.ttf',
  buffer: new Uint8Array([0, 1, 0, 0, 2]).buffer,
});
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalFonts === undefined) Reflect.deleteProperty(document, 'fonts');
  else Object.defineProperty(document, 'fonts', originalFonts);
});

it('resolves the current document bytes before reusing an embedded key', async () => {
  const { loadFont } = await import('./font-loader');
  const a = await loadFont(KEY, [A]);
  expect(await loadFont(KEY, [{ ...A }])).toBe(a);
  const b = await loadFont(KEY, [B]);
  expect([...new Uint8Array(b)]).toEqual([0, 1, 0, 0, 2]);
  expect(b).not.toBe(a);
});

it('does not let a warm cache conceal missing font data in the current document', async () => {
  const { loadFont, getCachedFont } = await import('./font-loader');
  const buffer = await loadFont(KEY, [A]);
  expect(getCachedFont(KEY, [A])).toBe(buffer);
  expect(getCachedFont(KEY, [B])).toBeNull();
  expect(getCachedFont(KEY)).toBeNull();
  await expect(loadFont(KEY, [])).rejects.toThrow("isn't on this computer");
});

it('preserves the bundled font cache', async () => {
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => buffer }));
  vi.stubGlobal('fetch', fetch);
  const { loadFont, getCachedFont } = await import('./font-loader');
  expect(await loadFont('roboto-regular')).toBe(buffer);
  expect(await loadFont('roboto-regular', [A])).toBe(buffer);
  expect(getCachedFont('roboto-regular')).toBe(buffer);
  expect(fetch).toHaveBeenCalledOnce();
});

it('replaces an installed CSS face when a document reuses the key with different bytes', async () => {
  const css = stubFontFaces();
  const { ensureFontCss } = await import('./font-loader');
  const first = ensureFontCss(KEY, [A]);
  await Promise.resolve();
  css.faces[0]!.finish();
  await first;
  await ensureFontCss(KEY, [{ ...A }]);
  expect(css.faces).toHaveLength(1);
  const second = ensureFontCss(KEY, [B]);
  await Promise.resolve();
  expect(css.faces).toHaveLength(2);
  css.faces[1]!.finish();
  await second;
  expect(css.add.mock.calls.map(([face]) => face.bytes.at(-1))).toEqual([1, 2]);
  expect(css.remove).toHaveBeenCalledWith(css.faces[0]);
});

it('prevents a late CSS font load from overwriting a newer document resource', async () => {
  const css = stubFontFaces();
  const { ensureFontCss } = await import('./font-loader');
  const old = ensureFontCss(KEY, [A]);
  await Promise.resolve();
  const current = ensureFontCss(KEY, [B]);
  await Promise.resolve();
  css.faces[1]!.finish();
  await current;
  css.faces[0]!.finish();
  await old;
  expect(css.add).toHaveBeenCalledOnce();
  expect(css.add).toHaveBeenCalledWith(css.faces[1]);
});

it('removes an obsolete CSS face and invalidates pending loads when the font is missing', async () => {
  const css = stubFontFaces();
  const { ensureFontCss } = await import('./font-loader');
  const installed = ensureFontCss(KEY, [A]);
  await Promise.resolve();
  css.faces[0]!.finish();
  await installed;
  const pending = ensureFontCss(KEY, [B]);
  await Promise.resolve();
  await expect(ensureFontCss(KEY, [])).rejects.toThrow("isn't on this computer");
  expect(css.remove).toHaveBeenCalledWith(css.faces[0]);
  css.faces[1]!.finish();
  await pending;
  expect(css.add).toHaveBeenCalledOnce();
});

function stubFontFaces() {
  const add = vi.fn();
  const remove = vi.fn();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add, delete: remove } });
  const faces: Face[] = [];
  class Face {
    readonly bytes: Uint8Array;
    finish: () => void = () => undefined;
    readonly pending = new Promise<Face>((resolve) => {
      this.finish = () => resolve(this);
    });
    constructor(
      readonly family: string,
      buffer: ArrayBuffer,
    ) {
      this.bytes = new Uint8Array(buffer);
      faces.push(this);
    }
    load() {
      return this.pending;
    }
  }
  vi.stubGlobal('FontFace', Face);
  return { faces, add, remove };
}
