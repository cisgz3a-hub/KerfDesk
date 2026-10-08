import { expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { findPlungedTravelIssues } from '../invariants';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from '../output';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncTool, type Polyline, type Vec2 } from '../scene';
import { cncProgramGeometry } from '../../io/cnc/cnc-program-geometry';
import { adaptivePocketPasses, resolveAdaptivePocketOperation } from './adaptive-pocket-operation';

const TOOL: CncTool = { id: 'em4', name: '4 mm end mill', kind: 'end-mill', diameterMm: 4 };
function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}
function clearOfIsland(point: Vec2): boolean {
  const dx = Math.max(10 - point.x, 0, point.x - 20),
    dy = Math.max(10 - point.y, 0, point.y - 20);
  return (
    point.x >= 1.997 &&
    point.x <= 28.003 &&
    point.y >= 1.997 &&
    point.y <= 28.003 &&
    Math.hypot(dx, dy) >= 1.997
  );
}
function segmentIsClear(
  a: Vec2 & { readonly z: number },
  b: Vec2 & { readonly z: number },
): boolean {
  const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    if (a.z + (b.z - a.z) * t >= 0) continue;
    if (!clearOfIsland({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

it('emits island entry helices, plunge-feed seed slotting and cutters wholly clear of protected stock', () => {
  const source = [square(0, 0, 30), square(10, 10, 10)];
  const operation = resolveAdaptivePocketOperation(
    source,
    {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      pocketStrategy: 'adaptive',
      adaptiveOptimalLoadMm: 0.5,
    },
    TOOL,
  );
  if (operation.kind !== 'ok') throw new Error(JSON.stringify(operation));
  const passes = adaptivePocketPasses(operation, [-1], source);
  const seeds = passes.filter((pass) => pass.kind === 'path3d');
  const entries = passes.filter((pass) => pass.kind === 'helical-contour');
  expect(entries.length).toBeGreaterThan(1);
  expect(seeds).toHaveLength(entries.length);
  expect(seeds.every((pass) => pass.lateralFeed === 'plunge')).toBe(true);
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'islands',
    color: '#000000',
    cutType: 'pocket',
    toolDiameterMm: 4,
    feedMmPerMin: 997,
    plungeMmPerMin: 287,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 5,
    retractBetweenPasses: false,
    passes,
  };
  const program = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
  expect(program.match(/^G[23] .* Z-/gm)?.length).toBeGreaterThanOrEqual(entries.length * 2);
  expect(plungeFeedXyMoves(program)).toBeGreaterThan(seeds.length);
  expect(findPlungedTravelIssues(program, { safeZMm: 5 })).toEqual([]);
  const parsed = cncProgramGeometry(program, [{ id: TOOL.id, name: TOOL.name }]);
  expect(parsed.sections).toHaveLength(1);
  expect(parsed.sections[0]?.depthMm).toBe(1);
  expect(parsed.disclosures).toEqual(
    expect.arrayContaining([expect.stringContaining('initial approach')]),
  );
  expect(parsed.disclosures.join(' ')).not.toMatch(
    /stopped|budget|no explicit|Uninterpretable|could not/,
  );
  const paths = parsed.sections.flatMap((section) => section.paths);
  expect(paths.length).toBeGreaterThan(100);
  for (const path of paths)
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1],
        b = path[index];
      if (a !== undefined && b !== undefined) expect(segmentIsClear(a, b)).toBe(true);
    }
});

function plungeFeedXyMoves(program: string): number {
  let feed = 0,
    count = 0;
  for (const line of program.split('\n')) {
    const word = /\bF(\d+(?:\.\d+)?)/.exec(line);
    if (word !== null) feed = Number(word[1]);
    if (/^G1\s/.test(line) && /\b[XY]-?\d/.test(line) && feed === 287) count += 1;
  }
  return count;
}
