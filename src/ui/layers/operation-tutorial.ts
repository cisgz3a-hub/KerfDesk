import type { CncCutType, LayerMode } from '../../core/scene';

const CNC_LESSONS: Readonly<Record<CncCutType, string>> = {
  'profile-outside': 'cnc-profile',
  'profile-inside': 'cnc-profile',
  'profile-on-path': 'cnc-profile',
  pocket: 'cnc-pocket',
  engrave: 'cnc-engrave',
  'v-carve': 'cnc-vcarve',
  'inlay-pair': 'cnc-inlay',
  drill: 'cnc-drill',
  'relief-rough': 'cnc-relief',
  'relief-finish': 'cnc-relief',
};

const LASER_LESSONS: Readonly<Record<LayerMode, string>> = {
  line: 'laser-cut',
  fill: 'laser-fill',
  image: 'laser-image',
};

export function cncOperationTutorial(cutType: CncCutType): string {
  return CNC_LESSONS[cutType];
}

export function laserOperationTutorial(mode: LayerMode): string {
  return LASER_LESSONS[mode];
}
