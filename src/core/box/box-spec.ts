// box-spec — the BoxSpec parameter type, inner/outer dimension derivation,
// and validateBoxSpec (ADR-106). Validation is a pure Result-style union; the
// dialog renders issues and disables generation — nothing here throws.

import { edgePattern, MIN_FINGER_WIDTH_MM } from './edge-pattern';
import { minOf } from '../util';
import { formatRoundedTo2Decimals } from '../util/number-format';

export type BoxStyle = 'closed' | 'open-top' | 'slide-lid' | 'lift-lid' | 'open-front';
export type BoxDimensionMode = 'inner' | 'outer';

export type BoxRelief =
  | { readonly kind: 'none' }
  | { readonly kind: 'corner-overcut'; readonly toolDiameterMm: number };

export type BoxSpec = {
  /** X dimension; inner or outer per dimensionMode. */
  readonly widthMm: number;
  /** Y dimension. */
  readonly depthMm: number;
  /** Z dimension. */
  readonly heightMm: number;
  readonly dimensionMode: BoxDimensionMode;
  readonly thicknessMm: number;
  readonly targetFingerWidthMm: number;
  readonly style: BoxStyle;
  /** Signed joint play; + = looser. Applied as a uniform −c/4 contour offset. */
  readonly clearanceMm: number;
  /** CNC corner-overcut relief; 'none' for laser (ADR-106 fit division). */
  readonly relief: BoxRelief;
  readonly partSpacingMm: number;
  /** Dividers partitioning the width (thin slabs in X); absent = 0 (ADR-116). */
  readonly dividersXCount?: number;
  /** Dividers partitioning the depth (thin slabs in Y); absent = 0 (ADR-116). */
  readonly dividersYCount?: number;
};

export type BoxDims = {
  readonly outerWidthMm: number;
  readonly outerDepthMm: number;
  readonly outerHeightMm: number;
  readonly innerWidthMm: number;
  readonly innerDepthMm: number;
  readonly innerHeightMm: number;
};

export type BoxSpecField =
  | 'width'
  | 'depth'
  | 'height'
  | 'thickness'
  | 'fingerWidth'
  | 'clearance'
  | 'reliefTool'
  | 'partSpacing'
  | 'dividersX'
  | 'dividersY';

export type BoxSpecIssue = { readonly field: BoxSpecField; readonly message: string };

export type BoxSpecValidation =
  | { readonly kind: 'valid'; readonly warnings: ReadonlyArray<BoxSpecIssue> }
  | {
      readonly kind: 'invalid';
      readonly issues: ReadonlyArray<BoxSpecIssue>;
      readonly warnings: ReadonlyArray<BoxSpecIssue>;
    };

/**
 * Derive both dimension sets. Each axis adds one T per layer the style
 * stacks around the cavity. Width always has two walls. Depth has two,
 * except open-front, which has only the back (ADR-693). Height: closed 2T
 * (bottom + top), open-top T (bottom only, ADR-106 Amd 1), slide-lid 3T
 * (bottom + lid + captive top strip, ADR-116 V3), lift-lid 3T (bottom + lid
 * lip band + lid top, ADR-693), open-front 2T. The entered inner
 * dimensions therefore always stay the usable cavity.
 */
export function deriveBoxDims(spec: BoxSpec): BoxDims {
  const t2 = 2 * spec.thicknessMm;
  const yExtra = depthLayers(spec.style) * spec.thicknessMm;
  const zExtra = HEIGHT_LAYERS[spec.style] * spec.thicknessMm;
  if (spec.dimensionMode === 'inner') {
    return {
      innerWidthMm: spec.widthMm,
      innerDepthMm: spec.depthMm,
      innerHeightMm: spec.heightMm,
      outerWidthMm: spec.widthMm + t2,
      outerDepthMm: spec.depthMm + yExtra,
      outerHeightMm: spec.heightMm + zExtra,
    };
  }
  return {
    outerWidthMm: spec.widthMm,
    outerDepthMm: spec.depthMm,
    outerHeightMm: spec.heightMm,
    innerWidthMm: spec.widthMm - t2,
    innerDepthMm: spec.depthMm - yExtra,
    innerHeightMm: spec.heightMm - zExtra,
  };
}

const HEIGHT_LAYERS: Readonly<Record<BoxStyle, number>> = {
  closed: 2,
  'open-top': 1,
  'slide-lid': 3,
  'lift-lid': 3,
  'open-front': 2,
};

