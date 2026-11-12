import { cncMaxFeedMmPerMin } from '../../core/cnc/cnc-head-feeds';
import { SURFACING_DEFAULT_DEPTH_PER_PASS_MM } from '../../core/cnc/surfacing';
import type { SurfacingParams } from '../../core/cnc/surfacing';
import type { ControllerKind } from '../../core/devices';
import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import { standaloneCncSetupAdvisories } from '../../core/preflight/standalone-cnc-preflight';
import { activeCncTool, type CncMachineConfig, type Project } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { buildGcodeMetadata } from '../app/build-info';
import { controllerReadinessAdvisories } from '../app/controller-readiness-advisories';
import { pushCncExportControllerMessages } from '../app/cnc-export-controller-advisory';
import { partitionSavePreflight } from '../app/save-preflight-policy';
import type { ToastVariant } from '../state/toast-store';
import { pickPreparedSaveTarget } from '../app/pick-prepared-save-target';
import { startSurfacingStream } from './surfacing-worker-client';
import { stageSurfacingProgram, writeSurfacingFile } from './surfacing-save-write';

export type SurfacingInputs = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly stepoverPct: number;
  readonly totalDepthMm: number;
  readonly feedMmPerMin?: number;
  readonly plungeMmPerMin?: number;
  readonly spindleRpm?: number;
  readonly depthPerPassMm?: number;
};

type SaveSurfacingOptions = {
  readonly platform: PlatformAdapter;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly project: Project;
  readonly machine: CncMachineConfig;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly settingsCapability: ReadinessSettingsCapability;
  readonly firmwareKind?: ControllerKind;
  readonly inputs: SurfacingInputs;
  readonly signal: AbortSignal;
  /** The program is ready; a destination is being chosen. */
  readonly onChoosing: () => void;
  /** A destination was chosen; the write can no longer be cancelled. */
  readonly onFinalizing: () => void;
  /** The file was written. */
  readonly onSaved?: () => void;
  readonly isCurrent: () => boolean;
};

export async function saveSurfacingProgram(options: SaveSurfacingOptions): Promise<void> {
  const {
    platform,
    pushToast,
    project,
    machine,
    controllerSettings,
    settingsCapability,
    inputs,
    signal,
    onChoosing,
  } = options;
  const tool = activeCncTool(machine);
  const reported = new Set<string>();
  const warn = (message: string, variant: ToastVariant = 'warning'): void => {
    if (reported.has(message) || !options.isCurrent()) return;
    reported.add(message);
    pushToast(message, variant);
  };
  // Setup advisories remain visible even if the destination picker is cancelled.
  for (const issue of standaloneCncSetupAdvisories(project.device)) warn(issue.message);
  for (const message of controllerReadinessAdvisories(
    project,
    controllerSettings,
    settingsCapability,
    options.firmwareKind,
  )) {
    warn(message);
  }
  // The surfacing program is GRBL CNC G-code whatever the profile (CN-1).
  pushCncExportControllerMessages(project.device, controllerSettings, warn);
  const task = startSurfacingStream(
    {
      params: surfacingParams(inputs, project, machine),
      device: project.device,
      machine,
      metadata: buildGcodeMetadata(),
    },
    signal,
  );
  try {
    // The save picker empties an existing file as it returns (ADR-656), so
    // preflight and the whole program finish before a destination is chosen.
    const { summary, preflight } = await task.ready;
    const { blocking, advisories } = partitionSavePreflight(preflight.issues);
    for (const issue of advisories) warn(issue.message);
    if (blocking.length > 0) throw new Error(blocking.map((issue) => issue.message).join(' '));
    const program = await stageSurfacingProgram(task.chunks, signal);
    // The worker is done; it need not live on while a destination is chosen.
    task.dispose();
    onChoosing();
    const target = await pickPreparedSaveTarget(
      platform,
      { suggestedName: 'surfacing.nc', extensions: ['.gcode', '.nc'] },
      { title: 'Save surfacing program', message: 'The surfacing program is ready.' },
      signal,
    );
    if (target === null) {
      signal.throwIfAborted();
      return;
    }
    // The chosen file is already empty, so the prepared program is written
    // even if the save is cancelled from here on.
    options.onFinalizing();
    await writeSurfacingFile(target, program);
    if (!options.isCurrent()) return;
    // What to do before running the file stays in the Surfacing panel
    // (SURFACING_BEFORE_RUNNING_NOTE); the toast confirms what was written
    // (annoyance audit A5-P2-5).
    options.onSaved?.();
    pushToast(
      `Saved preflighted surfacing program: ${summary.passes} pass(es) × ${summary.rowsPerPass} rows with the ${tool.name}. Requested total depth ${summary.requestedTotalDepthMm} mm; emitted maximum depth ${summary.emittedMaximumDepthText} mm at 0.001 mm coordinate precision. Before you run it, read the note under Save surfacing G-code.`,
      'success',
    );
  } finally {
    task.dispose();
  }
}

function surfacingParams(
  inputs: SurfacingInputs,
  project: Project,
  machine: CncMachineConfig,
): SurfacingParams {
  const tool = activeCncTool(machine);
  return {
    ...inputs,
    bitDiameterMm: tool.diameterMm,
    depthPerPassMm: inputs.depthPerPassMm ?? SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
    feedMmPerMin: Math.min(
      inputs.feedMmPerMin ?? 2500,
      cncMaxFeedMmPerMin(project.device, machine.params),
    ),
    plungeMmPerMin: Math.min(
      inputs.plungeMmPerMin ?? 600,
      cncMaxFeedMmPerMin(project.device, machine.params),
    ),
    spindleRpm: Math.min(
      inputs.spindleRpm ?? machine.params.spindleMaxRpm,
      machine.params.spindleMaxRpm,
    ),
    spindleSpinupSec: machine.params.spindleSpinupSec,
    safeZMm: machine.params.safeZMm,
  };
}
