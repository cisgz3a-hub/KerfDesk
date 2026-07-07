// fit-coupon — the Box Fit Test strips (ADR-119): a tab comb and a slot
// strip on a graduated clearance ladder. Rung i bakes the production fit
// law analytically — tab width f − cᵢ/2, notch width f + cᵢ/2 — so the rung
// that presses right on the bench IS the clearance to type into the Box
// Generator. Rung order is read from the narrow-margin end (half a finger
// at the start, two fingers at the end) — deliberately no cut index marks:
// any small protrusion or notch has reflex junctions the CNC relief pass
// would sliver. CNC mode runs both strips through the shared relief pass,
// exactly like panels.

import type { Polyline, Vec2 } from '../scene';
import type { BoxRelief, BoxSpecIssue } from './box-spec';
import { applyPanelFit, type PanelRings } from './panel-fit';

export type FitCouponSpec = {
  readonly thicknessMm: number;
  readonly fingerWidthMm: number;
  readonly startClearanceMm: number;
  readonly stepClearanceMm: number;
  readonly rungCount: number;
  readonly relief: BoxRelief;
};

export type FitCouponPart = { readonly name: string; readonly rings: PanelRings };

export type FitCouponResult =
  | { readonly kind: 'generated'; readonly parts: ReadonlyArray<FitCouponPart> }
  | { readonly kind: 'invalid'; readonly issues: ReadonlyArray<BoxSpecIssue> }
  | { readonly kind: 'error'; readonly message: string };

const MAX_RUNGS = 12;
const STRIP_GAP_MM = 6;

export function fitCouponClearanceMm(spec: FitCouponSpec, rung: number): number {
  return spec.startClearanceMm + rung * spec.stepClearanceMm;
}

/** Generate the two strips, slot strip laid out above the comb. */
export function generateFitCoupon(spec: FitCouponSpec): FitCouponResult {
  const issues = validate(spec);
  if (issues.length > 0) return { kind: 'invalid', issues };
  const parts: FitCouponPart[] = [];
  for (const [name, ring] of [
    ['Fit comb', combStrip(spec, 0)],
    ['Fit slots', slotStrip(spec, bodyMm(spec) + spec.thicknessMm + STRIP_GAP_MM)],
  ] as const) {
    const fit = applyPanelFit(
      { outline: ring, cutouts: [] },
      { clearanceMm: 0, relief: spec.relief },
    );
    if (fit.kind !== 'fitted') return { kind: 'error', message: `${name}: ${fit.detail}.` };
    parts.push({ name, rings: { outline: fit.outline, cutouts: fit.cutouts } });
  }
  return { kind: 'generated', parts };
}

function validate(spec: FitCouponSpec): BoxSpecIssue[] {
  const issues = collectFieldIssues(spec);
  if (issues.length > 0) return issues;
  const topMm = fitCouponClearanceMm(spec, spec.rungCount - 1);
  const limitMm = Math.min(spec.fingerWidthMm, spec.thicknessMm) / 2;
  if (topMm >= limitMm) {
    issues.push({
      field: 'clearance',
      message: `The top rung (${round2(topMm)} mm) reaches half the smallest joint dimension (${round2(limitMm)} mm) — shorten the ladder.`,
    });
  }
  if (spec.relief.kind === 'corner-overcut' && spec.relief.toolDiameterMm >= spec.fingerWidthMm) {
    issues.push({
      field: 'reliefTool',
      message: `Finger width ${round2(spec.fingerWidthMm)} mm is not larger than the ${round2(spec.relief.toolDiameterMm)} mm relief tool.`,
    });
  }
  return issues;
}

function collectFieldIssues(spec: FitCouponSpec): BoxSpecIssue[] {
  const issues: BoxSpecIssue[] = [];
  for (const [field, value] of [
    ['thickness', spec.thicknessMm],
    ['fingerWidth', spec.fingerWidthMm],
    ['clearance', spec.stepClearanceMm],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push({ field, message: 'Must be greater than 0.' });
    }
  }
  if (!Number.isFinite(spec.startClearanceMm) || spec.startClearanceMm < 0) {
    issues.push({ field: 'clearance', message: 'Ladder start must be 0 or greater.' });
  }
  if (!Number.isInteger(spec.rungCount) || spec.rungCount < 2 || spec.rungCount > MAX_RUNGS) {
    issues.push({
      field: 'clearance',
      message: `Rung count must be a whole number from 2 to ${MAX_RUNGS}.`,
    });
  }
  return issues;
}

// Rung i occupies [rungX(i), rungX(i) + f]; a full finger separates rungs.
// The start margin is HALF a finger and the end margin TWO fingers, so the
// strip's orientation — and therefore each rung's index — is unambiguous.
function rungXMm(spec: FitCouponSpec, rung: number): number {
  return spec.fingerWidthMm / 2 + rung * 2 * spec.fingerWidthMm;
}

function stripLengthMm(spec: FitCouponSpec): number {
  return rungXMm(spec, spec.rungCount - 1) + 3 * spec.fingerWidthMm;
}

function bodyMm(spec: FitCouponSpec): number {
  return Math.max(10, 2.5 * spec.thicknessMm);
}

// Comb: body with tabs protruding from the top edge (tab i narrowed cᵢ/2)
// and index notches in the bottom edge.
function combStrip(spec: FitCouponSpec, baseYMm: number): Polyline {
  const body = bodyMm(spec);
  const t = spec.thicknessMm;
  const points: Vec2[] = [{ x: 0, y: baseYMm + body }];
  for (let i = 0; i < spec.rungCount; i += 1) {
    const c = fitCouponClearanceMm(spec, i);
    const x0 = rungXMm(spec, i) + c / 4;
    const x1 = rungXMm(spec, i) + spec.fingerWidthMm - c / 4;
    points.push({ x: x0, y: baseYMm + body });
    points.push({ x: x0, y: baseYMm + body + t });
    points.push({ x: x1, y: baseYMm + body + t });
    points.push({ x: x1, y: baseYMm + body });
  }
  points.push({ x: stripLengthMm(spec), y: baseYMm + body });
  points.push({ x: stripLengthMm(spec), y: baseYMm });
  points.push({ x: 0, y: baseYMm });
  points.push({ x: 0, y: baseYMm + body });
  return { closed: true, points };
}

// Slot strip: notches cut into the top edge (notch i widened cᵢ/2).
function slotStrip(spec: FitCouponSpec, baseYMm: number): Polyline {
  const body = bodyMm(spec) + spec.thicknessMm;
  const t = spec.thicknessMm;
  const points: Vec2[] = [{ x: 0, y: baseYMm + body }];
  for (let i = 0; i < spec.rungCount; i += 1) {
    const c = fitCouponClearanceMm(spec, i);
    const x0 = rungXMm(spec, i) - c / 4;
    const x1 = rungXMm(spec, i) + spec.fingerWidthMm + c / 4;
    points.push({ x: x0, y: baseYMm + body });
    points.push({ x: x0, y: baseYMm + body - t });
    points.push({ x: x1, y: baseYMm + body - t });
    points.push({ x: x1, y: baseYMm + body });
  }
  points.push({ x: stripLengthMm(spec), y: baseYMm + body });
  points.push({ x: stripLengthMm(spec), y: baseYMm });
  points.push({ x: 0, y: baseYMm });
  points.push({ x: 0, y: baseYMm + body });
  return { closed: true, points };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
