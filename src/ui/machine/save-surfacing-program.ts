import { SURFACING_DEFAULT_DEPTH_PER_PASS_MM } from '../../core/cnc/surfacing';
import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import { standaloneCncSetupAdvisories } from '../../core/preflight/standalone-cnc-preflight';
import { activeCncTool, type CncMachineConfig, type Project } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { buildGcodeMetadata } from '../app/build-info';
import { controllerReadinessAdvisories } from '../app/controller-readiness-advisories';
import { partitionSavePreflight } from '../app/save-preflight-policy';
import type { ToastVariant } from '../state/toast-store';
import { startSurfacingStream } from './surfacing-worker-client';
import { writeSurfacingFile } from './surfacing-save-write';

export type SurfacingInputs = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly stepoverPct: number;
  readonly totalDepthMm: number;
};

type SaveSurfacingOptions = {
  readonly platform: PlatformAdapter;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly project: Project;
  readonly machine: CncMachineConfig;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly settingsCapability: ReadinessSettingsCapability;
  readonly inputs: SurfacingInputs;
  readonly signal: AbortSignal;
  readonly onWriting: () => void;
  readonly onFinalizing: () => void;
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
    onWriting,
  } = options;
  const tool = activeCncTool(machine);
  const reported = new Set<string>();
  const warn = (message: string): void => {
    if (reported.has(message) || !options.isCurrent()) return;
    reported.add(message);
    pushToast(message, 'warning');
  };
  // Setup advisories remain visible even if the destination picker is cancelled.
  for (const issue of standaloneCncSetupAdvisories(project.device)) warn(issue.message);
  for (const message of controllerReadinessAdvisories(
    project,
    controllerSettings,
    settingsCapability,
  )) {
    warn(message);
  }
  const task = startSurfacingStream(
    {
      params: {
        ...inputs,
        bitDiameterMm: tool.diameterMm,
        depthPerPassMm: SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
        feedMmPerMin: Math.min(2500, project.device.maxFeed),
        plungeMmPerMin: Math.min(600, project.device.maxFeed),
        spindleRpm: machine.params.spindleMaxRpm,
        spindleSpinupSec: machine.params.spindleSpinupSec,
        safeZMm: machine.params.safeZMm,
      },
      device: project.device,
      machine,
      metadata: buildGcodeMetadata(),
    },
    signal,
  );
  // Attach rejection handling while the native picker is open. Selecting a
  // destination uses the click's activation; no writable opens until preflight.
  const preparation = task.ready.then(
    (prepared) => ({ ok: true as const, prepared }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    const target = await platform.pickFileForSave({
      suggestedName: 'surfacing.nc',
      extensions: ['.gcode', '.nc'],
    });
    if (target === null) return;
    signal.throwIfAborted();
    const result = await preparation;
    if (!result.ok) throw result.error;
    const { summary, preflight } = result.prepared;
    const { blocking, advisories } = partitionSavePreflight(preflight.issues);
    for (const issue of advisories) warn(issue.message);
    if (blocking.length > 0) throw new Error(blocking.map((issue) => issue.message).join(' '));
    signal.throwIfAborted();
    await writeSurfacingFile(target, task.chunks, {
      signal,
      onWriting,
      onFinalizing: options.onFinalizing,
    });
    if (!options.isCurrent()) return;
    pushToast(
      `Saved preflighted surfacing program: ${summary.passes} pass(es) × ${summary.rowsPerPass} rows with the ${tool.name}. Requested total depth ${summary.requestedTotalDepthMm} mm; emitted maximum depth ${summary.emittedMaximumDepthText} mm at 0.001 mm coordinate precision. Zero X/Y at the area's front-left corner and Z on the surface before running; the file lifts to safe Z before spindle start.`,
      'success',
    );
  } finally {
    task.dispose();
  }
}
