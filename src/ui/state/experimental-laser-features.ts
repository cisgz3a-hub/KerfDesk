import { create } from 'zustand';

export type ExperimentalLaserFeature =
  | 'rotary'
  | 'rotaryRaster'
  | 'lowPowerFire'
  | 'printAndCut'
  | 'cameraAlignmentV2';

export type ExperimentalLaserFeatures = Readonly<Record<ExperimentalLaserFeature, boolean>>;

export const DEFAULT_EXPERIMENTAL_LASER_FEATURES: ExperimentalLaserFeatures = {
  rotary: false,
  rotaryRaster: false,
  lowPowerFire: false,
  printAndCut: false,
  cameraAlignmentV2: false,
};

const STORAGE_KEY = 'kerfdesk.experimental-laser-features.v1';

type ExperimentalLaserFeatureState = {
  readonly features: ExperimentalLaserFeatures;
  readonly setFeature: (feature: ExperimentalLaserFeature, enabled: boolean) => void;
  readonly resetFeatures: () => void;
};

export const useExperimentalLaserFeatures = create<ExperimentalLaserFeatureState>((set) => ({
  features: readExperimentalLaserFeatures(),
  setFeature: (feature, enabled) =>
    set((state) => {
      const features = { ...state.features, [feature]: enabled };
      writeExperimentalLaserFeatures(features);
      return { features };
    }),
  resetFeatures: () => {
    writeExperimentalLaserFeatures(DEFAULT_EXPERIMENTAL_LASER_FEATURES);
    set({ features: DEFAULT_EXPERIMENTAL_LASER_FEATURES });
  },
}));

export function readExperimentalLaserFeatures(
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): ExperimentalLaserFeatures {
  if (storage === null) return DEFAULT_EXPERIMENTAL_LASER_FEATURES;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_EXPERIMENTAL_LASER_FEATURES;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_EXPERIMENTAL_LASER_FEATURES;
    return {
      rotary: parsed['rotary'] === true,
      rotaryRaster: parsed['rotaryRaster'] === true,
      lowPowerFire: parsed['lowPowerFire'] === true,
      printAndCut: parsed['printAndCut'] === true,
      cameraAlignmentV2: parsed['cameraAlignmentV2'] === true,
    };
  } catch {
    return DEFAULT_EXPERIMENTAL_LASER_FEATURES;
  }
}

function writeExperimentalLaserFeatures(
  features: ExperimentalLaserFeatures,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(features));
  } catch {
    // Storage can be unavailable in private or embedded contexts; keep session state.
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
