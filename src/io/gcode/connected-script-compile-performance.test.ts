import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { connectedScriptCompilationProject } from '../../__fixtures__/connected-script-compilation-project';
import type {
  asVCarveBoundarySegmentIndex,
  buildVCarveBoundarySegmentIndex,
  everyVCarveBoundarySegmentInBox,
  minimumVCarveBoundaryChordDistance,
  minimumVCarveBoundaryPointDistance,
  someVCarveBoundarySegmentInBox,
} from '../../core/cnc/vcarve-boundary-segment-index';
import {
  logCompilationProfile,
  profileConnectedScriptCompilation,
  profileGcodeEmission,
  type CompilationProfile,
  type EmissionProfile,
} from './connected-script-compile-performance.test-helper';

type AsBoundaryIndex = typeof asVCarveBoundarySegmentIndex;
type BuildBoundaryIndex = typeof buildVCarveBoundarySegmentIndex;
type EveryBoundarySegment = typeof everyVCarveBoundarySegmentInBox;
type MinimumChordDistance = typeof minimumVCarveBoundaryChordDistance;
type MinimumPointDistance = typeof minimumVCarveBoundaryPointDistance;
type SomeBoundarySegment = typeof someVCarveBoundarySegmentInBox;
type BoundaryIndexModule = Readonly<Record<string, unknown>> & {
  readonly asVCarveBoundarySegmentIndex: AsBoundaryIndex;
  readonly buildVCarveBoundarySegmentIndex: BuildBoundaryIndex;
  readonly everyVCarveBoundarySegmentInBox: EveryBoundarySegment;
  readonly minimumVCarveBoundaryChordDistance: MinimumChordDistance;
  readonly minimumVCarveBoundaryPointDistance: MinimumPointDistance;
  readonly someVCarveBoundarySegmentInBox: SomeBoundarySegment;
};

const boundaryIndexProbe = vi.hoisted(() => ({
  arrayConversions: 0,
  arrayQuerySources: 0,
  explicitBuilds: 0,
}));

vi.mock('../../core/cnc/vcarve-boundary-segment-index', async (importOriginal) => {
  // Vitest cannot infer an asynchronously imported mock's exports; bind the
  // runtime module to the exact production function types used by this probe.
  return instrumentBoundaryIndexModule((await importOriginal()) as BoundaryIndexModule);
});

function instrumentBoundaryIndexModule(actual: BoundaryIndexModule): BoundaryIndexModule {
  return {
    ...actual,
    ...boundaryIndexConstructionWrappers(actual),
    ...boundaryIndexQueryWrappers(actual),
  };
}

function boundaryIndexConstructionWrappers(actual: BoundaryIndexModule) {
  const asBoundaryIndex: AsBoundaryIndex = (source) => {
    if (Array.isArray(source)) boundaryIndexProbe.arrayConversions += 1;
    return actual.asVCarveBoundarySegmentIndex(source);
  };
  const buildBoundaryIndex: BuildBoundaryIndex = (segments) => {
    boundaryIndexProbe.explicitBuilds += 1;
    return actual.buildVCarveBoundarySegmentIndex(segments);
  };
  return {
    asVCarveBoundarySegmentIndex: asBoundaryIndex,
    buildVCarveBoundarySegmentIndex: buildBoundaryIndex,
  };
}

function boundaryIndexQueryWrappers(actual: BoundaryIndexModule) {
  const everyBoundarySegment: EveryBoundarySegment = (source, box, predicate) => {
    recordBoundaryArraySource(source);
    return actual.everyVCarveBoundarySegmentInBox(source, box, predicate);
  };
  const minimumChordDistance: MinimumChordDistance = (source, a, b) => {
    recordBoundaryArraySource(source);
    return actual.minimumVCarveBoundaryChordDistance(source, a, b);
  };
  const minimumPointDistance: MinimumPointDistance = (source, point) => {
    recordBoundaryArraySource(source);
    return actual.minimumVCarveBoundaryPointDistance(source, point);
  };
  const someBoundarySegment: SomeBoundarySegment = (source, box, predicate) => {
    recordBoundaryArraySource(source);
    return actual.someVCarveBoundarySegmentInBox(source, box, predicate);
  };
  return {
    everyVCarveBoundarySegmentInBox: everyBoundarySegment,
    minimumVCarveBoundaryChordDistance: minimumChordDistance,
    minimumVCarveBoundaryPointDistance: minimumPointDistance,
    someVCarveBoundarySegmentInBox: someBoundarySegment,
  };
}

