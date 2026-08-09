import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CncRestOperation from '../../core/cnc/cnc-rest-operation';
import type * as CompileCncRelief from '../../core/cnc/compile-cnc-relief';
import type { Job } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Project,
  type SceneObject,
} from '../../core/scene';

type RestOperationFixture =
  | { readonly kind: 'not-requested' }
  | { readonly kind: 'ok'; readonly completion: 'pass-limit' };

const restOperation = vi.hoisted(() =>
  vi.fn<() => RestOperationFixture>(() => ({ kind: 'not-requested' })),
);
const sourceReliefDiagnostics = vi.hoisted(() => vi.fn(() => null));

vi.mock('../../core/cnc/cnc-rest-operation', async (importOriginal) => ({
  ...(await importOriginal<typeof CncRestOperation>()),
  resolveRestPocketOperation: restOperation,
}));

vi.mock('../../core/cnc/compile-cnc-relief', async (importOriginal) => ({
  ...(await importOriginal<typeof CompileCncRelief>()),
  reliefOffsetLadderDiagnostics: sourceReliefDiagnostics,
}));

const { detectCncOffsetLadderWarnings } = await import('./cnc-offset-ladder-warnings');

const COLOR = '#ff0000';
const VBIT_90: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

beforeEach(() => {
  restOperation.mockReset();
  restOperation.mockReturnValue({ kind: 'not-requested' });
  sourceReliefDiagnostics.mockReset();
  sourceReliefDiagnostics.mockReturnValue(null);
});

describe('compiled relief offset-ladder warnings', () => {
  it('uses dedicated copy for exact compiled relief ring-cap evidence', () => {
    const warnings = detectCncOffsetLadderWarnings(
      reliefProject(),
      compiledReliefJob([reliefEvidence(0)]),
      'compiled-evidence-only',
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Portrait relief');
    expect(warnings[0]).toContain('Relief roughing');
    expect(warnings[0]).toContain('uncleared core');
    expect(warnings[0]).toContain('larger roughing cutter');
    expect(warnings[0]).not.toContain('more-obtuse');
  });

  it('maps compiled relief offset failure to the existing geometry warning', () => {
    const warnings = detectCncOffsetLadderWarnings(
      reliefProject(),
      compiledReliefJob([{ ...reliefEvidence(0), offsetFailed: true, passLimited: false }]),
      'compiled-evidence-only',
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('could not be fully generated');
    expect(warnings[0]).toContain('Portrait relief');
  });

  it('preserves compiled-only V-carve warning semantics after evidence aggregation', () => {
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [
          {
            operationIndex: 0,
            layerId: 'vcarve-layer',
            entryIssue: null,
            offsetFailed: false,
            thinResidual: true,
            passLimited: true,
          },
        ],
      },
    };

    const warnings = detectCncOffsetLadderWarnings(vcarveProject(), job, 'compiled-evidence-only');

    expect(warnings).toHaveLength(2);
    expect(
      warnings.some((warning) => warning.includes('finer than the generated detail path')),
    ).toBe(true);
    expect(warnings.some((warning) => warning.includes('more-obtuse'))).toBe(true);
  });

  it('deduplicates multiple capped relief operations on the same layer', () => {
    const job = compiledReliefJob([reliefEvidence(0), reliefEvidence(1)]);

    expect(
      detectCncOffsetLadderWarnings(reliefProject(), job, 'compiled-evidence-only'),
    ).toHaveLength(1);
  });

  it('keeps a legacy exact sidecar silent without rebuilding relief geometry', () => {
    const legacy: Job = { groups: [], cncCompilation: { vcarveOperations: [] } };

    expect(
      detectCncOffsetLadderWarnings(reliefProject(), legacy, 'compiled-evidence-only'),
    ).toEqual([]);
    expect(sourceReliefDiagnostics).not.toHaveBeenCalled();
  });

  it('prefers supplied relief evidence in full mode instead of replanning the heightmap', () => {
    expect(
      detectCncOffsetLadderWarnings(reliefProject(), compiledReliefJob([reliefEvidence(0)])),
    ).toHaveLength(1);
    expect(sourceReliefDiagnostics).not.toHaveBeenCalled();
  });

  it('reports rest-pocket and relief limits together on a mixed layer', () => {
    restOperation.mockReturnValue({ kind: 'ok', completion: 'pass-limit' });

    const warnings = detectCncOffsetLadderWarnings(
      mixedProject(),
      compiledReliefJob(
        [{ ...reliefEvidence(0), layerId: 'mixed-layer' }],
        [{ layerId: 'mixed-layer', kind: 'pass-limit' }],
      ),
    );

    expect(warnings).toHaveLength(2);
    expect(warnings.some((warning) => warning.includes('route/ring limits'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('Relief roughing'))).toBe(true);
    expect(sourceReliefDiagnostics).not.toHaveBeenCalled();
  });
});

function reliefProject(): Project {
  const relief: SceneObject = {
    kind: 'relief',
    id: 'relief',
    source: 'relief.stl',
    targetWidthMm: 20,
    reliefDepthMm: 2,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 20, 0, 0, 20, 20, 1, 0, 0, 0, 20, 20, 1, 0, 20, 0],
      emptyCells: 'floor',
    },
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
  return projectWithLayer('relief-layer', 'Portrait relief', [relief]);
}

function vcarveProject(): Project {
  return {
    ...projectWithLayer('vcarve-layer', 'V-carve', []),
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [VBIT_90], toolId: VBIT_90.id },
  };
}

function mixedProject(): Project {
  const square: SceneObject = {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  return projectWithLayer('mixed-layer', 'Mixed layer', [square], 'pocket');
}

function projectWithLayer(
  id: string,
  name: string,
  objects: ReadonlyArray<SceneObject>,
  cutType: 'engrave' | 'pocket' = 'engrave',
): Project {
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects,
      layers: [
        {
          ...createLayer({ id, name, color: COLOR }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType },
        },
      ],
    },
  };
}

function compiledReliefJob(
  entries: ReadonlyArray<{
    readonly layerId: string;
    readonly offsetFailed: boolean;
    readonly passLimited: boolean;
  }>,
  exactVectorDiagnostics: ReadonlyArray<{
    readonly layerId: string;
    readonly kind: 'geometry-failed' | 'pass-limit' | 'thin-detail-dropped';
  }> = [],
): Job {
  const diagnostics = [
    ...exactVectorDiagnostics,
    ...entries.flatMap(({ layerId, offsetFailed, passLimited }) => [
      ...(offsetFailed ? ([{ layerId, kind: 'geometry-failed' }] as const) : []),
      ...(passLimited ? ([{ layerId, kind: 'relief-pass-limit' }] as const) : []),
    ]),
  ];
  const unique = diagnostics.filter(
    (entry, index) =>
      diagnostics.findIndex(
        (candidate) => candidate.layerId === entry.layerId && candidate.kind === entry.kind,
      ) === index,
  );
  return {
    groups: [],
    cncCompilation: { vcarveOperations: [], offsetLadderDiagnostics: unique },
  };
}

function reliefEvidence(operationIndex: number) {
  return {
    operationIndex,
    layerId: 'relief-layer',
    offsetFailed: false,
    passLimited: true,
  } as const;
}
