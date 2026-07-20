import type { ExecutionProvenance, ExecutionProvenanceV2 } from './execution-provenance';
import { hasValidController } from './execution-provenance-controller-validation';
import { hasValidLegacyReview, hasValidV2Review } from './execution-provenance-evidence-validation';
import {
  isBoundedString,
  isOptionalBoundedString,
  isOptionalProfileSource,
  isOptionalUsbId,
  isRecord,
  isSafeNonNegativeInteger,
  isSha256,
} from './execution-provenance-validation-helpers';

export function isExecutionProvenance(value: unknown): value is ExecutionProvenance {
  if (!isRecord(value)) return false;
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== 1 && schemaVersion !== 2) return false;
  if (!hasValidBuild(value['build']) || !hasValidContent(value['content'])) return false;
  if (!hasValidTransport(value['transport']) || !hasValidController(value['controller'])) {
    return false;
  }
  return schemaVersion === 1 ? hasValidV1Envelope(value) : hasValidV2Envelope(value);
}

function hasValidV1Envelope(value: Record<string, unknown>): boolean {
  if (
    value['workflow'] !== undefined ||
    value['envelopeSha256'] !== undefined ||
    value['archivedControllerObservationSha256'] !== undefined
  ) {
    return false;
  }
  return hasValidLegacyReview(value['review']);
}

function hasValidV2Envelope(value: Record<string, unknown>): boolean {
  if (!isSha256(value['envelopeSha256'])) return false;
  const observationSha256 = value['archivedControllerObservationSha256'];
  if (observationSha256 !== undefined && !isSha256(observationSha256)) return false;
  return hasValidV2Review(value as ExecutionProvenanceV2);
}

function hasValidBuild(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['appName', 'appVersion', 'gitSha', 'buildTimeUtc', 'emitterRevision'].every((key) =>
    isBoundedString(value[key], 1),
  );
}

function hasValidContent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isSha256(value['gcodeSha256']) &&
    isSha256(value['canonicalProfileSha256']) &&
    isSafeNonNegativeInteger(value['gcodeUtf8Bytes']) &&
    isSafeNonNegativeInteger(value['canonicalProfileUtf8Bytes']) &&
    isOptionalBoundedString(value['profileId'], 1) &&
    isBoundedString(value['profileName'], 1) &&
    isOptionalProfileSource(value['profileSource']) &&
    isOptionalBoundedString(value['catalogVersion'], 1)
  );
}

function hasValidTransport(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kind = value['kind'];
  if (kind !== 'web-serial' && kind !== 'file-only') return false;
  if (kind === 'file-only') return value['serialPortInfo'] === undefined;
  const serial = value['serialPortInfo'];
  if (serial === undefined) return true;
  if (!isRecord(serial)) return false;
  return (
    isOptionalUsbId(serial['usbVendorId']) &&
    isOptionalUsbId(serial['usbProductId']) &&
    isOptionalBoundedString(serial['bluetoothServiceClassId'], 1, 512)
  );
}
