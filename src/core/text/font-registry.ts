// Font registry — typed key → font name + loader path.
//
// Each FontKey is the stable identifier we store in TextObject.fontKey
// and in .lf2 files. Display labels and file paths are looked up from
// the registry; the keys themselves never change so a 3-year-old .lf2
// still resolves.
//
// Phase D bundles three fonts at three different style classes (sans
// for prose, mono for technical labels, script for decorative). All
// are MIT-compatible per ADR-017 and ADR-012:
//   - Roboto Regular        Apache-2.0     sans
//   - Inconsolata Regular   OFL-1.1        mono
//   - Pacifico Regular      OFL-1.1        script (handwritten)
//
// File loading: the UI layer fetches the .ttf via a browser fetch()
// to a known asset path. Pure-core stays binary-free; this module
// only declares the registry shape.

// KnownFontKey narrows the bundle to the three fonts we actually ship.
// TextObject.fontKey is `string` (the union member in scene-object) so
// .lf2 files can carry future-unknown keys without rejection; this
// narrow type is what the UI uses for compile-time safety and what
// the registry constrains its keys to.
export type KnownFontKey = 'roboto-regular' | 'inconsolata-regular' | 'pacifico-regular';

export type FontEntry = {
  readonly key: KnownFontKey;
  readonly displayName: string;
  readonly license: string;
  readonly styleClass: 'sans' | 'mono' | 'script';
};

export const FONT_REGISTRY: ReadonlyArray<FontEntry> = [
  { key: 'roboto-regular', displayName: 'Roboto', license: 'Apache-2.0', styleClass: 'sans' },
  { key: 'inconsolata-regular', displayName: 'Inconsolata', license: 'OFL-1.1', styleClass: 'mono' },
  { key: 'pacifico-regular', displayName: 'Pacifico', license: 'OFL-1.1', styleClass: 'script' },
];

export const DEFAULT_FONT_KEY: KnownFontKey = 'roboto-regular';

// Returns null when the key isn't registered (e.g., a .lf2 from a
// future version referencing a font we don't bundle). Callers decide
// how to fall back — typically to DEFAULT_FONT_KEY with a toast.
export function findFontEntry(key: string): FontEntry | null {
  return FONT_REGISTRY.find((e) => e.key === key) ?? null;
}
