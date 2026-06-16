import type { GrblSettingRow, StatusReport, StreamerState } from '../../core/controllers/grbl';
import {
  inferProfileFromDiagnostic,
  type DeviceProfile,
  type ProfileSuggestion,
} from '../../core/devices';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { SerialTranscriptEntry, TranscriptKind } from './laser-transcript';
import type { WorkCoordinateOffset } from './origin-actions';

export const MACHINE_DIAGNOSTIC_TRANSCRIPT_LIMIT = 300;

export type MachineDiagnosticBundle = {
  readonly format: 'laserforge-machine-diagnostic';
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly profile: MachineDiagnosticProfile;
  readonly controller: {
    readonly settings: ControllerSettingsSnapshot | null;
    readonly settingsRows: ReadonlyArray<GrblSettingRow>;
    readonly statusReport: StatusReport | null;
    readonly wcoCache: WorkCoordinateOffset | null;
    readonly workOriginActive: boolean;
  };
  readonly stream: MachineDiagnosticStream | null;
  readonly evidence: {
    readonly transcriptLimit: number;
    readonly transcriptTail: ReadonlyArray<SerialTranscriptEntry>;
    readonly outboundCommandKinds: ReadonlyArray<TranscriptKind>;
    readonly sampleGcode: string | null;
  };
  readonly profileSuggestion: ProfileSuggestion;
};

type MachineDiagnosticProfile = Pick<
  DeviceProfile,
  | 'name'
  | 'machineFamily'
  | 'controllerKind'
  | 'bedWidth'
  | 'bedHeight'
  | 'maxFeed'
  | 'maxPowerS'
  | 'minPowerS'
  | 'laserModeEnabled'
  | 'airAssistCommand'
  | 'controller'
  | 'gcodeDialect'
>;

type MachineDiagnosticStream = {
  readonly status: StreamerState['status'];
  readonly streamingMode: StreamerState['streamingMode'];
  readonly pollDuringJob: StreamerState['pollDuringJob'];
  readonly rxBufferBytes: number;
  readonly queuedCount: number;
  readonly inFlightCount: number;
  readonly inFlightBytes: number;
  readonly completed: number;
  readonly total: number;
};

export type MachineDiagnosticBundleInput = {
  readonly createdAt?: string;
  readonly profile: DeviceProfile;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly grblSettingsRows: ReadonlyArray<GrblSettingRow>;
  readonly statusReport: StatusReport | null;
  readonly wcoCache: WorkCoordinateOffset | null;
  readonly workOriginActive: boolean;
  readonly streamer: StreamerState | null;
  readonly transcript: ReadonlyArray<SerialTranscriptEntry>;
  readonly sampleGcode?: string | null;
};

export function createMachineDiagnosticBundle(
  input: MachineDiagnosticBundleInput,
): MachineDiagnosticBundle {
  const transcriptTail = input.transcript.slice(-MACHINE_DIAGNOSTIC_TRANSCRIPT_LIMIT);
  return {
    format: 'laserforge-machine-diagnostic',
    schemaVersion: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    profile: diagnosticProfile(input.profile),
    controller: {
      settings: input.controllerSettings,
      settingsRows: input.grblSettingsRows,
      statusReport: input.statusReport,
      wcoCache: input.wcoCache,
      workOriginActive: input.workOriginActive,
    },
    stream: diagnosticStream(input.streamer),
    evidence: {
      transcriptLimit: MACHINE_DIAGNOSTIC_TRANSCRIPT_LIMIT,
      transcriptTail,
      outboundCommandKinds: uniqueOutboundKinds(transcriptTail),
      sampleGcode: input.sampleGcode ?? null,
    },
    profileSuggestion: inferProfileFromDiagnostic({
      profile: input.profile,
      controllerSettings: input.controllerSettings,
      statusReport: input.statusReport,
      wcoCache: input.wcoCache,
      workOriginActive: input.workOriginActive,
      transcript: transcriptTail,
    }),
  };
}

function diagnosticProfile(profile: DeviceProfile): MachineDiagnosticProfile {
  return {
    name: profile.name,
    ...(profile.machineFamily === undefined ? {} : { machineFamily: profile.machineFamily }),
    ...(profile.controllerKind === undefined ? {} : { controllerKind: profile.controllerKind }),
    bedWidth: profile.bedWidth,
    bedHeight: profile.bedHeight,
    maxFeed: profile.maxFeed,
    maxPowerS: profile.maxPowerS,
    minPowerS: profile.minPowerS,
    laserModeEnabled: profile.laserModeEnabled,
    airAssistCommand: profile.airAssistCommand,
    controller: profile.controller,
    gcodeDialect: profile.gcodeDialect,
  };
}

function diagnosticStream(streamer: StreamerState | null): MachineDiagnosticStream | null {
  if (streamer === null) return null;
  return {
    status: streamer.status,
    streamingMode: streamer.streamingMode,
    pollDuringJob: streamer.pollDuringJob,
    rxBufferBytes: streamer.rxBufferBytes,
    queuedCount: streamer.queued.length,
    inFlightCount: streamer.inFlight.length,
    inFlightBytes: streamer.inFlightBytes,
    completed: streamer.completed,
    total: streamer.total,
  };
}

function uniqueOutboundKinds(
  transcript: ReadonlyArray<SerialTranscriptEntry>,
): ReadonlyArray<TranscriptKind> {
  const kinds: TranscriptKind[] = [];
  for (const entry of transcript) {
    if (entry.direction !== 'out') continue;
    if (!kinds.includes(entry.kind)) kinds.push(entry.kind);
  }
  return kinds;
}
