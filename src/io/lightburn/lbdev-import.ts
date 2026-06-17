import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../../core/devices';

export type LightBurnImportReviewField = {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
};

export type LightBurnDeviceImportReview = {
  readonly kind: 'review';
  readonly canCreateProfile: boolean;
  readonly profile: DeviceProfile;
  readonly applied: ReadonlyArray<LightBurnImportReviewField>;
  readonly needsReview: ReadonlyArray<LightBurnImportReviewField>;
  readonly ignored: ReadonlyArray<LightBurnImportReviewField>;
};

export type LightBurnDeviceImportResult =
  | LightBurnDeviceImportReview
  | { readonly kind: 'unsupported-bundle'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly reason: string };

export type LightBurnDeviceImportOptions = {
  readonly fileName?: string;
};

export function importLightBurnDeviceProfile(
  text: string,
  options: LightBurnDeviceImportOptions = {},
): LightBurnDeviceImportResult {
  if (options.fileName?.toLowerCase().endsWith('.lbzip') === true) {
    return {
      kind: 'unsupported-bundle',
      reason:
        'LightBurn .lbzip bundles are not imported yet. Export a legacy .lbdev device instead.',
    };
  }

  const name = extractFirst(text, ['Name', 'DeviceName', 'DisplayName']) ?? 'Imported LightBurn device';
  const controller = extractFirst(text, ['Controller', 'ControllerType', 'DeviceType', 'Type']);
  const width = parsePositiveNumber(extractFirst(text, ['Width', 'XSize', 'BedWidth', 'WorkWidth']));
  const height = parsePositiveNumber(extractFirst(text, ['Height', 'YSize', 'BedHeight', 'WorkHeight']));
  if (width === null || height === null) {
    return { kind: 'invalid', reason: 'missing bed width or height' };
  }

  const originRaw = extractFirst(text, ['Origin', 'HomeOrigin', 'StartFrom']);
  const origin = mapOrigin(originRaw);
  const maxPowerS = parsePositiveNumber(extractFirst(text, ['SMax', 'MaxS', 'SpindleMax', 'SValueMax']));
  const startScript = extractFirst(text, ['StartScript', 'StartGCode', 'StartMacro']);
  const endScript = extractFirst(text, ['EndScript', 'EndGCode', 'EndMacro']);
  const isGrbl = controller?.toLowerCase().includes('grbl') === true;

  const applied: LightBurnImportReviewField[] = [
    { label: 'Name', value: name },
    ...(isGrbl
      ? [{ label: 'Controller', value: controller ?? 'GRBL', note: 'Mapped as GRBL-compatible.' }]
      : []),
    { label: 'Bed width', value: `${width} mm` },
    { label: 'Bed height', value: `${height} mm` },
  ];
  const needsReview: LightBurnImportReviewField[] = [];
  const ignored: LightBurnImportReviewField[] = [];

  if (!isGrbl) {
    needsReview.push({
      label: 'Controller',
      value: controller ?? 'Unknown',
      note: 'Only GRBL-compatible LightBurn devices can become LaserForge profiles.',
    });
  }
  if (originRaw !== undefined && origin !== null) {
    applied.push({ label: 'Origin', value: originRaw });
  } else if (originRaw !== undefined) {
    needsReview.push({ label: 'Origin', value: originRaw, note: 'Could not map safely.' });
  }
  if (maxPowerS !== null) {
    applied.push({ label: 'Max S', value: String(maxPowerS) });
  } else {
    needsReview.push({
      label: 'Max S',
      value: 'Not detected',
      note: 'LaserForge default $30 range will be used until reviewed.',
    });
  }
  if (startScript !== undefined) {
    ignored.push({
      label: 'Start script',
      value: summarizeMultiline(startScript),
      note: 'Imported profiles never write firmware or run startup scripts automatically.',
    });
  }
  if (endScript !== undefined) {
    ignored.push({
      label: 'End script',
      value: summarizeMultiline(endScript),
      note: 'End scripts are review-only in Machine Setup.',
    });
  }

  const { catalogVersion, ...baseProfile } = DEFAULT_DEVICE_PROFILE;
  void catalogVersion;

  return {
    kind: 'review',
    canCreateProfile: isGrbl,
    profile: {
      ...baseProfile,
      profileId: `lightburn-${slugify(name)}`,
      profileSource: 'lightburn',
      name,
      bedWidth: width,
      bedHeight: height,
      maxPowerS: maxPowerS ?? DEFAULT_DEVICE_PROFILE.maxPowerS,
      origin: origin ?? DEFAULT_DEVICE_PROFILE.origin,
      scanningOffsets: [],
      noGoZones: [],
      evidence: [
        {
          label: 'LightBurn .lbdev import',
          status: 'user-imported',
          note: `Imported from ${options.fileName ?? 'legacy .lbdev text'}; review before first job.`,
        },
      ],
    },
    applied,
    needsReview,
    ignored,
  };
}

function extractFirst(text: string, tags: ReadonlyArray<string>): string | undefined {
  for (const tag of tags) {
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(text);
    if (match?.[1] !== undefined) {
      return decodeXmlEntities(match[1]).trim();
    }
  }
  return undefined;
}

function parsePositiveNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(value);
  if (match === null) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function mapOrigin(value: string | undefined): Origin | null {
  if (value === undefined) return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('frontleft') || normalized.includes('lowerleft')) return 'front-left';
  if (normalized.includes('frontright') || normalized.includes('lowerright')) return 'front-right';
  if (normalized.includes('rearleft') || normalized.includes('upperleft')) return 'rear-left';
  if (normalized.includes('rearright') || normalized.includes('upperright')) return 'rear-right';
  if (normalized.includes('center') || normalized.includes('centre')) return 'center';
  return null;
}

function summarizeMultiline(value: string): string {
  const compact = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('; ');
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'device';
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
