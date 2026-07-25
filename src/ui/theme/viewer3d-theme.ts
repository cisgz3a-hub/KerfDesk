// viewer3d-theme — the named appearance constants for the 3D viewport (the
// ADR-102 three.js scene), the 3D counterpart of canvas-theme.ts.
//
// three.js takes NUMERIC colors, not CSS strings, so CSS custom properties
// cannot reach the scene and the ADR-047 raw-hex lint rule cannot see these
// either (its selector matches string literals only). Collecting them here
// gives the 3D view the same single point of change the Canvas2D palette has.
//
// Surface and edge tones are byte-identical to the literals they replaced —
// the lighting rig changes, the material colors deliberately do not, so the
// upgrade is attributable to one variable at a time.

export const viewer3dTheme = {
  color: {
    surface: 0xb08050, // carved-wood tone, matches the 2D depth map
    stockEdge: 0x707070,
    background: 0x1c1f24,
  },
  // Image-based lighting (RoomEnvironment through PMREMGenerator) supplies
  // most of the fill, so the explicit ambient term is far lower than the
  // pre-IBL 0.55 — leaving it high washes the carve out to flat plastic.
  lighting: {
    ambientIntensity: 0.12,
    keyIntensity: 1.35,
    fillIntensity: 0.35,
    environmentIntensity: 0.85,
    // PMREM blur sigma: a touch of roughness on the room reflection so the
    // surface reads as machined material rather than polished chrome.
    environmentBlurSigma: 0.04,
    toneMappingExposure: 1.05,
  },
  // Retina panes render 4× the pixels for a barely-visible gain; 2 is the
  // usual quality/cost knee and keeps integrated GPUs inside budget.
  maxPixelRatio: 2,
} as const;
