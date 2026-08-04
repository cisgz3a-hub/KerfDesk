import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectLayerContours,
  layerPolylinesFromContours,
} from '../../core/cnc/collect-cnc-contours';
import { runCncCompilationTask } from '../../core/cnc/cnc-compilation-artifact';
import {
  vcarveBoundarySegments,
  vcarveChordInsideRegion,
  vcarveMedialRegionsFromTree,
} from '../../core/cnc/vcarve-medial-region';
import { toMachineCoords } from '../../core/devices';
import { pointInPolygon } from '../../core/geometry';
import {
  normalizeClosedPolylineTreeEvenOddChecked,
  normalizeClosedPolylinesEvenOddChecked,
} from '../../core/geometry/polygon-difference';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type Polyline,
  type Project,
  type TextObject,
} from '../../core/scene';
import { textToPolylines } from '../../core/text';
import { emitPreparedGcode, prepareOutput, type PreparedOutput } from '../../io/gcode';
import { prepareOutputAsync } from '../../io/gcode/prepare-output-async';
import { computeDesignSceneSourceFromPrepared } from './design-scene-source';

const CONNECTED_TEXT = 'Wedding';
const TEXT_SIZE_MM = 40;
const TEXT_COLOR = '#c026d3';
const READY_BOUND_MS = 45_000;
const TEST_TIMEOUT_MS = 120_000;

const VBIT: CncTool = {
  id: 'connected-script-v90',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 3.175,
  tipAngleDeg: 90,
};

const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  stock: {
    ...DEFAULT_CNC_MACHINE_CONFIG.stock,
    widthMm: 250,
    heightMm: 100,
    originOffset: { x: 0, y: 300 },
  },
  tools: [VBIT],
  toolId: VBIT.id,
};

const FONTS = [
  {
    key: 'dancing-script-regular',
    file: 'DancingScript-Regular.ttf',
    expectedRegions: 3,
  },
  { key: 'pacifico-regular', file: 'Pacifico-Regular.ttf', expectedRegions: 2 },
] as const;

type FontFixture = (typeof FONTS)[number];

type ConnectedScriptFixture = {
  readonly project: Project;
  readonly object: TextObject;
  readonly layer: Layer;
};

type ReadyFixture = ConnectedScriptFixture & {
  readonly source: NonNullable<ReturnType<typeof computeDesignSceneSourceFromPrepared>>;
  readonly elapsedMs: number;
};

type SuccessfulPreparedOutput = Extract<PreparedOutput, { readonly ok: true }>;

const projectCache = new Map<string, Promise<ConnectedScriptFixture>>();
const readyCache = new Map<string, Promise<ReadyFixture>>();

