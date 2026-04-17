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
}

export const BUNDLED_FONTS: BundledFont[] = [
  {
    family: 'Inter',
    label: 'Inter',
    category: 'sans',
    url: '/fonts/Inter-Regular.ttf',
    license: 'OFL-1.1',
    copyright: 'Copyright (c) The Inter Project Authors (https://github.com/rsms/inter)',
  },
];

export function findBundledFont(family: string): BundledFont | undefined {
  return BUNDLED_FONTS.find(f => f.family === family);
}
