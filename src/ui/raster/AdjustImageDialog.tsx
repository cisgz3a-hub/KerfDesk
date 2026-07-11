import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { MAX_RASTER_LINES_PER_MM } from '../../core/raster';
import type { Layer, RasterImage } from '../../core/scene';
import { jobAwareAlert, jobAwarePrompt } from '../state/job-aware-dialogs';
import { Button, Dialog, DialogActions as KitDialogActions } from '../kit';
import type { RasterImageAdjustmentPatch } from '../state/raster-adjustment-actions';
import { AdjustFields } from './AdjustImageDialog.fields';
import { dotWidthCorrectionMax, numberValue, parseDither } from './AdjustImageDialog.form-utils';
import {
  applyBuiltInImagePreset,
  applyUserImagePreset,
  imagePresetSettingsFromDraft,
  type ImagePresetId,
  parseImagePresetId,
} from './AdjustImageDialog.presets';
import { drawAdjustImagePreview } from './AdjustImageDialog.preview';
import * as styles from './AdjustImageDialog.styles';
import type { AdjustImageDraft } from './AdjustImageDialog.types';
import {
  deleteUserImagePreset,
  findUserImagePreset,
  readUserImagePresets,
  saveUserImagePreset,
  type UserImagePreset,
  userImagePresetId,
  writeUserImagePresets,
} from './AdjustImageDialog.user-presets';

type LayerPatch = Pick<
  Layer,
  | 'ditherAlgorithm'
  | 'minPower'
  | 'linesPerMm'
  | 'dotWidthCorrectionMm'
  | 'negativeImage'
  | 'passThrough'
>;

export type AdjustImageApply = {
  readonly imagePatch: RasterImageAdjustmentPatch;
  readonly layerPatch: LayerPatch;
};

export function AdjustImageDialog(props: {
  readonly image: RasterImage;
  readonly layer: Layer;
  readonly onCancel: () => void;
  readonly onApply: (patch: AdjustImageApply) => void;
}): JSX.Element {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const processedRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<AdjustImageDraft>(() =>
    initialDraft(props.image, props.layer),
  );
  const presetControls = useImagePresetControls(draft, setDraft);
  usePreviewEffects(sourceRef, processedRef, props.image, draft);
  const update = (patch: Partial<AdjustImageDraft>): void =>
    setDraft((prev) => normalizeDraft({ ...prev, ...patch }));
  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    props.onApply(patchFromDraft(draft));
  };

  return (
    <Dialog onClose={props.onCancel} ariaLabel="Adjust Image" as="form" onSubmit={submit} size="xl">
      <DialogHeader source={props.image.source} />
      <PreviewGrid sourceRef={sourceRef} processedRef={processedRef} />
      <AdjustFields
        draft={draft}
        maxPower={props.layer.power}
        update={update}
        applyPreset={presetControls.applyPreset}
        userPresets={presetControls.userPresets}
        savePreset={presetControls.savePreset}
        deletePreset={presetControls.deletePreset}
      />
      <FormActions onCancel={props.onCancel} />
    </Dialog>
  );
}

function useImagePresetControls(
  draft: AdjustImageDraft,
  setDraft: Dispatch<SetStateAction<AdjustImageDraft>>,
): {
  readonly userPresets: readonly UserImagePreset[];
  readonly applyPreset: (presetId: ImagePresetId) => void;
  readonly savePreset: () => void;
  readonly deletePreset: () => void;
} {
  const [userPresets, setUserPresets] = useState<readonly UserImagePreset[]>(() =>
    readUserImagePresets(),
  );
  const applyPreset = (presetId: ImagePresetId): void =>
    setDraft((prev) => {
      const userPreset = findUserImagePreset(userPresets, presetId);
      return normalizeDraft(
        userPreset === null
          ? applyBuiltInImagePreset(prev, presetId)
          : applyUserImagePreset(prev, userPreset),
      );
    });
  const savePreset = (): void => {
    const name = jobAwarePrompt('Preset name');
    if (name === null) return;
    const saveResult = saveUserImagePreset(userPresets, name, imagePresetSettingsFromDraft(draft));
    if (saveResult.kind !== 'ok') {
      jobAwareAlert(imagePresetSaveError(saveResult.kind));
      return;
    }
    const writeResult = writeUserImagePresets(saveResult.presets);
    if (writeResult.kind !== 'ok') {
      jobAwareAlert('Could not save image preset. Browser storage is unavailable.');
      return;
    }
    setUserPresets(saveResult.presets);
    setDraft((prev) =>
      normalizeDraft({ ...prev, presetId: userImagePresetId(saveResult.preset.name) }),
    );
  };
  const deletePreset = (): void => {
    const preset = findUserImagePreset(userPresets, draft.presetId);
    if (preset === null) return;
    const nextPresets = deleteUserImagePreset(userPresets, preset.name);
    const writeResult = writeUserImagePresets(nextPresets);
    if (writeResult.kind !== 'ok') {
      jobAwareAlert('Could not delete image preset. Browser storage is unavailable.');
      return;
    }
    setUserPresets(nextPresets);
    setDraft((prev) => normalizeDraft({ ...prev, presetId: 'custom' }));
  };
  return { userPresets, applyPreset, savePreset, deletePreset };
}

