import { createLayer } from '../../src/core/scene/layer';
import type { ImportedSvg, LayerOperationSettings, Project } from '../../src/core/scene';
import {
  oracleBurns,
  type OracleBurn,
  type OraclePoint,
} from '../../src/core/controllers/grbl/laser-burn-oracle.test-helper';
import { composedSvgSnapshot, importComposedSvg } from './composed-svg-browser';
import { expect, type KerfDeskFixture, type Page } from './kerfdesk-test';
import { runMenuCommand } from './recovery-flow';
import { selectWorkspacePanel } from './workspace-ui';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export type Shape = Rect & {
  readonly id: string;
  readonly settings: Partial<LayerOperationSettings> & {
    readonly power: number;
    readonly speed: number;
    readonly passes: number;
  };
};
export type ProgramBurn = OracleBurn & { readonly pass: number; readonly passCount: number };
export interface BurnInterval {
  readonly burn: ProgramBurn;
  readonly at: OraclePoint;
}
const operationId = 'topology-operation';
const process = (power: number, speed: number, angle = 0, air = false) => ({
  power,
  speed,
  passes: 1,
  hatchAngleDeg: angle,
  hatchSpacingMm: angle === 0 ? 2 : 1.5,
  airAssist: air,
  powerMode: air ? ('constant' as const) : ('dynamic' as const),
});
export const fillShapes: readonly Shape[] = [
  { id: 'I', x: 42, y: 42, w: 16, h: 16, settings: process(24, 450, 90, true) },
  { id: 'H', x: 34, y: 34, w: 32, h: 32, settings: process(20, 300, 30) },
  { id: 'P', x: 10, y: 10, w: 80, h: 80, settings: process(80, 1200) },
  { id: 'cross-H', x: 154, y: 34, w: 32, h: 32, settings: process(20, 300, 30) },
  { id: 'cross-P', x: 130, y: 10, w: 80, h: 80, settings: process(80, 1200) },
  { id: 'C', x: 170, y: 20, w: 60, h: 60, settings: process(40, 600, 90, true) },
];
const fragmented = {
  tabsEnabled: true,
  tabsPerShape: 4,
  tabSizeMm: 2,
  tabSkipInnerShapes: false,
  tabCutPowerPercent: 25,
  perforationEnabled: true,
  perforationCutMm: 3,
  perforationSkipMm: 1,
  overcutMm: 2,
};
export const lineShapes: readonly Shape[] = [
  {
    id: 'fragment-outer',
    x: 10,
    y: 10,
    w: 100,
    h: 100,
    settings: { ...process(80, 1200), ...fragmented, passes: 2 },
  },
  {
    id: 'fragment-inner',
    x: 50,
    y: 50,
    w: 20,
    h: 20,
    settings: { ...process(40, 600, 0, true), ...fragmented, passes: 3 },
  },
  {
    id: 'closed-outer',
    x: 150,
    y: 10,
    w: 100,
    h: 100,
    settings: { ...process(60, 900), overcutMm: 2, passes: 2 },
  },
  {
    id: 'closed-inner',
    x: 190,
    y: 50,
    w: 20,
    h: 20,
    settings: { ...process(30, 450, 0, true), overcutMm: 2, passes: 3 },
  },
];

// Each rectangle enters through the actual Import control as a separate SVG.
// Consecutive same-mode elements in one file correctly share one artwork object.
// Process/device/order facts and the importer placement translation are seeded
// afterward; canonical curves and compatibility polylines stay unchanged.
export async function importTopologyProject(
  page: Page,
  fixture: KerfDeskFixture,
  mode: 'fill' | 'line',
): Promise<{ readonly imported: Project; readonly project: Project }> {
  const shapes = mode === 'fill' ? fillShapes : lineShapes;
  for (const [index, shape] of shapes.entries()) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="140mm" viewBox="0 0 300 140">' +
      `<rect id="${shape.id}" fill="#000000" x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}"/></svg>`;
    await importComposedSvg(page, fixture, `topology-${mode}-${shape.id}.svg`, svg, index + 1);
  }
  const imported = (await composedSvgSnapshot(page)).project;
  const objects = shapes.map((shape) => configuredObject(imported, shape));
  const project: Project = {
    ...imported,
    device: {
      ...imported.device,
      origin: 'rear-left',
      bedWidth: 300,
      bedHeight: 140,
      maxPowerS: 1000,
      minPowerS: 0,
      maxFeed: 6000,
      laserModeEnabled: true,
      laserArcMoves: 'off',
      airAssistCommand: 'M8',
      homing: { enabled: false, direction: 'rear-left' },
    },
    workspace: { width: 300, height: 140, units: 'mm' },
    optimization: {
      ...imported.optimization,
      travelPolicy: 'nearest-neighbor',
      reduceTravelMoves: true,
      insideFirst: true,
      pathDirection: 'preserve',
      closedShapeStart: 'drawn',
      removeOverlappingLines: false,
    },
    jobSetup: {
      ...imported.jobSetup,
      placement: { startFrom: 'absolute', anchor: 'front-left' },
      outputScope: { cutSelectedGraphics: false, useSelectionOrigin: false, selectedObjectIds: [] },
    },
    scene: {
      objects,
      layers: [
        {
          ...createLayer({ id: operationId, color: '#000000', mode }),
          power: 80,
          speed: 1200,
          passes: 1,
          fillStyle: 'island',
          fillBidirectional: false,
          fillOverscanMm: 0,
          fillCrossHatch: false,
          hatchSpacingMm: 2,
        },
      ],
      artworkOrder:
        mode === 'fill' ? ['P', 'I', 'H', 'cross-P', 'cross-H', 'C'] : shapes.map((r) => r.id),
    },
  };
  await page.evaluate(async (value) => {
    const path = '/src/ui/state/store.ts';
    const loaded = (await import(/* @vite-ignore */ path)) as {
      useStore: { getState: () => { setProject: (project: Project) => void } };
    };
    loaded.useStore.getState().setProject(value);
  }, project);
  await selectWorkspacePanel(page, 'Artwork');
  await runMenuCommand(page, 'Edit', 'Select All');
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await expect(
    panel.getByRole('radio', { name: mode === 'fill' ? 'Fill' : 'Line', exact: true }),
  ).toBeChecked();
  return { imported, project };
}

