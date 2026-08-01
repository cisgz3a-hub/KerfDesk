// Perceptual eyeball harness for the four 2026-07-25 CNC audit fixes whose
// claims were geometric and were only ever checked as coordinates: the climb
// direction reversal (1.1), the pocket core (1.10), the relief far-Y row
// (1.11), and the inlay male lead (1.12).
//
// There is no machine to cut a coupon on, so this is the strongest verification
// available: render the real compiled toolpath and look at it. Each SVG draws
// the path, a dot at its start, and an arrowhead a quarter of the way along so
// travel direction is readable at a glance.
//
// A render proves the path is the shape claimed. It cannot prove the shape is
// the right one to cut with — for 1.1 that rests on the VCarve/Fusion/WoodWeb
// references recorded in the ADR-251 amendment.
//
// Gated on CNC_AUDIT=1 so CI never writes artifacts:
//   CNC_AUDIT=1 pnpm exec vitest run src/__fixtures__/perceptual/_cnc-audit-geometry.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { pocketToolpathRings } from '../../core/cnc/pocket-paths';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { reliefFinishingPasses } from '../../core/relief/relief-finishing';
import { kernelForTool } from '../../core/sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncTool,
  type ImportedSvg,
  type Polyline,
  type Scene,
  type Vec2,
} from '../../core/scene';

const OUT_DIR = join(process.cwd(), 'cnc-audit-artifacts');
const RUN = process.env['CNC_AUDIT'] === '1';
const END_MILL: CncTool = { id: 'em', name: 'flat', kind: 'end-mill', diameterMm: 3.175 };

type Trace = { readonly label: string; readonly points: ReadonlyArray<Vec2> };

function bounds(traces: ReadonlyArray<Trace>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const all = traces.flatMap((trace) => trace.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

// Arrowhead a quarter of the way along, pointing along travel — this is the
// mark that makes CW vs CCW readable without counting coordinates.
function arrow(points: ReadonlyArray<Vec2>, color: string): string {
  const at = Math.max(1, Math.floor(points.length / 4));
  const from = points[at - 1];
  const to = points[at];
  if (from === undefined || to === undefined) return '';
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 1.2;
  const left = {
    x: to.x - size * Math.cos(angle - 0.4),
    y: to.y - size * Math.sin(angle - 0.4),
  };
  const right = {
    x: to.x - size * Math.cos(angle + 0.4),
    y: to.y - size * Math.sin(angle + 0.4),
  };
  return `<polygon points="${to.x},${-to.y} ${left.x},${-left.y} ${right.x},${-right.y}" fill="${color}"/>`;
}

function traceMarkup(trace: Trace, color: string): string {
  const d = trace.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)},${(-p.y).toFixed(3)}`)
    .join(' ');
  const start = trace.points[0];
  const dot =
    start === undefined ? '' : `<circle cx="${start.x}" cy="${-start.y}" r="0.7" fill="${color}"/>`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.25"/>${dot}${arrow(trace.points, color)}`;
}

const COLORS = ['#d62728', '#1f77b4', '#2ca02c', '#9467bd', '#ff7f0e'];

function svg(title: string, traces: ReadonlyArray<Trace>): string {
  const b = bounds(traces);
  const pad = 4;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  const body = traces
    .map((trace, index) => traceMarkup(trace, COLORS[index % COLORS.length] ?? '#000'))
    .join('\n');
  const legend = traces
    .map(
      (trace, index) =>
        `<tspan x="${b.minX - pad + 1}" dy="1.6" fill="${COLORS[index % COLORS.length] ?? '#000'}">${trace.label}</tspan>`,
    )
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${-b.maxY - pad} ${w} ${h}" width="820">`,
    `<title>${title}</title>`,
    `<rect x="${b.minX - pad}" y="${-b.maxY - pad}" width="${w}" height="${h}" fill="#fff"/>`,
    body,
    `<text font-size="1.4" y="${-b.maxY - pad}">${legend}</text>`,
    '</svg>',
  ].join('\n');
}

