// Pure fact-row builders for the read-only Controller and Machine sections
// of the Job Review dialog (ADR-224). Section components pass live store
// snapshots in; keeping the mapping here keeps the sections dumb and the
// logic unit-testable without rendering.

import type { OverrideValues, StatusReport } from '../../../core/controllers/grbl';
import type { ActiveWorkCoordinateSystem } from '../../../core/controllers/grbl/work-offset-readback';
import type { ControllerKind } from '../../../core/devices';
import type { ControllerSettingsSnapshot } from '../../../core/preflight';
import { analyzeFillHeatRisk, type Job } from '../../../core/job';
import type { ScanDirectionReason } from '../../../core/job/scan-direction-policy';
import {
  activeCncTool,
  machineKindOf,
  type Layer,
  type MachineKind,
  type Project,
} from '../../../core/scene';
import {
  describeOverrides,
  formatMm,
  formatOnOff,
  overridesAreBaseline,
} from './job-review-format';

export type JobReviewFact = {
  readonly label: string;
  readonly value: string;
  readonly tone: 'default' | 'warning';
};

export type ControllerReviewArgs = {
  readonly isConnected: boolean;
  readonly machineKind: MachineKind;
  readonly statusReport: StatusReport | null;
  readonly alarmCode: number | null;
  readonly activeControllerKind: ControllerKind;
  readonly detectedControllerKind: ControllerKind | null;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly activeWcs: ActiveWorkCoordinateSystem | null;
  readonly overrides: OverrideValues | null;
  readonly profileMaxPowerS: number;
  readonly profileBedWidth: number;
  readonly profileBedHeight: number;
};

const DEFAULT_WCS = 'G54';

export function controllerReviewSummary(args: ControllerReviewArgs): string {
  if (!args.isConnected) return 'not connected';
  const state = args.statusReport?.state ?? 'no status yet';
  return overridesAreBaseline(args.overrides) ? `${state}` : `${state} · overrides active`;
}

export function buildControllerReviewFacts(
  args: ControllerReviewArgs,
): ReadonlyArray<JobReviewFact> {
  if (!args.isConnected) return [];
  return [
    fact('Firmware', firmwareLabel(args)),
    fact('State', machineStateLabel(args), machineStateTone(args)),
    ...positionFacts(args.statusReport),
    fact(
      'Active WCS',
      args.activeWcs ?? `${DEFAULT_WCS} (default)`,
      args.activeWcs !== null && args.activeWcs !== DEFAULT_WCS ? 'warning' : 'default',
    ),
    fact(
      'Overrides',
      describeOverrides(args.overrides),
      overridesAreBaseline(args.overrides) ? 'default' : 'warning',
    ),
    ...settingsFacts(args),
  ];
}

export function buildMachineReviewFacts(project: Project): ReadonlyArray<JobReviewFact> {
  const device = project.device;
  const shared: JobReviewFact[] = [
    fact('Bed', `${formatMm(device.bedWidth)} × ${formatMm(device.bedHeight)} mm`),
    fact('Machine origin', device.origin.split('-').join(' ')),
    fact('Max feed', `${formatMm(device.maxFeed)} mm/min`),
    fact('G-code dialect', device.gcodeDialect.dialectId),
  ];
  const machine = project.machine;
  if (machineKindOf(machine) === 'cnc' && machine?.kind === 'cnc') {
    return [
      ...shared,
      fact(
        'Stock',
        `${formatMm(machine.stock.widthMm)} × ${formatMm(machine.stock.heightMm)} × ${formatMm(machine.stock.thicknessMm)} mm`,
      ),
      fact('Active bit', activeCncTool(machine).name),
      fact('Safe Z', `${formatMm(machine.params.safeZMm)} mm above stock top`),
      fact(
        'Spindle',
        `max ${machine.params.spindleMaxRpm} RPM · spin-up ${machine.params.spindleSpinupSec} s`,
      ),
      fact('Coolant', machine.params.coolant ?? 'off'),
      fact('Park after job', parkLabel(machine.params.parkXMm, machine.params.parkYMm)),
    ];
  }
  return [
    ...shared,
    fact('Laser power scale', `S max $30 = ${device.maxPowerS}`),
    fact(
      'Air assist command',
      device.airAssistCommand === 'none'
        ? device.laserSubProfile?.airAssist === 'manual'
          ? 'Manual/external (no M-code)'
          : 'Not configured'
        : device.airAssistCommand,
    ),
    ...(device.rotary === undefined
      ? []
      : [
          fact(
            'Rotary',
            device.rotary.enabled ? 'Enabled' : 'Configured, disabled',
            device.rotary.enabled ? 'warning' : 'default',
          ),
        ]),
  ];
}

