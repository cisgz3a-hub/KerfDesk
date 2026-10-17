import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, SceneObject } from '../../../core/scene';
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
import { currentJigTracePreview } from './jig-trace-import';
import { useJigTraceSource } from './jig-trace-source';
import { useJigTraceCommit } from './jig-trace-commit';

export type JigTraceControlsProps = {
  readonly project: Project;
  readonly onImport: (object: SceneObject) => void;
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
  const ready = readyToImport(preview);
  useBusyNotification(source.loading || commit.busy, props.onBusyChange);
  return (
    <section aria-label="Trace image in jig" style={sectionStyle}>
      <h3 style={{ margin: 0 }}>Trace an image</h3>
      <label>
        Upload image to trace
        <input
          title="Upload an image and trace it directly into the jig"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
          disabled={commit.busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) void source.load(file);
          }}
        />
      </label>
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
            {commit.busy ? 'Adding trace…' : 'Trace to jig canvas'}
          </Button>
        </fieldset>
      )}
      <TraceStatus sourceError={source.error} commitError={commit.error} success={commit.success} />
    </section>
  );
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
}): JSX.Element {
  return (
    <>
      {props.sourceError !== null ? <p role="alert">{props.sourceError}</p> : null}
      {props.commitError !== null ? <p role="alert">{props.commitError}</p> : null}
      {props.success ? <p role="status">Traced artwork added and fitted inside the jig.</p> : null}
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
