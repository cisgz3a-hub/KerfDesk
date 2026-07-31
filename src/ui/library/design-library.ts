// Bundled Design Library manifest (ADR-105 G11). Customer artwork uses one
// pinned, provenance-complete visual family; CurveDesk templates remain
// geometry-only and flow through the normal SVG insertion path.

import { OWNED_TEMPLATE_ENTRIES } from './design-library-owned-svg';
import { TABLER_LIBRARY_ENTRIES } from './design-library-tabler';
import type { LibraryCategory, LibraryEntry } from './design-library-types';

export type { LibraryCategory, LibraryEntry } from './design-library-types';

export const LIBRARY_CATEGORIES: ReadonlyArray<LibraryCategory> = [
  'Laser Templates',
  'CNC Templates',
  'Test & Calibration',
  'Jigs & Fixtures',
  'Boxes & Joinery',
  'Signs & Plaques',
  'Decorative Artwork',
  'Icons & Symbols',
];

export const DESIGN_LIBRARY: ReadonlyArray<LibraryEntry> = [
  ...OWNED_TEMPLATE_ENTRIES,
  ...TABLER_LIBRARY_ENTRIES,
];
