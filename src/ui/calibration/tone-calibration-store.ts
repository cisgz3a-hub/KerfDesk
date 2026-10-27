// ADR-670: which Tone Calibration step is open, and the photo settings it uses.

import { create } from 'zustand';
import { effectiveOperationForObject } from '../../core/effective-output';
import { photoEngravingOperationForImage } from '../raster/photo-engraving-store';
import { useStore } from '../state';
import { photoBurnSettings, type ToneCalibrationSeed } from './tone-calibration-draft';

export type ToneCalibrationStep = 'generate' | 'record';

type ToneCalibrationSession = {
  readonly sessionId: number;
  readonly step: ToneCalibrationStep;
  readonly seed: ToneCalibrationSeed | null;
};

export const useToneCalibrationStore = create<{
  readonly session: ToneCalibrationSession | null;
}>(() => ({ session: null }));

let nextSessionId = 1;

/**
 * Open Tone Calibration. Without an explicit seed, a selected photo lends its
 * effective operation (object overrides included) at the power it burns with
 * (its power multiplier applied), as it would burn.
 */
export function openToneCalibration(
  options: { readonly step?: ToneCalibrationStep; readonly seed?: ToneCalibrationSeed } = {},
): void {
  useToneCalibrationStore.setState({
    session: {
      sessionId: nextSessionId++,
      step: options.step ?? 'generate',
      seed: options.seed ?? selectedPhotoSeed(),
    },
  });
}

export function closeToneCalibration(): void {
  useToneCalibrationStore.setState({ session: null });
}

function selectedPhotoSeed(): ToneCalibrationSeed | null {
  const state = useStore.getState();
  if (state.additionalSelectedIds.size > 0) return null;
  const image = state.project.scene.objects.find((object) => object.id === state.selectedObjectId);
  if (image?.kind !== 'raster-image') return null;
  const operation = photoEngravingOperationForImage(image, state.project.scene.layers);
  if (operation === null) return null;
  const effective = effectiveOperationForObject(operation, image);
  if (effective.mode !== 'image') return null;
  return { sourceName: image.source, settings: photoBurnSettings(effective, image) };
}