function recordBoundaryArraySource(source: Parameters<AsBoundaryIndex>[0]): void {
  if (Array.isArray(source)) boundaryIndexProbe.arrayQuerySources += 1;
}

const EXPECTED_REGION_COUNT = 12;
const EXPECTED_GCODE_CODE_UNITS = 1_024_912;
const EXPECTED_GCODE_SHA256 = 'dde64575fd5da13a6a62a3505eaee98e318d7165ffe65decd227a4c4ffe9d53e';
const EXPECTED_GCODE_UTF8_BYTES = 1_024_924;
const GCODE_REVIEW_EDGE_LINES = 16;
const GCODE_REVIEW_SAMPLES = 12;
const READY_BOUND_MS = 45_000;
const TEST_TIMEOUT_MS = 180_000;

describe('multi-artwork connected-script compilation', () => {
  it(
    'stays byte-exact and measurable',
    async () => {
      resetBoundaryIndexProbe();
      const project = await connectedScriptProject();
      const compilation = await profileConnectedScriptCompilation(project);
      expect(compilation.prepared.ok).toBe(true);
      if (!compilation.prepared.ok) return;
      const emission = profileGcodeEmission(compilation.prepared);
      logCompilationProfile(compilation, emission);
      assertCompilationProfile(compilation, emission);
    },
    TEST_TIMEOUT_MS,
  );
});

function assertCompilationProfile(
  compilation: CompilationProfile,
  emission: EmissionProfile,
): void {
  expect(compilation.regionTimings).toHaveLength(EXPECTED_REGION_COUNT);
  // Guard the repaired work shape without a machine-speed-sensitive exact time:
  // every region builds once, then every certification query reuses the index.
  expect(boundaryIndexProbe.explicitBuilds).toBe(EXPECTED_REGION_COUNT);
  expect(boundaryIndexProbe.arrayConversions).toBe(0);
  expect(boundaryIndexProbe.arrayQuerySources).toBe(0);
  expect(emission.emittedAt - compilation.startedAt).toBeLessThan(READY_BOUND_MS);
  expect(emission.gcode).toHaveLength(EXPECTED_GCODE_CODE_UNITS);
  expect(emission.gcodeUtf8Bytes).toBe(EXPECTED_GCODE_UTF8_BYTES);
  expect(emission.gcodeSha256).toBe(EXPECTED_GCODE_SHA256);
  expect(reviewableGcodeSnapshot(emission.gcode)).toMatchSnapshot();
}

function resetBoundaryIndexProbe(): void {
  boundaryIndexProbe.arrayConversions = 0;
  boundaryIndexProbe.arrayQuerySources = 0;
  boundaryIndexProbe.explicitBuilds = 0;
}

async function connectedScriptProject() {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts/DancingScript-Regular.ttf'));
  return connectedScriptCompilationProject(Uint8Array.from(bytes).buffer);
}

function reviewableGcodeSnapshot(gcode: string) {
  const lines = gcode.split('\n');
  const lastIndex = Math.max(0, lines.length - 1);
  return {
    codeUnitCount: gcode.length,
    lineCount: lines.length,
    head: lines.slice(0, GCODE_REVIEW_EDGE_LINES),
    samples: Array.from({ length: GCODE_REVIEW_SAMPLES }, (_, sampleIndex) => {
      const lineIndex = Math.round((lastIndex * sampleIndex) / (GCODE_REVIEW_SAMPLES - 1));
      return { lineIndex, line: lines[lineIndex] };
    }),
    tail: lines.slice(-GCODE_REVIEW_EDGE_LINES),
    utf8ByteCount: Buffer.byteLength(gcode, 'utf8'),
  };
}
