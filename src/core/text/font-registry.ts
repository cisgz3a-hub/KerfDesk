// Font registry — typed key → font name + loader path.
//
// Each FontKey is the stable identifier we store in TextObject.fontKey
// and in .lf2 files. Display labels and file paths are looked up from
// the registry; the keys themselves never change so a 3-year-old .lf2
// still resolves.
//
// Phase D bundles thirteen outline fonts and four native CNC stroke fonts.
// All are redistributable under ADR-017 / ADR-226 / ADR-266 / ADR-267:
//   - Roboto Regular          Apache-2.0     sans
//   - Poppins Regular         OFL-1.1        sans (geometric)
//   - Tinos Regular           OFL-1.1        serif (Times-metric)
//   - Tinos Bold              OFL-1.1        serif (Times-metric)
//   - Inconsolata Regular     OFL-1.1        mono
//   - Courier Prime Regular   OFL-1.1        mono (typewriter)
//   - Pacifico Regular        OFL-1.1        script (handwritten)
//   - Dancing Script Regular  OFL-1.1        script (calligraphic)
//   - Anton Regular           OFL-1.1        display (heavy condensed)
//   - Special Elite Regular   Apache-2.0     display (distressed typewriter)
//   - UnifrakturMaguntia Book OFL-1.1        display (blackletter, RFN)
//   - Stardos Stencil Regular OFL-1.1        stencil
//   - Saira Stencil One       OFL-1.1        stencil (display)
//
// Style classes follow each font's own upstream METADATA.pb category, not
// our judgement, except `stencil` — which upstream files under DISPLAY but
// which we surface separately because it is a functional distinction on a
// laser: stencil glyphs bridge their counters, so cutting them out leaves
// no loose centre pieces (ADR-267).
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
  | 'poppins-regular'
  | 'tinos-regular'
  | 'tinos-bold'
  | 'inconsolata-regular'
  | 'courier-prime-regular'
  | 'pacifico-regular'
  | 'dancing-script-regular'
  | 'anton-regular'
  | 'special-elite-regular'
  | 'unifraktur-maguntia-book'
  | 'stardos-stencil-regular'
  | 'saira-stencil-one-regular'
  | 'relief-single-line'
  | 'ems-nixish'
  | 'ems-decorous-script'
  | 'ems-casual-hand';

type SingleLineFontKey = Extract<KnownFontKey, 'relief-single-line' | `ems-${string}`>;

type FontEntryBase = {
  readonly displayName: string;
  readonly license: string;
  readonly styleClass: 'sans' | 'serif' | 'mono' | 'script' | 'display' | 'stencil' | 'single-line';
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
    key: 'poppins-regular',
    displayName: 'Poppins',
    license: 'OFL-1.1',
    styleClass: 'sans',
    geometry: 'outline',
  },
  {
    key: 'tinos-regular',
    displayName: 'Tinos',
    license: 'OFL-1.1',
    styleClass: 'serif',
    geometry: 'outline',
  },
  {
    key: 'tinos-bold',
    displayName: 'Tinos Bold',
    license: 'OFL-1.1',
    styleClass: 'serif',
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
    key: 'courier-prime-regular',
    displayName: 'Courier Prime',
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
    key: 'anton-regular',
    displayName: 'Anton',
    license: 'OFL-1.1',
    styleClass: 'display',
    geometry: 'outline',
  },
  {
    key: 'special-elite-regular',
    displayName: 'Special Elite',
    license: 'Apache-2.0',
    styleClass: 'display',
    geometry: 'outline',
  },
  {
    key: 'unifraktur-maguntia-book',
    displayName: 'UnifrakturMaguntia',
    license: 'OFL-1.1',
    styleClass: 'display',
    geometry: 'outline',
  },
  {
    key: 'stardos-stencil-regular',
    displayName: 'Stardos Stencil',
    license: 'OFL-1.1',
    styleClass: 'stencil',
    geometry: 'outline',
  },
  {
    key: 'saira-stencil-one-regular',
    displayName: 'Saira Stencil One',
    license: 'OFL-1.1',
    styleClass: 'stencil',
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