export function buildOutputQualityReviewFacts(
  job: Job,
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<JobReviewFact> {
  return [...buildFillRunwayFacts(job), ...buildScanDirectionFacts(job, layers)];
}

function buildFillRunwayFacts(job: Job): ReadonlyArray<JobReviewFact> {
  const facts: JobReviewFact[] = [];
  const coverage = analyzeFillHeatRisk(job);
  if (coverage.fillSweepCount > 0) {
    facts.push(
      fact(
        'Fill runway coverage',
        `requested ${coverage.fillRequestedRunwayValuesMm.join(' / ')} mm · ${coverage.fillFullRunwaySweepCount} full · ${coverage.fillPartialRunwaySweepCount} partial · ${coverage.fillNoRunwaySweepCount} skipped · ${coverage.fillDisabledRunwaySweepCount} disabled (${coverage.fillSweepCount} emitted sweeps)`,
        coverage.fillPartialRunwaySweepCount > 0 || coverage.fillNoRunwaySweepCount > 0
          ? 'warning'
          : 'default',
      ),
    );
  }
  return facts;
}

function buildScanDirectionFacts(
  job: Job,
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<JobReviewFact> {
  const facts: JobReviewFact[] = [];
  const seen = new Set<string>();
  for (const group of job.groups) {
    const entry = scanDirectionReviewEntry(group, layers);
    if (entry === null || seen.has(entry.key)) continue;
    seen.add(entry.key);
    facts.push(entry.reviewFact);
  }
  return facts;
}

function scanDirectionReviewEntry(
  group: Job['groups'][number],
  layers: ReadonlyArray<Layer>,
): { readonly key: string; readonly reviewFact: JobReviewFact } | null {
  if (
    group.kind === 'cnc' ||
    group.kind === 'cut' ||
    (group.kind === 'fill' && (group.fillStyle ?? 'scanline') === 'offset') ||
    group.scanDirection === undefined
  ) {
    return null;
  }
  const direction = group.scanDirection;
  const name = operationName(group.layerId, layers);
  return {
    key: `${group.layerId}:${group.kind}:${direction.reason}`,
    reviewFact: fact(
      `${group.kind === 'raster' ? 'Image' : 'Fill'} direction — ${name}`,
      `${direction.bidirectional ? 'Bidirectional' : 'One-way'} — ${scanDirectionReasonLabel(direction.reason)}`,
      scanDirectionFactTone(direction.reason),
    ),
  };
}

function scanDirectionFactTone(reason: ScanDirectionReason): JobReviewFact['tone'] {
  const warningReasons: ReadonlyArray<ScanDirectionReason> = [
    'expert-override',
    'calibration-baseline',
    'pending-calibration-4040-fallback',
    'uncalibrated-4040-fallback',
    'sensitive-island-one-way',
  ];
  return warningReasons.includes(reason) ? 'warning' : 'default';
}

function operationName(layerId: string, layers: ReadonlyArray<Layer>): string {
  const direct = layers.find((layer) => layer.id === layerId);
  if (direct !== undefined) return direct.name;
  for (const layer of layers) {
    const subLayer = layer.subLayers.find((candidate) => `${layer.id}:${candidate.id}` === layerId);
    if (subLayer !== undefined) return `${layer.name} / ${subLayer.label}`;
  }
  return layerId;
}

function scanDirectionReasonLabel(reason: ScanDirectionReason): string {
  switch (reason) {
    case 'requested-one-way':
      return 'selected by operator';
    case 'requested-bidirectional':
      return 'requested; profile does not require fallback';
    case 'calibrated-bidirectional':
      return 'scan-offset calibration present';
    case 'calibration-baseline':
      return 'uncorrected calibration baseline (explicit 0 mm)';
    case 'calibration-verification':
      return 'verification coupon using saved calibration table';
    case 'expert-override':
      return 'expert override without calibration';
    case 'sensitive-island-one-way':
      return 'sensitive Island Fill policy';
    case 'pending-calibration-4040-fallback':
      return '4040 fallback; saved calibration is awaiting verification';
    case 'uncalibrated-4040-fallback':
      return '4040 fallback; no scan-offset calibration';
  }
}

function fact(
  label: string,
  value: string,
  tone: JobReviewFact['tone'] = 'default',
): JobReviewFact {
  return { label, value, tone };
}

function firmwareLabel(args: ControllerReviewArgs): string {
  if (
    args.detectedControllerKind === null ||
    args.detectedControllerKind === args.activeControllerKind
  ) {
    return args.activeControllerKind;
  }
  return `${args.activeControllerKind} (banner says ${args.detectedControllerKind})`;
}

function machineStateLabel(args: ControllerReviewArgs): string {
  const state = args.statusReport?.state ?? 'No status report yet';
  return args.alarmCode === null ? `${state}` : `${state} — alarm ${args.alarmCode}`;
}

function machineStateTone(args: ControllerReviewArgs): JobReviewFact['tone'] {
  return args.statusReport?.state === 'Idle' && args.alarmCode === null ? 'default' : 'warning';
}

function positionFacts(statusReport: StatusReport | null): ReadonlyArray<JobReviewFact> {
  const facts: JobReviewFact[] = [];
  if (statusReport?.mPos != null)
    facts.push(fact('Machine position', axesLabel(statusReport.mPos)));
  if (statusReport?.wPos != null) facts.push(fact('Work position', axesLabel(statusReport.wPos)));
  return facts;
}

function axesLabel(axes: { readonly x: number; readonly y: number; readonly z: number }): string {
  return `X ${formatMm(axes.x)} · Y ${formatMm(axes.y)} · Z ${formatMm(axes.z)}`;
}

function settingsFacts(args: ControllerReviewArgs): ReadonlyArray<JobReviewFact> {
  const settings = args.controllerSettings;
  if (settings === null) {
    return [fact('Controller settings', 'Not read this session', 'warning')];
  }
  return [
    laserModeFact(settings, args.machineKind),
    maxPowerFact(settings, args.profileMaxPowerS),
    travelFact(settings, args.profileBedWidth, args.profileBedHeight),
    fact('Homing $22', formatOnOff(settings.homingEnabled)),
    fact('Soft limits $20', formatOnOff(settings.softLimitsEnabled)),
    fact(
      'Reports inches $13',
      formatOnOff(settings.reportInches),
      settings.reportInches === true ? 'warning' : 'default',
    ),
  ];
}

// A laser job wants $32=1 (beam gates with motion); a router wants $32=0
// (spindle keeps its commanded speed through holds). The mismatch is a
// warning here — the readiness pipeline already decides whether it blocks.
function laserModeFact(
  settings: ControllerSettingsSnapshot,
  machineKind: MachineKind,
): JobReviewFact {
  const expected = machineKind === 'laser';
  const tone: JobReviewFact['tone'] =
    settings.laserModeEnabled === undefined || settings.laserModeEnabled !== expected
      ? 'warning'
      : 'default';
  return fact('Laser mode $32', formatOnOff(settings.laserModeEnabled), tone);
}

function maxPowerFact(
  settings: ControllerSettingsSnapshot,
  profileMaxPowerS: number,
): JobReviewFact {
  if (settings.maxPowerS === undefined) return fact('S max $30', 'Unknown', 'warning');
  const matches = settings.maxPowerS === profileMaxPowerS;
  return fact(
    'S max $30',
    matches
      ? `${settings.maxPowerS}`
      : `${settings.maxPowerS} — profile expects ${profileMaxPowerS}`,
    matches ? 'default' : 'warning',
  );
}

function travelFact(
  settings: ControllerSettingsSnapshot,
  profileBedWidth: number,
  profileBedHeight: number,
): JobReviewFact {
  if (settings.bedWidth === undefined || settings.bedHeight === undefined) {
    return fact('Travel $130 × $131', 'Unknown');
  }
  const matches = settings.bedWidth === profileBedWidth && settings.bedHeight === profileBedHeight;
  const value = `${formatMm(settings.bedWidth)} × ${formatMm(settings.bedHeight)} mm`;
  return fact(
    'Travel $130 × $131',
    matches
      ? value
      : `${value} — profile bed ${formatMm(profileBedWidth)} × ${formatMm(profileBedHeight)} mm`,
    matches ? 'default' : 'warning',
  );
}

function parkLabel(parkXMm: number | undefined, parkYMm: number | undefined): string {
  if (parkXMm === undefined || parkYMm === undefined) return 'Machine origin';
  return `X ${formatMm(parkXMm)} · Y ${formatMm(parkYMm)}`;
}
