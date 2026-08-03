// TEMPORARY AUDIT PROBE (2026-08-03) - dumps the REAL emitted V-carve G-code
// so the program text itself can be checked against GRBL/LinuxCNC semantics and
// V-bit cone geometry, instead of only asserting pass structure. Follows the
// existing `_`-prefixed probe convention in this folder.
//
//   VCARVE_PROBE=1 pnpm exec vitest run src/__fixtures__/perceptual/_vcarve-gcode-probe.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { cncGrblStrategy } from '../../core/output';
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

function vbit(tipAngleDeg: number, diameterMm: number): CncTool {
  return { id: 'v', name: `${tipAngleDeg}deg`, kind: 'v-bit', diameterMm, tipAngleDeg };
}

function square(atX: number, atY: number, size: number) {
  return {
    closed: true,
    points: [
      { x: atX, y: atY },
      { x: atX + size, y: atY },
      { x: atX + size, y: atY + size },
      { x: atX, y: atY + size },
    ],
  } as const;
}

function scene(
  depthMm: number,
  depthPerPassMm: number,
  vResolutionMm: number,
  size: number,
): Scene {
  const obj: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: 50, minY: 50, maxX: 50 + size, maxY: 50 + size },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [square(50, 50, size)] }],
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
          depthPerPassMm,
          vResolutionMm,
        },
      },
    ],
  };
}

function config(tool: CncTool): CncMachineConfig {
  return { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id };
}

type Case = {
  readonly label: string;
  readonly tool: CncTool;
  readonly depthMm: number;
  readonly depthPerPassMm: number;
  readonly resolutionMm: number;
  readonly sizeMm: number;
};

const CASES: ReadonlyArray<Case> = [
  {
    label: 'v90-d2-pp2',
    tool: vbit(90, 6),
    depthMm: 2,
    depthPerPassMm: 2,
    resolutionMm: 0.25,
    sizeMm: 10,
  },
  {
    label: 'v60-d2-pp2',
    tool: vbit(60, 6),
    depthMm: 2,
    depthPerPassMm: 2,
    resolutionMm: 0.25,
    sizeMm: 10,
  },
  {
    label: 'v90-d2-pp05',
    tool: vbit(90, 6),
    depthMm: 2,
    depthPerPassMm: 0.5,
    resolutionMm: 0.25,
    sizeMm: 10,
  },
  {
    label: 'v90-d10-clamped',
    tool: vbit(90, 6),
    depthMm: 10,
    depthPerPassMm: 10,
    resolutionMm: 0.25,
    sizeMm: 20,
  },
];

type Scan = {
  readonly deepest: number;
  readonly distinctZ: number;
  readonly feedWords: ReadonlyArray<string>;
  readonly g0BelowZeroCount: number;
};

function word(line: string, letter: string): number | null {
  const match = new RegExp(`${letter}(-?\\d+(?:\\.\\d+)?)`).exec(line);
  return match?.[1] === undefined ? null : Number(match[1]);
}

// One pass over the program: deepest Z reached, distinct Z levels, every feed
// word used, and any rapid that targets stock (the motion-contract violation).
function scanProgram(lines: ReadonlyArray<string>): Scan {
  const zSet = new Set<number>();
  const feedWords = new Set<string>();
  let deepest = 0;
  let g0BelowZeroCount = 0;
  for (const line of lines) {
    const feed = word(line, 'F');
    if (feed !== null) feedWords.add(String(feed));
    const z = word(line, 'Z');
    if (z === null) continue;
    zSet.add(z);
    deepest = Math.min(deepest, z);
    if (line.startsWith('G0') && z < 0) g0BelowZeroCount += 1;
  }
  return { deepest, distinctZ: zSet.size, feedWords: [...feedWords], g0BelowZeroCount };
}

function report(c: Case): string {
  const job = compileCncJob(
    scene(c.depthMm, c.depthPerPassMm, c.resolutionMm, c.sizeMm),
    DEFAULT_DEVICE_PROFILE,
    config(c.tool),
  );
  const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE, {});
  writeFileSync(join(OUT_DIR, `${c.label}.nc`), gcode, 'utf8');
  const lines = gcode.split('\n').filter((l) => l.length > 0);
  const scan = scanProgram(lines);

  const tanHalf = Math.tan(((c.tool.tipAngleDeg ?? 0) / 2) * (Math.PI / 180));
  const coneHeight = c.tool.diameterMm / 2 / tanHalf;
  const analyticDepth = Math.min(c.depthMm, c.sizeMm / 2 / tanHalf, coneHeight);

  return [
    `=== ${c.label} ===`,
    `tool: ${c.tool.tipAngleDeg}deg dia ${c.tool.diameterMm}  cone height (full-dia depth) = ${coneHeight.toFixed(4)} mm`,
    `requested depth ${c.depthMm}  depthPerPass ${c.depthPerPassMm}  detail ${c.resolutionMm}  square ${c.sizeMm} mm`,
    `ANALYTIC deepest = -min(depth, halfWidth/tanHalf, coneHeight) = ${(-analyticDepth).toFixed(4)}`,
    `EMITTED  deepest = ${scan.deepest.toFixed(4)}`,
    `lines=${lines.length}  distinct Z=${scan.distinctZ}  feed words=${scan.feedWords.join(',')}`,
    `G0 targeting Z<0 (must be 0): ${scan.g0BelowZeroCount}`,
    `first 12 lines:`,
    ...lines.slice(0, 12).map((l) => `  ${l}`),
    `last 5 lines:`,
    ...lines.slice(-5).map((l) => `  ${l}`),
    '',
  ].join('\n');
}

it.runIf(RUN)('dumps v-carve g-code for audit', () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = CASES.map(report).join('\n');
  writeFileSync(join(OUT_DIR, 'summary.txt'), out, 'utf8');

  console.log(`\n${out}`);
});
