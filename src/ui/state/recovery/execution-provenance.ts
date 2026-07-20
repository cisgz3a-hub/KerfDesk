import type { GrblBuildInfo } from '../../../core/controllers/grbl/build-info';
import type { ControllerKind, DeviceProfile, MachineProfileSource } from '../../../core/devices';
import type { GcodeMetadata } from '../../../io/gcode';
import { serializeCanonicalDeviceProfile } from '../../../io/machine-profile/machine-profile-io';
import { buildGcodeMetadata } from '../../app/build-info';
import type { JobReviewAcknowledgement } from '../../laser/job-review/job-review-model';
import type { CncSetupAttestation } from '../cnc-setup-attestation';
import type { ControllerQualification } from '../laser-controller-qualification';
import type { SessionObservationStamp } from '../laser-controller-observation';
import type { LaserModeStartEvidence } from '../laser-mode-start-evidence';
import type { LaserState } from '../laser-store';
import type { ArchivedControllerObservationV1 } from './execution-artifact';
import type {
  ExecutionProvenanceEvidenceV2,
  ExecutionReviewEvidenceV2,
  ExecutionWorkflowV2,
} from './execution-workflow-evidence';
import { isExecutionProvenance } from './execution-provenance-validation';

export const LEGACY_EXECUTION_PROVENANCE_SCHEMA_VERSION = 1;
export const EXECUTION_PROVENANCE_SCHEMA_VERSION = 2;

export type ArchivedSerialPortInfoV1 = {
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
  readonly bluetoothServiceClassId?: string;
};

type ExecutionProvenanceBase = {
  readonly build: GcodeMetadata;
  readonly content: {
    readonly gcodeSha256: `sha256:${string}`;
    readonly canonicalProfileSha256: `sha256:${string}`;
    readonly gcodeUtf8Bytes: number;
    readonly canonicalProfileUtf8Bytes: number;
    readonly profileId?: string;
    readonly profileName: string;
    readonly profileSource?: MachineProfileSource;
    readonly catalogVersion?: string;
  };
  readonly transport: {
    readonly kind: 'web-serial' | 'file-only';
    /** USB VID/PID identify an adapter/model, not a unique physical machine. */
    readonly serialPortInfo?: ArchivedSerialPortInfoV1;
  };
  readonly controller: {
    readonly sessionEpoch: number;
    readonly activeKind: ControllerKind;
    readonly detectedKind: ControllerKind | null;
    readonly qualification: ControllerQualification;
    readonly buildInfo: {
      readonly parsed: GrblBuildInfo | null;
      readonly rawLines: ReadonlyArray<string>;
      readonly observation: SessionObservationStamp;
    } | null;
    readonly settingsObservation: SessionObservationStamp | null;
    readonly settingsRows: ReadonlyArray<{
      readonly code: `$${number}`;
      readonly rawValue: string;
    }>;
  };
};

export type ExecutionProvenanceV1 = ExecutionProvenanceBase & {
  readonly schemaVersion: typeof LEGACY_EXECUTION_PROVENANCE_SCHEMA_VERSION;
  readonly review: {
    readonly reviewedAtIso: string;
    readonly warningsShown: ReadonlyArray<string>;
    readonly acknowledgement: JobReviewAcknowledgement;
    readonly laserModeStartEvidence?: LaserModeStartEvidence;
    readonly cncSetupAttestation?: CncSetupAttestation;
  };
};

export type ExecutionProvenanceV2 = ExecutionProvenanceBase & {
  readonly schemaVersion: typeof EXECUTION_PROVENANCE_SCHEMA_VERSION;
  /** Digest of the complete immutable controller observation archived beside
   * this provenance. Optional only for V2 artifacts written before this
   * binding was introduced. */
  readonly archivedControllerObservationSha256?: `sha256:${string}`;
  /** SHA-256 of the canonical build/content/transport/controller/workflow/review envelope. */
  readonly envelopeSha256: `sha256:${string}`;
  readonly workflow: ExecutionWorkflowV2;
  readonly review: ExecutionReviewEvidenceV2;
};

export type ExecutionProvenance = ExecutionProvenanceV1 | ExecutionProvenanceV2;
type UnsignedExecutionProvenanceV2 = Omit<ExecutionProvenanceV2, 'envelopeSha256'>;

