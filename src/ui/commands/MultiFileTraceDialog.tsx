import { useState } from 'react';
import { TRACE_PRESETS } from '../../core/trace';
import type { BatchTraceFile, BatchTraceFormat } from '../../core/trace/batch-trace';
import { DEFAULT_EXPORT_PRECISION_MM } from '../../core/vector-export/decimal-grid';
import {
  isSaveDirectoryUnsupported,
  type PlatformAdapter,
  type SaveDirectoryTarget,
} from '../../platform/types';
import { usePlatform } from '../app/platform-context';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useToastStore, type ToastVariant } from '../state/toast-store';
import { traceTargetPxPerMm } from '../trace/trace-commit-grid';
import { VISIBLE_TRACE_PRESET_NAMES } from '../trace/dialog-parts';
import {
  DEFAULT_MULTI_FILE_TRACE_PRESET,
  runMultiFileTrace,
  traceFileWriterForDirectory,
  writeTraceFileWithPlatform,
} from './multi-file-trace-action';
import { beginMultiFileTraceProgress, isMultiFileTraceRunning } from './MultiFileTraceProgress';
import {
  batchTraceSettings,
  lastTraceSettingsRecord,
  type MultiFileTraceSettingsSource,
} from './multi-file-trace-settings';
import type { TraceSettingsRecord } from '../../core/scene/scene-object';
import { pickPlatformBatchTraceImageFiles } from './platform-image-files';
import {
  DEFAULT_TRACE_PAGE_SETTINGS,
  TracePageFields,
  tracePageOutput,
  type TracePageSettings,
} from './TracePageFields';
import {
  DEFAULT_TRACE_SIZE_SETTINGS,
  TraceSizeFields,
  traceSizeOutput,
  type TraceSizeSettings,
} from './TraceSizeFields';

export type MultiFileTraceSettings = TracePageSettings &
  TraceSizeSettings & {
    readonly settingsSource: MultiFileTraceSettingsSource;
    readonly presetName: string;
    readonly format: BatchTraceFormat;
    readonly groupContours: boolean;
    readonly precisionMm: number;
  };

// Remembered for the session so a second batch starts where the last one ended.
let lastSettings: MultiFileTraceSettings = {
  settingsSource: 'preset',
  presetName: DEFAULT_MULTI_FILE_TRACE_PRESET,
  format: 'svg',
  groupContours: false,
  precisionMm: DEFAULT_EXPORT_PRECISION_MM,
  ...DEFAULT_TRACE_PAGE_SETTINGS,
  ...DEFAULT_TRACE_SIZE_SETTINGS,
};

type Choice = { readonly value: string; readonly label: string };