function depthLayers(style: BoxStyle): number {
  return style === 'open-front' ? 1 : 2;
}

/**
 * Height of the fingered walls: the full outer height, except a lift-off
 * lid, whose loose lid top sits on the wall rim (ADR-693).
 */
export function wallHeightMm(spec: BoxSpec, dims: BoxDims): number {
  return spec.style === 'lift-lid' ? dims.outerHeightMm - spec.thicknessMm : dims.outerHeightMm;
}

/** Validate a spec; generation must be gated on `kind === 'valid'`. */
export function validateBoxSpec(spec: BoxSpec): BoxSpecValidation {
  const issues: BoxSpecIssue[] = [];
  const warnings: BoxSpecIssue[] = [];
  collectFieldIssues(spec, issues);
  if (issues.length > 0) return { kind: 'invalid', issues, warnings };
  collectInteriorIssues(spec, issues);
  if (issues.length > 0) return { kind: 'invalid', issues, warnings };
  collectDividerIssues(spec, issues);
  if (issues.length > 0) return { kind: 'invalid', issues, warnings };
  const minCellMm = minFingerCellMm(spec, deriveBoxDims(spec));
  collectReliefIssues(spec, minCellMm, issues, warnings);
  collectClearanceIssues(spec, minCellMm, issues);
  if (issues.length > 0) return { kind: 'invalid', issues, warnings };
  return { kind: 'valid', warnings };
}

function collectFieldIssues(spec: BoxSpec, issues: BoxSpecIssue[]): void {
  checkPositive(issues, 'width', spec.widthMm);
  checkPositive(issues, 'depth', spec.depthMm);
  checkPositive(issues, 'height', spec.heightMm);
  checkPositive(issues, 'thickness', spec.thicknessMm);
  checkPositive(issues, 'fingerWidth', spec.targetFingerWidthMm);
  if (!Number.isFinite(spec.clearanceMm)) {
    issues.push({ field: 'clearance', message: 'Clearance must be a number.' });
  }
  if (!Number.isFinite(spec.partSpacingMm) || spec.partSpacingMm < 0) {
    issues.push({ field: 'partSpacing', message: 'Part spacing must be 0 or greater.' });
  } else if (!Number.isFinite(2 * spec.partSpacingMm)) {
    issues.push({
      field: 'partSpacing',
      message: 'Part spacing is too large to lay out the panel sheet.',
    });
  }
}

function collectInteriorIssues(spec: BoxSpec, issues: BoxSpecIssue[]): void {
  const dims = deriveBoxDims(spec);
  for (const [field, innerMm, outerMm, enteredMm] of [
    ['width', dims.innerWidthMm, dims.outerWidthMm, spec.widthMm],
    ['depth', dims.innerDepthMm, dims.outerDepthMm, spec.depthMm],
    ['height', dims.innerHeightMm, dims.outerHeightMm, spec.heightMm],
  ] as const) {
    if (!Number.isFinite(innerMm) || !Number.isFinite(outerMm)) {
      issues.push({
        field,
        message: `The ${field} and material thickness produce a dimension outside the numeric range.`,
      });
      continue;
    }
    if (innerMm <= 0) {
      issues.push({
        field,
        message: `Outer ${field} ${formatRoundedTo2Decimals(enteredMm)} mm leaves no interior at thickness ${formatRoundedTo2Decimals(spec.thicknessMm)} mm.`,
      });
    }
  }
}

function collectReliefIssues(
  spec: BoxSpec,
  minCellMm: number,
  issues: BoxSpecIssue[],
  warnings: BoxSpecIssue[],
): void {
  if (spec.relief.kind !== 'corner-overcut') return;
  const toolMm = spec.relief.toolDiameterMm;
  if (!Number.isFinite(toolMm) || toolMm <= 0) {
    issues.push({ field: 'reliefTool', message: 'Relief tool diameter must be greater than 0.' });
    return;
  }
  if (minCellMm <= toolMm) {
    issues.push({
      field: 'reliefTool',
      message: `Finger width ${formatRoundedTo2Decimals(minCellMm)} mm is not larger than the ${formatRoundedTo2Decimals(toolMm)} mm relief tool — tabs cannot be relieved. Increase finger width or use a smaller bit.`,
    });
    return;
  }
  if (minCellMm < 2 * toolMm) {
    warnings.push({
      field: 'reliefTool',
      message: `Finger width ${formatRoundedTo2Decimals(minCellMm)} mm is under twice the ${formatRoundedTo2Decimals(toolMm)} mm relief tool; joints will be mostly relief. Consider a wider finger.`,
    });
  }
}

