// ADR-497 Amendment 1 (audit v4 E5-P2-1, E5-P2-3): what a Material Test card
// burns, read back from the emitted program rather than from compileJob.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords, type DeviceProfile } from '../../core/devices';
import {
  generateMaterialTestGrid,
  type MaterialTestCell,
  type MaterialTestGrid,
} from '../../core/job/material-test-grid';
import { materialTestAxis } from '../../core/job/material-test-axes';
import { effectiveHatchSpacingMm } from '../../core/job/fill-hatching';
import {
  createProject,
  DEFAULT_PROJECT_OPTIMIZATION,
  type Project,
  type ProjectOptimizationSettings,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

type LitMove = { readonly from: Vec; readonly to: Vec };
type Vec = { readonly x: number; readonly y: number };

describe('Material Test hatch spacing (E5-P2-1)', () => {
  it('never offers a spacing the fill engine would raise', () => {
    const axis = materialTestAxis('interval', 5, {
      speedMin: 1000,
      speedMax: 1000,
      powerMin: 20,
      powerMax: 20,
      intervalMinMm: 0.01,
      intervalMaxMm: 0.05,
    });
    for (const value of axis.values) expect(effectiveHatchSpacingMm(value)).toBe(value);
    expect(axis.labels).toEqual(['0.05', '0.05', '0.05', '0.05', '0.05']);
  });

  it('burns each hatch row at its labelled spacing, down to the floor', () => {
    const grid = generateMaterialTestGrid({
      rows: 4,
      columns: 2,
      rowParameter: 'interval',
      columnParameter: 'power',
      // Below the floor: the densest row is raised to it before it is labelled.
      intervalMinMm: 0.02,
      intervalMaxMm: 0.2,
      speedMin: 2000,
      speedMax: 2000,
      powerMin: 10,
      powerMax: 20,
      cellWidthMm: 4,
      cellHeightMm: 4,
    });
    const device = DEFAULT_DEVICE_PROFILE;
    const moves = litMoves(emitGcode(projectFor(grid, device)).gcode, device);
    // The two column labels come first.
    const rowLabels = labelTexts(grid).slice(2);
    expect(rowLabels).toEqual(['0.2', '0.15', '0.1', '0.05']);
    for (const cell of grid.cells) {
      const rows = [
        ...new Set(
          moves
            .filter((move) => inside(midpoint(move), cell))
            .map((move) => Number(midpoint(move).y.toFixed(3))),
        ),
      ].sort((a, b) => a - b);
      const spacing = (rows.at(-1)! - rows[0]!) / (rows.length - 1);
      expect(spacing, `r${cell.row}c${cell.column}`).toBeCloseTo(Number(rowLabels[cell.row]), 3);
    }
  });
});

describe('Material Test cut order (E5-P2-3)', () => {
  const grid = generateMaterialTestGrid({
    rows: 3,
    columns: 4,
    mode: 'line',
    rowParameter: 'speed',
    columnParameter: 'power',
    speedMin: 500,
    speedMax: 3000,
    powerMin: 10,
    powerMax: 80,
    cellWidthMm: 4,
    cellHeightMm: 4,
    gapMm: 1,
    maxFeedMmPerMin: 6000,
  });
  const generated = grid.cells.map(cellName);

  it.each([
    ['front-left', 'front-left'],
    ['rear-right', 'rear-right'],
    ['front-right', 'front-right'],
    ['center', 'front-left'],
  ] as const)('cuts gentlest first on a %s origin', (origin, homing) => {
    const device: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      origin,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: false, direction: homing },
    };
    expect(burnOrder(grid, emitGcode(projectFor(grid, device)).gcode, device)).toEqual(generated);
  });

  it.each([
    ['right-to-left Cut direction', { cutDirection: 'right-to-left' }],
    ['bottom-to-top Cut direction', { cutDirection: 'bottom-to-top' }],
    ['front-right Line start region', { lineStartRegion: 'front-right' }],
    ['job-centre start point', { startPoint: 'job-center' }],
  ] as const)('cuts gentlest first with a %s', (_, optimization) => {
    const device = DEFAULT_DEVICE_PROFILE;
    const gcode = emitGcode(projectFor(grid, device, optimization)).gcode;
    expect(burnOrder(grid, gcode, device)).toEqual(generated);
  });
});

function projectFor(
  grid: MaterialTestGrid,
  device: DeviceProfile,
  optimization: Partial<ProjectOptimizationSettings> = {},
): Project {
  const base = createProject(device);
  return {
    ...base,
    device,
    optimization: { ...DEFAULT_PROJECT_OPTIMIZATION, ...optimization },
    scene: { ...base.scene, ...grid.scene },
  };
}

// Modal machine state, so a word-less axis keeps its last value.
type ModalState = {
  readonly x: number;
  readonly y: number;
  readonly s: number;
  readonly g: number;
};

function litMoves(gcode: string, device: DeviceProfile): LitMove[] {
  let state: ModalState = { x: 0, y: 0, s: 0, g: 0 };
  const moves: LitMove[] = [];
  for (const raw of gcode.split('\n')) {
    const words = new Map(
      [
        ...raw
          .replace(/;.*$/, '')
          .toUpperCase()
          .matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g),
      ].map((match) => [match[1], Number(match[2])] as const),
    );
    if (words.has('M')) continue;
    const g = words.get('G');
    const next: ModalState = {
      x: words.get('X') ?? state.x,
      y: words.get('Y') ?? state.y,
      s: words.get('S') ?? state.s,
      g: g === 0 || g === 1 ? g : state.g,
    };
    if ((words.has('X') || words.has('Y')) && next.g === 1 && next.s > 0) {
      moves.push({
        from: toSceneCoords({ x: state.x, y: state.y }, device),
        to: toSceneCoords({ x: next.x, y: next.y }, device),
      });
    }
    state = next;
  }
  return moves;
}

function burnOrder(grid: MaterialTestGrid, gcode: string, device: DeviceProfile): string[] {
  const order: string[] = [];
  for (const move of litMoves(gcode, device)) {
    const cell = grid.cells.find((item) => inside(midpoint(move), item));
    if (cell !== undefined && !order.includes(cellName(cell))) order.push(cellName(cell));
  }
  return order;
}

function labelTexts(grid: MaterialTestGrid): string[] {
  return grid.scene.objects.flatMap((object) =>
    object.kind === 'imported-svg' && object.source?.startsWith('calibration-label:')
      ? [object.source.slice('calibration-label:'.length)]
      : [],
  );
}

function midpoint(move: LitMove): Vec {
  return { x: (move.from.x + move.to.x) / 2, y: (move.from.y + move.to.y) / 2 };
}

function inside(point: Vec, cell: MaterialTestCell): boolean {
  const tolerance = 0.02;
  return (
    point.x >= cell.bounds.minX - tolerance &&
    point.x <= cell.bounds.maxX + tolerance &&
    point.y >= cell.bounds.minY - tolerance &&
    point.y <= cell.bounds.maxY + tolerance
  );
}

function cellName(cell: MaterialTestCell): string {
  return `r${cell.row}c${cell.column}`;
}
