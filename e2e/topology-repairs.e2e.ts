import { writeFileSync } from 'node:fs';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import {
  burnIntervals,
  duplicateIntervals,
  edgeRange,
  fillShapes,
  importTopologyProject,
  inside,
  length,
  lineShapes,
  observeTopologyWorkers,
  programBurns,
  saveTopologyGcode,
  tabOverlapMm,
  topologyWorkerRequests,
  type ProgramBurn,
  type Shape,
} from './fixtures/topology-repairs';

// Renderer-only workflows with fake file pickers. These deliberately exercise
// Save, not Frame/Start or controller/material behaviour. No source test module runs in the page.
test('saved Fill pools voids and gives each positive region one process owner', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(180_000);
  await observeTopologyWorkers(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  const project = await importTopologyProject(page, kerfdesk, 'fill');
  await page.screenshot({ path: info.outputPath('fill-workspace.png') });
  const gcode = await saveTopologyGcode(page, kerfdesk);
  writeFileSync(info.outputPath('fill.gcode'), gcode);
  writeFileSync(info.outputPath('fill-project.lf2'), JSON.stringify(project, null, 2));
  const burns = programBurns(gcode);
  expect(burns.length).toBeGreaterThan(20);
  const intervals = burnIntervals(burns, fillShapes);
  expect(intervals.length).toBeGreaterThan(20);
  const classified = intervals.map((interval) => ({ ...interval, owner: fillOwner(interval.at) }));
  expect(classified.filter((row) => row.owner === null)).toEqual([]);
  const observed = new Set<string>();
  for (const { burn, owner } of classified) {
    if (!owner) throw new Error('A Fill burn entered a void');
    observed.add(owner.id);
    assertProcess(burn, owner, false);
    const angle =
      Math.abs(burn.to.y - burn.from.y) < 1e-6
        ? 0
        : Math.abs(burn.to.x - burn.from.x) < 1e-6
          ? 90
          : -1;
    expect(angle, `${owner.id} hatch on saved line ${burn.line}`).toBe(
      owner.settings.hatchAngleDeg,
    );
    expect(burn.pass).toBe(1);
    expect(burn.passCount).toBe(1);
  }
  expect([...observed].sort()).toEqual(['C', 'I', 'P', 'cross-P']);
  expect(
    classified.some((row) => row.owner?.id === 'C' && inside(fillShape('cross-H'), row.at)),
  ).toBe(true);
  expect(
    classified.some((row) => row.owner?.id === 'C' && !inside(fillShape('cross-P'), row.at)),
  ).toBe(true);
  expect(duplicateIntervals(burns)).toEqual([]);
  const workerRequests = await topologyWorkerRequests(page);
  expect(workerRequests.some((request) => request.kind === 'save')).toBe(true);
  const events = await assertFileOnly(page, kerfdesk);
  writeFileSync(
    info.outputPath('fill-analytic-evidence.json'),
    JSON.stringify(
      {
        workerRequests,
        events,
        burns,
        classified,
        oracle:
          'Independent emitted G1 interpreter + rectangle edge-subinterval membership; 0.002 mm rounding margin.',
        setup:
          'UI SVG Import; original geometry retained; process/device/order fixture seeded; C is canvas-frontmost positive contributor.',
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('fill-saved.png') });
});

test('saved Line finishes each inner packet before outer passes without changing bridges or overcut', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(180_000);
  await observeTopologyWorkers(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  const project = await importTopologyProject(page, kerfdesk, 'line');
  await page.screenshot({ path: info.outputPath('line-workspace.png') });
  const gcode = await saveTopologyGcode(page, kerfdesk);
  writeFileSync(info.outputPath('line.gcode'), gcode);
  writeFileSync(info.outputPath('line-project.lf2'), JSON.stringify(project, null, 2));
  const burns = programBurns(gcode);
  expect(burns.length).toBeGreaterThan(20);
  const rows = burns.map((burn) => ({
    burn,
    owners: lineShapes.filter((shape) => edgeRange(shape, burn) !== null),
  }));
  expect(rows.filter((row) => row.owners.length !== 1)).toEqual([]);
  const byShape = lineShapes.map((shape) => ({
    shape,
    burns: rows.filter((row) => row.owners[0]?.id === shape.id).map((row) => row.burn),
  }));
  for (const record of byShape) checkLineShape(gcode, record.shape, record.burns);
  for (const pair of [
    ['fragment-inner', 'fragment-outer'],
    ['closed-inner', 'closed-outer'],
  ] as const) {
    const inner = byShape.find((row) => row.shape.id === pair[0])?.burns ?? [];
    const outer = byShape.find((row) => row.shape.id === pair[1])?.burns ?? [];
    expect(inner.length).toBeGreaterThan(0);
    expect(outer.length).toBeGreaterThan(0);
    expect(
      Math.max(...inner.map((burn) => burn.line)),
      `${pair[0]} main and bridge passes before outer`,
    ).toBeLessThan(Math.min(...outer.map((burn) => burn.line)));
  }
  const workerRequests = await topologyWorkerRequests(page);
  const events = await assertFileOnly(page, kerfdesk);
  writeFileSync(
    info.outputPath('line-analytic-evidence.json'),
    JSON.stringify(
      {
        workerRequests,
        events,
        burns,
        byShape,
        oracle:
          'Independent emitted G1 interpreter, rectangle perimeters, four 2 mm tabs, 3/1 mm dashes, final-pass-only 2 mm retrace.',
        setup:
          'UI SVG Import; original geometry retained; differing settings/passes and inside-first fixture seeded.',
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('line-saved.png') });
});

function fillShape(id: string): Shape {
  const found = fillShapes.find((shape) => shape.id === id);
  if (!found) throw new Error(`Unknown Fill fixture ${id}`);
  return found;
}
function fillOwner(point: { readonly x: number; readonly y: number }): Shape | null {
  if (point.x < 120) {
    if (inside(fillShape('I'), point)) return fillShape('I');
    return inside(fillShape('P'), point) && !inside(fillShape('H'), point) ? fillShape('P') : null;
  }
  const positiveP = inside(fillShape('cross-P'), point),
    negativeH = inside(fillShape('cross-H'), point),
    positiveC = inside(fillShape('C'), point);
  if ((Number(positiveP) + Number(negativeH) + Number(positiveC)) % 2 === 0) return null;
  return positiveC ? fillShape('C') : positiveP ? fillShape('cross-P') : null;
}
function assertProcess(burn: ProgramBurn, shape: Shape, bridge: boolean): void {
  expect(burn.power, `${shape.id} saved S on line ${burn.line}`).toBe(
    shape.settings.power * 10 * (bridge ? 0.25 : 1),
  );
  expect(burn.feed, `${shape.id} saved F on line ${burn.line}`).toBe(shape.settings.speed);
  expect(burn.beam).toBe(shape.settings.powerMode === 'constant' ? 3 : 4);
  expect(burn.air).toBe(shape.settings.airAssist ? 'M8' : 'off');
  expect(burn.frame).toBe('G54 G94 mm');
}
function checkLineShape(gcode: string, shape: Shape, burns: readonly ProgramBurn[]): void {
  expect(burns.length, `${shape.id} actual saved burns`).toBeGreaterThan(0);
  const main = burns.filter((burn) => burn.power === shape.settings.power * 10);
  const bridges = burns.filter((burn) => burn.power !== shape.settings.power * 10);
  const isFragmented = shape.settings.tabsEnabled === true;
  expect(main.length).toBeGreaterThan(0);
  for (const burn of burns) {
    const bridge = bridges.includes(burn);
    assertProcess(burn, shape, bridge);
    expect(burn.passCount).toBe(shape.settings.passes);
    expect(burn.pass).toBeGreaterThanOrEqual(1);
    expect(burn.pass).toBeLessThanOrEqual(shape.settings.passes);
    if (isFragmented) expect(tabOverlapMm(shape, burn)).toBeCloseTo(bridge ? length(burn) : 0, 5);
  }
  const perimeter = 2 * (shape.w + shape.h);
  for (let pass = 1; pass <= shape.settings.passes; pass += 1) {
    const actual = main
      .filter((burn) => burn.pass === pass)
      .reduce((sum, burn) => sum + length(burn), 0);
    const piece = perimeter / 4 - 2;
    const dashedLength = 4 * (Math.floor(piece / 4) * 3 + Math.min(3, piece % 4));
    const expected = isFragmented
      ? dashedLength
      : perimeter + (pass === shape.settings.passes ? 2 : 0);
    expect(actual, `${shape.id} main length on pass ${pass}`).toBeCloseTo(expected, 5);
    const bridgeLength = bridges
      .filter((burn) => burn.pass === pass)
      .reduce((sum, burn) => sum + length(burn), 0);
    expect(bridgeLength, `${shape.id} tab length on pass ${pass}`).toBeCloseTo(
      isFragmented ? 8 : 0,
      5,
    );
  }
  if (isFragmented) {
    expect(bridges.length).toBeGreaterThan(0);
    expect(Math.max(...main.map((burn) => burn.line))).toBeLessThan(
      Math.min(...bridges.map((burn) => burn.line)),
    );
    const strokes = strokeLengths(gcode, main);
    expect(strokes.length).toBeGreaterThan(4 * shape.settings.passes);
    expect(Math.max(...strokes)).toBeLessThanOrEqual(3 + 1e-5);
  } else expect(bridges).toEqual([]);
}
async function assertFileOnly(page: Page, fixture: KerfDeskFixture) {
  const events = await fixture.events();
  expect(events.filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
  expect(events.filter((event) => event.kind === 'file-saved')).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  return events;
}

function strokeLengths(gcode: string, burns: readonly ProgramBurn[]): number[] {
  const lines = gcode.split(/\r\n|\n|\r/),
    totals: number[] = [];
  let previous: ProgramBurn | undefined;
  for (const burn of burns) {
    const uninterrupted =
      previous !== undefined &&
      previous.power === burn.power &&
      previous.pass === burn.pass &&
      !lines.slice(previous.line, burn.line - 1).some((line) => /\bG0(?:\s|$)/.test(line));
    if (uninterrupted) totals[totals.length - 1] = (totals.at(-1) ?? 0) + length(burn);
    else totals.push(length(burn));
    previous = burn;
  }
  return totals;
}
