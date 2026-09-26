import { useState } from 'react';
import { TRACE_PRESETS, type BatchTraceFormat } from '../../core/trace';
import { DEFAULT_EXPORT_PRECISION_MM } from '../../core/vector-export/decimal-grid';
import type { PlatformAdapter } from '../../platform/types';
import { usePlatform } from '../app/platform-context';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useToastStore, type ToastVariant } from '../state/toast-store';
import { traceTargetPxPerMm } from '../trace/trace-commit-grid';
import { VISIBLE_TRACE_PRESET_NAMES } from '../trace/dialog-parts';
import {
  DEFAULT_MULTI_FILE_TRACE_PRESET,
  runMultiFileTrace,
  writeTraceFileWithPlatform,
} from './multi-file-trace-action';
import { pickPlatformImageFiles } from './platform-image-files';

export type MultiFileTraceSettings = {
  readonly presetName: string;
  readonly format: BatchTraceFormat;
  readonly groupContours: boolean;
  readonly precisionMm: number;
};

// Remembered for the session so a second batch starts where the last one ended.
let lastSettings: MultiFileTraceSettings = {
  presetName: DEFAULT_MULTI_FILE_TRACE_PRESET,
  format: 'svg',
  groupContours: false,
  precisionMm: DEFAULT_EXPORT_PRECISION_MM,
};

type Choice = { readonly value: string; readonly label: string };

const PRESET_CHOICES: ReadonlyArray<Choice> = VISIBLE_TRACE_PRESET_NAMES.filter(
  (name) => TRACE_PRESETS[name] !== undefined,
).map((name) => ({ value: name, label: name }));
const FORMAT_CHOICES: ReadonlyArray<Choice> = [
  { value: 'svg', label: 'SVG' },
  { value: 'dxf', label: 'DXF' },
];
const PRECISION_CHOICES: ReadonlyArray<Choice> = [0.1, 0.01, 0.001, 0.0001].map((step) => ({
  value: String(step),
  label: `${step} mm`,
}));

function ChoiceField(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly title: string;
  readonly value: string;
  readonly choices: ReadonlyArray<Choice>;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span>{props.label}</span>
      <select
        className="lf-select"
        aria-label={props.ariaLabel}
        title={props.title}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MultiFileTraceDialog(props: {
  readonly onCancel: () => void;
  readonly onRun: (settings: MultiFileTraceSettings) => void;
}): JSX.Element {
  const [settings, setSettings] = useState<MultiFileTraceSettings>(lastSettings);
  const update = (patch: Partial<MultiFileTraceSettings>): void =>
    setSettings((current) => ({ ...current, ...patch }));
  return (
    <Dialog
      title="Multi-File Trace"
      size="sm"
      onClose={props.onCancel}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        lastSettings = settings;
        props.onRun(settings);
      }}
    >
      <ChoiceField
        label="Preset"
        ariaLabel="Trace preset"
        title="Trace style used for every selected image."
        value={settings.presetName}
        choices={PRESET_CHOICES}
        onChange={(presetName) => update({ presetName })}
      />
      <ChoiceField
        label="Format"
        ariaLabel="Output format"
        title="SVG keeps smooth curves; DXF writes millimetre polylines for CAD and CAM."
        value={settings.format}
        choices={FORMAT_CHOICES}
        onChange={(format) => update({ format: format === 'dxf' ? 'dxf' : 'svg' })}
      />
      <ChoiceField
        label="Precision"
        ariaLabel="Coordinate precision"
        title="Coordinates are rounded to this step in millimetres. Coarser steps give smaller files."
        value={String(settings.precisionMm)}
        choices={PRECISION_CHOICES}
        onChange={(step) => update({ precisionMm: Number(step) })}
      />
      {settings.format === 'svg' ? (
        <label className="lf-field">
          <input
            type="checkbox"
            checked={settings.groupContours}
            title="Put each shape and its holes in their own group so editors select them together."
            onChange={(event) => update({ groupContours: event.currentTarget.checked })}
          />
          <span>Group each shape with its holes</span>
        </label>
      ) : null}
      <div className="lf-dialog-body">
        <p>Each image is traced with the preset and saved as its own file.</p>
      </div>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit">
          Choose Images...
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function MultiFileTraceDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  return (
    <MultiFileTraceDialog
      onCancel={props.onClose}
      onRun={(settings) => {
        props.onClose();
        void pickAndRunMultiFileTrace(platform, pushToast, settings);
      }}
    />
  );
}

export async function pickAndRunMultiFileTrace(
  platform: PlatformAdapter,
  pushToast: (message: string, variant?: ToastVariant) => void,
  settings: MultiFileTraceSettings,
): Promise<void> {
  let files: ReadonlyArray<File>;
  try {
    // The picker must be the first await so it runs inside the click's user activation.
    files = await pickPlatformImageFiles(platform);
  } catch (err) {
    pushToast(`Could not choose trace images: ${errMsg(err)}`, 'error');
    return;
  }
  const options = TRACE_PRESETS[settings.presetName];
  const { project } = useStore.getState();
  await runMultiFileTrace(files, pushToast, {
    ...(options === undefined ? {} : { options }),
    // Trace each file on the grid its placed size needs (ADR-409).
    targetPxPerMm: traceTargetPxPerMm(project.device, project.machine?.kind),
    output: {
      format: settings.format,
      groupContours: settings.groupContours,
      precisionMm: settings.precisionMm,
    },
    write: (file) => writeTraceFileWithPlatform(platform, file),
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