function write(name: string, title: string, traces: ReadonlyArray<Trace>): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${name}.svg`), svg(title, traces), 'utf8');
}

// The path colour must match the layer's: contours are collected by colour, so
// a mismatch silently yields an empty job rather than an error.
function squareSvgObject(min: number, max: number, color: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'sq',
    source: 'sq.svg',
    bounds: { minX: min, minY: min, maxX: max, maxY: max },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: min, y: min },
              { x: max, y: min },
              { x: max, y: max },
              { x: min, y: max },
            ],
          },
        ],
      },
    ],
  };
}

it.runIf(RUN)('1.1 — default climb profile-outside walks the exterior clockwise', () => {
  const layer = {
    ...createLayer({ id: 'L', color: '#2563eb' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      profileLead: { shape: 'none' as const },
    },
  };
  const scene: Scene = { objects: [squareSvgObject(50, 70, '#2563eb')], layers: [layer] };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
  const pass = group.passes[0];
  if (pass?.kind !== 'contour') throw new Error('expected a contour pass');
  write('1.1-climb-direction', 'Climb, profile-outside — dot = start, arrow = travel', [
    { label: 'climb outside (expect CW)', points: [...pass.polyline] },
  ]);
});

it.runIf(RUN)('1.10 — 85% stepover pocket reaches the core', () => {
  const SIZE = 16.35;
  const outline: Polyline = {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: SIZE, y: 0 },
      { x: SIZE, y: SIZE },
      { x: 0, y: SIZE },
    ],
  };
  const rings = pocketToolpathRings([outline], 6.35, 85);
  write('1.10-pocket-core', 'Pocket rings at 85% stepover — innermost must reach the centre', [
    { label: 'stock outline', points: [...outline.points, outline.points[0] as Vec2] },
    ...rings.map((ring, index) => ({
      label: `ring ${index} (innermost first)`,
      points: [...ring.points],
    })),
  ]);
});

it.runIf(RUN)('1.11 — relief finishing reaches the far-Y edge', () => {
  const cells = 20;
  const passes = reliefFinishingPasses(
    {
      widthCells: cells,
      heightCells: cells,
      mmPerCell: 0.5,
      depth: new Float32Array(cells * cells).fill(-3),
    },
    { tool: END_MILL, kernel: kernelForTool(END_MILL, 0.5), scallopMm: 0.025 },
  );
  write('1.11-relief-far-edge', 'Relief finishing rows — last row must sit on the far-Y edge', [
    ...passes.flatMap((pass, index) =>
      pass.kind === 'path3d'
        ? [{ label: `row ${index}`, points: pass.points.map((p) => ({ x: p.x, y: p.y })) }]
        : [],
    ),
  ]);
});

it.runIf(RUN)('1.12 — inlay male insert enters on a lead', () => {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'inlay-pair' as const,
      depthMm: 6.35,
      depthPerPassMm: 2,
      inlayPocketDepthMm: 3,
      inlayAllowanceMm: 0.1,
      inlayPairSpacingMm: 10,
      tabsEnabled: false,
    },
  };
  const scene: Scene = { objects: [squareSvgObject(50, 80, '#ff0000')], layers: [layer] };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const male = job.groups[1];
  if (male?.kind !== 'cnc') throw new Error('expected the male group');
  write('1.12-inlay-lead', 'Inlay male insert — entry must start off the part outline', [
    ...male.passes.flatMap((pass, index) =>
      pass.kind === 'path3d'
        ? [{ label: `male pass ${index}`, points: pass.points.map((p) => ({ x: p.x, y: p.y })) }]
        : pass.kind === 'contour'
          ? [{ label: `male contour ${index} (NO LEAD)`, points: [...pass.polyline] }]
          : [],
    ),
  ]);
});
