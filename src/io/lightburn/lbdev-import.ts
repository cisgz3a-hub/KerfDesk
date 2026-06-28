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

type ParsedLightBurnDevice = {
  readonly name: string;
  readonly controller?: string;
  readonly width: number;
  readonly height: number;
  readonly originRaw?: string;
  readonly origin: Origin | null;
  readonly maxPowerS: number | null;
  readonly startScript?: string;
  readonly endScript?: string;
  readonly isGrbl: boolean;
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

  const parsed = parseLightBurnDevice(text);
  if (parsed.kind === 'invalid') return parsed;
  const review = lightBurnReviewFields(parsed.device);

  return {
    kind: 'review',
    canCreateProfile: parsed.device.isGrbl,
    profile: lightBurnProfile(parsed.device, options),
    applied: review.applied,
    needsReview: review.needsReview,
    ignored: review.ignored,
  };
}

function parseLightBurnDevice(
  text: string,
):
  | { readonly kind: 'ok'; readonly device: ParsedLightBurnDevice }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const name =
    extractFirst(text, ['Name', 'DeviceName', 'DisplayName']) ?? 'Imported LightBurn device';
  const controller = extractFirst(text, ['Controller', 'ControllerType', 'DeviceType', 'Type']);
  const width = parsePositiveNumber(
    extractFirst(text, ['Width', 'XSize', 'BedWidth', 'WorkWidth']),
  );
  const height = parsePositiveNumber(
    extractFirst(text, ['Height', 'YSize', 'BedHeight', 'WorkHeight']),
  );
  if (width === null || height === null)
    return { kind: 'invalid', reason: 'missing bed width or height' };
  const originRaw = extractFirst(text, ['Origin', 'HomeOrigin', 'StartFrom']);
  return {
    kind: 'ok',
    device: {
      name,
      ...(controller !== undefined ? { controller } : {}),
      width,
      height,
      ...(originRaw !== undefined ? { originRaw } : {}),
      origin: mapOrigin(originRaw),
      maxPowerS: parsePositiveNumber(
        extractFirst(text, ['SMax', 'MaxS', 'SpindleMax', 'SValueMax']),
      ),
      ...optionalScript(text, 'startScript', ['StartScript', 'StartGCode', 'StartMacro']),
      ...optionalScript(text, 'endScript', ['EndScript', 'EndGCode', 'EndMacro']),
      isGrbl: controller?.toLowerCase().includes('grbl') === true,
    },
  };
}

function lightBurnProfile(
  device: ParsedLightBurnDevice,
  options: LightBurnDeviceImportOptions,
): DeviceProfile {
  const { catalogVersion, ...baseProfile } = DEFAULT_DEVICE_PROFILE;
  void catalogVersion;
  return {
    ...baseProfile,
    profileId: `lightburn-${slugify(device.name)}`,
    profileSource: 'lightburn',
    name: device.name,
    bedWidth: device.width,
    bedHeight: device.height,
    maxPowerS: device.maxPowerS ?? DEFAULT_DEVICE_PROFILE.maxPowerS,
    origin: device.origin ?? DEFAULT_DEVICE_PROFILE.origin,
    scanningOffsets: [],
    noGoZones: [],
    evidence: [
      {
        label: 'LightBurn .lbdev import',
        status: 'user-imported',
        note: `Imported from ${options.fileName ?? 'legacy .lbdev text'}; review before first job.`,
      },
    ],
  };
}

function lightBurnReviewFields(device: ParsedLightBurnDevice): {
  readonly applied: ReadonlyArray<LightBurnImportReviewField>;
  readonly needsReview: ReadonlyArray<LightBurnImportReviewField>;
  readonly ignored: ReadonlyArray<LightBurnImportReviewField>;
} {
  return {
    applied: appliedLightBurnFields(device),
    needsReview: reviewLightBurnFields(device),
    ignored: ignoredLightBurnFields(device),
  };
}

function appliedLightBurnFields(device: ParsedLightBurnDevice): LightBurnImportReviewField[] {
  return [
    { label: 'Name', value: device.name },
    ...(device.isGrbl
      ? [
          {
            label: 'Controller',
            value: device.controller ?? 'GRBL',
            note: 'Mapped as GRBL-compatible.',
          },
        ]
      : []),
    { label: 'Bed width', value: `${device.width} mm` },
    { label: 'Bed height', value: `${device.height} mm` },
    ...(device.originRaw !== undefined && device.origin !== null
      ? [{ label: 'Origin', value: device.originRaw }]
      : []),
    ...(device.maxPowerS !== null ? [{ label: 'Max S', value: String(device.maxPowerS) }] : []),
  ];
}

function reviewLightBurnFields(device: ParsedLightBurnDevice): LightBurnImportReviewField[] {
  return [...controllerReview(device), ...originReview(device), ...maxPowerReview(device)];
}

function controllerReview(device: ParsedLightBurnDevice): LightBurnImportReviewField[] {
  if (device.isGrbl) return [];
  return [
    {
      label: 'Controller',
      value: device.controller ?? 'Unknown',
      note: 'Only GRBL-compatible LightBurn devices can become KerfDesk profiles.',
    },
  ];
}

function originReview(device: ParsedLightBurnDevice): LightBurnImportReviewField[] {
  if (device.originRaw === undefined || device.origin !== null) return [];
  return [{ label: 'Origin', value: device.originRaw, note: 'Could not map safely.' }];
}

function maxPowerReview(device: ParsedLightBurnDevice): LightBurnImportReviewField[] {
  if (device.maxPowerS !== null) return [];
  return [
    {
      label: 'Max S',
      value: 'Not detected',
      note: 'KerfDesk default $30 range will be used until reviewed.',
    },
  ];
}

function ignoredLightBurnFields(device: ParsedLightBurnDevice): LightBurnImportReviewField[] {
  return [
    ...scriptReview(
      'Start script',
      device.startScript,
      'Imported profiles never write firmware or run startup scripts automatically.',
    ),
    ...scriptReview(
      'End script',
      device.endScript,
      'End scripts are review-only in Machine Setup.',
    ),
  ];
}

function scriptReview(
  label: string,
  script: string | undefined,
  note: string,
): LightBurnImportReviewField[] {
  return script === undefined ? [] : [{ label, value: summarizeMultiline(script), note }];
}

function optionalScript(
  text: string,
  key: 'startScript' | 'endScript',
  tags: ReadonlyArray<string>,
): Pick<ParsedLightBurnDevice, 'startScript' | 'endScript'> {
  const script = extractFirst(text, tags);
  if (script === undefined) return {};
  return key === 'startScript' ? { startScript: script } : { endScript: script };
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
