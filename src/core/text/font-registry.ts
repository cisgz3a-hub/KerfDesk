// Font registry — typed key → font name + loader path.
//
// Each FontKey is the stable identifier we store in TextObject.fontKey
// and in .lf2 files. Display labels and file paths are looked up from
// the registry; the keys themselves never change so a 3-year-old .lf2
// still resolves.
//
// Phase D bundles four outline fonts plus fifteen Forge/EMS CNC single-line fonts.
// All are redistributable under ADR-017 and ADR-012/191:
//   - Roboto Regular          Apache-2.0     sans
//   - Inconsolata Regular     OFL-1.1        mono
//   - Pacifico Regular        OFL-1.1        script (handwritten)
//   - Dancing Script Regular  OFL-1.1        script (calligraphic)
//   - Hershey Roman Simplex   public-domain data with acknowledgement terms
//   - EMS Allure              OFL-1.1        single-line calligraphy
//   - EMS Delight             OFL-1.1        single-line handwriting
//   - EMS Tech                OFL-1.1        single-line architectural hand
//   - EMS Osmotron            OFL-1.1        single-line geometric display
//   - Forge Soft              MIT + Hershey   original rounded workshop hand
//   - Forge Soft Cursive      MIT + Hershey   original connected script hand
//   - Forge Compact           MIT + Hershey   condensed production lettering
//   - Forge Sign              MIT + Hershey   broad rounded display lettering
//   - Forge Swing             MIT + Hershey   expressive connected maker script
//   - Forge Grace             MIT + Hershey   elegant connected monoline script
//   - Forge Grace Flourish    MIT + Hershey   alternate ornamental display capitals
//   - Forge Signature         OFL-1.1        centerline trace of Sacramento
//   - Forge Romantic          OFL-1.1        centerline trace of Great Vibes
//   - Forge Copperplate       OFL-1.1        centerline trace of Alex Brush
//   - Forge Casual            OFL-1.1        centerline trace of Caveat
//   - Forge Friendly          OFL-1.1        centerline trace of Dancing Script
//   - Forge Signwriter        OFL-1.1        centerline trace of Kaushan Script
//   - Forge Parisian          OFL-1.1        centerline trace of Parisienne
//   - Forge Personal          OFL-1.1        centerline trace of Pacifico
//
// File loading: the UI layer fetches the .ttf via a browser fetch()
// to a known asset path. Pure-core stays binary-free; this module
// only declares the registry shape.

// KnownFontKey narrows the bundle to the four fonts we actually ship.
// TextObject.fontKey is `string` (the union member in scene-object) so
// .lf2 files can carry future-unknown keys without rejection; this
// narrow type is what the UI uses for compile-time safety and what
// the registry constrains its keys to.
export type KnownFontKey =
  | 'roboto-regular'
  | 'inconsolata-regular'
  | 'pacifico-regular'
  | 'dancing-script-regular'
  | 'hershey-simplex'
  | 'ems-allure'
  | 'ems-delight'
  | 'ems-tech'
  | 'ems-osmotron'
  | 'forge-soft'
  | 'forge-soft-cursive'
  | 'forge-compact'
  | 'forge-sign'
  | 'forge-swing'
  | 'forge-grace'
  | 'forge-grace-flourish'
  | 'forge-signature'
  | 'forge-romantic'
  | 'forge-copperplate'
  | 'forge-casual'
  | 'forge-friendly'
  | 'forge-signwriter'
  | 'forge-parisian'
  | 'forge-personal';

type SingleLineFontKey = Extract<
  KnownFontKey,
  'hershey-simplex' | `ems-${string}` | `forge-${string}`
>;

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
    key: 'hershey-simplex',
    displayName: 'Hershey Simplex',
    license: 'Hershey redistribution terms',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'ems-allure',
    displayName: 'EMS Allure',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'ems-delight',
    displayName: 'EMS Delight',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'ems-tech',
    displayName: 'EMS Tech',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'ems-osmotron',
    displayName: 'EMS Osmotron',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-soft',
    displayName: 'Forge Soft',
    license: 'MIT + Hershey redistribution terms',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-soft-cursive',
    displayName: 'Forge Soft Cursive',
    license: 'MIT + Hershey redistribution terms',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-compact',
    displayName: 'Forge Compact',
    license: 'MIT + Hershey redistribution terms',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-sign',
    displayName: 'Forge Sign',
    license: 'MIT + Hershey redistribution terms',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-swing',
    displayName: 'Forge Swing',
    license: 'MIT + Hershey redistribution terms',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-grace',
    displayName: 'Forge Grace',
    license: 'MIT + Hershey redistribution terms',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-grace-flourish',
    displayName: 'Forge Grace Flourish',
    license: 'MIT + Hershey redistribution terms',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-signature',
    displayName: 'Forge Signature',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-romantic',
    displayName: 'Forge Romantic',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-copperplate',
    displayName: 'Forge Copperplate',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-casual',
    displayName: 'Forge Casual',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-friendly',
    displayName: 'Forge Friendly',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-signwriter',
    displayName: 'Forge Signwriter',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-parisian',
    displayName: 'Forge Parisian',
    license: 'OFL-1.1',
    styleClass: 'single-line',
    geometry: 'single-line',
  },
  {
    key: 'forge-personal',
    displayName: 'Forge Personal',
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
