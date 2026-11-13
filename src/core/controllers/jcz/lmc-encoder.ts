// LMC job encoder (ADR-704): a prepared, machine-space Job → the list packets
// a JCZ galvo board runs. The program follows MeerK40t's (balormk at d511944e):
// program_mode opens it with Ready Mark, the fiber open-MO dwell, the port
// bits and the jump speed (controller.py L486-532); each layer's settings go
// out in set_settings order (L643-708); each pass of each segment is a jump
// to its start and marks along it (driver.py L379-430); the end dwell and End
// of List close it (driver.py L598, controller.py L464-468). Line and Fill
// hatch groups are vectors and encode directly; a galvo needs no overscan, so
// hatch scanlines are marked as the burn spans they are. Image rasters and CNC
// groups are refused. Deterministic; NOT verified on a real controller.

import type { DeviceProfile } from '../../devices';
import type { GalvoSetup } from '../../devices/galvo-setup';
import type { CutGroup, CutSegment, FillGroup, Job } from '../../job';
import { cutSegmentsForPass, finalPassCutSegments } from '../../job/cut-pass-segments';
import type { LayerOperationSettings, Vec2 } from '../../scene';
import { machineToGalvo, type GalvoPoint } from './galvo-field';
import { lmcFootprint, type LmcFootprint } from './lmc-footprint';
import { writeLmcLaserSettings } from './lmc-laser-settings';
import { LMC_PORT_PROGRAM_BIT } from './lmc-opcodes';
import { LmcProgramWriter } from './lmc-program-writer';
import { lmcSpeedWord } from './lmc-units';

export type LmcEncodeError =
  | { readonly kind: 'empty-job' }
  | { readonly kind: 'galvo-setup-missing' }
  | { readonly kind: 'field-not-square'; readonly widthMm: number; readonly heightMm: number }
  | { readonly kind: 'raster-unsupported'; readonly layerId: string }
  | { readonly kind: 'cnc-unsupported'; readonly layerId: string }
  | { readonly kind: 'outside-field'; readonly layerId: string; readonly point: Vec2 }
  | {
      readonly kind: 'speed-out-of-range';
      readonly layerId: string;
      readonly mmPerSec: number;
      readonly travel: boolean;
    };

/** One encoded program: the packets in order and where its moves go. */
export type LmcProgram = {
  readonly lists: ReadonlyArray<Uint8Array>;
  readonly source: GalvoSetup['source'];
  readonly footprint: LmcFootprint;
  readonly marks: number;
};

export type LmcEncodeResult =
  | { readonly ok: true; readonly program: LmcProgram }
  | { readonly ok: false; readonly error: LmcEncodeError };

/** A layer's own galvo settings, looked up by the group's layerId. */
export type LmcLayerSettings = { readonly id: string } & Pick<
  LayerOperationSettings,
  'galvoFrequencyKhz' | 'galvoPulseWidthNs'
>;

export type LmcEncodeOptions = { readonly layers: ReadonlyArray<LmcLayerSettings> };

type VectorGroup = CutGroup | FillGroup;

class EncodeFailure extends Error {
  constructor(readonly failure: LmcEncodeError) {
    super(failure.kind);
  }
}

/** The galvo setup a 'jcz-lmc' device marks with, or why it cannot mark. */
export function galvoSetupOf(device: DeviceProfile): GalvoSetup | LmcEncodeError {
  if (device.galvo === undefined) return { kind: 'galvo-setup-missing' };
  if (device.bedWidth !== device.bedHeight)
    return { kind: 'field-not-square', widthMm: device.bedWidth, heightMm: device.bedHeight };
  return device.galvo;
}

export function encodeLmcJob(
  job: Job,
  device: DeviceProfile,
  options: LmcEncodeOptions,
): LmcEncodeResult {
  const setup = galvoSetupOf(device);
  if ('kind' in setup) return { ok: false, error: setup };
  const groups: VectorGroup[] = [];
  for (const group of job.groups) {
    if (group.kind === 'cnc')
      return { ok: false, error: { kind: 'cnc-unsupported', layerId: group.layerId } };
    if (group.kind !== 'cut' && group.kind !== 'fill')
      return { ok: false, error: { kind: 'raster-unsupported', layerId: group.layerId } };
    groups.push(group);
  }
  try {
    return encodeGroups(groups, device, setup, options);
  } catch (error) {
    if (error instanceof EncodeFailure) return { ok: false, error: error.failure };
    throw error;
  }
}

