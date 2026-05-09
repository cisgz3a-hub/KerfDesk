import { type Scene } from '../core/scene/Scene';
import { createLayer } from '../core/scene/Layer';
import { createRect } from '../core/scene/SceneObject';

export const FIRST_RUN_GUIDE_STORAGE_KEY = 'laserforge_first_run_guide_complete';

export type FirstRunGuideStepId =
  | 'place-scrap'
  | 'focus'
  | 'jog'
  | 'set-origin'
  | 'frame'
  | 'run-test'
  | 'confirm';

export interface FirstRunGuideStep {
  readonly id: FirstRunGuideStepId;
  readonly title: string;
  readonly body: string;
  readonly primaryAction: 'prepare' | 'machine-panel' | 'confirm';
}

export const FIRST_RUN_GUIDE_STEPS: readonly FirstRunGuideStep[] = [
  {
    id: 'place-scrap',
    title: 'Place scrap material',
    body: 'Use a small scrap that can safely take a faint 20 mm square test mark.',
    primaryAction: 'prepare',
  },
  {
    id: 'focus',
    title: 'Focus the laser',
    body: 'Set focus at the material surface before moving or firing the laser.',
    primaryAction: 'machine-panel',
  },
  {
    id: 'jog',
    title: 'Jog to the test spot',
    body: 'Move the laser head to the corner where the square should start.',
    primaryAction: 'machine-panel',
  },
  {
    id: 'set-origin',
    title: 'Set zero point',
    body: 'Save the current head position as the repeatable zero for this test.',
    primaryAction: 'machine-panel',
  },
  {
    id: 'frame',
    title: 'Frame the square',
    body: 'Use Frame to trace the 20 mm square with the laser off before burning.',
    primaryAction: 'machine-panel',
  },
  {
    id: 'run-test',
    title: 'Run the low-power test',
    body: 'Start only after the frame lands fully on the scrap material.',
    primaryAction: 'machine-panel',
  },
  {
    id: 'confirm',
    title: 'Confirm the mark',
    body: 'Check that the square appears where expected before starting real projects.',
    primaryAction: 'confirm',
  },
] as const;

export interface FirstRunGuideStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(storage?: FirstRunGuideStorage): FirstRunGuideStorage | null {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function shouldShowFirstRunGuide(storage?: FirstRunGuideStorage): boolean {
  const resolved = resolveStorage(storage);
  if (!resolved) return true;
  try {
    return resolved.getItem(FIRST_RUN_GUIDE_STORAGE_KEY) !== 'true';
  } catch {
    return true;
  }
}

export function markFirstRunGuideComplete(storage?: FirstRunGuideStorage): void {
  const resolved = resolveStorage(storage);
  if (!resolved) return;
  try {
    resolved.setItem(FIRST_RUN_GUIDE_STORAGE_KEY, 'true');
  } catch {
    /* ignore unavailable storage */
  }
}

export function createFirstRunTestScene(baseScene: Scene): Scene {
  const layer = createLayer(0, 'score', 'First test mark');
  layer.settings.power = { min: 0, max: 8 };
  layer.settings.speed = 1200;
  layer.settings.passes = 1;
  layer.settings.airAssist = false;

  const square = createRect(layer.id, 0, 0, 20, 20, '20 mm first test square');
  return {
    ...baseScene,
    canvas: { ...baseScene.canvas },
    layers: [layer],
    objects: [square],
    material: null,
    activeLayerId: layer.id,
    compileOptions: { ...baseScene.compileOptions, optimizeOrder: true },
    metadata: {
      ...baseScene.metadata,
      name: 'First safe test',
      modified: new Date().toISOString(),
    },
  };
}
