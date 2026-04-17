import { BUNDLED_FONTS } from './fontRegistry';

let injected = false;

/**
 * Register bundled fonts with the browser font system via FontFace API.
 * After this runs, CSS and canvas fillText calls can resolve bundled families.
 *
 * Safe in non-browser contexts (tests/SSR): exits when document.fonts is absent.
 */
export async function injectBundledFontFaces(): Promise<void> {
  if (injected) return;
  if (typeof document === 'undefined' || !document.fonts) return;
  injected = true;

  const loads = BUNDLED_FONTS.map(async (bf) => {
    try {
      const face = new FontFace(bf.family, `url(${bf.url})`);
      const loaded = await face.load();
      document.fonts.add(loaded);
    } catch (e) {
      console.warn(`[fonts] Failed to load @font-face for ${bf.family}:`, e);
    }
  });

  await Promise.all(loads);
}