const PRESET_CHOICES: ReadonlyArray<Choice> = VISIBLE_TRACE_PRESET_NAMES.filter(
  (name) => TRACE_PRESETS[name] !== undefined,
).map((name) => ({ value: name, label: name }));
const FORMAT_CHOICES: ReadonlyArray<Choice> = [
  { value: 'svg', label: 'SVG' },
  { value: 'dxf', label: 'DXF' },
  { value: 'pdf', label: 'PDF' },
  { value: 'eps', label: 'EPS' },
  { value: 'geojson', label: 'GeoJSON' },
];
const FORMATS: ReadonlyArray<BatchTraceFormat> = ['svg', 'dxf', 'pdf', 'eps', 'geojson'];
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
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span>{props.label}</span>
      <select
        className="lf-select"
        aria-label={props.ariaLabel}
        title={props.title}
        value={props.value}
        disabled={props.disabled === true}
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
  // Opens the image picker; its first await runs inside the button's click.
  readonly onChooseImages: () => Promise<ReadonlyArray<File> | null>;
  readonly onRun: (settings: MultiFileTraceSettings, files: ReadonlyArray<File>) => void;
}): JSX.Element {
  const [settings, setSettings] = useState<MultiFileTraceSettings>(lastSettings);
  const [files, setFiles] = useState<ReadonlyArray<File>>([]);
  const lastTrace = useStore((state) => lastTraceSettingsRecord(state.project.scene.objects));
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
        if (files.length === 0) return;
        lastSettings = settings;
        props.onRun(settings, files);
      }}
    >
      <TraceSettingsSourceFields settings={settings} lastTrace={lastTrace} onChange={update} />
      <ChoiceField
        label="Format"
        ariaLabel="Output format"
        title="SVG, PDF and EPS keep smooth curves; DXF writes millimetre polylines for CAD and CAM; GeoJSON writes flattened polygons in millimetres."
        value={settings.format}
        choices={FORMAT_CHOICES}
        onChange={(value) => update({ format: FORMATS.find((f) => f === value) ?? 'svg' })}
      />
      <ChoiceField
        label="Precision"
        ariaLabel="Coordinate precision"
        title="Coordinates are rounded to this step in millimetres. Coarser steps give smaller files."
        value={String(settings.precisionMm)}
        choices={PRECISION_CHOICES}
        onChange={(step) => update({ precisionMm: Number(step) })}
      />
      <TraceSizeFields value={settings} onChange={update} />
      <TracePageFields value={settings} onChange={update} />
      {settings.format === 'svg' ? (
        <label className="lf-field">
          <input
            type="checkbox"
            checked={settings.groupContours}
            title="Put each filled shape and its holes in their own group so editors select them together."
            onChange={(event) => update({ groupContours: event.currentTarget.checked })}
          />
          <span>Group islands</span>
        </label>
      ) : null}
      <div className="lf-dialog-body">
        <p>
          Each image is traced with the preset and written as its own file into the folder you
          choose.
        </p>
        <p aria-live="polite">{chosenText(files)}</p>
      </div>
      <MultiFileTraceActions
        onCancel={props.onCancel}
        onChooseImages={() => {
          void props.onChooseImages().then((chosen) => {
            if (chosen !== null) setFiles(chosen);
          });
        }}
        canTrace={files.length > 0}
      />
    </Dialog>
  );
}

const SOURCE_CHOICES: ReadonlyArray<Choice> = [
  { value: 'preset', label: 'Preset defaults' },
  { value: 'last-trace', label: 'Last Trace Image settings' },
];

function TraceSettingsSourceFields(props: {
  readonly settings: MultiFileTraceSettings;
  readonly lastTrace: TraceSettingsRecord | null;
  readonly onChange: (patch: Partial<MultiFileTraceSettings>) => void;
}): JSX.Element {
  const fromLast = props.settings.settingsSource === 'last-trace' && props.lastTrace !== null;
  const machineKind = useStore((state) => state.project.machine?.kind);
  const shown = batchTraceSettings(
    props.settings.settingsSource,
    props.settings.presetName,
    props.lastTrace,
    machineKind,
  );
  return (
    <>
      <ChoiceField
        label="Settings"
        ariaLabel="Trace settings"
        title={
          props.lastTrace === null
            ? 'Preset defaults. Trace an image with Trace Image to reuse its settings here.'
            : 'Preset defaults, or the settings of the last Trace Image in this project (as Re-trace reopens them).'
        }
        value={fromLast ? 'last-trace' : 'preset'}
        choices={props.lastTrace === null ? SOURCE_CHOICES.slice(0, 1) : SOURCE_CHOICES}
        onChange={(value) =>
          props.onChange({ settingsSource: value === 'last-trace' ? 'last-trace' : 'preset' })
        }
      />
      <ChoiceField
        label="Preset"
        ariaLabel="Trace preset"
        title={
          fromLast
            ? 'The preset the last Trace Image used.'
            : 'Trace style used for every selected image.'
        }
        value={shown.presetName}
        choices={PRESET_CHOICES}
        disabled={fromLast}
        onChange={(presetName) => props.onChange({ presetName })}
      />
    </>
  );
}

function MultiFileTraceActions(props: {
  readonly onCancel: () => void;
  readonly onChooseImages: () => void;
  readonly canTrace: boolean;
}): JSX.Element {
  return (
    <DialogActions>
      <Button onClick={props.onCancel}>Cancel</Button>
      <Button onClick={props.onChooseImages}>Choose Images...</Button>
      <Button variant="primary" type="submit" disabled={!props.canTrace}>
        Trace...
      </Button>
    </DialogActions>
  );
}

