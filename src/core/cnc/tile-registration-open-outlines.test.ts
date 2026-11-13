// N8-P1-1 (CNC audit v3): a part drawn as an open outline compiles to a cut
// whose ends do not meet, so the bore keep-out never saw it. 11 of 14 bores
// went through a 600 x 300 panel even when the tab compiler (ADR-258 Amd 7)
// treats that outline as closed. These read the written tile programs.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import type { Job } from '../job';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_TILING,
  type CncCutType,
  type CncLayerSettings,
} from '../scene';
import { tileJobs, type TiledJob } from './tile-plan';
import { closedForTabsBelowMm } from './cnc-open-outline-tabs';
import { TILE_REGISTRATION_LAYER_ID } from './tile-registration-placement';
import { isVertical, readProgram } from './tile-gcode-reader.test-support';
import {
  BIT_MM,
  LAYER_ID,
  REGISTRATION,
  compiledOutlines,
  contains,
  grow,
  jobBounds,
  machineWithStock,
  type Rect,
} from './tile-seam-fixtures.test-support';

type Point = { readonly x: number; readonly y: number };

function settings(cutType: CncCutType): CncLayerSettings {
  return {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    tabsEnabled: true,
    cutType,
    depthMm: 6,
    depthPerPassMm: 2,
  };
}

// A W x H panel (scene mm at 20, 20) drawn open: it starts `gap` mm along its
// bottom edge and ends back at its corner.
function openPanel(w: number, h: number, gap: number): Point[] {
  return [
    { x: 20 + gap, y: 20 },
    { x: 20 + w, y: 20 },
    { x: 20 + w, y: 20 + h },
    { x: 20, y: 20 + h },
    { x: 20, y: 20 },
  ];
}

function tiledSave(job: Job, layer: CncLayerSettings, tiling: { w: number; h: number }) {
  const stock = grow(jobBounds(job), 15);
  const result = tileJobs(
    job,
    {
      ...DEFAULT_CNC_TILING,
      tileWidthMm: tiling.w,
      tileHeightMm: tiling.h,
      registration: REGISTRATION,
    },
    {
      machine: machineWithStock(stock),
      device: DEFAULT_DEVICE_PROFILE,
      layers: [{ id: LAYER_ID, name: 'Panel', cnc: layer }],
    },
  );
  if (result.kind !== 'ready') throw new Error(result.kind);
  return result;
}

function boresIn({ tile, job }: TiledJob): ReadonlyArray<Point> {
  const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
  const seen = new Map<string, Point>();
  for (const move of readProgram(gcode, { x: tile.rect.minX, y: tile.rect.minY })) {
    if (move.layerId !== TILE_REGISTRATION_LAYER_ID || move.motion !== 'G1') continue;
    if (!isVertical(move) || !(move.to.z < 0)) continue;
    seen.set(`${move.to.x.toFixed(2)},${move.to.y.toFixed(2)}`, { x: move.to.x, y: move.to.y });
  }
  return [...seen.values()];
}

// A circle (scene mm) drawn open: its ends are `gap` mm apart.
function openCircle(cx: number, cy: number, diameter: number, gap: number): Point[] {
  const radius = diameter / 2;
  const sweep = 2 * Math.PI - 2 * Math.asin(gap / (2 * radius));
  return Array.from({ length: 121 }, (_, index) => {
    const angle = (sweep * index) / 120;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

// The panel's drawn rectangle in machine coordinates.
function panelRect(w: number, h: number): Rect {
  const a = toMachineCoords({ x: 20, y: 20 }, DEFAULT_DEVICE_PROFILE);
  const b = toMachineCoords({ x: 20 + w, y: 20 + h }, DEFAULT_DEVICE_PROFILE);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

describe('registration bores and open outlines (N8-P1-1)', () => {
  const limitMm = closedForTabsBelowMm(settings('profile-on-path'), BIT_MM);

  it('uses the tab compiler’s limit: D + 1.89 mm for 6 x 2 tabs through 6.35 mm', () => {
    expect(
      closedForTabsBelowMm({ ...settings('profile-on-path'), depthMm: 6.35 }, BIT_MM),
    ).toBeCloseTo(BIT_MM + 1.89, 2);
  });

  it.each([
    ['profile-on-path', 2.5],
    ['profile-on-path', 3.5],
    ['profile-on-path', 4.5],
    ['profile-outside', 2.5],
    ['profile-outside', 4.5],
  ] as const)('keeps every bore out of a 600 x 300 %s panel left open by %s mm', (cutType, gap) => {
    expect(gap).toBeLessThan(limitMm);
    const layer = settings(cutType);
    const job = compiledOutlines([openPanel(600, 300, gap)], layer, false);
    const result = tiledSave(job, layer, { w: 250, h: 200 });
    const bores = result.tiles.flatMap(boresIn);
    const panel = panelRect(600, 300);
    expect(bores.length).toBeGreaterThan(0);
    for (const bore of bores) expect(contains(panel, bore)).toBe(false);
    expect(result.advisories?.some((line) => line.includes('inside an open outline'))).toBe(false);
  });

  it('keeps every bore out of a Ø300 disc whose outline stops 2 mm short', () => {
    const layer = settings('profile-on-path');
    const job = compiledOutlines([openCircle(200, 200, 300, 2)], layer, false);
    const result = tiledSave(job, layer, { w: 250, h: 250 });
    const centre = toMachineCoords({ x: 200, y: 200 }, DEFAULT_DEVICE_PROFILE);
    for (const bore of result.tiles.flatMap(boresIn)) {
      expect(Math.hypot(bore.x - centre.x, bore.y - centre.y)).toBeGreaterThan(150);
    }
  });

  it('names a genuinely open outline, its layer and the bores inside it', () => {
    const layer = settings('profile-on-path');
    const gap = 40;
    expect(gap).toBeGreaterThan(limitMm);
    const job = compiledOutlines([openPanel(600, 300, gap)], layer, false);
    const result = tiledSave(job, layer, { w: 250, h: 200 });
    const panel = panelRect(600, 300);
    const inside = result.tiles.flatMap(boresIn).filter((bore) => contains(panel, bore));
    const warning = result.advisories?.find((line) => line.includes('inside an open outline'));
    // Nothing keeps a bore out of an outline this open: the warning must name it.
    expect(inside.length).toBeGreaterThan(0);
    expect(warning).toContain('layer "Panel"');
    expect(warning).toContain('ends 40 mm apart');
    for (const bore of inside) expect(warning).toContain(`${Math.round(bore.x * 100) / 100}`);
  });
});