function encodeGroups(
  groups: ReadonlyArray<VectorGroup>,
  device: DeviceProfile,
  setup: GalvoSetup,
  options: LmcEncodeOptions,
): LmcEncodeResult {
  const writer = new LmcProgramWriter();
  const jumpWord = speedWord(setup.jumpSpeedMmPerSec, device.bedWidth, '', true);
  writer.ready();
  // Fiber: wait for the master oscillator MeerK40t opens before the list
  // (controller.py L515-517: delay_openmo ms × 100, in 10 µs units).
  if (setup.source === 'fiber' || setup.source === 'mopa')
    if (setup.openMoDelayMs !== 0) writer.delayTime(Math.trunc(setup.openMoDelayMs * 100));
  writer.writePort(1 << LMC_PORT_PROGRAM_BIT);
  writer.jumpSpeed(jumpWord);
  for (const group of groups) encodeGroup(writer, group, device, setup, options, jumpWord);
  const steps = writer.steps();
  const marks = steps.filter((step) => step.kind === 'mark').length;
  if (marks === 0) return { ok: false, error: { kind: 'empty-job' } };
  writer.dwellUs(setup.endDelayUs);
  writer.endOfList();
  const footprint = lmcFootprint(steps);
  if (footprint === null) return { ok: false, error: { kind: 'empty-job' } };
  return {
    ok: true,
    program: { lists: writer.finish(), source: setup.source, footprint, marks },
  };
}

function encodeGroup(
  writer: LmcProgramWriter,
  group: VectorGroup,
  device: DeviceProfile,
  setup: GalvoSetup,
  options: LmcEncodeOptions,
  jumpWord: number,
): void {
  const settings = groupGalvoSettings(group, options);
  writeLmcLaserSettings(writer, setup, {
    powerPercent: group.power,
    frequencyKhz: settings.galvoFrequencyKhz ?? setup.frequencyKhz,
    pulseWidthNs: settings.galvoPulseWidthNs ?? setup.pulseWidthNs,
    jumpSpeedWord: jumpWord,
    markSpeedWord: speedWord(group.speed / 60, device.bedWidth, group.layerId, false),
  });
  const passes = Math.max(1, group.passes);
  const finalPass = group.kind === 'cut' ? finalPassCutSegments(group) : group.segments;
  for (let pass = 0; pass < passes; pass += 1) {
    for (const segment of cutSegmentsForPass(group, finalPass, pass, passes)) {
      encodeSegment(writer, segment, device, setup, group.layerId);
    }
  }
}

// An override-derived group carries its full settings; any other group reads
// its layer's (compile copies no galvo field onto groups, so G-code is unchanged).
function groupGalvoSettings(
  group: VectorGroup,
  options: LmcEncodeOptions,
): Pick<LayerOperationSettings, 'galvoFrequencyKhz' | 'galvoPulseWidthNs'> {
  return (
    group.operationSettings ?? options.layers.find((layer) => layer.id === group.layerId) ?? {}
  );
}

function encodeSegment(
  writer: LmcProgramWriter,
  segment: CutSegment,
  device: DeviceProfile,
  setup: GalvoSetup,
  layerId: string,
): void {
  const points = segment.polyline.map((point) => galvoPoint(point, device, setup, layerId));
  const [first, ...rest] = points;
  if (first === undefined || rest.every((point) => samePoint(point, first))) return;
  writer.jump(first);
  for (const point of rest) writer.mark(point);
}

function galvoPoint(
  point: Vec2,
  device: DeviceProfile,
  setup: GalvoSetup,
  layerId: string,
): GalvoPoint {
  const mapped = machineToGalvo(point, device, setup);
  if (mapped === null) throw new EncodeFailure({ kind: 'outside-field', layerId, point });
  return mapped;
}

function speedWord(mmPerSec: number, fieldMm: number, layerId: string, travel: boolean): number {
  const word = lmcSpeedWord(mmPerSec, fieldMm);
  if (word === null)
    throw new EncodeFailure({ kind: 'speed-out-of-range', layerId, mmPerSec, travel });
  return word;
}

function samePoint(a: GalvoPoint, b: GalvoPoint): boolean {
  return a.gx === b.gx && a.gy === b.gy;
}
