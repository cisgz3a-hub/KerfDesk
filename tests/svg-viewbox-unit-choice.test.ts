/**
 * T3-32: viewBox-only SVG imports must ask which physical-unit convention to use.
 * Run: npx tsx tests/svg-viewbox-unit-choice.test.ts
 */
import { readFileSync } from 'node:fs';
import {
  SVG_UNIT_MODE_PREFERENCE_KEY,
  buildSvgUnitChoicePrompt,
  chooseSvgUnitModeForImport,
  detectViewBoxOnlySvgUnitAmbiguity,
  type SvgUnitChoiceOption,
} from '../src/import/svg/SvgUnitChoice';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

function assertClose(actual: number, expected: number, epsilon: number, msg: string): void {
  assert(Math.abs(actual - expected) <= epsilon, `${msg} (got ${actual}, expected ${expected})`);
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

async function main(): Promise<void> {
  console.log('\n=== SVG viewBox-only unit choice ===\n');

  const viewBoxOnlySvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
    <rect x="0" y="0" width="100" height="50" />
  </svg>`;

  {
    const ambiguity = detectViewBoxOnlySvgUnitAmbiguity(viewBoxOnlySvg);
    assert(ambiguity !== null, 'viewBox-only SVG is detected as unit-ambiguous');
    if (ambiguity) {
      assertClose(ambiguity.viewBox.width, 100, 0.001, 'viewBox width is reported');
      assertClose(ambiguity.viewBox.height, 50, 0.001, 'viewBox height is reported');
      assertClose(ambiguity.laserConvention.widthMm, 100, 0.001, 'laser convention keeps user units as mm');
      assertClose(ambiguity.laserConvention.heightMm, 50, 0.001, 'laser convention height stays in mm');
      assertClose(ambiguity.svgSpec.widthMm, 26.4583, 0.001, 'SVG spec converts px to mm');
      assertClose(ambiguity.svgSpec.heightMm, 13.2292, 0.001, 'SVG spec height converts px to mm');
    }
  }

  {
    const explicitSizeSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
      <rect x="0" y="0" width="100" height="50" />
    </svg>`;
    assert(
      detectViewBoxOnlySvgUnitAmbiguity(explicitSizeSvg) === null,
      'SVG with explicit width and height does not prompt',
    );
  }

  {
    const ambiguity = detectViewBoxOnlySvgUnitAmbiguity(viewBoxOnlySvg);
    assert(ambiguity !== null, 'prompt fixture is ambiguous');
    if (ambiguity) {
      const prompt = buildSvgUnitChoicePrompt(ambiguity, 'spec');
      assert(prompt.message.includes('100 x 50'), 'prompt names the raw viewBox dimensions');
      assert(prompt.details.includes('100 x 50 mm'), 'prompt shows laser-convention physical size');
      assert(prompt.details.includes('26.46 x 13.23 mm'), 'prompt shows SVG-spec physical size');
      assert(prompt.choices[0].value === 'spec', 'previous unit choice is the default primary choice');
      assert(prompt.choices.some(choice => choice.value === 'laser'), 'prompt still offers laser convention');
      assert(prompt.choices.some(choice => choice.value === 'cancel'), 'prompt offers cancel');
    }
  }

  {
    const storage = new MemoryStorage();
    storage.setItem(SVG_UNIT_MODE_PREFERENCE_KEY, 'spec');
    let choicesSeen: readonly SvgUnitChoiceOption[] = [];
    const selected = await chooseSvgUnitModeForImport(
      viewBoxOnlySvg,
      async (_title, _message, choices) => {
        choicesSeen = choices;
        return 'laser';
      },
      storage,
    );

    assert(selected === 'laser', 'selected unit mode is returned');
    assert(choicesSeen[0]?.value === 'spec', 'stored previous choice controls prompt ordering');
    assert(storage.getItem(SVG_UNIT_MODE_PREFERENCE_KEY) === 'laser', 'new selection is persisted');
  }

  {
    const toolbarSource = readFileSync('src/ui/components/FileToolbar.tsx', 'utf8');
    const useImportSource = readFileSync('src/ui/hooks/useImport.ts', 'utf8');
    const appSource = readFileSync('src/ui/components/App.tsx', 'utf8');

    assert(toolbarSource.includes('chooseSvgUnitModeForImport'), 'toolbar SVG import asks for a unit choice');
    assert(toolbarSource.includes('svgUnitMode'), 'toolbar passes selected svgUnitMode to the importer');
    assert(useImportSource.includes('chooseSvgUnitModeForImport'), 'drag/drop SVG import asks for a unit choice');
    assert(useImportSource.includes('svgUnitMode'), 'drag/drop passes selected svgUnitMode to the importer');
    assert(appSource.includes('showChoice'), 'App modal layer exposes a multi-choice prompt');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