export async function createExecutionProvenance(
  args: {
    readonly gcode: string;
    readonly profile: DeviceProfile;
    readonly laser: LaserState;
    readonly archivedControllerObservation: ArchivedControllerObservationV1;
  } & ExecutionProvenanceEvidenceV2,
): Promise<ExecutionProvenanceV2> {
  const canonicalProfile = serializeCanonicalDeviceProfile(args.profile);
  const gcodeUtf8Bytes = new TextEncoder().encode(args.gcode).byteLength;
  const canonicalProfileUtf8Bytes = new TextEncoder().encode(canonicalProfile).byteLength;
  const [gcodeSha256, canonicalProfileSha256, archivedControllerObservationSha256] =
    await Promise.all([
      sha256Utf8(args.gcode),
      sha256Utf8(canonicalProfile),
      computeArchivedControllerObservationSha256(args.archivedControllerObservation),
    ]);
  const buildObservation = args.laser.controllerBuildInfoObservation;
  const serialPortInfo = args.laser.serialPortInfo ?? null;
  const transportKind =
    args.laser.capabilities.transport === 'file-only' ? 'file-only' : 'web-serial';
  const unsigned = {
    schemaVersion: EXECUTION_PROVENANCE_SCHEMA_VERSION,
    archivedControllerObservationSha256,
    build: buildGcodeMetadata(),
    content: {
      gcodeSha256,
      canonicalProfileSha256,
      gcodeUtf8Bytes,
      canonicalProfileUtf8Bytes,
      ...(args.profile.profileId === undefined ? {} : { profileId: args.profile.profileId }),
      profileName: args.profile.name,
      ...(args.profile.profileSource === undefined
        ? {}
        : { profileSource: args.profile.profileSource }),
      ...(args.profile.catalogVersion === undefined
        ? {}
        : { catalogVersion: args.profile.catalogVersion }),
    },
    transport: {
      kind: transportKind,
      ...(transportKind === 'file-only' || serialPortInfo === null ? {} : { serialPortInfo }),
    },
    controller: {
      sessionEpoch: args.laser.controllerSessionEpoch,
      activeKind: args.laser.activeControllerKind,
      detectedKind: args.laser.detectedControllerKind,
      qualification: args.laser.controllerQualification,
      buildInfo:
        buildObservation === null
          ? null
          : {
              parsed:
                args.laser.controllerBuildInfo === null
                  ? null
                  : {
                      ...args.laser.controllerBuildInfo,
                      optionCodes: [...args.laser.controllerBuildInfo.optionCodes],
                    },
              rawLines: [...args.laser.controllerBuildInfoRawLines],
              observation: { ...buildObservation },
            },
      settingsObservation:
        args.laser.controllerSettingsObservation === null
          ? null
          : { ...args.laser.controllerSettingsObservation },
      settingsRows: args.laser.grblSettingsRows.map(({ code, rawValue }) => ({ code, rawValue })),
    },
    workflow: args.workflow,
    review: { ...args.review, warningsShown: [...args.review.warningsShown] },
  } satisfies UnsignedExecutionProvenanceV2;
  return {
    ...unsigned,
    envelopeSha256: await computeExecutionProvenanceEnvelopeSha256(unsigned),
  };
}

export { isExecutionProvenance };

/** Hash all V2 provenance evidence independently of object property insertion order. */
export async function computeExecutionProvenanceEnvelopeSha256(
  provenance: UnsignedExecutionProvenanceV2,
): Promise<`sha256:${string}`> {
  const envelope = { ...provenance } as Record<string, unknown>;
  delete envelope['envelopeSha256'];
  return sha256Utf8(`${EXECUTION_PROVENANCE_ENVELOPE_DOMAIN}${canonicalJson(envelope)}`);
}

/** Bind every archived controller field, including settings/status/WCO/work-Z,
 * overrides, and accessories, independently of object insertion order. */
export async function computeArchivedControllerObservationSha256(
  observation: ArchivedControllerObservationV1,
): Promise<`sha256:${string}`> {
  return sha256Utf8(`${ARCHIVED_CONTROLLER_OBSERVATION_DOMAIN}${canonicalJson(observation)}`);
}

const EXECUTION_PROVENANCE_ENVELOPE_DOMAIN = 'KerfDesk execution provenance v2\0';
const ARCHIVED_CONTROLLER_OBSERVATION_DOMAIN = 'KerfDesk archived controller observation v1\0';
const MAX_CANONICAL_JSON_DEPTH = 32;

function canonicalJson(
  value: unknown,
  depth = 0,
  ancestors: Set<object> = new Set<object>(),
): string {
  if (depth > MAX_CANONICAL_JSON_DEPTH) throw new Error('Provenance JSON is nested too deeply.');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Provenance JSON contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (typeof value === 'object') return canonicalJsonReference(value, depth + 1, ancestors);
  throw new Error('Provenance JSON contains an unsupported value.');
}

function canonicalJsonReference(value: object, depth: number, ancestors: Set<object>): string {
  if (ancestors.has(value)) throw new Error('Provenance JSON contains a cycle.');
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? canonicalJsonArray(value, depth, ancestors)
      : canonicalJsonObject(value, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJsonArray(
  value: ReadonlyArray<unknown>,
  depth: number,
  ancestors: Set<object>,
): string {
  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new Error('Provenance JSON contains a sparse array.');
    }
    items.push(canonicalJson(value[index], depth, ancestors));
  }
  return `[${items.join(',')}]`;
}

function canonicalJsonObject(value: object, depth: number, ancestors: Set<object>): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Provenance JSON contains a non-plain object.');
  }
  const record = value as Record<string, unknown>;
  const fields: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    // Match JSON object semantics for optional evidence properties.
    if (item === undefined) continue;
    fields.push(`${JSON.stringify(key)}:${canonicalJson(item, depth, ancestors)}`);
  }
  return `{${fields.join(',')}}`;
}

export async function sha256Utf8(value: string): Promise<`sha256:${string}`> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('SHA-256 is unavailable in this runtime.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
