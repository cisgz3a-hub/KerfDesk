import { DOMParser } from '@xmldom/xmldom';
import { type SvgUnitMode, parseLength } from './SvgParser';

export const SVG_UNIT_MODE_PREFERENCE_KEY = 'laserforge.svgUnitMode';

export type SvgUnitChoiceValue = SvgUnitMode | 'cancel';

export interface SvgUnitChoiceOption {
  value: SvgUnitChoiceValue;
  label: string;
  primary?: boolean;
  color?: string;
}

export interface SvgViewBoxOnlyUnitAmbiguity {
  viewBox: { x: number; y: number; width: number; height: number };
  laserConvention: { widthMm: number; heightMm: number };
  svgSpec: { widthMm: number; heightMm: number };
}

export interface SvgUnitChoicePrompt {
  title: string;
  message: string;
  details: string;
  choices: readonly SvgUnitChoiceOption[];
}

export interface SvgUnitModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SvgUnitChoiceDialog = (
  title: string,
  message: string,
  choices: readonly SvgUnitChoiceOption[],
  details?: string,
) => Promise<string | null>;

const PX_TO_MM = 25.4 / 96;

function parseViewBox(value: string | null): SvgViewBoxOnlyUnitAmbiguity['viewBox'] | null {
  if (!value) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function getBrowserStorage(): SvgUnitModeStorage | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function isSvgUnitMode(value: string | null): value is SvgUnitMode {
  return value === 'laser' || value === 'spec';
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function formatSize(widthMm: number, heightMm: number): string {
  return `${formatNumber(widthMm)} x ${formatNumber(heightMm)} mm`;
}

function choiceForMode(mode: SvgUnitMode, ambiguity: SvgViewBoxOnlyUnitAmbiguity, primary: boolean): SvgUnitChoiceOption {
  if (mode === 'laser') {
    return {
      value: 'laser',
      label: `Laser convention (${formatSize(ambiguity.laserConvention.widthMm, ambiguity.laserConvention.heightMm)})`,
      primary,
      color: '34,211,238',
    };
  }

  return {
    value: 'spec',
    label: `SVG spec (${formatSize(ambiguity.svgSpec.widthMm, ambiguity.svgSpec.heightMm)})`,
    primary,
    color: '45,212,160',
  };
}

export function getStoredSvgUnitMode(storage: SvgUnitModeStorage | null = getBrowserStorage()): SvgUnitMode {
  const stored = storage?.getItem(SVG_UNIT_MODE_PREFERENCE_KEY) ?? null;
  return isSvgUnitMode(stored) ? stored : 'laser';
}

export function setStoredSvgUnitMode(mode: SvgUnitMode, storage: SvgUnitModeStorage | null = getBrowserStorage()): void {
  try {
    storage?.setItem(SVG_UNIT_MODE_PREFERENCE_KEY, mode);
  } catch {
    // Storage is a preference only; failed persistence must not block import.
  }
}

export function detectViewBoxOnlySvgUnitAmbiguity(svgString: string): SvgViewBoxOnlyUnitAmbiguity | null {
  if (!svgString.trim()) return null;

  let doc: any;
  try {
    doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  } catch {
    return null;
  }

  const svgRoot = doc.getElementsByTagName('svg')[0];
  if (!svgRoot) return null;

  const viewBox = parseViewBox(svgRoot.getAttribute('viewBox'));
  if (!viewBox) return null;

  const width = parseLength(svgRoot.getAttribute('width'));
  const height = parseLength(svgRoot.getAttribute('height'));
  if (width || height) return null;

  return {
    viewBox,
    laserConvention: {
      widthMm: viewBox.width,
      heightMm: viewBox.height,
    },
    svgSpec: {
      widthMm: viewBox.width * PX_TO_MM,
      heightMm: viewBox.height * PX_TO_MM,
    },
  };
}

export function buildSvgUnitChoicePrompt(
  ambiguity: SvgViewBoxOnlyUnitAmbiguity,
  previousChoice: SvgUnitMode = 'laser',
): SvgUnitChoicePrompt {
  const primary = isSvgUnitMode(previousChoice) ? previousChoice : 'laser';
  const secondary: SvgUnitMode = primary === 'laser' ? 'spec' : 'laser';

  return {
    title: 'SVG Size Units',
    message:
      `This SVG has a ${formatNumber(ambiguity.viewBox.width)} x ${formatNumber(ambiguity.viewBox.height)} ` +
      'viewBox but no explicit width or height. Choose the physical size to import.',
    details:
      `Laser convention: ${formatSize(ambiguity.laserConvention.widthMm, ambiguity.laserConvention.heightMm)}\n` +
      `SVG spec: ${formatSize(ambiguity.svgSpec.widthMm, ambiguity.svgSpec.heightMm)}\n\n` +
      'Laser convention is common for files exported from laser/CAD tools. SVG spec is common for pixel-based artwork.',
    choices: [
      choiceForMode(primary, ambiguity, true),
      choiceForMode(secondary, ambiguity, false),
      { value: 'cancel', label: 'Cancel' },
    ],
  };
}

export async function chooseSvgUnitModeForImport(
  svgString: string,
  showChoice: SvgUnitChoiceDialog,
  storage: SvgUnitModeStorage | null = getBrowserStorage(),
): Promise<SvgUnitMode | null> {
  const previousChoice = getStoredSvgUnitMode(storage);
  const ambiguity = detectViewBoxOnlySvgUnitAmbiguity(svgString);
  if (!ambiguity) return previousChoice;

  const prompt = buildSvgUnitChoicePrompt(ambiguity, previousChoice);
  const selected = await showChoice(prompt.title, prompt.message, prompt.choices, prompt.details);
  if (!isSvgUnitMode(selected)) return null;

  setStoredSvgUnitMode(selected, storage);
  return selected;
}
