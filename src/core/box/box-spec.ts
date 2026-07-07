// box-spec — the BoxSpec parameter type, inner/outer dimension derivation,
// and validateBoxSpec (ADR-106). Validation is a pure Result-style union; the
// dialog renders issues and disables generation — nothing here throws.

import { edgePattern, MIN_FINGER_WIDTH_MM } from './edge-pattern';

export type BoxStyle = 'closed' | 'open-top';
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

/** Derive both dimension sets. Outer = inner + 2T on every axis. */
export function deriveBoxDims(spec: BoxSpec): BoxDims {
  const t2 = 2 * spec.thicknessMm;
  if (spec.dimensionMode === 'inner') {
    return {
      innerWidthMm: spec.widthMm,
      innerDepthMm: spec.depthMm,
      innerHeightMm: spec.heightMm,
      outerWidthMm: spec.widthMm + t2,
      outerDepthMm: spec.depthMm + t2,
      outerHeightMm: spec.heightMm + t2,
    };
  }
  return {
    outerWidthMm: spec.widthMm,
    outerDepthMm: spec.depthMm,
    outerHeightMm: spec.heightMm,
    innerWidthMm: spec.widthMm - t2,
    innerDepthMm: spec.depthMm - t2,
    innerHeightMm: spec.heightMm - t2,
  };
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
  }
}

function collectInteriorIssues(spec: BoxSpec, issues: BoxSpecIssue[]): void {
  const dims = deriveBoxDims(spec);
  for (const [field, innerMm, enteredMm] of [
    ['width', dims.innerWidthMm, spec.widthMm],
    ['depth', dims.innerDepthMm, spec.depthMm],
    ['height', dims.innerHeightMm, spec.heightMm],
  ] as const) {
    if (innerMm <= 0) {
      issues.push({
        field,
        message: `Outer ${field} ${fmt(enteredMm)} mm leaves no interior at thickness ${fmt(spec.thicknessMm)} mm.`,
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
      message: `Finger width ${fmt(minCellMm)} mm is not larger than the ${fmt(toolMm)} mm relief tool — tabs cannot be relieved. Increase finger width or use a smaller bit.`,
    });
    return;
  }
  if (minCellMm < 2 * toolMm) {
    warnings.push({
      field: 'reliefTool',
      message: `Finger width ${fmt(minCellMm)} mm is under twice the ${fmt(toolMm)} mm relief tool; joints will be mostly relief. Consider a wider finger.`,
    });
  }
}

function collectClearanceIssues(spec: BoxSpec, minCellMm: number, issues: BoxSpecIssue[]): void {
  const clearanceLimitMm = Math.min(minCellMm, spec.thicknessMm) / 2;
  if (Math.abs(spec.clearanceMm) >= clearanceLimitMm) {
    issues.push({
      field: 'clearance',
      message: `Clearance must stay under ${fmt(clearanceLimitMm)} mm (half the smallest finger or the thickness).`,
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
    const pitchMm = (innerMm - count * spec.thicknessMm) / (count + 1);
    if (pitchMm < 2 * spec.thicknessMm) {
      issues.push({
        field,
        message: `${count} dividers leave ${fmt(pitchMm)} mm compartments — under twice the ${fmt(spec.thicknessMm)} mm thickness.`,
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
    message: `Divider slots are ${fmt(spec.thicknessMm)} mm wide — the ${fmt(spec.relief.toolDiameterMm)} mm relief tool cannot seat in them.`,
  });
}

// The smallest finger cell across the three edge axes — plus the divider
// junction cells when dividers are present — bounds both relief feasibility
// and the clearance the joint can absorb.
function minFingerCellMm(spec: BoxSpec, dims: BoxDims): number {
  const spans = [dims.outerWidthMm, dims.outerDepthMm, dims.outerHeightMm];
  if ((spec.dividersXCount ?? 0) > 0 || (spec.dividersYCount ?? 0) > 0) {
    const heightSpanMm =
      spec.style === 'open-top' ? dims.innerHeightMm + spec.thicknessMm : dims.innerHeightMm;
    spans.push(heightSpanMm + 2 * spec.thicknessMm);
  }
  return Math.min(
    ...spans.map(
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

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export { MIN_FINGER_WIDTH_MM };
