import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../../core/devices';

export type LightBurnImportReviewRow = {
  readonly label: string;
  readonly value: string;
  readonly note: string;
};

export type LightBurnDeviceImportResult =
  | { readonly kind: 'unsupported-bundle'; readonly message: string }
  | { readonly kind: 'invalid'; readonly reason: string }
  | {
      readonly kind: 'review';
      readonly canCreateProfile: boolean;
      readonly profile: DeviceProfile;
      readonly applied: ReadonlyArray<LightBurnImportReviewRow>;
      readonly needsReview: ReadonlyArray<LightBurnImportReviewRow>;
      readonly ignored: ReadonlyArray<LightBurnImportReviewRow>;
    };

const LBZIP_UNSUPPORTED_MESSAGE =
  'LightBurn .lbzip bundles are not imported yet. Export a legacy single-device .lbdev file for review-first import.';

type LightBurnFields = {
  readonly name: string | null;
  readonly controller: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly origin: Origin | null;
  readonly maxS: number | null;
  readonly autoHome: boolean | null;
  readonly startScript: string | null;
  readonly endScript: string | null;
};

export function importLightBurnDeviceProfile(
  text: string,
  fileName: string,
): LightBurnDeviceImportResult {
  if (isLbzip(text, fileName)) {
    return { kind: 'unsupported-bundle', message: LBZIP_UNSUPPORTED_MESSAGE };
  }

  const document = parseXml(text);
  if (document.kind === 'invalid') {
    return document;
  }

  return buildLightBurnReview(extractFields(document.root), fileName);
}

function extractFields(document: Document): LightBurnFields {
  const getter = fieldGetter(document);
  return {
    name: getter(['Name', 'DeviceName', 'Device']),
    controller: getter(['Controller', 'ControllerType', 'DeviceType']),
    width: parsePositiveNumber(getter(['XSize', 'BedWidth', 'Width', 'XMax'])),
    height: parsePositiveNumber(getter(['YSize', 'BedHeight', 'Height', 'YMax'])),
    origin: parseOrigin(getter(['Origin', 'StartFrom', 'HomeOrigin'])),
    maxS: parsePositiveNumber(getter(['SValueMax', 'MaxS', 'MaxPower', 'SMax'])),
    autoHome: parseBoolean(getter(['AutoHome', 'HomeOnStartup', 'AutoHomeOnStartup'])),
    startScript: getter(['StartScript', 'StartGCode', 'StartGcode']),
    endScript: getter(['EndScript', 'EndGCode', 'EndGcode']),
  };
}

function buildLightBurnReview(
  fields: LightBurnFields,
  fileName: string,
): Extract<LightBurnDeviceImportResult, { readonly kind: 'review' }> {
  const isGrbl = fields.controller === null || /grbl/i.test(fields.controller);
  return {
    kind: 'review',
    canCreateProfile: isGrbl,
    profile: profileFromFields(fields, fileName),
    applied: appliedRows(fields, isGrbl),
    needsReview: needsReviewRows(fields, isGrbl),
    ignored: [
      {
        label: 'LightBurn file',
        value: fileName,
        note: 'Imported as a LaserForge machine profile document, not as a LightBurn project.',
      },
    ],
  };
}

function profileFromFields(fields: LightBurnFields, fileName: string): DeviceProfile {
  const displayName = fields.name ?? stripExtension(fileName);
  const profile: DeviceProfile = {
    ...withoutCatalogVersion(DEFAULT_DEVICE_PROFILE),
    profileId: slugFromName(displayName),
    profileSource: 'imported-lightburn',
    vendor: 'LightBurn import',
    model: displayName,
    name: displayName,
    evidence: [
      {
        label: 'LightBurn .lbdev import',
        status: 'user-imported',
        note: 'Review-first import. LaserForge mapped only GRBL-compatible fields.',
      },
    ],
  };
  return {
    ...profile,
    ...(fields.width !== null ? { bedWidth: fields.width } : {}),
    ...(fields.height !== null ? { bedHeight: fields.height } : {}),
    ...(fields.maxS !== null ? { maxPowerS: fields.maxS } : {}),
    ...(fields.origin !== null ? { origin: fields.origin } : {}),
    ...(fields.autoHome !== null
      ? { homing: { enabled: fields.autoHome, direction: fields.origin ?? profile.origin } }
      : {}),
  };
}