function collectClearanceIssues(spec: BoxSpec, minCellMm: number, issues: BoxSpecIssue[]): void {
  if (spec.style === 'slide-lid' && spec.clearanceMm <= 0) {
    issues.push({
      field: 'clearance',
      message: 'A slide lid needs clearance to slide — use 0.2 mm or more.',
    });
    return;
  }
  if (spec.style === 'lift-lid' && spec.clearanceMm <= 0) {
    issues.push({
      field: 'clearance',
      message: 'A lift-off lid needs clearance to drop into the box — use 0.2 mm or more.',
    });
    return;
  }
  const clearanceLimitMm = Math.min(minCellMm, spec.thicknessMm) / 2;
  if (Math.abs(spec.clearanceMm) >= clearanceLimitMm) {
    issues.push({
      field: 'clearance',
      message: `Clearance must stay under ${formatRoundedTo2Decimals(clearanceLimitMm)} mm (half the smallest finger or the thickness).`,
    });
  }
}

// Divider counts must be whole and small enough that every compartment
// clears 2T; a divider grid a bit can't relieve is rejected via the shared
// min-cell rule below (the junction cells join the min).
function collectDividerIssues(spec: BoxSpec, issues: BoxSpecIssue[]): void {
  const dims = deriveBoxDims(spec);
  for (const [field, count, innerMm] of [
    ['dividersX', spec.dividersXCount ?? 0, dims.innerWidthMm],
    ['dividersY', spec.dividersYCount ?? 0, dims.innerDepthMm],
  ] as const) {
    if (!Number.isInteger(count) || count < 0) {
      issues.push({ field, message: 'Divider count must be a whole number of 0 or more.' });
      continue;
    }
    if (count === 0) continue;
    if (field === 'dividersY' && spec.style === 'open-front') {
      issues.push({
        field,
        message:
          'An open-front box takes dividers across its width only — dividers across its depth would close off the opening.',
      });
      continue;
    }
    const pitchMm = (innerMm - count * spec.thicknessMm) / (count + 1);
    if (pitchMm < 2 * spec.thicknessMm) {
      issues.push({
        field,
        message: `${count} dividers leave ${formatRoundedTo2Decimals(pitchMm)} mm compartments — under twice the ${formatRoundedTo2Decimals(spec.thicknessMm)} mm thickness.`,
      });
    }
  }
  collectDividerReliefIssues(spec, issues);
}

// A relief bit as wide as the stock cannot seat in a T-wide divider slot.
function collectDividerReliefIssues(spec: BoxSpec, issues: BoxSpecIssue[]): void {
  if ((spec.dividersXCount ?? 0) === 0 && (spec.dividersYCount ?? 0) === 0) return;
  if (spec.relief.kind !== 'corner-overcut') return;
  if (!Number.isFinite(spec.relief.toolDiameterMm)) return;
  if (spec.relief.toolDiameterMm < spec.thicknessMm) return;
  issues.push({
    field: 'reliefTool',
    message: `Divider slots are ${formatRoundedTo2Decimals(spec.thicknessMm)} mm wide — the ${formatRoundedTo2Decimals(spec.relief.toolDiameterMm)} mm relief tool cannot seat in them.`,
  });
}

// The smallest finger cell across the three edge axes — plus the divider
// junction cells when dividers are present — bounds both relief feasibility
// and the clearance the joint can absorb.
function minFingerCellMm(spec: BoxSpec, dims: BoxDims): number {
  const spans = [dims.outerWidthMm, dims.outerDepthMm, wallHeightMm(spec, dims)];
  if ((spec.dividersXCount ?? 0) > 0 || (spec.dividersYCount ?? 0) > 0) {
    // Dividers rise the full cavity: inner height for every style.
    spans.push(dims.innerHeightMm + 2 * spec.thicknessMm);
  }
  return minOf(
    spans.map(
      (fullSpanMm) =>
        edgePattern({
          fullSpanMm,
          thicknessMm: spec.thicknessMm,
          targetFingerWidthMm: spec.targetFingerWidthMm,
        }).cellWidthMm,
    ),
  );
}

function checkPositive(issues: BoxSpecIssue[], field: BoxSpecField, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    issues.push({ field, message: 'Must be greater than 0.' });
  }
}

export { MIN_FINGER_WIDTH_MM };
