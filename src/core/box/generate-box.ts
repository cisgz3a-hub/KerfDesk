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
import { dividerLayout, hasDividers } from './divider-layout';
import { dividerName, dividerPanelRings, wallSlotCutouts } from './divider-panels';
import { buildSlideLidParts } from './slide-lid-panels';
import { checkBoxAssembly } from './assembly-referee';
import { checkDividerAssembly } from './divider-referee';
import { checkSlideLidAssembly } from './slide-lid-referee';

export type BoxPanel = {
  readonly name: string;
  /** 'divider'/'lid' entries are the ADR-116 V2/V3 loose parts. */
  readonly panel: PanelId | 'divider' | 'lid';
  readonly divider?: { readonly axis: 'x' | 'y'; readonly index: number };
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

type FittedBoxPanel = {
  readonly name: string;
  readonly panel: PanelId | 'divider' | 'lid';
  readonly divider?: BoxPanel['divider'];
} & PanelRings;

type PreparedBoxPanel = {
  readonly name: string;
  readonly panel: PanelId | 'divider' | 'lid';
  readonly divider?: BoxPanel['divider'];
  readonly rings: PanelRings;
};

type FittedPanelsResult =
  | {
      readonly kind: 'fitted';
      readonly panels: ReadonlyArray<FittedBoxPanel>;
      readonly proofPanels: ReadonlyArray<FittedBoxPanel>;
    }
  | { readonly kind: 'error'; readonly message: string };

/** Generate the cut-ready panel sheet for a validated spec. */
export function generateBox(spec: BoxSpec): GenerateBoxResult {
  const validation = validateBoxSpec(spec);
  if (validation.kind === 'invalid') {
    return { kind: 'invalid', issues: validation.issues, warnings: validation.warnings };
  }
  const dividers = hasDividers(spec) ? dividerLayout(spec) : null;
  const slots = dividers === null ? null : wallSlotCutouts(dividers, spec);
  const fitted = fitGeneratedPanels(spec, slots, dividers);
  if (fitted.kind === 'error') return fitted;
  const panels = layoutFittedPanels(fitted.panels, spec.partSpacingMm);
  // Keep numeric-integrity failures ahead of the geometric referee. At extreme
  // finite inputs the layout addition can overflow even though each unplaced
  // panel is finite; feeding those values to the referee produces a misleading
  // collision report instead of the established numeric-range failure.
  if (!panels.every(panelGeometryIsFinite)) {
    return {
      kind: 'error',
      message: 'Box dimensions or spacing exceed the supported numeric range.',
    };
  }
  const assemblyIssues = verifyFittedAssembly(fitted.proofPanels, spec, dividers !== null);
  if (assemblyIssues.length > 0) {
    return {
      kind: 'error',
      message: `Generated box failed its assembly proof: ${assemblyIssues.slice(0, 3).join('; ')}.`,
    };
  }
  return { kind: 'generated', panels };
}

function fitGeneratedPanels(
  spec: BoxSpec,
  slots: ReturnType<typeof wallSlotCutouts> | null,
  dividers: ReturnType<typeof dividerLayout> | null,
): FittedPanelsResult {
  const fittedPanels: FittedBoxPanel[] = [];
  const proofPanels: FittedBoxPanel[] = [];
  const parts = [
    ...nominalParts(spec, slots),
    ...(dividers === null ? [] : dividerParts(spec, dividers)),
  ];
  for (const part of parts) {
    const result = fitPanelWithAssemblyProof(part, spec);
    if (result.kind === 'error') return result;
    fittedPanels.push(result.panel);
    proofPanels.push(result.proofPanel);
  }
  return { kind: 'fitted', panels: fittedPanels, proofPanels };
}

function fitPanelWithAssemblyProof(
  part: PreparedBoxPanel,
  spec: BoxSpec,
):
  | { readonly kind: 'fitted'; readonly panel: FittedBoxPanel; readonly proofPanel: FittedBoxPanel }
  | { readonly kind: 'error'; readonly message: string } {
  // The loose lid's thumb notch is a handhold, not a square-tab seat.
  const relief = part.panel === 'lid' ? ({ kind: 'none' } as const) : spec.relief;
  const fit = applyPanelFit(part.rings, { clearanceMm: spec.clearanceMm, relief });
  if (fit.kind !== 'fitted') {
    return { kind: 'error', message: `${part.name} panel: ${fit.detail}.` };
  }
  const proof =
    relief.kind === 'none'
      ? fit
      : applyPanelFit(part.rings, {
          clearanceMm: spec.clearanceMm,
          relief: { kind: 'none' },
        });
  if (proof.kind !== 'fitted') {
    return { kind: 'error', message: `${part.name} assembly proof: ${proof.detail}.` };
  }
  const identity = {
    name: part.name,
    panel: part.panel,
    ...(part.divider === undefined ? {} : { divider: part.divider }),
  };
  return {
    kind: 'fitted',
    panel: { ...identity, outline: fit.outline, cutouts: fit.cutouts },
    proofPanel: { ...identity, outline: proof.outline, cutouts: proof.cutouts },
  };
}

function layoutFittedPanels(
  fittedPanels: ReadonlyArray<FittedBoxPanel>,
  partSpacingMm: number,
): ReadonlyArray<BoxPanel> {
  const offsets = layoutPanelOffsets(
    fittedPanels.map((panel) => ringsExtent(panel)),
    partSpacingMm,
  );
  return fittedPanels.map((panel, index): BoxPanel => {
    const offsetMm = offsets[index] ?? { x: 0, y: 0 };
    return {
      name: panel.name,
      panel: panel.panel,
      ...(panel.divider === undefined ? {} : { divider: panel.divider }),
      outline: translate(panel.outline, offsetMm),
      cutouts: panel.cutouts.map((cutout) => translate(cutout, offsetMm)),
      offsetMm,
    };
  });
}

function verifyFittedAssembly(
  panels: ReadonlyArray<FittedBoxPanel>,
  spec: BoxSpec,
  includesDividers: boolean,
): ReadonlyArray<string> {
  // The referee's play model covers nominal and non-negative clearance.
  // Negative clearance is deliberate interference and has a different fit
  // contract, so it retains the generator's numeric/topology validation.
  if (spec.clearanceMm < 0) return [];
  const options = { playMm: spec.clearanceMm };
  const walls = panels.flatMap((panel) =>
    panel.panel === 'divider' || panel.panel === 'lid'
      ? []
      : [{ panel: panel.panel, outline: panel.outline, cutouts: panel.cutouts }],
  );
  const issues =
    spec.style === 'slide-lid'
      ? checkSlideLidAssembly(panels, spec, options)
      : checkBoxAssembly(walls, spec, options);
  if (!includesDividers) return issues;
  return [
    ...issues,
    ...checkDividerAssembly(
      {
        walls: walls.map((panel) => ({ panel: panel.panel, cutouts: panel.cutouts })),
        dividers: panels.flatMap((panel) =>
          panel.panel === 'divider' && panel.divider !== undefined
            ? [{ ...panel.divider, outline: panel.outline }]
            : [],
        ),
      },
      spec,
      options,
    ),
  ];
}

// Walls (with any divider slots) per style: claim-model panels for closed
// and open-top, the dedicated slide-lid builder otherwise.
function nominalParts(
  spec: BoxSpec,
  slots: ReadonlyMap<PanelId, ReadonlyArray<Polyline>> | null,
): ReadonlyArray<PreparedBoxPanel> {
  if (spec.style === 'slide-lid') {
    return buildSlideLidParts(spec).map((part) => ({
      name: part.name,
      panel: part.panel,
      rings: {
        outline: part.rings.outline,
        cutouts: [
          ...part.rings.cutouts,
          ...(part.panel === 'lid' ? [] : (slots?.get(part.panel) ?? [])),
        ],
      },
    }));
  }
  return buildPanelClaims(spec).map((claims) => ({
    name: PANEL_NAMES[claims.panel],
    panel: claims.panel,
    rings: {
      outline: panelOutline(claims),
      cutouts: slots?.get(claims.panel) ?? [],
    },
  }));
}

function dividerParts(
  spec: BoxSpec,
  dividers: ReturnType<typeof dividerLayout>,
): ReadonlyArray<PreparedBoxPanel> {
  return [...dividers.xDividers, ...dividers.yDividers].map((placement) => ({
    name: dividerName(placement),
    panel: 'divider',
    divider: { axis: placement.axis, index: placement.index },
    rings: dividerPanelRings(dividers, placement, spec),
  }));
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

function panelGeometryIsFinite(panel: BoxPanel): boolean {
  return (
    Number.isFinite(panel.offsetMm.x) &&
    Number.isFinite(panel.offsetMm.y) &&
    [panel.outline, ...panel.cutouts].every((ring) =>
      ring.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    )
  );
}
