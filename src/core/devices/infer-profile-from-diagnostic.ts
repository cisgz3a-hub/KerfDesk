import type { ControllerSettingsSnapshot, StatusReport } from '../controllers/grbl';
import type { DeviceProfile } from './device-profile';

export type ProfileSuggestionConfidence = 'low' | 'medium' | 'high';

export type ProfileSuggestionBlockerCode =
  | 'controller-settings-unknown'
  | 'max-power-unknown'
  | 'max-power-mismatch'
  | 'laser-mode-unknown'
  | 'laser-mode-disabled'
  | 'bed-size-mismatch'
  | 'work-offset-unknown';

export type ProfileSuggestionWarningCode = 'min-power-nonzero' | 'homing-disabled';

export type ProfileSuggestionIssue<Code extends string> = {
  readonly code: Code;
  readonly message: string;
};

export type ProfileSuggestionEvidence = {
  readonly buildInfo: string | null;
  readonly modalState: string | null;
  readonly statusState: StatusReport['state'] | null;
  readonly wcoKnown: boolean;
};

export type ProfileSuggestion = {
  readonly confidence: ProfileSuggestionConfidence;
  readonly patch: Partial<DeviceProfile>;
  readonly blockers: ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionBlockerCode>>;
  readonly warnings: ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionWarningCode>>;
  readonly evidence: ProfileSuggestionEvidence;
};

export type DiagnosticTranscriptEntry = {
  readonly direction: 'in' | 'out' | 'system';
  readonly raw: string;
};

export type DiagnosticPosition = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type InferProfileFromDiagnosticInput = {
  readonly profile: DeviceProfile;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly statusReport: StatusReport | null;
  readonly wcoCache: DiagnosticPosition | null;
  readonly workOriginActive: boolean;
  readonly transcript: ReadonlyArray<DiagnosticTranscriptEntry>;
};

const DIMENSION_TOLERANCE_MM = 0.01;

export function inferProfileFromDiagnostic(
  input: InferProfileFromDiagnosticInput,
): ProfileSuggestion {
  const evidence = diagnosticEvidence(input.transcript, input.statusReport, input.wcoCache);
  return {
    confidence: suggestionConfidence(input.controllerSettings, evidence),
    patch: profilePatch(input.profile, input.controllerSettings),
    blockers: profileBlockers(input),
    warnings: profileWarnings(input.profile, input.controllerSettings),
    evidence,
  };
}

function profilePatch(
  profile: DeviceProfile,
  controller: ControllerSettingsSnapshot | null,
): Partial<DeviceProfile> {
  if (controller === null) return {};
  return Object.assign(
    {},
    knownNumber(controller.maxPowerS, (maxPowerS) => ({ maxPowerS })),
    knownNumber(controller.minPowerS, (minPowerS) => ({ minPowerS })),
    knownBoolean(controller.laserModeEnabled, (laserModeEnabled) => ({ laserModeEnabled })),
    knownNumber(controller.maxFeed, (maxFeed) => ({ maxFeed })),
    knownNumber(controller.accelMmPerSec2, (accelMmPerSec2) => ({ accelMmPerSec2 })),
    knownNumber(controller.bedWidth, (bedWidth) => ({ bedWidth })),
    knownNumber(controller.bedHeight, (bedHeight) => ({ bedHeight })),
    knownNumber(controller.zTravelMm, (zTravelMm) => ({ zTravelMm })),
    knownNumber(controller.junctionDeviationMm, (junctionDeviationMm) => ({ junctionDeviationMm })),
    homingPatch(profile, controller),
  ) as Partial<DeviceProfile>;
}

function profileBlockers(
  input: InferProfileFromDiagnosticInput,
): ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionBlockerCode>> {
  const { profile, controllerSettings: controller } = input;
  if (controller === null) {
    return [
      {
        code: 'controller-settings-unknown',
        message: 'Diagnostic bundle does not include a parsed GRBL $$ settings snapshot.',
      },
    ];
  }
  return [
    ...maxPowerBlockers(profile, controller),
    ...laserModeBlockers(controller),
    ...bedSizeBlockers(profile, controller),
    ...workOffsetBlockers(input),
  ];
}

function maxPowerBlockers(
  profile: DeviceProfile,
  controller: ControllerSettingsSnapshot,
): ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionBlockerCode>> {
  if (controller.maxPowerS === undefined) {
    return [
      {
        code: 'max-power-unknown',
        message: 'GRBL $30 was not captured, so LaserForge cannot verify the S-value power scale.',
      },
    ];
  }
  if (controller.maxPowerS !== profile.maxPowerS) {
    return [
      {
        code: 'max-power-mismatch',
        message: `Controller $30 is ${controller.maxPowerS}; the active profile uses ${profile.maxPowerS}.`,
      },
    ];
  }
  return [];
}