function configuredObject(project: Project, shape: Shape): ImportedSvg {
  const found = project.scene.objects.find(
    (object) =>
      object.kind === 'imported-svg' &&
      Math.abs(object.bounds.minX - shape.x) < 1e-6 &&
      Math.abs(object.bounds.minY - shape.y) < 1e-6 &&
      Math.abs(object.bounds.maxX - shape.x - shape.w) < 1e-6 &&
      Math.abs(object.bounds.maxY - shape.y - shape.h) < 1e-6,
  );
  if (found?.kind !== 'imported-svg') throw new Error(`Imported rectangle ${shape.id} is missing`);
  expect([found.transform.x, found.transform.y].every(Number.isFinite)).toBe(true);
  expect({ ...found.transform, x: 0, y: 0 }).toEqual({
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    mirrorX: false,
    mirrorY: false,
  });
  expect(found.paths.flatMap((path) => path.polylines).length).toBeGreaterThan(0);
  expect(found.paths.flatMap((path) => path.polylines).every((line) => line.closed)).toBe(true);
  return {
    ...found,
    id: shape.id,
    transform: { ...found.transform, x: 0, y: 0 },
    operationIds: [operationId],
    operationOverride: { byOperation: { [operationId]: shape.settings } },
  };
}

// Passive request observation: forward the same payload and transfer list.
// This distinguishes a real Save request from an unrelated preview worker spawn.
export async function observeTopologyWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __topologyWorkerRequests?: { url: string; kind: string }[];
    };
    target.__topologyWorkerRequests = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      private readonly topologyUrl: string;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.topologyUrl = String(url);
      }
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const envelope = message as { request?: { kind?: unknown } } | null;
        const kind = envelope?.request?.kind;
        if (this.topologyUrl.includes('output-preparation-worker') && typeof kind === 'string')
          target.__topologyWorkerRequests?.push({ url: this.topologyUrl, kind });
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
}
export async function topologyWorkerRequests(page: Page) {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __topologyWorkerRequests?: readonly { url: string; kind: string }[];
        }
      ).__topologyWorkerRequests ?? [],
  );
}
export async function saveTopologyGcode(page: Page, fixture: KerfDeskFixture): Promise<string> {
  const before = (await fixture.events()).filter((event) => event.kind === 'file-saved').length;
  await runMenuCommand(page, 'File', 'Save G-code...');
  const dialog = page.getByRole('dialog', { name: 'Save G-code', exact: true });
  await expect(dialog).toContainText('The complete export is ready.', { timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Save as…', exact: true }).click();
  await expect
    .poll(
      async () => (await fixture.events()).filter((event) => event.kind === 'file-saved').length,
      { timeout: 30_000 },
    )
    .toBe(before + 1);
  const name = (await fixture.events()).filter((event) => event.kind === 'file-saved').at(-1)?.[
    'name'
  ];
  const text = typeof name === 'string' ? (await fixture.savedFiles())[name] : undefined;
  if (text === undefined || typeof name !== 'string' || !name.endsWith('.gcode'))
    throw new Error('Save G-code did not write its prepared file');
  return text;
}

// The existing pure interpreter has no Vitest dependency or production parser.
// It rejects unsupported words rather than silently discarding executable motion.
export function programBurns(gcode: string): ProgramBurn[] {
  let pass = 0,
    passCount = 0;
  const facts = gcode.split(/\r\n|\n|\r/).map((line) => {
    const match = /^; pass (\d+) of (\d+)$/.exec(line.trim());
    if (match) {
      pass = Number(match[1]);
      passCount = Number(match[2]);
    }
    return { pass, passCount };
  });
  return oracleBurns(gcode)
    .filter((burn) => length(burn) > 1e-6)
    .map((burn) => {
      const fact = facts[burn.line - 1];
      if (!fact || fact.pass === 0)
        throw new Error(`Burn on line ${burn.line} lacks an emitted pass marker`);
      return { ...burn, ...fact };
    });
}
export const length = (burn: OracleBurn) =>
  Math.hypot(burn.to.x - burn.from.x, burn.to.y - burn.from.y);
export const midpoint = (burn: OracleBurn): OraclePoint => ({
  x: (burn.from.x + burn.to.x) / 2,
  y: (burn.from.y + burn.to.y) / 2,
});
export const inside = (r: Rect, p: OraclePoint) =>
  p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

// Split at every rectangle edge-axis. Membership is constant within each
// interval; tiny emitted-rounding slivers within 0.002 mm of a boundary are excluded.
export function burnIntervals(
  burns: readonly ProgramBurn[],
  rectangles: readonly Rect[],
): BurnInterval[] {
  const x = [...new Set(rectangles.flatMap((r) => [r.x, r.x + r.w]))];
  const y = [...new Set(rectangles.flatMap((r) => [r.y, r.y + r.h]))];
  return burns.flatMap((burn) => {
    const times = new Set([0, 1]);
    for (const [start, end, axes] of [
      [burn.from.x, burn.to.x, x],
      [burn.from.y, burn.to.y, y],
    ] as const) {
      if (start === end) continue;
      for (const edge of axes) {
        const t = (edge - start) / (end - start);
        if (t > 0 && t < 1) times.add(t);
      }
    }
    const ordered = [...times].sort((a, b) => a - b);
    return ordered.slice(1).flatMap((high, i) => {
      const low = ordered[i];
      if (low === undefined || !(high > low)) return [];
      const t = (low + high) / 2;
      const at = {
        x: burn.from.x + (burn.to.x - burn.from.x) * t,
        y: burn.from.y + (burn.to.y - burn.from.y) * t,
      };
      const near = rectangles.some(
        (r) =>
          Math.min(
            Math.abs(at.x - r.x),
            Math.abs(at.x - r.x - r.w),
            Math.abs(at.y - r.y),
            Math.abs(at.y - r.y - r.h),
          ) <= 0.002,
      );
      return near ? [] : [{ burn, at }];
    });
  });
}

export function duplicateIntervals(burns: readonly ProgramBurn[]): readonly unknown[] {
  const duplicates: unknown[] = [];
  for (let i = 0; i < burns.length; i += 1) {
    const a = burns[i];
    if (!a) continue;
    const span = length(a),
      ux = (a.to.x - a.from.x) / span,
      uy = (a.to.y - a.from.y) / span;
    const cross = (p: OraclePoint) => (p.x - a.from.x) * uy - (p.y - a.from.y) * ux;
    const along = (p: OraclePoint) => (p.x - a.from.x) * ux + (p.y - a.from.y) * uy;
    for (const b of burns.slice(i + 1)) {
      if (Math.abs(cross(b.from)) > 1e-6 || Math.abs(cross(b.to)) > 1e-6) continue;
      const low = Math.max(0, Math.min(along(b.from), along(b.to)));
      const high = Math.min(span, Math.max(along(b.from), along(b.to)));
      if (high - low > 0.002) duplicates.push({ lines: [a.line, b.line], overlapMm: high - low });
    }
  }
  return duplicates;
}

// Independent perimeter coordinates, derived only from the input rectangle.
export function edgeRange(r: Rect, burn: OracleBurn): readonly [number, number] | null {
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const within = (p: OraclePoint) =>
    p.x >= r.x - 1e-6 && p.x <= r.x + r.w + 1e-6 && p.y >= r.y - 1e-6 && p.y <= r.y + r.h + 1e-6;
  if (!within(burn.from) || !within(burn.to)) return null;
  let coordinate: ((p: OraclePoint) => number) | null = null;
  if (close(burn.from.y, r.y) && close(burn.to.y, r.y)) coordinate = (p) => p.x - r.x;
  else if (close(burn.from.x, r.x + r.w) && close(burn.to.x, r.x + r.w))
    coordinate = (p) => r.w + p.y - r.y;
  else if (close(burn.from.y, r.y + r.h) && close(burn.to.y, r.y + r.h))
    coordinate = (p) => r.w + r.h + r.x + r.w - p.x;
  else if (close(burn.from.x, r.x) && close(burn.to.x, r.x))
    coordinate = (p) => 2 * r.w + r.h + r.y + r.h - p.y;
  return coordinate === null
    ? null
    : ([coordinate(burn.from), coordinate(burn.to)].sort((a, b) => a - b) as [number, number]);
}
export function tabOverlapMm(shape: Shape, burn: OracleBurn): number {
  const range = edgeRange(shape, burn);
  if (!range) throw new Error('Tab check requires an actual rectangle edge');
  const perimeter = 2 * (shape.w + shape.h);
  return [0, 1, 2, 3].reduce((total, i) => {
    const center = ((i + 0.5) * perimeter) / 4;
    return total + Math.max(0, Math.min(range[1], center + 1) - Math.max(range[0], center - 1));
  }, 0);
}
