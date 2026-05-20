export type DxfUnitMode = 'mm' | 'cm' | 'm' | 'inch' | 'foot';

export type DxfUnitChoiceValue = DxfUnitMode | 'cancel';

export interface DxfUnitChoiceOption {
  value: DxfUnitChoiceValue;
  label: string;
  primary?: boolean;
  color?: string;
}

export interface DxfUnitModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DxfUnitInfo {
  source: 'header' | 'unitless' | 'missing' | 'unsupported';
  insunitsCode: number | null;
  unit: DxfUnitMode | null;
  scaleToMm: number;
  label: string;
}

export type DxfUnitChoiceDialog = (
  title: string,
  message: string,
  choices: readonly DxfUnitChoiceOption[],
  details?: string,
) => Promise<string | null>;

export const DXF_UNIT_MODE_PREFERENCE_KEY = 'laserforge.dxfUnitMode';

const UNIT_SCALES_MM: Record<DxfUnitMode, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  inch: 25.4,
  foot: 304.8,
};

const INSUNITS_TO_MODE: Record<number, DxfUnitMode> = {
  1: 'inch',
  2: 'foot',
  4: 'mm',
  5: 'cm',
  6: 'm',
};

const UNIT_LABELS: Record<DxfUnitMode, string> = {
  mm: 'Millimeters',
  cm: 'Centimeters',
  m: 'Meters',
  inch: 'Inches',
  foot: 'Feet',
};

function getBrowserStorage(): DxfUnitModeStorage | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function isDxfUnitMode(value: string | null): value is DxfUnitMode {
  return value === 'mm' || value === 'cm' || value === 'm' || value === 'inch' || value === 'foot';
}

export function getStoredDxfUnitMode(storage: DxfUnitModeStorage | null = getBrowserStorage()): DxfUnitMode {
  const stored = storage?.getItem(DXF_UNIT_MODE_PREFERENCE_KEY) ?? null;
  return isDxfUnitMode(stored) ? stored : 'mm';
}

export function setStoredDxfUnitMode(mode: DxfUnitMode, storage: DxfUnitModeStorage | null = getBrowserStorage()): void {
  try {
    storage?.setItem(DXF_UNIT_MODE_PREFERENCE_KEY, mode);
  } catch {
    // Preference persistence must not block import.
  }
}

export function dxfUnitScaleToMm(mode: DxfUnitMode): number {
  return UNIT_SCALES_MM[mode];
}

function infoForCode(code: number | null): DxfUnitInfo {
  if (code == null) {
    return {
      source: 'missing',
      insunitsCode: null,
      unit: null,
      scaleToMm: 1,
      label: 'Missing $INSUNITS',
    };
  }
  if (code === 0) {
    return {
      source: 'unitless',
      insunitsCode: 0,
      unit: null,
      scaleToMm: 1,
      label: 'Unitless',
    };
  }
  const unit = INSUNITS_TO_MODE[code] ?? null;
  if (unit == null) {
    return {
      source: 'unsupported',
      insunitsCode: code,
      unit: null,
      scaleToMm: 1,
      label: `Unsupported $INSUNITS=${code}`,
    };
  }
  return {
    source: 'header',
    insunitsCode: code,
    unit,
    scaleToMm: dxfUnitScaleToMm(unit),
    label: UNIT_LABELS[unit],
  };
}

export function parseDxfInsunitsCodeFromText(text: string): number | null {
  const lines = text.split(/\r?\n/);
  let inHeader = false;

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim();
    const value = (lines[i + 1] ?? '').trim();

    if (code === '0' && value === 'SECTION') {
      const nextCode = (lines[i + 2] ?? '').trim();
      const nextValue = (lines[i + 3] ?? '').trim();
      inHeader = nextCode === '2' && nextValue === 'HEADER';
      if (inHeader) {
        i += 2;
      }
      continue;
    }

    if (inHeader && code === '0' && value === 'ENDSEC') {
      break;
    }

    if (inHeader && code === '9' && value.toUpperCase() === '$INSUNITS') {
      const unitCode = (lines[i + 2] ?? '').trim();
      const unitValue = (lines[i + 3] ?? '').trim();
      if (unitCode !== '70') return null;
      const parsed = Number.parseInt(unitValue, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  return null;
}

export function parseDxfUnitInfoFromText(text: string): DxfUnitInfo {
  return infoForCode(parseDxfInsunitsCodeFromText(text));
}

export function resolveDxfUnitScaleToMm(info: DxfUnitInfo, fallbackUnit?: DxfUnitMode | null): number {
  if (info.unit != null) return info.scaleToMm;
  return fallbackUnit ? dxfUnitScaleToMm(fallbackUnit) : 1;
}

function choiceForMode(mode: DxfUnitMode, primary: boolean): DxfUnitChoiceOption {
  return {
    value: mode,
    label: `${UNIT_LABELS[mode]} (${dxfUnitScaleToMm(mode)} mm per unit)`,
    primary,
    color: primary ? '45,212,160' : undefined,
  };
}

export async function chooseDxfUnitModeForImport(
  dxfText: string,
  showChoice: DxfUnitChoiceDialog,
  storage: DxfUnitModeStorage | null = getBrowserStorage(),
): Promise<DxfUnitMode | null> {
  const info = parseDxfUnitInfoFromText(dxfText);
  if (info.unit != null) return info.unit;

  const previous = getStoredDxfUnitMode(storage);
  const candidates: DxfUnitMode[] = [previous, 'mm', 'inch', 'cm'];
  const modes = candidates.filter(
    (mode, index, arr) => arr.indexOf(mode) === index,
  );
  const selected = await showChoice(
    'DXF Size Units',
    'This DXF does not declare supported physical units. Choose how LaserForge should interpret one DXF unit.',
    [
      ...modes.map((mode, index) => choiceForMode(mode, index === 0)),
      { value: 'cancel', label: 'Cancel' },
    ],
    `${info.label}\n\nChoosing the wrong units changes the physical cut size. CAD/laser DXFs are commonly millimeters or inches.`,
  );
  if (!isDxfUnitMode(selected)) return null;

  setStoredDxfUnitMode(selected, storage);
  return selected;
}
