/**
 * F45-04-003: DXF import must honor $INSUNITS and require an explicit
 * unit choice when a DXF is unitless/ambiguous.
 *
 * Run: npx tsx tests/dxf-unit-import.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScene } from '../src/core/scene/Scene';
import {
  chooseDxfUnitModeForImport,
  parseDxfUnitInfoFromText,
  type DxfUnitMode,
} from '../src/import/dxf/DxfUnits';
import { importDxfIntoScene } from '../src/import/dxf';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

function closeTo(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) <= eps;
}

function dxfWithInsunits(code: number | null, x2 = 2): string {
  const header = code == null
    ? []
    : [
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$INSUNITS',
        '70', String(code),
        '0', 'ENDSEC',
      ];
  return [
    ...header,
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LINE',
    '8', 'Cut',
    '10', '0',
    '20', '0',
    '11', String(x2),
    '21', '0',
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

console.log('\n=== F45-04-003 DXF unit import ===\n');

void (async () => {
  {
    const info = parseDxfUnitInfoFromText(dxfWithInsunits(1));
    assert(info.source === 'header', 'INSUNITS=1 is parsed from HEADER');
    assert(info.unit === 'inch', 'INSUNITS=1 maps to inch');
    assert(closeTo(info.scaleToMm, 25.4), 'inch scale is 25.4 mm');
  }

  {
    const scene = importDxfIntoScene(dxfWithInsunits(1, 2), createScene(100, 100, 'dxf inch'));
    const line = scene.objects[0]?.geometry;
    assert(line?.type === 'line', 'inch DXF imports a line');
    if (line?.type === 'line') {
      assert(closeTo(line.x2, 50.8), '2 inch DXF line is scaled to 50.8 mm');
    }
  }

  {
    const scene = importDxfIntoScene(dxfWithInsunits(4, 20), createScene(100, 100, 'dxf mm'));
    const line = scene.objects[0]?.geometry;
    assert(line?.type === 'line', 'mm DXF imports a line');
    if (line?.type === 'line') {
      assert(closeTo(line.x2, 20), '20 mm DXF line remains 20 mm');
    }
  }

  {
    const unitless = dxfWithInsunits(null, 2);
    let prompts = 0;
    let choicesSeen: readonly { value: string; label: string }[] = [];
    const choice = await chooseDxfUnitModeForImport(
      unitless,
      async (_title, _message, choices) => {
        prompts++;
        choicesSeen = choices;
        return 'inch';
      },
      null,
    );
    assert(prompts === 1, 'unitless DXF asks for an explicit unit choice');
    assert(choicesSeen.some(choice => choice.value === 'inch'), 'unitless DXF prompt offers inches');
    assert(choice === 'inch', 'selected unit is returned');

    const scene = importDxfIntoScene(unitless, createScene(100, 100, 'dxf chosen inch'), { unitMode: choice as DxfUnitMode });
    const line = scene.objects[0]?.geometry;
    assert(line?.type === 'line', 'chosen-unit DXF imports a line');
    if (line?.type === 'line') {
      assert(closeTo(line.x2, 50.8), 'unitless DXF chosen as inches is scaled to 50.8 mm');
    }
  }

  {
    const unitless = dxfWithInsunits(null, 2);
    const choice = await chooseDxfUnitModeForImport(
      unitless,
      async () => 'cancel',
      null,
    );
    assert(choice === null, 'cancelled unitless DXF import returns null');
  }

  {
    const toolbar = readFileSync(resolve(process.cwd(), 'src/ui/components/FileToolbar.tsx'), 'utf-8');
    const dropHook = readFileSync(resolve(process.cwd(), 'src/ui/hooks/useImport.ts'), 'utf-8');
    assert(toolbar.includes('chooseDxfUnitModeForImport'), 'toolbar DXF import asks for unit choice');
    assert(dropHook.includes('chooseDxfUnitModeForImport'), 'drag/drop DXF import asks for unit choice');
    assert(toolbar.includes('importDxfIntoScene(text, scene, { unitMode: dxfUnitMode })'), 'toolbar passes chosen DXF unit into import');
    assert(dropHook.includes('importDxfIntoScene(text, scene, { unitMode: dxfUnitMode })'), 'drag/drop passes chosen DXF unit into import');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