function chosenText(files: ReadonlyArray<File>): string {
  if (files.length === 0) return 'No images chosen yet.';
  if (files.length === 1) return `1 image chosen: ${files[0]?.name ?? ''}`;
  return `${files.length} images chosen.`;
}

type PushToast = (message: string, variant?: ToastVariant) => void;

export function MultiFileTraceDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  return (
    <MultiFileTraceDialog
      onCancel={props.onClose}
      onChooseImages={() => chooseMultiFileTraceImages(platform, pushToast)}
      onRun={(settings, files) => {
        props.onClose();
        void runChosenMultiFileTrace(platform, pushToast, settings, files);
      }}
    />
  );
}

export async function chooseMultiFileTraceImages(
  platform: PlatformAdapter,
  pushToast: PushToast,
): Promise<ReadonlyArray<File> | null> {
  try {
    // The picker must be the first await so it runs inside the click's user activation.
    return await pickPlatformBatchTraceImageFiles(platform);
  } catch (err) {
    pushToast(`Could not choose trace images: ${errMsg(err)}`, 'error');
    return null;
  }
}

// The output folder is reserved in the Trace click (as Save Tiled G-code
// reserves one), and each file is written into it as soon as it is traced.
export async function runChosenMultiFileTrace(
  platform: PlatformAdapter,
  pushToast: PushToast,
  settings: MultiFileTraceSettings,
  files: ReadonlyArray<File>,
): Promise<void> {
  // One batch at a time: two would supersede each other's worker traces.
  if (isMultiFileTraceRunning()) {
    pushToast('A Multi-File Trace is already running. Cancel it or let it finish first.', 'info');
    return;
  }
  const write = await reserveTraceOutput(platform, pushToast);
  if (write === null || files.length === 0) return;
  // Another picker may have resolved and started its batch while ours waited.
  if (isMultiFileTraceRunning()) {
    pushToast('A Multi-File Trace is already running. Cancel it or let it finish first.', 'info');
    return;
  }
  const { project } = useStore.getState();
  const chosen = batchTraceSettings(
    settings.settingsSource,
    settings.presetName,
    lastTraceSettingsRecord(project.scene.objects),
    project.machine?.kind,
  );
  const options = chosen.options;
  const controller = new AbortController();
  const progress = beginMultiFileTraceProgress(files.length, () => controller.abort());
  try {
    await runMultiFileTrace(files, pushToast, {
      ...(options === undefined ? {} : { options }),
      // Trace each file on the grid its placed size needs (ADR-409).
      targetPxPerMm: traceTargetPxPerMm(project.device, project.machine?.kind),
      output: {
        format: settings.format,
        groupContours: settings.groupContours,
        precisionMm: settings.precisionMm,
        ...tracePageOutput(settings),
      },
      ...(chosen.hybridMaxStrokeWidthMm === undefined
        ? {}
        : { hybridMaxStrokeWidthMm: chosen.hybridMaxStrokeWidthMm }),
      ...traceSizeOutput(settings),
      settingsLabel: chosen.label,
      signal: controller.signal,
      onProgress: progress.update,
      write,
    });
  } finally {
    progress.end();
  }
}

type TraceWriter = (file: BatchTraceFile) => Promise<boolean> | boolean;

async function reserveTraceOutput(
  platform: PlatformAdapter,
  pushToast: PushToast,
): Promise<TraceWriter | null> {
  const perFile: TraceWriter = (file) => writeTraceFileWithPlatform(platform, file);
  if (platform.reserveSaveDirectory === undefined) return perFile;
  let directory: SaveDirectoryTarget | null;
  try {
    // The folder picker must be the first await, inside the click's activation.
    directory = await platform.reserveSaveDirectory();
  } catch (err) {
    // No folder picker here (a browser without the File System Access
    // directory API): each file is offered through its own save dialog. Any
    // other failure is reported and nothing starts, as Save Tiled G-code does.
    if (isSaveDirectoryUnsupported(err)) return perFile;
    pushToast(`Could not trace images: ${errMsg(err)}`, 'error');
    return null;
  }
  return directory === null ? null : traceFileWriterForDirectory(directory);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
