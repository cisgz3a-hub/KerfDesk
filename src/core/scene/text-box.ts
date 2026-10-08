export type TextBoxSettings = {
  readonly mode: 'auto-width' | 'auto-height' | 'fixed';
  readonly widthMm: number;
  readonly heightMm: number;
  readonly wrap: boolean;
  readonly fit: 'none' | 'shrink';
  readonly minSizeMm: number;
};
