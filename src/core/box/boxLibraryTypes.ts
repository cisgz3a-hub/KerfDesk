export type BoxPresetCategory =
  | 'basic'
  | 'tray'
  | 'gift'
  | 'storage'
  | 'electronics'
  | 'calibration'
  | 'desk';

export type BoxLidType = 'none' | 'lift-off' | 'flush';

export type BoxBottomStyle = 'standard' | 'inset';

export type BoxHandleStyle = 'none' | 'slot';

export type BoxPreviewVariant =
  | 'closed-box'
  | 'open-tray'
  | 'electronics-box'
  | 'gift-box'
  | 'test-coupon'
  | 'pencil-cup';

export interface BoxLibraryPreset {
  id: string;
  name: string;
  category: BoxPresetCategory;
  description: string;
  tags: string[];
  width: number;
  height: number;
  depth: number;
  thickness: number;
  fingerWidth: number;
  kerf: number;
  fitAllowance: number;
  openTop: boolean;
  lidType: BoxLidType;
  bottomStyle: BoxBottomStyle;
  handleStyle: BoxHandleStyle;
  featureBadges: string[];
  recommendedUse?: string;
  accentColor: string;
  previewVariant: BoxPreviewVariant;
  sortOrder: number;
}
