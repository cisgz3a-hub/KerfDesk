import circularFlourish from './assets/openclipart/circular-flourish-by-m1981-optimized.svg?raw';
import flower from './assets/openclipart/flower.svg?raw';
import flowerCluster from './assets/openclipart/flower-cluster.svg?raw';
import guitarFretboard from './assets/openclipart/guitar-fretboard-25-scale.svg?raw';
import laserCutterIcon from './assets/openclipart/laser-cutter-icon.svg?raw';
import laserInUse from './assets/openclipart/laser-in-use.svg?raw';
import petalFlower from './assets/openclipart/petal-flower-with-svg-mask.svg?raw';
import scaryLaser from './assets/openclipart/scary-laser.svg?raw';
import type { LibraryEntry } from './design-library-types';

function cc0Entry(args: {
  readonly id: string;
  readonly title: string;
  readonly subcategory: string;
  readonly tags: ReadonlyArray<string>;
  readonly sourceUrl: string;
  readonly assetHash: string;
  readonly svgText: string;
}): LibraryEntry {
  return {
    id: args.id,
    title: args.title,
    category: 'Decorative Artwork',
    subcategory: args.subcategory,
    kind: 'bundled-artwork',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'fill'],
    tags: args.tags,
    provenance: {
      sourceKind: 'cc0',
      license: 'CC0-1.0 / Public Domain',
      sourceUrl: args.sourceUrl,
      downloadedAt: '2026-07-06',
      assetHash: args.assetHash,
      notice: 'Openclipart states submitted clipart is released to the public domain under CC0.',
    },
    previewSvgText: args.svgText,
    insert: { kind: 'svg', svgText: args.svgText },
  };
}

export const CC0_LIBRARY_ENTRIES: ReadonlyArray<LibraryEntry> = [
  cc0Entry({
    id: 'cc0-laser-cutter-icon',
    title: 'Laser Cutter Icon',
    subcategory: 'Tools & Machines',
    tags: ['laser', 'cutter', 'machine', 'icon'],
    sourceUrl: 'https://openclipart.org/detail/315232/laser-cutter-icon',
    assetHash: 'sha256:97aed71d31ade8f305135b8166c8f68ae6bda479c5eadd2d3d5caa75311dce25',
    svgText: laserCutterIcon,
  }),
  cc0Entry({
    id: 'cc0-laser-in-use',
    title: 'Laser In Use',
    subcategory: 'Signs & Labels',
    tags: ['laser', 'warning', 'sign', 'label'],
    sourceUrl: 'https://openclipart.org/detail/215782/laser-in-use',
    assetHash: 'sha256:afda4b9826129ac45ccb8c44fe70df37ddf3b8a8f49a5c9b7b3f7c71f3451e8b',
    svgText: laserInUse,
  }),
  cc0Entry({
    id: 'cc0-circular-flourish',
    title: 'Circular Flourish',
    subcategory: 'Decorative Borders',
    tags: ['flourish', 'border', 'ornamental', 'cnc'],
    sourceUrl: 'https://openclipart.org/detail/351224/circular-flourish-by-m1981-optimized',
    assetHash: 'sha256:dcb241479c0deadf1b6faf0a65a55c0c58820da24703878d33d5d275e1e5c42a',
    svgText: circularFlourish,
  }),
  cc0Entry({
    id: 'cc0-scary-laser',
    title: 'Laser Warning Sign',
    subcategory: 'Signs & Labels',
    tags: ['laser', 'warning', 'sign', 'label'],
    sourceUrl: 'https://openclipart.org/detail/20408/scary-laser',
    assetHash: 'sha256:f454f30f95036c974b0c35fa05b09f645300377f17ea71308c2a7c5dbc5caa51',
    svgText: scaryLaser,
  }),
  cc0Entry({
    id: 'cc0-petal-flower',
    title: 'Petal Flower',
    subcategory: 'Nature',
    tags: ['flower', 'petal', 'nature', 'floral'],
    sourceUrl: 'https://openclipart.org/detail/295526/petal-flower-with-svg-mask',
    assetHash: 'sha256:e6ca3e8eb867bcf3dd698253e5e789828a407144044e2610a3571e33c264882c',
    svgText: petalFlower,
  }),
  cc0Entry({
    id: 'cc0-flower-cluster',
    title: 'Flower Cluster',
    subcategory: 'Nature',
    tags: ['flower', 'cluster', 'nature', 'floral'],
    sourceUrl: 'https://openclipart.org/detail/122221/flower-cluster',
    assetHash: 'sha256:098eb30cf383057318e0297ab4f8d705b9d6d4596442a30fba22fc1f8b20fc5b',
    svgText: flowerCluster,
  }),
  cc0Entry({
    id: 'cc0-flower',
    title: 'Flower',
    subcategory: 'Nature',
    tags: ['flower', 'top-view', 'nature', 'landscape'],
    sourceUrl: 'https://openclipart.org/detail/338382/flower',
    assetHash: 'sha256:aff78b765c5b06c65874de45a1d0ea8503f4a06e95575264d6bb00d2b0e2c492',
    svgText: flower,
  }),
  cc0Entry({
    id: 'cc0-guitar-fretboard-25-scale',
    title: 'Guitar Fretboard 25 Scale',
    subcategory: 'Hobby & Travel',
    tags: ['guitar', 'fretboard', 'cnc', 'woodworking'],
    sourceUrl: 'https://openclipart.org/detail/289994/guitar-fretboard-25-scale',
    assetHash: 'sha256:9392c3f9ba6cc20f17b9470536f0faf45b9f4fdc08d407c77188c30185f8a32e',
    svgText: guitarFretboard,
  }),
];
