// Font registry — typed key → font name + loader path.
//
// Each FontKey is the stable identifier we store in TextObject.fontKey
// and in .lf2 files. Display labels and file paths are looked up from
// the registry; the keys themselves never change so a 3-year-old .lf2
// still resolves.
//
// Phase D bundles four outline fonts and four native CNC stroke fonts.
// All are redistributable under ADR-017 / ADR-226:
//   - Roboto Regular          Apache-2.0     sans
//   - Inconsolata Regular     OFL-1.1        mono
//   - Pacifico Regular        OFL-1.1        script (handwritten)
//   - Dancing Script Regular  OFL-1.1        script (calligraphic)
//   - Relief SingleLine       OFL-1.1        single-line technical
//   - EMS Nixish              OFL-1.1        single-line display
//   - EMS Decorous Script     OFL-1.1        single-line calligraphic
//   - EMS Casual Hand         OFL-1.1        single-line handwritten
//
// File loading: the UI layer fetches outline .ttf files from known asset
// paths. The core stroke renderer lazy-loads compact pinned SVG glyph data.
// This module only declares the shared registry shape.

// KnownFontKey narrows the bundle to the fonts we actually ship.
// TextObject.fontKey is `string` (the union member in scene-object) so
// .lf2 files can carry future-unknown keys without rejection; this
// narrow type is what the UI uses for compile-time safety and what
// the registry constrains its keys to.
export type KnownFontKey =
  | 'roboto-regular'
  | 'inconsolata-regular'
  | 'pacifico-regular'
  | 'dancing-script-regular'
  | 'relief-single-line'
  | 'ems-nixish'
  | 'ems-decorous-script'
  | 'ems-casual-hand';

type SingleLineFontKey = Extract<KnownFontKey, 'relief-single-line' | `ems-${string}`>;

type FontEntryBase = {
  readonly displayName: string;
  readonly license: string;
  readonly styleClass: 'sans' | 'mono' | 'script' | 'single-line';
};

export type FontEntry =
  | (FontEntryBase & {
      readonly key: Exclude<KnownFontKey, SingleLineFontKey>;
      readonly geometry: 'outline';
    })
  | (FontEntryBase & {
      readonly key: SingleLineFontKey;
      readonly geometry: 'single-line';
    });

export const FONT_REGISTRY: ReadonlyArray<FontEntry> = [
  {
    key: 'roboto-regular',
    displayName: 'Roboto',
    license: 'Apache-2.0',
    styleClass: 'sans',
    geometry: 'outline',
  },
  {
    key: 'inconsolata-regular',
    displayName: 'Inconsolata',
    license: 'OFL-1.1',
    styleClass: 'mono',
    geometry: 'outline',
  },
  {
    key: 'pacifico-regular',
    displayName: 'Pacifico',
    license: 'OFL-1.1',
    styleClass: 'script',
    geometry: 'outline',
  },
  {
    key: 'dancing-script-regular',
    displayName: 'Dancing Script',
    license: 'OFL-1.1',
    styleClass: 'script',
    geometry: 'outline',
  },
  {
    key: 'relief-single-line',
    displayName: 'Relief SingleLine',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'ems-nixish',
    displayName: 'EMS Nixish',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'ems-decorous-script',
    displayName: 'EMS Decorous Script',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'ems-casual-hand',
    displayName: 'EMS Casual Hand',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
];

export const DEFAULT_FONT_KEY: KnownFontKey = 'roboto-regular';

// Returns null when the key isn't registered (e.g., a .lf2 from a
// future version referencing a font we don't bundle). Callers decide
// how to fall back — typically to DEFAULT_FONT_KEY with a toast.
export function findFontEntry(key: string): FontEntry | null {
  return FONT_REGISTRY.find((e) => e.key === key) ?? null;
}
