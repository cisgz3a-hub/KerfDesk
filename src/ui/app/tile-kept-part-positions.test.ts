// Rolling audit v3 G5-P3-2 (ADR-433 Amendment 5): each tile file is moved so
// the tile's min corner is its zero, but its kept-part warning printed the
// whole job's machine position, which lies nowhere in that file. Through the
// production tiled-save core, as the refuter reproduced it.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type Project,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { tiledCncProject } from './save-tiled-gcode-testing';
import { finalizeTiledOutput } from './tiled-output-preparation';

function square(id: string, color: string, x: number, y: number): ImportedSvg {
  const ring: Polyline = {
    closed: true,
    points: [
      { x, y },
      { x: x + 20, y },
      { x: x + 20, y: y + 20 },
      { x, y: y + 20 },
    ],
  };
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + 20, maxY: y + 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [ring] }],
  };
}

// Two Outside operations' parts 2.5 mm apart: each 1/8" cut reaches the other.
function closeParts(): Project {
  const base = tiledCncProject();
  const machine = base.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC project');
  const [first, second] = base.scene.layers;
  if (first === undefined || second === undefined) throw new Error('expected two layers');
  return {
    ...base,
    machine: {
      ...machine,
      tiling: { tileWidthMm: 60, tileHeightMm: 100, overlapMm: 10, registrationHoles: false },
    },
    scene: {
      objects: [square('O1', first.color, 10, 10), square('O2', second.color, 32.5, 10)],
      layers: [first, second].map((layer) => ({
        ...layer,
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside', tabsEnabled: false },
      })),
    },
  };
}

describe('tile files name a kept-part cut without whole-job positions', () => {
  it('says how deep the cut reaches but not where in machine coordinates', () => {
    const project = closeParts();
    const result = finalizeTiledOutput(prepareOutput(project, {}), 'job', null, null);
    if (result.kind !== 'ready') throw new Error(`expected tile files, got ${result.kind}`);
    const kept = result.emissionAdvisories.filter((line) => line.includes('keeps and cuts up to'));
    expect(kept.length).toBeGreaterThan(0);
    for (const line of kept) expect(line).not.toContain(' at X ');
    // The same job saved untiled runs where it was compiled and keeps them.
    const untiled = emitGcode(project).preflight.issues.filter(
      (issue) => issue.code === 'cnc-profile-cuts-kept-part',
    );
    expect(untiled.length).toBeGreaterThan(0);
    for (const issue of untiled) expect(issue.message).toContain(' at X ');
  });
});
