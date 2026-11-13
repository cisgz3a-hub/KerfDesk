// ADR-711: which Photo Test Card step is open, and the photo it is cut from.
// This module loads with the app; the dialog and the card generator load when
// a session opens, so it imports neither.

import { create } from 'zustand';
import { effectiveOperationForObject } from '../../core/effective-output';
import type { PhotoTestTones } from '../../core/job/photo-test-card';
import type { RasterImage } from '../../core/scene';
import { photoEngravingOperationForImage } from '../raster/photo-engraving-store';
import { useStore } from '../state';
import type { PhotoTestSeed } from './photo-test-card-draft';
import { photoBurnSettings } from './tone-calibration-draft';

export type PhotoTestCardStep = 'generate' | 'pick';

export type PhotoTestCardSession = {
  readonly sessionId: number;
  /** Absent lets the dialog choose: Pick when there is a burned card and no
   * photo to cut a new one from, else Generate. */
  readonly step: PhotoTestCardStep | undefined;
  readonly seed: PhotoTestSeed | null;
};

export const usePhotoTestCardStore = create<{
  readonly session: PhotoTestCardSession | null;
}>(() => ({ session: null }));

let nextSessionId = 1;

/**
 * Open the Photo Test Card. Without an explicit seed, a selected photo lends
 * its pixels and its effective operation at the power it burns with. With no
 * photo to cut from, a card already generated here opens at Pick.
 */
export function openPhotoTestCard(
  options: { readonly step?: PhotoTestCardStep; readonly seed?: PhotoTestSeed } = {},
): void {
  usePhotoTestCardStore.setState({
    session: {
      sessionId: nextSessionId++,
      step: options.step,
      seed: options.seed ?? selectedPhotoSeed(),
    },
  });
}

export function closePhotoTestCard(): void {
  usePhotoTestCardStore.setState({ session: null });
}

/** The tone and sharpening fields a photo carries on the image itself. */
export function photoTestTones(image: RasterImage): PhotoTestTones {
  return {
    brightness: image.brightness ?? 0,
    contrast: image.contrast ?? 0,
    gamma: image.gamma ?? 1,
    ...(image.sharpenAmount === undefined ? {} : { sharpenAmount: image.sharpenAmount }),
    ...(image.sharpenRadius === undefined ? {} : { sharpenRadius: image.sharpenRadius }),
  };
}

function selectedPhotoSeed(): PhotoTestSeed | null {
  const state = useStore.getState();
  if (state.additionalSelectedIds.size > 0) return null;
  const image = state.project.scene.objects.find((object) => object.id === state.selectedObjectId);
  if (image?.kind !== 'raster-image') return null;
  const operation = photoEngravingOperationForImage(image, state.project.scene.layers);
  if (operation === null) return null;
  const effective = effectiveOperationForObject(operation, image);
  if (effective.mode !== 'image') return null;
  return {
    sourceName: image.source,
    image,
    settings: photoBurnSettings(effective, image),
    tones: photoTestTones(image),
  };
}
