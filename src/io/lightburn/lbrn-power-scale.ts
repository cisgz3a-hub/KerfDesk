// LightBurn's Shape Properties > Power Scale: one shape's power as a percent
// of its layer's, written on the <Shape> as `PowerScale` and left out at 100 %
// (ADR-388 Amendment 2). It opens as the object's `powerScale`, the same
// setting as KerfDesk's Power multiplier (Advanced artwork settings).

/** The shapes whose Power Scale the import could not carry across. */
export type LbrnPowerScaleLeftOut = {
  /** A value that is not a percent from 0 to 100, as the file wrote it. */
  readonly unusable: string[];
  /** A Power Scale written on a Group, as the file wrote it. */
  readonly onGroups: string[];
};

export function emptyPowerScaleLeftOut(): LbrnPowerScaleLeftOut {
  return { unusable: [], onGroups: [] };
}

/**
 * The scale `shape` opens with, or `{}` at LightBurn's 100 %. A value the field
 * cannot hold is not applied and is kept for the report, as a Cut layer's kerf
 * is (ADR-388 decision 6).
 */
export function lbrnShapePowerScale(
  shape: Element,
  leftOut: LbrnPowerScaleLeftOut,
): { readonly powerScale?: number } {
  const text = powerScaleText(shape);
  if (text === null) return {};
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    leftOut.unusable.push(text);
    return {};
  }
  return value === 100 ? {} : { powerScale: value };
}

/** A Group's own Power Scale is named, not applied to the shapes inside it. */
export function noteGroupPowerScale(group: Element, leftOut: LbrnPowerScaleLeftOut): void {
  const text = powerScaleText(group);
  if (text !== null && Number(text) !== 100) leftOut.onGroups.push(text);
}

export function powerScaleWarnings(leftOut: LbrnPowerScaleLeftOut): string[] {
  const warnings: string[] = [];
  const { unusable, onGroups } = leftOut;
  if (unusable.length > 0) {
    warnings.push(
      `${shapes(unusable.length)} had a Power Scale that is not a percent from 0 to 100 (${listed(unusable)}), so ${unusable.length === 1 ? 'it opens' : 'they open'} at ${unusable.length === 1 ? 'its' : 'their'} layer's full power. Set it as the Power multiplier in Advanced artwork settings before running the job.`,
    );
  }
  if (onGroups.length > 0) {
    warnings.push(
      `${onGroups.length === 1 ? '1 Group carries' : `${onGroups.length} Groups carry`} a Power Scale (${listed(onGroups)}) that was not applied to the shapes inside: KerfDesk scales each shape on its own, and they open at their own Power Scale. Check their Power multiplier in Advanced artwork settings.`,
    );
  }
  return warnings;
}

function powerScaleText(shape: Element): string | null {
  const text = shape.getAttribute('PowerScale') ?? shape.getAttribute('powerscale');
  return text === null || text.trim() === '' ? null : text.trim();
}

function shapes(count: number): string {
  return count === 1 ? '1 shape' : `${count} shapes`;
}

// The distinct values, in the order the file gives them, at most five.
function listed(values: ReadonlyArray<string>): string {
  const distinct = [...new Set(values)];
  const shown = distinct.slice(0, 5).map((value) => `"${value}"`);
  return distinct.length > 5 ? `${shown.join(', ')} and others` : shown.join(', ');
}
