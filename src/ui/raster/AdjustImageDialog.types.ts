import type { ImagePresetId } from './AdjustImageDialog.presets';
import type { ImagePresetSettings } from './AdjustImageDialog.user-presets';

export type AdjustImageDraft = ImagePresetSettings & {
  readonly presetId: ImagePresetId;
};
