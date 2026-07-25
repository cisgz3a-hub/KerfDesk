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
  // Move-kind palette. RED MEANS TRAVERSAL, following LightBurn, which
  // PROJECT.md names as this project's reference. Note OpenBuilds CONTROL uses
  // the opposite convention (red = G1 cut), so this is a real fork in the road
  // and not an arbitrary pick — an operator reading it backwards would think
  // rapids were cuts.
  toolpath: {
    rapid: 0xd4483c,
    feedTravel: 0xc98a2b,
    cut: 0x3f9fd0,
    plunge: 0xe07a35,
    retract: 0x8f7566,
    // Depth ramp for cutting moves. Endpoints mirror the 2D canvas's
    // SHALLOW_RGB/DEEP_RGB in draw-cnc-removal.ts so the two previews cannot
    // tell the operator different stories about the same cut.
    depthShallow: 0xc4a074,
    depthDeep: 0x4a301c,
  },
  // Screen-space line widths in CSS pixels (worldUnits: false), so the path
  // stays legible at any zoom. Traversals are drawn thinner than cuts because
  // they are context, not the subject.
  toolpathWidthMm: {
    cut: 0.45,
    plunge: 0.4,
    travel: 0.2,
  },
  // Traversals also sit back in opacity so a dense rapid web never buries the
  // cut it is connecting.
  toolpathTravelOpacity: 0.55,
  // Scenery: dim enough to read as context rather than content. If the grid
  // competes with the toolpath for attention it is doing the opposite of its
  // job.
  stage: {
    gridMinor: 0x3a4048,
    gridMajor: 0x525b66,
    gridOpacity: 0.5,
  },
  // The cutter. Translucent because an opaque tool hides precisely the cut the
  // operator is inspecting — it is always sitting in it.
  tool: {
    body: 0xe8a13a,
    opacity: 0.5,
  },
} as const;
