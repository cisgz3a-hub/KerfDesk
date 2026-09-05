import { effectiveScanOffsetCalibrationStatus } from '../../core/devices/scan-offset-profile';
import type { Layer, Project } from '../../core/scene';
import type { MachineSetupFillHeatRisk } from './machine-setup-fill-heat-risk';

export type DiagnosticCheck = {
  readonly label: string;
  readonly status: 'check' | 'ok' | 'warn';
  readonly detail: string;
};

type SettingDiagnostic = {
  readonly kind: 'known' | 'missing';
  readonly display: string;
  readonly value: number | null;
};

type DiagnosticCheckInput = {
  readonly project: Project;
  readonly requestedBidirectionalOperations: number;
  readonly effectiveBidirectionalGroups: number | null;
  readonly profileFallbackGroups: number | null;
  readonly lowOverscanGroups: number | null;
  readonly defaultRecipeLayers: ReadonlyArray<Layer>;
  readonly defaultLineIntervalLayers: ReadonlyArray<Layer>;
  readonly fillHeatRisk: MachineSetupFillHeatRisk;
  readonly laserMode: SettingDiagnostic;
  readonly sMax: SettingDiagnostic;
};

export function diagnosticChecks(args: DiagnosticCheckInput): ReadonlyArray<DiagnosticCheck> {
  return [
    bidirectionalCheck(args),
    controllerLaserModeCheck(args.laserMode),
    islandFillHeatCheck(args.fillHeatRisk),
    accelerationMarginCheck(args.lowOverscanGroups),
    materialRecipeCheck(args.defaultRecipeLayers),
    lineIntervalCheck(args.defaultLineIntervalLayers),
    mechanicalFocusCheck(),
  ];
}

function bidirectionalCheck(args: DiagnosticCheckInput): DiagnosticCheck {
  const calibrationStatus = effectiveScanOffsetCalibrationStatus(args.project.device);
  const offsetsNotReady =
    (args.effectiveBidirectionalGroups ?? 0) > 0 &&
    (calibrationStatus === 'uncalibrated' || calibrationStatus === 'pending');
  if (args.effectiveBidirectionalGroups === null) {
    return {
      label: 'Bidirectional compensation',
      status: 'check',
      detail:
        args.requestedBidirectionalOperations > 0
          ? 'Requested bidirectional operations exist; inspect compiled effective direction in Job Review.'
          : 'No requested bidirectional raster or fill operations were found.',
    };
  }
  if ((args.profileFallbackGroups ?? 0) > 0) {
    return {
      label: 'Bidirectional compensation',
      status: 'warn',
      detail: `${args.profileFallbackGroups} executable group(s) are effectively one-way because this profile requires verified scan offsets.`,
    };
  }
  return {
    label: 'Bidirectional compensation',
    status: offsetsNotReady ? 'warn' : 'ok',
    detail:
      calibrationStatus === 'pending'
        ? 'Burn and inspect “Verify saved table,” then mark the table verified. Profiles that require verification stay one-way while pending.'
        : args.effectiveBidirectionalGroups > 0
          ? 'Disable bidirectional output for a test burn, then add calibrated scan offsets if the doubled letters disappear.'
          : 'No executable bidirectional raster or fill groups were found.',
  };
}

function controllerLaserModeCheck(laserMode: SettingDiagnostic): DiagnosticCheck {
  return {
    label: 'Controller laser mode',
    status: laserMode.value === 0 || laserMode.kind === 'missing' ? 'warn' : 'ok',
    detail:
      laserMode.kind === 'missing'
        ? 'Read controller settings before trusting raster diagnostics.'
        : `Current controller readback is ${laserMode.display}.`,
  };
}

function islandFillHeatCheck(fillHeatRisk: MachineSetupFillHeatRisk): DiagnosticCheck {
  if (fillHeatRisk === 'background') {
    return {
      label: 'Island Fill heat margin',
      status: 'check',
      detail:
        'Detailed sweep analysis is deferred to the background preparation shown in Job Review.',
    };
  }
  if (fillHeatRisk === 'no-island') {
    return {
      label: 'Island Fill heat margin',
      status: 'ok',
      detail: 'No active Island Fill layers were found.',
    };
  }
  const riskyCount =
    fillHeatRisk.islandNoRunwayShortSweepCount + fillHeatRisk.islandPartialRunwaySweepCount;
  return {
    label: 'Island Fill heat margin',
    status:
      fillHeatRisk.islandNoRunwayShortSweepCount > 0 ? 'warn' : riskyCount > 0 ? 'check' : 'ok',
    detail:
      riskyCount > 0
        ? 'Tiny island sweeps are sensitive to acceleration. Use partial overscan, test on scrap, or use Scanline Fill if spots look too dark.'
        : 'No short Island Fill sweeps were found in the active output.',
  };
}

function accelerationMarginCheck(lowOverscanGroups: number | null): DiagnosticCheck {
  if (lowOverscanGroups === null) {
    return {
      label: 'Head acceleration margin',
      status: 'check',
      detail: 'Inspect compiled effective overscan in Job Review for this large canvas.',
    };
  }
  return {
    label: 'Head acceleration margin',
    status: lowOverscanGroups > 0 ? 'check' : 'ok',
    detail:
      lowOverscanGroups > 0
        ? 'Some bidirectional groups are below the 5%-of-speed calibration runway reference. Increase runway if edges look darker, stretched, or uneven, then verify against controller acceleration.'
        : 'Executable bidirectional groups meet the 5%-of-speed calibration runway reference; low axis acceleration can still require more.',
  };
}

function materialRecipeCheck(defaultRecipeLayers: ReadonlyArray<Layer>): DiagnosticCheck {
  return {
    label: 'Material recipe',
    status: defaultRecipeLayers.length > 0 ? 'check' : 'ok',
    detail:
      defaultRecipeLayers.length > 0
        ? 'Burn a Material Test on scrap and copy the winning speed, power, and passes into the output layer.'
        : 'Active output layers have moved away from first-run starter settings.',
  };
}

function lineIntervalCheck(defaultLineIntervalLayers: ReadonlyArray<Layer>): DiagnosticCheck {
  return {
    label: 'Line interval',
    status: defaultLineIntervalLayers.length > 0 ? 'check' : 'ok',
    detail:
      defaultLineIntervalLayers.length > 0
        ? 'Use Interval Test to tune hatch spacing or image lines/mm for this material and focus height.'
        : 'Active raster/fill layers are not using the default line interval.',
  };
}

function mechanicalFocusCheck(): DiagnosticCheck {
  return {
    label: 'Mechanical focus and motion',
    status: 'check',
    detail:
      'If unidirectional output still doubles, inspect belt tension, pulley set screws, frame squareness, focus height, lens cleanliness, and workpiece hold-down.',
  };
}