function usePreviewEffects(
  sourceRef: React.RefObject<HTMLCanvasElement>,
  processedRef: React.RefObject<HTMLCanvasElement>,
  image: RasterImage,
  draft: AdjustImageDraft,
): void {
  useEffect(
    () => drawAdjustImagePreview(sourceRef.current, image, draft, 'source'),
    [sourceRef, image, draft],
  );
  useEffect(
    () => drawAdjustImagePreview(processedRef.current, image, draft, 'processed'),
    [processedRef, image, draft],
  );
}

function patchFromDraft(draft: AdjustImageDraft): AdjustImageApply {
  return {
    imagePatch: {
      brightness: draft.brightness,
      contrast: draft.contrast,
      gamma: draft.gamma,
    },
    layerPatch: {
      ditherAlgorithm: draft.ditherAlgorithm,
      minPower: draft.minPower,
      linesPerMm: draft.linesPerMm,
      dotWidthCorrectionMm: draft.dotWidthCorrectionMm,
      negativeImage: draft.negativeImage,
      passThrough: draft.passThrough,
    },
  };
}

function DialogHeader({ source }: { readonly source: string }): JSX.Element {
  return (
    <header style={styles.headerStyle}>
      <h2 className="lf-dialog-title">Adjust Image</h2>
      <p className="lf-subheading" style={styles.subheadingStyle}>
        {source}
      </p>
    </header>
  );
}

function PreviewGrid(props: {
  readonly sourceRef: React.RefObject<HTMLCanvasElement>;
  readonly processedRef: React.RefObject<HTMLCanvasElement>;
}): JSX.Element {
  return (
    <div style={styles.previewGridStyle}>
      <PreviewPane label="Source">
        <canvas
          ref={props.sourceRef}
          aria-label="Source image preview"
          style={styles.previewCanvasStyle}
        />
      </PreviewPane>
      <PreviewPane label="Processed">
        <canvas
          ref={props.processedRef}
          aria-label="Processed image preview"
          style={styles.previewCanvasStyle}
        />
      </PreviewPane>
    </div>
  );
}

function FormActions({ onCancel }: { readonly onCancel: () => void }): JSX.Element {
  return (
    <KitDialogActions>
      <Button onClick={onCancel}>Cancel</Button>
      <Button type="submit" variant="primary">
        OK
      </Button>
    </KitDialogActions>
  );
}

function PreviewPane(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section style={styles.previewPaneStyle}>
      <h3 style={styles.previewHeadingStyle}>{props.label}</h3>
      {props.children}
    </section>
  );
}

function initialDraft(image: RasterImage, layer: Layer): AdjustImageDraft {
  return normalizeDraft({
    presetId: 'custom',
    brightness: image.brightness ?? 0,
    contrast: image.contrast ?? 0,
    gamma: image.gamma ?? 1,
    ditherAlgorithm: layer.ditherAlgorithm,
    minPower: layer.minPower,
    linesPerMm: layer.linesPerMm,
    dotWidthCorrectionMm: layer.dotWidthCorrectionMm,
    negativeImage: layer.negativeImage,
    passThrough: layer.passThrough,
    invertDisplay: false,
  });
}

function normalizeDraft(draft: AdjustImageDraft): AdjustImageDraft {
  const linesPerMm = numberValue(String(draft.linesPerMm), 5, MAX_RASTER_LINES_PER_MM);
  return {
    ...draft,
    presetId: parseImagePresetId(draft.presetId),
    brightness: numberValue(String(draft.brightness), -100, 100),
    contrast: numberValue(String(draft.contrast), -100, 100),
    gamma: numberValue(String(draft.gamma), 0.1, 5),
    ditherAlgorithm: parseDither(draft.ditherAlgorithm),
    minPower: numberValue(String(draft.minPower), 0, 100),
    linesPerMm,
    dotWidthCorrectionMm: numberValue(
      String(draft.dotWidthCorrectionMm),
      0,
      dotWidthCorrectionMax(linesPerMm),
    ),
  };
}

function imagePresetSaveError(kind: 'invalid-name' | 'reserved-name'): string {
  return kind === 'invalid-name'
    ? 'Image preset name is required.'
    : 'That image preset name is reserved.';
}
