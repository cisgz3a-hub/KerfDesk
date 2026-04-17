/**
 * Registry of bundled fonts. Fonts are served from public/fonts/ and fetched
 * at runtime with the standard fetch() API (works in dev via Vite and in the
 * Electron production bundle).
 */

export type FontCategory = 'sans' | 'serif' | 'display' | 'script' | 'mono' | 'stencil' | 'engraving';

export interface BundledFont {
  /** Stable identifier used in TextGeometry.fontFamily */
  family: string;
  /** Display label in the picker */
  label: string;
  /** Kind of font, used for filtering in the picker */
  category: FontCategory;
  /** URL relative to the app root */
  url: string;
  /** License shorthand for the credits screen */
  license: 'OFL-1.1' | 'Apache-2.0' | 'Public-Domain';
  /** Copyright attribution shown in credits */
  copyright: string;
  /**
   * Optional Hershey family key from the hersheytext package.
   * When set, compile routes through single-line polyline generation.
   */
  hersheyFamily?: string;
}

export const BUNDLED_FONTS: BundledFont[] = [
  // --- Sans ---
  { family: 'Inter',            label: 'Inter',            category: 'sans',    url: '/fonts/Inter-Regular.ttf',           license: 'OFL-1.1',    copyright: 'Copyright (c) The Inter Project Authors (https://github.com/rsms/inter)' },
  { family: 'Roboto',           label: 'Roboto',           category: 'sans',    url: '/fonts/Roboto-Regular.ttf',          license: 'OFL-1.1',    copyright: 'Copyright 2011 Google LLC' },
  { family: 'Open Sans',        label: 'Open Sans',        category: 'sans',    url: '/fonts/OpenSans-Regular.ttf',        license: 'OFL-1.1',    copyright: 'Copyright (c) The Open Sans Project Authors' },
  { family: 'Montserrat',       label: 'Montserrat',       category: 'sans',    url: '/fonts/Montserrat-Regular.ttf',      license: 'OFL-1.1',    copyright: 'Copyright (c) The Montserrat Project Authors' },
  { family: 'Lato',             label: 'Lato',             category: 'sans',    url: '/fonts/Lato-Regular.ttf',            license: 'OFL-1.1',    copyright: 'Copyright (c) 2010-2015 by tyPoland Lukasz Dziedzic' },
  { family: 'DM Sans',          label: 'DM Sans',          category: 'sans',    url: '/fonts/DMSans-Regular.ttf',          license: 'OFL-1.1',    copyright: 'Copyright (c) The DM Sans Project Authors' },
  // --- Serif ---
  { family: 'Playfair Display', label: 'Playfair Display', category: 'serif',   url: '/fonts/PlayfairDisplay-Regular.ttf', license: 'OFL-1.1',    copyright: 'Copyright (c) The Playfair Project Authors' },
  { family: 'Merriweather',     label: 'Merriweather',     category: 'serif',   url: '/fonts/Merriweather-Regular.ttf',    license: 'OFL-1.1',    copyright: 'Copyright (c) The Merriweather Project Authors' },
  { family: 'Lora',             label: 'Lora',             category: 'serif',   url: '/fonts/Lora-Regular.ttf',            license: 'OFL-1.1',    copyright: 'Copyright (c) The Lora Project Authors' },
  { family: 'EB Garamond',      label: 'EB Garamond',      category: 'serif',   url: '/fonts/EBGaramond-Regular.ttf',      license: 'OFL-1.1',    copyright: 'Copyright (c) The EB Garamond Project Authors' },
  // --- Display ---
  { family: 'Bebas Neue',       label: 'Bebas Neue',       category: 'display', url: '/fonts/BebasNeue-Regular.ttf',       license: 'OFL-1.1',    copyright: 'Copyright (c) The Bebas Neue Project Authors' },
  { family: 'Anton',            label: 'Anton',            category: 'display', url: '/fonts/Anton-Regular.ttf',           license: 'OFL-1.1',    copyright: 'Copyright (c) The Anton Project Authors' },
  { family: 'Oswald',           label: 'Oswald',           category: 'display', url: '/fonts/Oswald-Regular.ttf',          license: 'OFL-1.1',    copyright: 'Copyright (c) The Oswald Project Authors' },
  { family: 'Press Start 2P',   label: 'Press Start 2P',   category: 'display', url: '/fonts/PressStart2P-Regular.ttf',    license: 'OFL-1.1',    copyright: 'Copyright (c) The Press Start 2P Project Authors' },
  // --- Script ---
  { family: 'Pacifico',         label: 'Pacifico',         category: 'script',  url: '/fonts/Pacifico-Regular.ttf',        license: 'OFL-1.1',    copyright: 'Copyright (c) The Pacifico Project Authors' },
  { family: 'Dancing Script',   label: 'Dancing Script',   category: 'script',  url: '/fonts/DancingScript-Regular.ttf',   license: 'OFL-1.1',    copyright: 'Copyright (c) The Dancing Script Project Authors' },
  { family: 'Caveat',           label: 'Caveat',           category: 'script',  url: '/fonts/Caveat-Regular.ttf',          license: 'OFL-1.1',    copyright: 'Copyright (c) The Caveat Project Authors' },
  // --- Mono ---
  { family: 'JetBrains Mono',   label: 'JetBrains Mono',   category: 'mono',    url: '/fonts/JetBrainsMono-Regular.ttf',   license: 'OFL-1.1',    copyright: 'Copyright 2020 The JetBrains Mono Project Authors' },
  { family: 'Fira Code',        label: 'Fira Code',        category: 'mono',    url: '/fonts/FiraCode-Regular.ttf',        license: 'OFL-1.1',    copyright: 'Copyright (c) 2014 The Fira Code Project Authors' },
  // --- Stencil ---
  { family: 'Stardos Stencil',  label: 'Stardos Stencil',  category: 'stencil', url: '/fonts/StardosStencil-Regular.ttf',  license: 'OFL-1.1',    copyright: 'Copyright (c) The Stardos Stencil Project Authors' },
  // --- Engraving (Hershey single-line) ---
  { family: 'Hershey Sans',     label: 'Hershey Sans  (single-line)',   category: 'engraving', url: '', license: 'Public-Domain', copyright: 'Hershey fonts by Dr. A.V. Hershey, US National Bureau of Standards (public domain)', hersheyFamily: 'futural' },
  { family: 'Hershey Roman',    label: 'Hershey Roman  (single-line)',  category: 'engraving', url: '', license: 'Public-Domain', copyright: 'Hershey fonts by Dr. A.V. Hershey, US National Bureau of Standards (public domain)', hersheyFamily: 'timesr' },
  { family: 'Hershey Script',   label: 'Hershey Script  (single-line)', category: 'engraving', url: '', license: 'Public-Domain', copyright: 'Hershey fonts by Dr. A.V. Hershey, US National Bureau of Standards (public domain)', hersheyFamily: 'cursive' },
  { family: 'Hershey Gothic',   label: 'Hershey Gothic  (single-line)', category: 'engraving', url: '', license: 'Public-Domain', copyright: 'Hershey fonts by Dr. A.V. Hershey, US National Bureau of Standards (public domain)', hersheyFamily: 'gothiceng' },
];

export function findBundledFont(family: string): BundledFont | undefined {
  return BUNDLED_FONTS.find(f => f.family === family);
}
