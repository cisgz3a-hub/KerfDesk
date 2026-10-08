import type { DeviceProfile } from '../../../core/devices';
import type { GcodeMetadata } from '../../../io/gcode';
import type { LaserState } from '../../state/laser-store';
import { redactDiagnosticText } from './diagnostic-redaction';
import { machineProtocolInventory } from './machine-protocol-inventory';

export const DIAGNOSTIC_BUNDLE_MAX_BYTES = 128 * 1024;
export const DIAGNOSTIC_TRANSCRIPT_LIMIT = 200;
const SETTINGS_LIMIT = 256;

export type DiagnosticBundleOptions = {
  readonly app: GcodeMetadata;
  readonly platformId: string;
  readonly device: DeviceProfile;
  readonly machineKind: 'laser' | 'cnc';
  readonly laser: LaserState;
  readonly includeTranscript: boolean;
  readonly createdAt: string;
};

export type DiagnosticBundleReview = {
  readonly json: string;
  readonly bytes: number;
  readonly transcriptIncluded: number;
  readonly transcriptOmitted: number;
};

/** Reads only the values passed in. No controller, storage or network access. */
export function createDiagnosticBundle(options: DiagnosticBundleOptions): DiagnosticBundleReview {
  const transcript = diagnosticTranscript(options);
  const bundle = {
    format: 'kerfdesk.diagnostic-bundle',
    schemaVersion: 1,
    createdAt: options.createdAt,
    app: appIdentity(options),
    declaredMachine: declaredMachine(options),
    knownConnection: knownConnection(options.laser),
    knownController: knownController(options.laser),
    protocolInventory: machineProtocolInventory(options.device, options.laser),
    disclosure: disclosure(options.laser.transcript.length - transcript.length),
    transcript,
  };
  let json = serialize(bundle);
  while (byteLength(json) > DIAGNOSTIC_BUNDLE_MAX_BYTES && transcript.length > 0) {
    transcript.shift();
    bundle.disclosure.transcriptOmitted = options.laser.transcript.length - transcript.length;
    json = serialize(bundle);
  }
  return {
    json,
    bytes: byteLength(json),
    transcriptIncluded: transcript.length,
    transcriptOmitted: bundle.disclosure.transcriptOmitted,
  };
}

function diagnosticTranscript(options: DiagnosticBundleOptions) {
  const { laser } = options;
  const transcript: Array<Record<string, string | number | null>> = [];
  if (options.includeTranscript) {
    for (const entry of laser.transcript.slice(-DIAGNOSTIC_TRANSCRIPT_LIMIT)) {
      // Motion text can reconstruct the user's artwork. Keep diagnostic replies,
      // not executable output, even when a manual command was classified G-code.
      if (entry.source === 'job' || entry.source === 'motion' || entry.kind === 'gcode') continue;
      const raw = redactDiagnosticText(entry.raw);
      if (raw === null) continue;
      transcript.push({
        at: finite(entry.at),
        direction: entry.direction,
        source: entry.source,
        kind: entry.kind,
        raw,
        decoded: entry.decoded === undefined ? null : redactDiagnosticText(entry.decoded),
      });
    }
  }
  return transcript;
}

function appIdentity(options: DiagnosticBundleOptions) {
  return {
    name: text(options.app.appName),
    version: text(options.app.appVersion),
    gitSha: text(options.app.gitSha),
    buildTimeUtc: text(options.app.buildTimeUtc),
    emitterRevision: options.app.emitterRevision,
    platform: text(options.platformId),
  };
}

function declaredMachine(options: DiagnosticBundleOptions) {
  const { device } = options;
  return {
    kind: options.machineKind,
    controller: device.controllerKind ?? 'grbl-v1.1',
    commandSet: device.controllerCommandSet ?? null,
    origin: device.origin,
    bedWidthMm: finite(device.bedWidth),
    bedHeightMm: finite(device.bedHeight),
    maxFeedMmPerMin: finite(device.maxFeed),
    minPowerS: finite(device.minPowerS),
    maxPowerS: finite(device.maxPowerS),
    laserModeExpected: device.laserModeEnabled,
    rotaryEnabled: device.rotary?.enabled === true,
  };
}

function knownConnection(laser: LaserState) {
  return {
    state: laser.connection.kind,
    activeController: laser.activeControllerKind,
    detectedController: laser.detectedControllerKind,
    transport: laser.serialPortInfo?.transport ?? laser.capabilities.transport,
    baudRate: finite(laser.connectedBaudRate),
    qualification: laser.controllerQualification.kind,
    usbVendorId: finite(laser.serialPortInfo?.usbVendorId),
    usbProductId: finite(laser.serialPortInfo?.usbProductId),
    error: laser.connection.kind === 'failed' ? text(laser.connection.error) : null,
  };
}

function knownController(laser: LaserState) {
  const build = laser.controllerBuildInfo;
  const status = laser.statusReport;
  return {
    settingsReadAt: finite(laser.lastSettingsReadAt),
    firmwareReport: diagnosticFirmwareReport(laser),
    settings: laser.grblSettingsRows.slice(0, SETTINGS_LIMIT).map((row) => ({
      id: finite(row.id),
      numericValue: finite(row.numericValue),
    })),
    settingsOmitted: Math.max(0, laser.grblSettingsRows.length - SETTINGS_LIMIT),
    build:
      build === null
        ? null
        : {
            protocolVersion: text(build.protocolVersion),
            buildRevision: text(build.buildRevision),
            options: build.optionCodes.slice(0, 32),
            plannerBufferBlocks: finite(build.plannerBufferBlocks),
            rxBufferBytes: finite(build.rxBufferBytes),
          },
    status:
      status === null
        ? null
        : {
            state: status.state,
            subState: finite(status.subState),
            machinePosition: position(status.mPos),
            workPosition: position(status.wPos),
            feed: finite(status.feed),
            spindleCommand: finite(status.spindle),
            reportedLaserPercent: finite(status.laserPowerPercent),
          },
  };
}

function diagnosticFirmwareReport(laser: LaserState) {
  const report = laser.controllerFirmwareReport;
  if (
    report == null ||
    laser.connection.kind !== 'connected' ||
    report.sessionEpoch !== laser.controllerSessionEpoch
  )
    return null;
  return {
    controller: report.controllerKind,
    query: report.query,
    observedAt: finite(report.observedAt),
    fields: report.fields
      .slice(0, 32)
      .map((field) => ({ name: text(field.name), value: text(field.value) })),
    reportedCapabilities: report.reportedCapabilities.slice(0, 64),
    scope: 'Firmware-reported claims only; no capability enabling or hardware qualification',
  };
}

function disclosure(transcriptOmitted: number) {
  return {
    observations:
      'Existing in-memory observations only; may be absent or stale. No fresh controller query.',
    omitted: [
      'artwork and project data',
      'job and motion G-code',
      'profile and file names/paths',
      'accounts and licence data',
      'device serial numbers and controller user info',
      'raw settings values',
    ],
    redaction:
      'Recognised sensitive lines are omitted; URLs, paths, addresses and identifiers are redacted. Review before sharing; unlabelled secrets may not be recognised.',
    payloadLimitBytes: DIAGNOSTIC_BUNDLE_MAX_BYTES,
    transcriptOmitted,
  };
}

function text(value: string | undefined): string | null {
  return value === undefined ? null : redactDiagnosticText(value);
}
function finite(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}
function position(value: { readonly x: number; readonly y: number; readonly z: number } | null) {
  return value === null ? null : { x: finite(value.x), y: finite(value.y), z: finite(value.z) };
}
function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
