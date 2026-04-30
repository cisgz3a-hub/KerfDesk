import type { BoxLibraryPreset, BoxLidType } from './boxLibraryTypes';

export interface BoxPreviewModel {
  widthUnits: number;
  heightUnits: number;
  depthUnits: number;
  accentColor: string;
  openTop: boolean;
  lidType: BoxLidType;
  showVentSlots: boolean;
  showHandleSlots: boolean;
  showCouponMarks: boolean;
  variant: string;
}

function clampUnits(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function createBoxPreviewModel(preset: BoxLibraryPreset): BoxPreviewModel {
  const longest = Math.max(preset.width, preset.height, preset.depth, 1);
  return {
    widthUnits: clampUnits(preset.width / longest, 0.35, 1),
    heightUnits: clampUnits(preset.height / longest, 0.25, 1),
    depthUnits: clampUnits(preset.depth / longest, 0.35, 1),
    accentColor: preset.accentColor,
    openTop: preset.openTop || preset.previewVariant === 'open-tray' || preset.previewVariant === 'pencil-cup',
    lidType: preset.lidType,
    showVentSlots: preset.previewVariant === 'electronics-box' || preset.tags.some(tag => tag.includes('vent')),
    showHandleSlots: preset.handleStyle === 'slot',
    showCouponMarks: preset.previewVariant === 'test-coupon',
    variant: preset.previewVariant,
  };
}