function fontBuffer(file: string): ArrayBuffer {
  const bytes = readFileSync(resolve(__dirname, '../text/fonts', file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function connectedScriptProject(font: FontFixture): Promise<ConnectedScriptFixture> {
  const cached = projectCache.get(font.key);
  if (cached !== undefined) return cached;
  const built = buildConnectedScriptProject(font);
  projectCache.set(font.key, built);
  return built;
}

async function buildConnectedScriptProject(font: FontFixture): Promise<ConnectedScriptFixture> {
  return buildTextProject(font, CONNECTED_TEXT, TEXT_SIZE_MM, 'connected');
}

async function buildTextProject(
  font: FontFixture,
  content: string,
  sizeMm: number,
  idPrefix: string,
): Promise<ConnectedScriptFixture> {
  const rendered = await textToPolylines({
    fontBuffer: fontBuffer(font.file),
    content,
    sizeMm,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: TEXT_COLOR,
  });
  const object: TextObject = {
    kind: 'text',
    id: `${idPrefix}-${font.key}`,
    content,
    fontKey: font.key,
    sizeMm,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: TEXT_COLOR,
    bounds: rendered.bounds,
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    paths: rendered.paths,
  };
  const layer: Layer = {
    ...createLayer({ id: 'connected-script-vcarve', color: TEXT_COLOR }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'v-carve',
      toolId: VBIT.id,
      depthMm: 1,
      depthPerPassMm: 1.5,
      vCarveFlatDepthEnabled: false,
      vResolutionMm: 0,
    },
  };
  const project: Project = {
    ...createProject(),
    machine: MACHINE,
    scene: { objects: [object], layers: [layer] },
  };
  return { project, object, layer };
}

function readyFixture(font: FontFixture): Promise<ReadyFixture> {
  const cached = readyCache.get(font.key);
  if (cached !== undefined) return cached;
  const built = buildReadyFixture(font);
  readyCache.set(font.key, built);
  return built;
}

async function buildReadyFixture(font: FontFixture): Promise<ReadyFixture> {
  const fixture = await connectedScriptProject(font);
  const started = performance.now();
  const prepared = await prepareOutputAsync(
    fixture.project,
    { outputScope: DEFAULT_OUTPUT_SCOPE },
    {
      jobId: `connected-script-${font.key}`,
      runCncTasks: async ({ jobId, tasks }) =>
        tasks.map((task) => ({
          jobId,
          taskId: task.taskId,
          result: runCncCompilationTask(task.payload),
        })),
    },
  );
  const source = computeDesignSceneSourceFromPrepared(fixture.project, prepared);
  const elapsedMs = performance.now() - started;
  if (source === null) throw new Error(`${font.key} did not become ready for the G-code 3D pane.`);
  return { ...fixture, source, elapsedMs };
}

function requirePrepared(prepared: PreparedOutput): SuccessfulPreparedOutput {
  if (prepared.ok) return prepared;
  throw new Error(`Connected-script preparation failed: ${JSON.stringify(prepared.preflight)}`);
}

function normalizedFixtureGeometry(fixture: ConnectedScriptFixture) {
  const raw = collectLayerContours(
    fixture.project.scene.objects,
    fixture.layer,
    fixture.project.device,
  );
  const merged = layerPolylinesFromContours(fixture.layer, raw);
  const tree = normalizeClosedPolylineTreeEvenOddChecked(merged);
  const rawEvenOdd = normalizeClosedPolylinesEvenOddChecked(raw.map(({ polyline }) => polyline));
  const mergedEvenOdd = normalizeClosedPolylinesEvenOddChecked(merged);
  if (tree.kind !== 'ok' || rawEvenOdd.kind !== 'ok' || mergedEvenOdd.kind !== 'ok') {
    throw new Error('Connected-script fixture did not normalize.');
  }
  return {
    rawEvenOdd: rawEvenOdd.value,
    mergedEvenOdd: mergedEvenOdd.value,
    regions: vcarveMedialRegionsFromTree(tree.value),
  };
}

function pointInFilledContours(
  point: { readonly x: number; readonly y: number },
  contours: ReadonlyArray<Polyline>,
): boolean {
  return contours.reduce(
    (inside, contour) => (pointInPolygon(point, contour.points) ? !inside : inside),
    false,
  );
}

describe('G-code 3D readiness for connected script TextObjects', () => {
  it(
    'finishes Dancing Script and Pacifico production preparation within a bounded time',
    async () => {
      for (const font of FONTS) {
        const ready = await readyFixture(font);
        const geometry = normalizedFixtureGeometry(ready);

        expect(geometry.regions).toHaveLength(font.expectedRegions);
        expect(ready.source.moves.length).toBeGreaterThan(0);
        expect(ready.source.moves.some((move) => move.kind === 'cut')).toBe(true);
        expect(
          ready.source.moves.every((move) =>
            move.points.every(
              (point) =>
                Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
            ),
          ),
        ).toBe(true);
        expect(ready.source.grid.depth.some((depth) => depth < 0)).toBe(true);
        expect(
          ready.elapsedMs,
          `${font.key} G-code 3D preparation took ${ready.elapsedMs.toFixed(1)} ms`,
        ).toBeLessThan(READY_BOUND_MS);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'keeps Pacifico output byte-deterministic and every emitted V-carve chord contained',
    async () => {
      const fixture = await buildTextProject(FONTS[1], 'We', TEXT_SIZE_MM, 'compact');
      const first = requirePrepared(
        prepareOutput(fixture.project, { outputScope: DEFAULT_OUTPUT_SCOPE }),
      );
      const second = requirePrepared(
        prepareOutput(fixture.project, { outputScope: DEFAULT_OUTPUT_SCOPE }),
      );
      const firstGcode = emitPreparedGcode(first).gcode;
      const secondGcode = emitPreparedGcode(second).gcode;

      expect(firstGcode.length).toBeGreaterThan(0);
      expect(secondGcode).toBe(firstGcode);

      const geometry = normalizedFixtureGeometry(fixture);
      expect(geometry.regions.some((region) => region.holes.length > 0)).toBe(true);
      const segmentSets = geometry.regions.map((region) => vcarveBoundarySegments(region));
      const passes = first.job.groups.flatMap((group) =>
        group.kind === 'cnc' ? group.passes.filter((pass) => pass.kind === 'path3d') : [],
      );
      expect(passes.length).toBeGreaterThan(0);
      const checked = new Set<string>();
      for (const pass of passes) {
        for (let index = 1; index < pass.points.length; index += 1) {
          const from = pass.points[index - 1];
          const to = pass.points[index];
          if (from === undefined || to === undefined) continue;
          const key = `${from.x},${from.y}:${to.x},${to.y}`;
          if (checked.has(key)) continue;
          checked.add(key);
          expect(
            geometry.regions.some((region, regionIndex) =>
              vcarveChordInsideRegion(from, to, region, segmentSets[regionIndex] ?? []),
            ),
            `emitted chord escaped every Pacifico region: ${key}`,
          ).toBe(true);
        }
      }
      expect(checked.size).toBeGreaterThan(100);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'removes Pacifico overlap lenses instead of dropping connected letter joins',
    async () => {
      const ready = await readyFixture(FONTS[1]);
      const geometry = normalizedFixtureGeometry(ready);
      const { grid } = ready.source;
      const minX = ready.object.transform.x + ready.object.bounds.minX;
      const maxX = ready.object.transform.x + ready.object.bounds.maxX;
      const minY = ready.object.transform.y + ready.object.bounds.minY;
      const maxY = ready.object.transform.y + ready.object.bounds.maxY;
      let overlapCells = 0;
      let carvedCells = 0;

      for (let cy = 0; cy < grid.heightCells; cy += 1) {
        const y = grid.originY + (cy + 0.5) * grid.mmPerCell;
        if (y < minY || y > maxY) continue;
        for (let cx = 0; cx < grid.widthCells; cx += 1) {
          const x = grid.originX + (cx + 0.5) * grid.mmPerCell;
          if (x < minX || x > maxX) continue;
          const machinePoint = toMachineCoords({ x, y }, ready.project.device);
          if (
            !pointInFilledContours(machinePoint, geometry.mergedEvenOdd) ||
            pointInFilledContours(machinePoint, geometry.rawEvenOdd)
          ) {
            continue;
          }
          overlapCells += 1;
          if ((grid.depth[cy * grid.widthCells + cx] ?? 0) < 0) carvedCells += 1;
        }
      }

      expect(overlapCells).toBeGreaterThan(20);
      expect(carvedCells / overlapCells).toBeGreaterThan(0.9);
    },
    TEST_TIMEOUT_MS,
  );
});
