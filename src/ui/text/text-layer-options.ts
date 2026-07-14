import {
  cutTypeLabel,
  DEFAULT_CNC_LAYER_SETTINGS,
  type Layer,
  type MachineConfig,
  type Project,
} from '../../core/scene';
import { defaultCncTextCutType, isTextCutTypeCompatible } from '../common/text-layer-policy';
import type { TextDialogState } from '../state/ui-store';

/* eslint-disable no-restricted-syntax -- These hex values are scene layer data, not UI chrome. */

export type TextLayerNotice = {
  readonly kind: 'error' | 'warning';
  readonly message: string;
};

export type TextLayerOption = {
  readonly color: string;
  readonly label: string;
  readonly summary: string;
  readonly isNew: boolean;
  readonly notice?: TextLayerNotice;
};

const TEXT_LAYER_COLORS = [
  '#000000',
  '#0000ff',
  '#008000',
  '#800080',
  '#ff8c00',
  '#00a0a0',
  '#8b4513',
  '#ff1493',
] as const;

export function nextTextLayerColor(project: Project): string {
  const used = new Set(project.scene.layers.map((layer) => layer.color.toLowerCase()));
  return TEXT_LAYER_COLORS.find((color) => !used.has(color)) ?? generatedColor(used);
}

export function initialTextLayerColor(
  state: TextDialogState,
  project: Project,
  activeLayerColor: string | null,
): string {
  if (state.mode === 'edit') return state.color;
  if (project.machine?.kind === 'cnc') return nextTextLayerColor(project);
  if (
    activeLayerColor !== null &&
    project.scene.layers.some((layer) => layer.color === activeLayerColor)
  ) {
    return activeLayerColor;
  }
  return project.scene.layers[0]?.color ?? nextTextLayerColor(project);
}

export function textLayerOptions(
  project: Project,
  fontKey: string,
  selectedColor?: string,
): ReadonlyArray<TextLayerOption> {
  const existing = project.scene.layers.map((layer, index) =>
    existingLayerOption(layer, index, project.machine, fontKey),
  );
  const newColor =
    selectedColor !== undefined &&
    !project.scene.layers.some((layer) => layer.color === selectedColor)
      ? selectedColor
      : nextTextLayerColor(project);
  return [...existing, newLayerOption(newColor, project.machine, fontKey)];
}

function existingLayerOption(
  layer: Layer,
  index: number,
  machine: MachineConfig | undefined,
  fontKey: string,
): TextLayerOption {
  if (machine?.kind !== 'cnc') {
    return {
      color: layer.color,
      label: `Layer ${index + 1}`,
      summary: `${laserModeLabel(layer.mode)} · ${formatNumber(layer.power)}% power · ${formatNumber(layer.speed)} mm/min`,
      isNew: false,
    };
  }
  const cnc = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const compatible = isTextCutTypeCompatible(fontKey, cnc.cutType);
  const reachesStock = cnc.depthMm >= machine.stock.thicknessMm;
  return {
    color: layer.color,
    label: `Layer ${index + 1}`,
    summary: `${cutTypeLabel(cnc.cutType)} · ${formatNumber(cnc.depthMm)} mm deep`,
    isNew: false,
    ...(!compatible
      ? {
          notice: {
            kind: 'error' as const,
            message: 'Single-line text needs Engrave or Outline — on path.',
          },
        }
      : reachesStock
        ? {
            notice: {
              kind: 'warning' as const,
              message: 'This operation reaches the stock thickness and may cut the text through.',
            },
          }
        : {}),
  };
}

function newLayerOption(
  color: string,
  machine: MachineConfig | undefined,
  fontKey: string,
): TextLayerOption {
  if (machine?.kind !== 'cnc') {
    return {
      color,
      label: 'New text layer',
      summary: 'Line · 30% power · 1500 mm/min',
      isNew: true,
    };
  }
  const cutType = defaultCncTextCutType(machine, fontKey);
  return {
    color,
    label: 'New text layer',
    summary: `${cutTypeLabel(cutType)} · ${formatNumber(DEFAULT_CNC_LAYER_SETTINGS.depthMm)} mm deep`,
    isNew: true,
  };
}

function laserModeLabel(mode: Layer['mode']): string {
  if (mode === 'fill') return 'Fill';
  if (mode === 'image') return 'Image';
  return 'Line';
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function generatedColor(used: ReadonlySet<string>): string {
  for (let hue = 0; hue < 360; hue += 17) {
    const color = hslToHex(hue, 70, 42);
    if (!used.has(color)) return color;
  }
  return '#555555';
}

function hslToHex(h: number, s: number, l: number): string {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return `#${[r, g, b]
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
