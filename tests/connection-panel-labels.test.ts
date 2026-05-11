/**
 * T1-143: regression test for the pure label / format / scene-summary
 * helpers extracted from ConnectionPanelMain. Operator-visible label
 * strings ("Cutting" / "Engraving" / "Use canvas position") are part
 * of the contract — pinned verbatim.
 *
 * Run: npx tsx tests/connection-panel-labels.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/core/scene/Scene';
import type { Layer } from '../src/core/scene/Layer';
import type { SceneObject } from '../src/core/scene/SceneObject';
import type { FrameResult } from '../src/app/ExecutionCoordinator';
import {
  buildReadyOperationRows,
  formatJobTime,
  frameFailureLogLine,
  jobModeLabel,
  layerModeToOperationKind,
  readyStartModeLabel,
} from '../src/ui/components/connection/connectionPanelLabels';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function layer(id: string, mode: 'cut' | 'engrave' | 'score' | 'image', overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id.toUpperCase(),
    color: '#000000',
    visible: true,
    locked: false,
    output: true,
    settings: {
      mode,
      power: { max: 50, min: 0 },
      speed: 1200,
      passes: 1,
    } as never,
    ...overrides,
  } as Layer;
}

function scene(layers: Layer[], objectLayerIds: string[] = []): Scene {
  return {
    id: 's',
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects: objectLayerIds.map((lid, i) => ({
      id: `obj-${i}`,
      layerId: lid,
      visible: true,
    } as unknown as SceneObject)),
    layers,
    activeLayerId: layers[0]?.id ?? '',
    metadata: { name: 't' } as never,
  } as unknown as Scene;
}

console.log('\n=== T1-143 connection-panel labels ===\n');

// -------- formatJobTime --------
assert(formatJobTime(0) === '0:00', 'formatJobTime(0) = "0:00"');
assert(formatJobTime(5) === '0:05', 'formatJobTime(5) = "0:05" (zero-padded)');
assert(formatJobTime(65) === '1:05', 'formatJobTime(65) = "1:05"');
assert(formatJobTime(125) === '2:05', 'formatJobTime(125) = "2:05"');
assert(formatJobTime(3661) === '61:01', 'formatJobTime(3661) does NOT roll to hours');
assert(formatJobTime(-100) === '0:00', 'negative seconds clamped to 0');
assert(formatJobTime(45.9) === '0:45', 'fractional seconds floored');

// -------- readyStartModeLabel --------
assert(readyStartModeLabel('absolute') === 'Use canvas position',
  'readyStartModeLabel(absolute) verbatim');
assert(readyStartModeLabel('current') === 'Start from laser head',
  'readyStartModeLabel(current) verbatim');
assert(readyStartModeLabel('savedOrigin') === 'Use saved zero point',
  'readyStartModeLabel(savedOrigin) verbatim');

// -------- layerModeToOperationKind --------
assert(layerModeToOperationKind('cut') === 'cut', 'cut → cut');
assert(layerModeToOperationKind('engrave') === 'engrave', 'engrave → engrave');
assert(layerModeToOperationKind('score') === 'score', 'score → score');
assert(layerModeToOperationKind('image') === 'image', 'image → image (per OperationKind type)');

// -------- jobModeLabel --------
{
  assert(jobModeLabel(scene([])) === 'Running',
    'no layers → Running');

  // One cut layer with an object
  const s1 = scene([layer('l1', 'cut')], ['l1']);
  assert(jobModeLabel(s1) === 'Cutting',
    'all-cut → Cutting');

  // One engrave layer
  const s2 = scene([layer('l1', 'engrave')], ['l1']);
  assert(jobModeLabel(s2) === 'Engraving',
    'all-engrave → Engraving');

  // Image layer → Engraving (operator-language)
  const s3 = scene([layer('l1', 'image')], ['l1']);
  assert(jobModeLabel(s3) === 'Engraving',
    'image → Engraving (image == engrave at operator level)');

  // Score
  const s4 = scene([layer('l1', 'score')], ['l1']);
  assert(jobModeLabel(s4) === 'Scoring',
    'score → Scoring');

  // Mixed modes → Running
  const s5 = scene([layer('l1', 'cut'), layer('l2', 'engrave')], ['l1', 'l2']);
  assert(jobModeLabel(s5) === 'Running',
    'mixed cut + engrave → Running');

  // Layer is visible but has no visible objects → not contributing
  const s6 = scene([layer('l1', 'cut'), layer('l2', 'engrave')], ['l1']);
  assert(jobModeLabel(s6) === 'Cutting',
    'engrave layer without visible objects → Cutting (only cut counts)');

  // Output-disabled layer ignored
  const s7 = scene([layer('l1', 'cut'), layer('l2', 'engrave', { output: false })], ['l1', 'l2']);
  assert(jobModeLabel(s7) === 'Cutting',
    'output:false layer ignored → Cutting');

  // Hidden layer ignored
  const s8 = scene([layer('l1', 'cut'), layer('l2', 'engrave', { visible: false })], ['l1', 'l2']);
  assert(jobModeLabel(s8) === 'Cutting',
    'invisible layer ignored → Cutting');
}

// -------- buildReadyOperationRows --------
{
  const s = scene([layer('l1', 'cut'), layer('l2', 'engrave')], ['l1', 'l2']);
  const rows = buildReadyOperationRows(s);
  assert(rows.length === 2, '2 contributing layers → 2 rows');
  assert(rows[0].index === 1 && rows[1].index === 2,
    'rows are 1-indexed in processing order');

  // Layer with no objects: skipped
  const s2 = scene([layer('l1', 'cut'), layer('l2', 'engrave')], ['l1']);
  const rows2 = buildReadyOperationRows(s2);
  assert(rows2.length === 1, 'layer with 0 visible objects → skipped');
  assert(rows2[0].layerName === 'L1',
    'remaining row carries layer.name');

  // power / speed / passes rounding
  const s3 = scene(
    [layer('l1', 'cut', {
      settings: {
        mode: 'cut',
        power: { max: 75.6, min: 0 },
        speed: 1234.7,
        passes: 2.3,
      } as never,
    })],
    ['l1'],
  );
  const rows3 = buildReadyOperationRows(s3);
  assert(rows3[0].powerPercent === 76, 'power rounded (75.6 → 76)');
  assert(rows3[0].feedRateMmPerMin === 1235, 'speed rounded (1234.7 → 1235)');
  assert(rows3[0].passes === 2, 'passes rounded (2.3 → 2)');
  // passes minimum is 1
  const s4 = scene(
    [layer('l1', 'cut', { settings: { mode: 'cut', power: { max: 50, min: 0 }, speed: 100, passes: 0 } as never })],
    ['l1'],
  );
  assert(buildReadyOperationRows(s4)[0].passes === 1,
    'passes clamped to min 1');
}

// -------- frameFailureLogLine --------
{
  const result: FrameResult = { kind: 'success' } as unknown as FrameResult;
  // Frame success would not normally be passed to frameFailureLogLine,
  // but the function should still call describeFrameFailure and format
  // the result. We test that the output is shaped like
  // "⚠ <title>: <message> <recovery>[ Details: <details>]"
  const line = frameFailureLogLine(result, 'Test frame');
  assert(line.startsWith('⚠'), 'frameFailureLogLine output starts with ⚠');
  assert(line.includes(':'), 'frameFailureLogLine includes colon separator');
}

// -------- Source-level pin: ConnectionPanelMain delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/from '\.\/connection\/connectionPanelLabels'/.test(panelSrc),
    'ConnectionPanelMain imports from connection/connectionPanelLabels');
  assert(/T1-143/.test(panelSrc),
    'ConnectionPanelMain carries T1-143 marker');
  // Each inline function definition is gone.
  assert(!/^function jobModeLabel/m.test(panelSrc),
    'inline jobModeLabel definition is gone from ConnectionPanelMain');
  assert(!/^function formatJobTime/m.test(panelSrc),
    'inline formatJobTime definition is gone');
  assert(!/^function readyStartModeLabel/m.test(panelSrc),
    'inline readyStartModeLabel definition is gone');
  assert(!/^function buildReadyOperationRows/m.test(panelSrc),
    'inline buildReadyOperationRows definition is gone');
  assert(!/^function frameFailureLogLine/m.test(panelSrc),
    'inline frameFailureLogLine definition is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/connection/connectionPanelLabels.ts'),
    'utf-8',
  );
  assert(/T1-143/.test(helperSrc),
    'connectionPanelLabels carries T1-143 marker');
  for (const name of [
    'jobModeLabel',
    'formatJobTime',
    'readyStartModeLabel',
    'layerModeToOperationKind',
    'buildReadyOperationRows',
    'frameFailureLogLine',
  ]) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc),
      `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