function appliedRows(fields: LightBurnFields, isGrbl: boolean): ReadonlyArray<LightBurnImportReviewRow> {
  return [
    fields.width !== null && fields.height !== null
      ? row('Work area', `${fields.width} x ${fields.height} mm`, 'Mapped to LaserForge bed size.')
      : null,
    fields.maxS !== null ? row('Laser S max', String(fields.maxS), 'Mapped to GRBL max power S value.') : null,
    fields.origin !== null ? row('Origin', fields.origin, 'Mapped to LaserForge machine origin.') : null,
    fields.autoHome !== null
      ? row('Homing', fields.autoHome ? 'enabled' : 'disabled', 'Mapped to profile homing preference only.')
      : null,
    isGrbl && fields.controller !== null
      ? row('Controller', fields.controller, 'Recognized as GRBL-compatible metadata.')
      : null,
  ].filter(isReviewRow);
}

function needsReviewRows(fields: LightBurnFields, isGrbl: boolean): ReadonlyArray<LightBurnImportReviewRow> {
  return [
    !isGrbl ? row('Controller', fields.controller ?? 'unknown', 'LaserForge is GRBL-only for this import path.') : null,
    fields.startScript !== null
      ? row('Start script', fields.startScript, 'Scripts are shown for review but are not imported as firmware writes.')
      : null,
    fields.endScript !== null
      ? row('End script', fields.endScript, 'Scripts are shown for review but are not imported as firmware writes.')
      : null,
  ].filter(isReviewRow);
}

function row(label: string, value: string, note: string): LightBurnImportReviewRow {
  return { label, value, note };
}

function isReviewRow(value: LightBurnImportReviewRow | null): value is LightBurnImportReviewRow {
  return value !== null;
}

function parseXml(
  text: string,
):
  | { readonly kind: 'ok'; readonly root: Document }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (typeof DOMParser === 'undefined') {
    return { kind: 'invalid', reason: 'DOMParser is not available in this runtime' };
  }
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    return { kind: 'invalid', reason: 'malformed LightBurn .lbdev XML' };
  }
  return { kind: 'ok', root: document };
}

function fieldGetter(document: Document): (names: ReadonlyArray<string>) => string | null {
  const elements = Array.from(document.getElementsByTagName('*'));
  return (names) => {
    const lowerNames = names.map((name) => name.toLowerCase());
    const element = elements.find((candidate) =>
      lowerNames.includes(candidate.localName.toLowerCase()),
    );
    const value = element?.textContent?.trim();
    return value === undefined || value === '' ? null : value;
  };
}

function parsePositiveNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBoolean(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return null;
}

function parseOrigin(value: string | null): Origin | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase().replaceAll(/[\s_-]+/g, '-');
  if (normalized.includes('front-left') || normalized === 'lower-left') return 'front-left';
  if (normalized.includes('front-right') || normalized === 'lower-right') return 'front-right';
  if (normalized.includes('rear-left') || normalized === 'upper-left') return 'rear-left';
  if (normalized.includes('rear-right') || normalized === 'upper-right') return 'rear-right';
  if (normalized === 'center' || normalized === 'centre') return 'center';
  return null;
}

function isLbzip(text: string, fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.lbzip') || text.startsWith('PK\x03\x04');
}

function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
  return `lightburn-${slug || 'imported-device'}`;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'Imported LightBurn Device';
}

function withoutCatalogVersion(profile: DeviceProfile): DeviceProfile {
  const { catalogVersion, ...rest } = profile;
  if (catalogVersion === undefined) return rest;
  return rest;
}
