// TEMPORARY AUDIT PROBE (2026-08-03) - measures the CARVED SURFACE across a
// narrow V-carved stroke and compares it to the analytic V-groove, to find out
// whether the offset ladder actually reaches the medial-axis depth or leaves a
// standing ridge there. Uses the real compile â†’ toolpath â†’ removal-grid chain.
//
//   VCARVE_PROBE=1 pnpm exec vitest run src/__fixtures__/perceptual/_vcarve-medial-ridge-probe.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../../core/devices';
import { buildToolpath } from '../../core/job';
import { computeRemovalGrid, kernelForTool } from '../../core/sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Scene,
} from '../../core/scene';

// cnc-audit-artifacts/ is already gitignored (.gitignore:28).
const OUT_DIR = join(process.cwd(), 'cnc-audit-artifacts');
const RUN = process.env['VCARVE_PROBE'] === '1';
const CELL = 0.02;
const BAR_LEN = 12;
const AT = 50;

function vbit(tipAngleDeg: number, diameterMm: number): CncTool {
  return { id: 'v', name: `${tipAngleDeg}deg`, kind: 'v-bit', diameterMm, tipAngleDeg };
}

function bar(widthMm: number) {
  return {
    closed: true,
    points: [
      { x: AT, y: AT },
      { x: AT + widthMm, y: AT },
      { x: AT + widthMm, y: AT + BAR_LEN },
      { x: AT, y: AT + BAR_LEN },
    ],
  } as const;
}

function scene(widthMm: number, depthMm: number, vResolutionMm: number): Scene {
  const obj: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: AT, minY: AT, maxX: AT + widthMm, maxY: AT + BAR_LEN },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [bar(widthMm)] }],
  };
  return {
    objects: [obj],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          depthMm,
          depthPerPassMm: depthMm,
          vResolutionMm,
        },
      },
    ],
  };
}

type Case = {
  readonly label: string;
  readonly widthMm: number;
  readonly angle: number;
  readonly diaMm: number;
  readonly depthMm: number;
  readonly resolutionMm: number;
};

const CASES: ReadonlyArray<Case> = [
  {
    label: 'bar1.0mm-v90-detail0.25',
    widthMm: 1.0,
    angle: 90,
    diaMm: 6,
    depthMm: 5,
    resolutionMm: 0.25,
  },
  {
    label: 'bar3.0mm-v90-detail0.25',
    widthMm: 3.0,
    angle: 90,
    diaMm: 6,
    depthMm: 5,
    resolutionMm: 0.25,
  },
  {
    label: 'bar3.0mm-v90-AUTOdetail',
    widthMm: 3.0,
    angle: 90,
    diaMm: 6,
    depthMm: 5,
    resolutionMm: 0,
  },
  {
    label: 'bar6.0mm-v90-AUTOdetail',
    widthMm: 6.0,
    angle: 90,
    diaMm: 6,
    depthMm: 5,
    resolutionMm: 0,
  },
  {
    label: 'bar3.0mm-v60-detail0.25',
    widthMm: 3.0,
    angle: 60,
    diaMm: 6,
    depthMm: 5,
    resolutionMm: 0.25,
  },
  {
    label: 'bar2.0mm-v30-detail0.25',
    widthMm: 2.0,
    angle: 30,
    diaMm: 6,
    depthMm: 8,
    resolutionMm: 0.25,
  },
];

function report(c: Case): string {
  const tool = vbit(c.angle, c.diaMm);
  const config: CncMachineConfig = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [tool],
    toolId: tool.id,
  };
  const job = compileCncJob(
    scene(c.widthMm, c.depthMm, c.resolutionMm),
    DEFAULT_DEVICE_PROFILE,
    config,
  );
  const toolpath = buildToolpath(job);

  const c1 = toMachineCoords({ x: AT, y: AT }, DEFAULT_DEVICE_PROFILE);
  const c2 = toMachineCoords({ x: AT + c.widthMm, y: AT + BAR_LEN }, DEFAULT_DEVICE_PROFILE);
  const minX = Math.min(c1.x, c2.x);
  const maxX = Math.max(c1.x, c2.x);
  const minY = Math.min(c1.y, c2.y);
  const maxY = Math.max(c1.y, c2.y);

  const pad = 1;
  const result = computeRemovalGrid(
    toolpath,
    {
      originX: minX - pad,
      originY: minY - pad,
      widthMm: c.widthMm + 2 * pad,
      heightMm: BAR_LEN + 2 * pad,
      mmPerCell: CELL,
    },
    kernelForTool(tool, CELL),
  );
  if (result.kind === 'error') return `=== ${c.label} === GRID ERROR: ${result.reason}\n`;
  const grid = result.grid;

  const tanHalf = Math.tan(((c.angle / 2) * Math.PI) / 180);
  const coneH = c.diaMm / 2 / tanHalf;
  const maxDepth = Math.min(c.depthMm, coneH);
  const analyticCentre = -Math.min(c.widthMm / 2 / tanHalf, maxDepth);

  const midY = (minY + maxY) / 2;
  const cy = Math.floor((midY - grid.originY) / grid.mmPerCell);
  const profile: Array<{ x: number; z: number; want: number }> = [];
  let worstShallow = 0;
  let centreZ = 0;
  for (let cx = 0; cx < grid.widthCells; cx += 1) {
    const x = grid.originX + (cx + 0.5) * grid.mmPerCell;
    if (x < minX || x > maxX) continue;
    const z = grid.depth[cy * grid.widthCells + cx] ?? 0;
    const dist = Math.min(x - minX, maxX - x);
    const want = -Math.min(dist / tanHalf, maxDepth);
    profile.push({ x: +(x - minX).toFixed(3), z: +z.toFixed(4), want: +want.toFixed(4) });
    const shallow = z - want;
    if (shallow > worstShallow) worstShallow = shallow;
    if (Math.abs(x - (minX + maxX) / 2) < grid.mmPerCell) centreZ = z;
  }

  const lines = [
    `=== ${c.label} ===`,
    `bar ${c.widthMm} mm wide, ${c.angle}deg bit, detail ${c.resolutionMm === 0 ? `auto(${(c.diaMm / 8).toFixed(3)})` : c.resolutionMm}`,
    `ANALYTIC centreline depth = ${analyticCentre.toFixed(4)}`,
    `MEASURED centreline depth = ${centreZ.toFixed(4)}   SHORTFALL = ${(centreZ - analyticCentre).toFixed(4)} mm`,
    `worst under-cut anywhere across the stroke = ${worstShallow.toFixed(4)} mm`,
    `cross-section (x from left edge | carved z | analytic z):`,
    ...profile
      .filter((_, i) => i % Math.max(1, Math.floor(profile.length / 26)) === 0)
      .map(
        (p) =>
          `   ${p.x.toFixed(3).padStart(6)}  ${p.z.toFixed(4).padStart(8)}  ${p.want.toFixed(4).padStart(8)}`,
      ),
    '',
  ];
  return lines.join('\n');
}

// The removal grid is 0.02 mm/cell over six cases - ~150 s, far past vitest's
// 5 s default. Env-gated, so this budget only ever applies to a manual run.
const PROBE_TIMEOUT_MS = 1_500_000;

it.runIf(RUN)(
  'measures the medial-axis ridge',
  () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const out = CASES.map(report).join('\n');
    writeFileSync(join(OUT_DIR, 'medial-ridge.txt'), out, 'utf8');

    console.log(`\n${out}`);
  },
  PROBE_TIMEOUT_MS,
);
