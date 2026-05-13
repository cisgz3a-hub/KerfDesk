import {
  buildPipelineJobFingerprint,
  type PipelineJobFingerprintInputs,
} from '../../src/app/PipelineService';
import type { DeviceProfile } from '../../src/core/devices/DeviceProfile';
import type { GcodeStartMode } from '../../src/core/output/GcodeOrigin';
import type { OutputFormat } from '../../src/core/output/Output';
import type { Scene } from '../../src/core/scene/Scene';

export function makeTestJobFingerprint(args: {
  scene: Scene;
  profile?: DeviceProfile | null;
  startMode?: GcodeStartMode;
  savedOrigin?: { x: number; y: number } | null;
  controllerMaxSpindle?: number | null;
  outputFormat?: OutputFormat;
  machineBedFromController?: { width: number; height: number } | null;
  controllerAccelMmPerS2?: number | null;
  controllerCapabilities?: PipelineJobFingerprintInputs['controllerCapabilities'];
}): ReturnType<typeof buildPipelineJobFingerprint> {
  return buildPipelineJobFingerprint({
    scene: args.scene,
    profile: args.profile ?? null,
    startMode: args.startMode ?? 'current',
    savedOrigin: args.savedOrigin ?? null,
    controllerMaxSpindle: args.controllerMaxSpindle ?? null,
    outputFormat: args.outputFormat ?? 'grbl',
    machineBedFromController: args.machineBedFromController ?? null,
    controllerAccelMmPerS2: args.controllerAccelMmPerS2 ?? null,
    controllerCapabilities: args.controllerCapabilities,
  });
}
