import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, RasterImage, SceneObject, TracedImage } from '../../../core/scene';
import { DEFAULT_TRACE_OPTIONS, TRACE_PRESETS } from '../../../core/trace';
import { Button } from '../../kit';
import {
  CNC_TRACE_PRESET_NAME,
  DEFAULT_TRACE_PRESET_NAME,
  PresetPicker,
} from '../../trace/dialog-parts';
import { TracePreview } from '../../trace/TracePreview';
import { TraceSettingsControls } from '../../trace/TraceSettingsControls';
import {
  mergeLightBurnTraceSettings,
  type LightBurnTraceSettingOverrides,
} from '../../trace/trace-options';
import { useTracePreview, type TracePreviewState } from '../../trace/use-trace-preview';
import { jigImageTraceTargets, jigTraceableImage } from './jig-image-trace';
import { currentJigTracePreview, type JigTraceSource } from './jig-trace-import';
import { useJigTraceSource } from './jig-trace-source';
import { jigTraceImageMissing, useJigTraceCommit } from './jig-trace-commit';

export type JigTraceControlsProps = {
  readonly project: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly onImport: (object: SceneObject) => void;
  /** Replaces a jig image, and its copies in the other outlines, with the trace. */
  readonly onTraceImage: (imageId: string, traced: TracedImage) => void;
  readonly onBusyChange: (busy: boolean) => void;
};

export function JigTraceControls(props: JigTraceControlsProps): JSX.Element {
  const machineKind = props.project.machine?.kind ?? 'laser';
  const [preset, setPreset] = useState<string>(
    machineKind === 'cnc' ? CNC_TRACE_PRESET_NAME : DEFAULT_TRACE_PRESET_NAME,
  );
  const [overrides, setOverrides] = useState<LightBurnTraceSettingOverrides>({});
  const source = useJigTraceSource();
  const presetOptions = TRACE_PRESETS[preset] ?? DEFAULT_TRACE_OPTIONS;
  const options = useMemo(
    () => mergeLightBurnTraceSettings(presetOptions, overrides),
    [presetOptions, overrides],
  );
  const rawPreview = useTracePreview(source.source?.file ?? null, options);
  const preview = currentJigTracePreview(source.source, options, rawPreview);
  const commit = useJigTraceCommit({ ...props, source: source.source, options, preview });
  const missing = jigTraceImageMissing({ project: props.project, source: source.source });
  const ready = readyToImport(preview) && !missing;
  useBusyNotification(source.loading || commit.busy, props.onBusyChange);
  return (
    <section aria-label="Trace image in jig" style={sectionStyle}>
      <JigTraceSourcePicker
        project={props.project}
        selectedIds={props.selectedIds}
        disabled={commit.busy}
        onImage={(image, maskObject) => void source.loadImage(image, maskObject)}
        onFile={(file) => void source.load(file)}
      />
      {source.loading ? <p role="status">Loading image…</p> : null}
      {source.source === null ? null : (
        <fieldset disabled={commit.busy} style={fieldsetStyle}>
          <legend>{source.source.file.name}</legend>
          <PresetPicker machineKind={machineKind} value={preset} onChange={setPreset} />
          <TraceSettingsControls
            preset={presetOptions}
            overrides={overrides}
            sourceHasTransparency={previewTransparency(preview)}
            onChange={setOverrides}
          />
          <TracePreview state={preview} sourceDataUrl={source.source.dataUrl} />
          <Button disabled={!ready || commit.busy} onClick={() => void commit.commit()}>
            {commitLabel(props.project, source.source, commit.busy)}
          </Button>
        </fieldset>
      )}
      <TraceStatus
        sourceError={source.error}
        commitError={commit.error}
        success={commit.success}
        source={source.source}
        missing={missing}
      />
    </section>
  );
}

// Trace the image already on the jig, or upload one to add as a trace.
function JigTraceSourcePicker(props: {
  readonly project: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onImage: (image: RasterImage, maskObject: SceneObject | undefined) => void;
  readonly onFile: (file: File) => void;
}): JSX.Element {
  const scene = props.project.scene;
  const image = jigTraceableImage(scene, props.selectedIds);
  return (
    <>
      <Button
        disabled={props.disabled || image === null}
        title={
          image === null
            ? 'Select an image on the jig canvas to trace it'
            : `Trace ${image.source}, then replace it with the trace`
        }
        onClick={() => {
          if (image === null) return;
          const maskId = image.imageMaskId;
          props.onImage(
            image,
            maskId === undefined ? undefined : scene.objects.find((object) => object.id === maskId),
          );
        }}
      >
        Trace selected image
      </Button>
      <label>
        Or upload an image to trace
        <input
          title="Upload an image and trace it directly into the jig"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
          disabled={props.disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) props.onFile(file);
          }}
        />
      </label>
    </>
  );
}

function commitLabel(project: Project, source: JigTraceSource, busy: boolean): string {
  if (busy) return 'Adding trace…';
  if (source.image === undefined) return 'Trace to jig canvas';
  const copies = jigImageTraceTargets(project.scene, source.image.id)?.copies.length ?? 0;
  return copies === 0 ? 'Replace image with trace' : `Replace all ${copies + 1} images with trace`;
}

function readyToImport(preview: TracePreviewState): boolean {
  return preview.kind === 'ready' && preview.preparedTrace !== undefined;
}

function previewTransparency(preview: TracePreviewState): boolean | undefined {
  return preview.kind === 'ready' || preview.kind === 'tracing'
    ? preview.sourceHasTransparency
    : undefined;
}

function TraceStatus(props: {
  readonly sourceError: string | null;
  readonly commitError: string | null;
  readonly success: boolean;
  readonly source: JigTraceSource | null;
  readonly missing: boolean;
}): JSX.Element {
  const replacing = props.source?.image !== undefined;
  // Undo brings a replaced image back, and the replacement is then no longer done.
  const done = props.success && (!replacing || props.missing);
  return (
    <>
      {props.sourceError !== null ? <p role="alert">{props.sourceError}</p> : null}
      {props.commitError !== null ? <p role="alert">{props.commitError}</p> : null}
      {done ? (
        <p role="status">
          {replacing
            ? 'Trace replaced the image on the jig.'
            : 'Traced artwork added and fitted inside the jig.'}
        </p>
      ) : props.missing ? (
        <p role="status">
          The image being traced is no longer on the jig. Undo to bring it back, or select another
          image.
        </p>
      ) : null}
    </>
  );
}

function useBusyNotification(busy: boolean, onBusyChange: (busy: boolean) => void): void {
  const callback = useRef(onBusyChange);
  callback.current = onBusyChange;
  useEffect(() => {
    callback.current(busy);
  }, [busy]);
  useEffect(
    () => () => {
      callback.current(false);
    },
    [],
  );
}

const sectionStyle: React.CSSProperties = { display: 'grid', gap: 10 };
const fieldsetStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  margin: 0,
  padding: 0,
  minWidth: 0,
  border: 0,
};
