import { useEffect, useRef, useState } from 'react';
import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import { DITHER_ALGORITHMS, type Layer, type RasterImage } from '../../core/scene';
import { useDialogA11y } from '../common/use-dialog-a11y';
import type { RasterImageAdjustmentPatch } from '../state/raster-adjustment-actions';
import { drawAdjustImagePreview } from './AdjustImageDialog.preview';
import * as styles from './AdjustImageDialog.styles';

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

type Draft = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly ditherAlgorithm: Layer['ditherAlgorithm'];
  readonly minPower: number;
  readonly linesPerMm: number;
  readonly dotWidthCorrectionMm: number;
  readonly negativeImage: boolean;
  readonly passThrough: boolean;
  readonly invertDisplay: boolean;
};

export function AdjustImageDialog(props: {
  readonly image: RasterImage;
  readonly layer: Layer;
  readonly onCancel: () => void;
  readonly onApply: (patch: AdjustImageApply) => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const processedRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(props.image, props.layer));
  useDialogA11y(dialogRef, props.onCancel);
  usePreviewEffects(sourceRef, processedRef, props.image, draft);
  const update = (patch: Partial<Draft>): void =>
    setDraft((prev) => normalizeDraft({ ...prev, ...patch }));
  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    props.onApply(patchFromDraft(draft));
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Adjust Image"
      tabIndex={-1}
      style={styles.backdropStyle}
    >
      <form onSubmit={submit} style={styles.panelStyle}>
        <DialogHeader source={props.image.source} />
        <PreviewGrid sourceRef={sourceRef} processedRef={processedRef} />
        <AdjustFields draft={draft} maxPower={props.layer.power} update={update} />
        <DialogActions onCancel={props.onCancel} />
      </form>
    </div>
  );
}

function usePreviewEffects(
  sourceRef: React.RefObject<HTMLCanvasElement>,
  processedRef: React.RefObject<HTMLCanvasElement>,
  image: RasterImage,
  draft: Draft,
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

function patchFromDraft(draft: Draft): AdjustImageApply {
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
      <h2 style={styles.headingStyle}>Adjust Image</h2>
      <p style={styles.subheadingStyle}>{source}</p>
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

function AdjustFields(props: {
  readonly draft: Draft;
  readonly maxPower: number;
  readonly update: (patch: Partial<Draft>) => void;
}): JSX.Element {
  const { draft, update } = props;
  return (
    <div style={styles.fieldsGridStyle}>
      <NumberField
        name="brightness"
        label="Brightness"
        value={draft.brightness}
        min={-100}
        max={100}
        step={1}
        onChange={(brightness) => update({ brightness })}
      />
      <NumberField
        name="contrast"
        label="Contrast"
        value={draft.contrast}
        min={-100}
        max={100}
        step={1}
        onChange={(contrast) => update({ contrast })}
      />
      <NumberField
        name="gamma"
        label="Gamma"
        value={draft.gamma}
        min={0.1}
        max={5}
        step={0.05}
        onChange={(gamma) => update({ gamma })}
      />
      <RasterSettingsFields draft={draft} maxPower={props.maxPower} update={update} />
      <RasterToggleFields draft={draft} update={update} />
    </div>
  );
}

function RasterSettingsFields(props: {
  readonly draft: Draft;
  readonly maxPower: number;
  readonly update: (patch: Partial<Draft>) => void;
}): JSX.Element {
  const { draft, update } = props;
  return (
    <>
      <SelectField
        value={draft.ditherAlgorithm}
        onChange={(ditherAlgorithm) => update({ ditherAlgorithm })}
      />
      <NumberField
        name="minPower"
        label="Min Power"
        value={draft.minPower}
        min={0}
        max={props.maxPower}
        step={1}
        unit="%"
        onChange={(minPower) => update({ minPower })}
      />
      <NumberField
        name="linesPerMm"
        label="Resolution"
        value={draft.linesPerMm}
        min={5}
        max={MAX_RASTER_LINES_PER_MM}
        step={1}
        unit="lines / mm"
        onChange={(linesPerMm) => update({ linesPerMm })}
      />
      <NumberField
        name="dotWidthCorrectionMm"
        label="Dot Width"
        value={draft.dotWidthCorrectionMm}
        min={0}
        max={dotWidthCorrectionMax(draft.linesPerMm)}
        step={0.001}
        unit="mm"
        onChange={(dotWidthCorrectionMm) => update({ dotWidthCorrectionMm })}
      />
    </>
  );
}

function RasterToggleFields(props: {
  readonly draft: Draft;
  readonly update: (patch: Partial<Draft>) => void;
}): JSX.Element {
  const { draft, update } = props;
  return (
    <>
      <CheckboxField
        name="negativeImage"
        label="Negative"
        checked={draft.negativeImage}
        onChange={(negativeImage) => update({ negativeImage })}
      />
      <CheckboxField
        name="passThrough"
        label="Pass-through"
        checked={draft.passThrough}
        onChange={(passThrough) => update({ passThrough })}
      />
      <CheckboxField
        name="invertDisplay"
        label="Invert display"
        checked={draft.invertDisplay}
        onChange={(invertDisplay) => update({ invertDisplay })}
      />
    </>
  );
}

function DialogActions({ onCancel }: { readonly onCancel: () => void }): JSX.Element {
  return (
    <div style={styles.actionsStyle}>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit">OK</button>
    </div>
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

function NumberField(props: {
  readonly name: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={styles.fieldStyle}>
      <span style={styles.labelStyle}>{props.label}</span>
      <input
        name={props.name}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(numberValue(event.target.value, props.min, props.max))}
        style={styles.inputStyle}
      />
      {props.unit === undefined ? null : <span style={styles.unitStyle}>{props.unit}</span>}
    </label>
  );
}

function SelectField(props: {
  readonly value: Layer['ditherAlgorithm'];
  readonly onChange: (value: Layer['ditherAlgorithm']) => void;
}): JSX.Element {
  return (
    <label style={styles.fieldStyle}>
      <span style={styles.labelStyle}>Dither</span>
      <select
        name="ditherAlgorithm"
        value={props.value}
        onChange={(event) => props.onChange(parseDither(event.target.value))}
        style={styles.inputStyle}
      >
        {DITHER_ALGORITHMS.map((algorithm) => (
          <option key={algorithm} value={algorithm}>
            {algorithmLabel(algorithm)}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField(props: {
  readonly name: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={styles.checkboxStyle}>
      <span style={styles.labelStyle}>{props.label}</span>
      <input
        name={props.name}
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

function initialDraft(image: RasterImage, layer: Layer): Draft {
  return normalizeDraft({
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

function normalizeDraft(draft: Draft): Draft {
  const linesPerMm = numberValue(String(draft.linesPerMm), 5, MAX_RASTER_LINES_PER_MM);
  return {
    ...draft,
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

function numberValue(value: string, min: number, max: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function parseDither(value: string): Layer['ditherAlgorithm'] {
  return DITHER_ALGORITHMS.some((algorithm) => algorithm === value)
    ? (value as Layer['ditherAlgorithm'])
    : 'floyd-steinberg';
}

function dotWidthCorrectionMax(linesPerMm: number): number {
  return 1 / Math.max(1, linesPerMm);
}

function algorithmLabel(algorithm: Layer['ditherAlgorithm']): string {
  return algorithm
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
