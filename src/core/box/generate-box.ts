// generate-box — the ADR-106 orchestrator: validated spec → claims →
// outlines → fit/relief → sheet layout. Pure and deterministic (no RNG, no
// clock); ids and layer colors are the UI's job at insertion. Failure is a
// value, never a throw, and a failed generation emits no panels at all
// (no-partial-output, F-K1 error flow).

import type { Polyline, Vec2 } from '../scene';
import { validateBoxSpec, type BoxSpec, type BoxSpecIssue } from './box-spec';
import { buildPanelClaims, type PanelId } from './panel-claims';
import { panelOutline } from './panel-outline';
import { applyPanelFit, type PanelRings } from './panel-fit';
import { layoutPanelOffsets, type PanelExtent } from './layout';

export type BoxPanel = {
  readonly name: string;
  readonly panel: PanelId;
  /** Closed outline in sheet mm (layout offset already applied). */
  readonly outline: Polyline;
  /** Interior cutout rings in sheet mm (ADR-116; empty without dividers). */
  readonly cutouts: ReadonlyArray<Polyline>;
  /** The layout translation; subtract it to recover the local panel frame. */
  readonly offsetMm: Vec2;
};

export type GenerateBoxResult =
  | { readonly kind: 'generated'; readonly panels: ReadonlyArray<BoxPanel> }
  | {
      readonly kind: 'invalid';
      readonly issues: ReadonlyArray<BoxSpecIssue>;
      readonly warnings: ReadonlyArray<BoxSpecIssue>;
    }
  | { readonly kind: 'error'; readonly message: string };

const PANEL_NAMES: Readonly<Record<PanelId, string>> = {
  bottom: 'Bottom',
  top: 'Top',
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
};

/** Generate the cut-ready panel sheet for a validated spec. */
export function generateBox(spec: BoxSpec): GenerateBoxResult {
  const validation = validateBoxSpec(spec);
  if (validation.kind === 'invalid') {
    return { kind: 'invalid', issues: validation.issues, warnings: validation.warnings };
  }
  const fittedPanels: Array<{ panel: PanelId } & PanelRings> = [];
  for (const claims of buildPanelClaims(spec)) {
    // Cutouts arrive with the divider pack (ADR-116 V2): wall slots join
    // the nominal rings here, ahead of the shared fit pass.
    const fit = applyPanelFit(
      { outline: panelOutline(claims), cutouts: [] },
      { clearanceMm: spec.clearanceMm, relief: spec.relief },
    );
    if (fit.kind !== 'fitted') {
      return { kind: 'error', message: `${PANEL_NAMES[claims.panel]} panel: ${fit.detail}.` };
    }
    fittedPanels.push({ panel: claims.panel, outline: fit.outline, cutouts: fit.cutouts });
  }
  const offsets = layoutPanelOffsets(
    fittedPanels.map((panel) => ringsExtent(panel)),
    spec.partSpacingMm,
  );
  return {
    kind: 'generated',
    panels: fittedPanels.map((panel, index) => {
      const offsetMm = offsets[index] ?? { x: 0, y: 0 };
      return {
        name: PANEL_NAMES[panel.panel],
        panel: panel.panel,
        outline: translate(panel.outline, offsetMm),
        cutouts: panel.cutouts.map((cutout) => translate(cutout, offsetMm)),
        offsetMm,
      };
    }),
  };
}

function ringsExtent(rings: PanelRings): PanelExtent {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of [rings.outline, ...rings.cutouts]) {
    for (const point of ring.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function translate(ring: Polyline, offsetMm: Vec2): Polyline {
  return {
    closed: ring.closed,
    points: ring.points.map((point) => ({ x: point.x + offsetMm.x, y: point.y + offsetMm.y })),
  };
}
