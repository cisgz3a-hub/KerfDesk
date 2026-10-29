export type TextBoxSettings = {
  readonly mode: 'auto-width' | 'auto-height' | 'fixed';
  readonly widthMm: number;
  readonly heightMm: number;
  readonly wrap: boolean;
  readonly fit: 'none' | 'shrink';
  readonly minSizeMm: number;
  /**
   * How many ems a single-line font's line fills in this frame. Only schema
   * 19 sets it, on single-line text saved before Size became the em: such a
   * frame counted a line as the old cap-height Size (0.68 em for Relief, 0.5
   * for the EMS fonts), and keeps fitting text that way. Without it a line is
   * one em. Outline fonts ignore it (ADR-682 Amendment 1).
   */
  readonly legacyLineEm?: number;
};
