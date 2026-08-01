export const MIN_CNC_TIP_ANGLE_DEG = 1;
export const MAX_CNC_TIP_ANGLE_DEG = 179;

/** The one included-angle contract shared by entry, persistence, and geometry. */
export function isValidCncTipAngleDeg(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_CNC_TIP_ANGLE_DEG &&
    value <= MAX_CNC_TIP_ANGLE_DEG
  );
}