function laserModeBlockers(
  controller: ControllerSettingsSnapshot,
): ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionBlockerCode>> {
  if (controller.laserModeEnabled === undefined) {
    return [
      {
        code: 'laser-mode-unknown',
        message: 'GRBL $32 was not captured, so LaserForge cannot verify laser mode.',
      },
    ];
  }
  if (!controller.laserModeEnabled) {
    return [
      {
        code: 'laser-mode-disabled',
        message: 'Controller reports $32=0. Enable GRBL laser mode before running laser jobs.',
      },
    ];
  }
  return [];
}

function bedSizeBlockers(
  profile: DeviceProfile,
  controller: ControllerSettingsSnapshot,
): ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionBlockerCode>> {
  if (!bedSizeMismatch(profile, controller)) return [];
  return [
    {
      code: 'bed-size-mismatch',
      message: `Controller travel is ${controller.bedWidth}x${controller.bedHeight} mm; the active profile is ${profile.bedWidth}x${profile.bedHeight} mm.`,
    },
  ];
}

function workOffsetBlockers(
  input: InferProfileFromDiagnosticInput,
): ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionBlockerCode>> {
  if (!input.workOriginActive || input.wcoCache !== null) return [];
  return [
    {
      code: 'work-offset-unknown',
      message: 'Work origin is active, but the diagnostic bundle does not include a confirmed WCO.',
    },
  ];
}

function profileWarnings(
  profile: DeviceProfile,
  controller: ControllerSettingsSnapshot | null,
): ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionWarningCode>> {
  if (controller === null) return [];
  return [...minPowerWarnings(controller), ...homingWarnings(profile, controller)];
}

function minPowerWarnings(
  controller: ControllerSettingsSnapshot,
): ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionWarningCode>> {
  if (controller.minPowerS === undefined || controller.minPowerS <= 0) return [];
  return [
    {
      code: 'min-power-nonzero',
      message: `Controller $31 minimum S is ${controller.minPowerS}. Low nonzero power values may burn hotter than expected.`,
    },
  ];
}

function homingWarnings(
  profile: DeviceProfile,
  controller: ControllerSettingsSnapshot,
): ReadonlyArray<ProfileSuggestionIssue<ProfileSuggestionWarningCode>> {
  if (!profile.controller.requiresHomingBeforeJob || controller.homingEnabled !== false) return [];
  return [
    {
      code: 'homing-disabled',
      message:
        'The active profile requires homing before jobs, but GRBL $22 reports homing disabled.',
    },
  ];
}

function diagnosticEvidence(
  transcript: ReadonlyArray<DiagnosticTranscriptEntry>,
  statusReport: StatusReport | null,
  wcoCache: DiagnosticPosition | null,
): ProfileSuggestionEvidence {
  return {
    buildInfo: firstInbound(
      transcript,
      (raw) => raw.startsWith('[VER:') || raw.startsWith('Grbl '),
    ),
    modalState: firstInbound(transcript, (raw) => raw.startsWith('[GC:')),
    statusState: statusReport?.state ?? null,
    wcoKnown: wcoCache !== null,
  };
}

function suggestionConfidence(
  controller: ControllerSettingsSnapshot | null,
  evidence: ProfileSuggestionEvidence,
): ProfileSuggestionConfidence {
  if (controller === null) return 'low';
  if (
    evidence.buildInfo === null &&
    evidence.modalState === null &&
    evidence.statusState === null
  ) {
    return 'medium';
  }
  return 'high';
}

function bedSizeMismatch(profile: DeviceProfile, controller: ControllerSettingsSnapshot): boolean {
  return (
    knownDimensionMismatch(controller.bedWidth, profile.bedWidth) ||
    knownDimensionMismatch(controller.bedHeight, profile.bedHeight)
  );
}

function knownDimensionMismatch(
  controllerValue: number | undefined,
  profileValue: number,
): boolean {
  return (
    controllerValue !== undefined &&
    Math.abs(controllerValue - profileValue) > DIMENSION_TOLERANCE_MM
  );
}

function homingPatch(
  profile: DeviceProfile,
  controller: ControllerSettingsSnapshot,
): Partial<DeviceProfile> {
  if (controller.homingEnabled === undefined) return {};
  return { homing: { ...profile.homing, enabled: controller.homingEnabled } };
}

function knownNumber(
  value: number | undefined,
  build: (value: number) => Partial<DeviceProfile>,
): Partial<DeviceProfile> {
  return value === undefined ? {} : build(value);
}

function knownBoolean(
  value: boolean | undefined,
  build: (value: boolean) => Partial<DeviceProfile>,
): Partial<DeviceProfile> {
  return value === undefined ? {} : build(value);
}

function firstInbound(
  transcript: ReadonlyArray<DiagnosticTranscriptEntry>,
  predicate: (raw: string) => boolean,
): string | null {
  const match = transcript.find((entry) => entry.direction === 'in' && predicate(entry.raw.trim()));
  return match?.raw.trim() ?? null;
}
