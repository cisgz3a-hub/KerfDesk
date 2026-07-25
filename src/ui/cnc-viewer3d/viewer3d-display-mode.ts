// viewer3d-display-mode — what the viewport is currently showing.
//
// A tagged union, not three booleans: "surface hidden and toolpath hidden" is
// not a state anyone wants, and modelling it as flags makes it representable.
// The pure flag derivation lives here so the toolbar and the scene cannot
// disagree about what a mode means.
//
// PURE: a mode in, flags out. No three import.

import { assertNever } from '../../core/scene';

export type Viewer3DDisplayMode =
  // The carve alone — what the part will look like.
  | { readonly kind: 'shaded' }
  // The carve with the route that made it. The default: it answers both
  // "what do I get" and "how does it get there".
  | { readonly kind: 'shaded-toolpath' }
  // Route only, for checking lead-ins and retract heights against nothing.
  | { readonly kind: 'toolpath' }
  // Surface made translucent so the route inside a pocket stays visible.
  | { readonly kind: 'xray' };

export type DisplayModeFlags = {
  readonly isSurfaceVisible: boolean;
  readonly isToolpathVisible: boolean;
  // 1 is opaque. Below 1 the surface material must also be switched to
  // transparent, which is the caller's job.
  readonly surfaceOpacity: number;
};

// Enough to read the form through, not so much that the route is lost in it.
const XRAY_OPACITY = 0.35;

/**
 * Derives what to draw for a display mode.
 *
 * @param mode The current display mode.
 * @returns Visibility and opacity flags for the surface and toolpath.
 */
export function displayModeFlags(mode: Viewer3DDisplayMode): DisplayModeFlags {
  switch (mode.kind) {
    case 'shaded':
      return { isSurfaceVisible: true, isToolpathVisible: false, surfaceOpacity: 1 };
    case 'shaded-toolpath':
      return { isSurfaceVisible: true, isToolpathVisible: true, surfaceOpacity: 1 };
    case 'toolpath':
      return { isSurfaceVisible: false, isToolpathVisible: true, surfaceOpacity: 1 };
    case 'xray':
      return { isSurfaceVisible: true, isToolpathVisible: true, surfaceOpacity: XRAY_OPACITY };
    default:
      return assertNever(mode, 'Viewer3DDisplayMode');
  }
}

export const DEFAULT_DISPLAY_MODE: Viewer3DDisplayMode = { kind: 'shaded-toolpath' };

/** Every mode with its button label and hover explanation, in toolbar order. */
export const DISPLAY_MODE_CHOICES: ReadonlyArray<{
  readonly mode: Viewer3DDisplayMode;
  readonly label: string;
  readonly hint: string;
}> = [
  { mode: { kind: 'shaded' }, label: 'Result', hint: 'Show only the carved part.' },
  {
    mode: { kind: 'shaded-toolpath' },
    label: 'Result + path',
    hint: 'Show the carved part with the route that cuts it.',
  },
  {
    mode: { kind: 'toolpath' },
    label: 'Path',
    hint: 'Show only the route, with no material around it.',
  },
  {
    mode: { kind: 'xray' },
    label: 'X-ray',
    hint: 'Make the part translucent so the route inside pockets stays visible.',
  },
];
