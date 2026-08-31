import {
  resolveGrblDialect,
  type DeviceProfile,
  type GrblGcodeDialect,
  type GrblPowerMode,
} from '../devices';
import type { CutGroup, FillGroup, Job } from '../job';

export type LaserPowerModeWord = 'M3' | 'M4';

export type LaserJobPowerModeWords = {
  readonly cut: ReadonlyArray<LaserPowerModeWord>;
  readonly fill: ReadonlyArray<LaserPowerModeWord>;
  readonly raster: ReadonlyArray<LaserPowerModeWord>;
};

export function laserModeWord(mode: GrblPowerMode): LaserPowerModeWord {
  return mode === 'dynamic' ? 'M4' : 'M3';
}

// The effective M3/M4 word for a vector group: per-layer override first, then
// the dialect's per-kind default. Emission and provenance share this owner.
export function vectorPowerWord(
  group: CutGroup | FillGroup,
  dialect: GrblGcodeDialect,
): LaserPowerModeWord {
  if (group.powerMode !== undefined) return laserModeWord(group.powerMode);
  if (group.kind === 'fill') return laserModeWord(dialect.fillPowerMode);
  return laserModeWord(dialect.cutPowerMode);
}

/** Exact operation-family power words consumed by the compiled laser job. */
export function grblPowerModeWordsForJob(job: Job, device: DeviceProfile): LaserJobPowerModeWords {
  const dialect = resolveGrblDialect(device);
  const words: Record<keyof LaserJobPowerModeWords, Array<LaserPowerModeWord>> = {
    cut: [],
    fill: [],
    raster: [],
  };
  for (const group of job.groups) {
    if (group.kind === 'cut' || group.kind === 'fill') {
      addPowerModeWord(words[group.kind], vectorPowerWord(group, dialect));
    } else if (group.kind === 'raster') {
      addPowerModeWord(words.raster, laserModeWord(dialect.rasterPowerMode));
    }
  }
  return words;
}

function addPowerModeWord(words: Array<LaserPowerModeWord>, word: LaserPowerModeWord): void {
  if (!words.includes(word)) words.push(word);
}
