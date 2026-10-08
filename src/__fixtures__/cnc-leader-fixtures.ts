import {
  createProject,
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type ImportedSvg,
  type Polyline,
  type CncLayerSettings,
} from '../core/scene';
import type { CncTool } from '../core/scene/cnc-tool';
import { defaultCncMachiningSetup } from '../core/scene/cnc-machining-setup';
import { DEFAULT_CNC_TAPERED_INLAY } from '../core/scene/cnc-tapered-inlay';
import { defaultConstrainedSketch } from '../core/sketch-constraints/default-constrained-sketch';
import { materializeConstrainedSketch } from '../core/sketch-constraints/materialize-constrained-sketch';
export const BENCHMARK_TOOLS: readonly CncTool[] = [
  {
    id: 'end6',
    name: 'End mill 6',
    kind: 'end-mill',
    diameterMm: 6,
    fluteCount: 2,
    fluteLengthMm: 15,
    stickoutMm: 24,
    shankDiameterMm: 6,
    holderSegments: [{ name: 'Holder', startMm: 24, lengthMm: 20, diameterMm: 28 }],
  },
  {
    id: 'end2',
    name: 'End mill 2',
    kind: 'end-mill',
    diameterMm: 2,
    fluteLengthMm: 6,
    stickoutMm: 10,
    shankDiameterMm: 3,
  },
  { id: 'v60', name: 'Pointed V60', kind: 'v-bit', diameterMm: 6, tipAngleDeg: 60 },
  { id: 'ball2', name: 'Ball nose 2', kind: 'ball-nose', diameterMm: 2 },
  { id: 'ball1', name: 'Ball nose 1', kind: 'ball-nose', diameterMm: 1 },
];
export function benchmarkProject(): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, origin: 'rear-left' },
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: 'end6',
      tools: BENCHMARK_TOOLS,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, widthMm: 100, heightMm: 80, thicknessMm: 12 },
    },
    cncSetup: defaultCncMachiningSetup(),
    scene: { objects: [], layers: [] },
  };
}
export function benchmarkRectangle(x: number, y: number, w: number, h: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}
export function benchmarkVector(
  id: string,
  polylines: readonly Polyline[],
  operations: readonly string[],
): ImportedSvg {
  const points = polylines.flatMap((p) => p.points);
  return {
    kind: 'imported-svg',
    id,
    source: 'Analytical ' + id,
    operationIds: operations,
    transform: IDENTITY_TRANSFORM,
    bounds: {
      minX: Math.min(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxX: Math.max(...points.map((p) => p.x)),
      maxY: Math.max(...points.map((p) => p.y)),
    },
    paths: [{ color: '#000000', operationIds: operations, polylines }],
  };
}
export function benchmarkLayer(id: string, settings: Partial<CncLayerSettings>) {
  return {
    ...createLayer({
      id,
      color:
        '#' +
        Array.from(id)
          .reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 0xffffff, 1)
          .toString(16)
          .padStart(6, '0'),
    }),
    name: id,
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: 'end6',
      depthMm: 2,
      depthPerPassMm: 1,
      feedMmPerMin: 600,
      plungeMmPerMin: 150,
      spindleRpm: 12000,
      tabsEnabled: false,
      profileLead: { shape: 'none' as const },
      ...settings,
    },
  };
}
export function signBenchmark(): Project {
  const base = benchmarkProject();
  const letter: Polyline = {
    closed: true,
    points: [
      { x: 20, y: 20 },
      { x: 24, y: 20 },
      { x: 24, y: 32 },
      { x: 31, y: 32 },
      { x: 31, y: 36 },
      { x: 20, y: 36 },
    ],
  };
  return {
    ...base,
    scene: {
      layers: [
        benchmarkLayer('letter-v-carve', {
          cutType: 'v-carve',
          toolId: 'v60',
          depthMm: 1,
          vResolutionMm: 0.3,
        }),
        benchmarkLayer('release-profile', {
          cutType: 'profile-outside',
          tabsEnabled: true,
          tabHeightMm: 1,
          tabWidthMm: 4,
          tabsPerShape: 3,
        }),
      ],
      objects: [
        benchmarkVector('letter', [letter], ['letter-v-carve']),
        benchmarkVector(
          'sign-board',
          [benchmarkRectangle(10, 10, 40, 35), benchmarkRectangle(13, 13, 4, 4)],
          ['release-profile'],
        ),
      ],
    },
  };
}
export function inlayBenchmarks(): readonly {
  readonly variant: string;
  readonly project: Project;
}[] {
  const base = benchmarkProject(),
    source = benchmarkVector('coupon', [benchmarkRectangle(10, 10, 6, 6)], ['inlay']);
  const common = benchmarkLayer('inlay', {
    cutType: 'inlay-pair',
    toolId: 'v60',
    depthPerPassMm: 0.25,
    vResolutionMm: 0.2,
  });
  const intent = {
    ...DEFAULT_CNC_TAPERED_INLAY,
    pocketDepthMm: 0.7,
    engagementDepthMm: 0.5,
    glueGapMm: 0.2,
    surfaceClearanceMm: 0.3,
    plugBorderMm: 1,
    pairSpacingMm: 8,
  };
  return [
    {
      variant: 'straight',
      project: {
        ...base,
        scene: {
          layers: [{ ...common, cnc: { ...common.cnc, toolId: 'end2', depthMm: 1 } }],
          objects: [source],
        },
      },
    },
    {
      variant: 'tapered-v',
      project: {
        ...base,
        scene: {
          layers: [{ ...common, cnc: { ...common.cnc, taperedInlay: intent } }],
          objects: [source],
        },
      },
    },
  ];
}
export function reachBenchmark(): Project {
  const base = benchmarkProject();
  return {
    ...base,
    cncSetup: {
      ...defaultCncMachiningSetup(),
      fixtures: [
        {
          id: 'clamp',
          name: 'Raised clamp',
          xMm: 18,
          yMm: 20,
          widthMm: 8,
          heightMm: 8,
          bottomZMm: 0,
          topZMm: 22,
        },
      ],
    },
    scene: {
      layers: [
        benchmarkLayer('long-assembly', {
          cutType: 'profile-on-path',
          toolId: 'end6',
          depthMm: 12,
          depthPerPassMm: 4,
        }),
        benchmarkLayer('short-assembly', {
          cutType: 'profile-on-path',
          toolId: 'end2',
          depthMm: 12,
          depthPerPassMm: 4,
        }),
      ],
      objects: [
        benchmarkVector(
          'long-line',
          [
            {
              closed: false,
              points: [
                { x: 10, y: 24 },
                { x: 35, y: 24 },
              ],
            },
          ],
          ['long-assembly'],
        ),
        benchmarkVector(
          'short-line',
          [
            {
              closed: false,
              points: [
                { x: 10, y: 26 },
                { x: 35, y: 26 },
              ],
            },
          ],
          ['short-assembly'],
        ),
      ],
    },
  };
}
export function twoSidedBenchmark(): readonly {
  readonly variant: string;
  readonly project: Project;
}[] {
  const base = benchmarkProject(),
    source = benchmarkVector(
      'asymmetric',
      [benchmarkRectangle(13, 18, 21, 12), benchmarkRectangle(18, 21, 3, 2)],
      ['profile'],
    );
  const setup = {
    ...defaultCncMachiningSetup(),
    twoSided: {
      activeSide: 'A' as const,
      flipAxis: 'y' as const,
      sideBStockOriginMm: { x: 4, y: 7 },
      sideAObjectIds: [source.id],
      sideBObjectIds: [source.id],
      registration: [
        { id: 'pin', name: 'Registration pin', stockXMm: 13, stockYMm: 8, diameterMm: 4 },
      ],
    },
  };
  const project = {
    ...base,
    cncSetup: setup,
    scene: {
      layers: [benchmarkLayer('profile', { cutType: 'profile-on-path' })],
      objects: [source],
    },
  };
  return [
    { variant: 'side-A', project },
    {
      variant: 'side-B',
      project: {
        ...project,
        cncSetup: { ...setup, twoSided: { ...setup.twoSided, activeSide: 'B' } },
      },
    },
  ];
}
export function sketchBenchmarks(): readonly {
  readonly variant: string;
  readonly project: Project;
}[] {
  return [60, 75].map((width) => {
    const base = benchmarkProject(),
      draft = defaultConstrainedSketch();
    const built = materializeConstrainedSketch(
      {
        ...draft,
        parameters: draft.parameters.map((p) => (p.name === 'width' ? { ...p, value: width } : p)),
      },
      '#000000',
    );
    if (built.paths === undefined || built.bounds === undefined || built.result.kind !== 'solved')
      throw new Error('Analytical sketch did not solve.');
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'bracket',
      source: 'Constrained bracket',
      transform: IDENTITY_TRANSFORM,
      bounds: built.bounds,
      paths: built.paths.map((p, i) => ({ ...p, operationIds: [i === 0 ? 'release' : 'holes'] })),
      constrainedSketch: built.result.sketch,
    };
    return {
      variant: 'width-' + width,
      project: {
        ...base,
        scene: {
          layers: [
            benchmarkLayer('holes', { cutType: 'profile-on-path', toolId: 'end2', depthMm: 1 }),
            benchmarkLayer('release', { cutType: 'profile-outside', toolId: 'end2' }),
          ],
          objects: [object],
        },
      },
    };
  });
}
