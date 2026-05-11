/**
 * T1-160: pure preset-ops helpers extracted from MaterialPresets.
 * Pre-T1-160 these two helpers lived inside the 686-line preset file
 * mixed with the large `MATERIAL_PRESETS` data table.
 *
 *   - `LaserOp`: the {power, speed, passes} triple shape (now
 *     exported from this module).
 *   - `MaterialPresetOps`: cut + engrave (always) + optional score
 *     (derived from cut when omitted).
 *   - `deriveScoreFromCut(cut)`: build a score-mode `LaserOp` from
 *     the cut row. Power = 20% of cut clamped to [1, 100]; speed =
 *     4× cut clamped to [2000, 6000] mm/min; passes = 1. The clamps
 *     keep score-derived rows reasonable even when a preset's cut
 *     row is on the edges of the allowable space.
 *   - `normalizePresetOps(ops)`: ensure every preset row has all
 *     three ops, deriving score from cut when missing.
 *
 * No behavioral change — the derived score values are byte-identical.
 */

export interface LaserOp {
  power: number;
  speed: number;
  passes: number;
}

/** Per-machine preset row: cut + engrave always; score derived from cut if omitted. */
export type MaterialPresetOps = { cut: LaserOp; engrave: LaserOp; score?: LaserOp };

/**
 * Derive a score-mode `LaserOp` from a cut row:
 *   - power: 20% of cut.power, rounded, clamped to [1, 100]
 *   - speed: 4× cut.speed, rounded, clamped to [2000, 6000] mm/min
 *   - passes: always 1
 *
 * The clamps keep score-derived rows reasonable when the cut row is
 * extreme (very low power → score wouldn't be visible; very high
 * power → score would cut through).
 */
export function deriveScoreFromCut(cut: LaserOp): LaserOp {
  return {
    power: Math.max(1, Math.min(100, Math.round(cut.power * 0.2))),
    speed: Math.min(6000, Math.max(2000, Math.round(cut.speed * 4))),
    passes: 1,
  };
}

/**
 * Ensure a preset-ops row has all three ops. When `score` is missing,
 * derive it from `cut` via `deriveScoreFromCut`. Returns a fresh
 * object — never mutates the input.
 */
export function normalizePresetOps(
  ops: { cut: LaserOp; engrave: LaserOp; score?: LaserOp },
): MaterialPresetOps {
  return {
    cut: ops.cut,
    engrave: ops.engrave,
    score: ops.score ?? deriveScoreFromCut(ops.cut),
  };
}
