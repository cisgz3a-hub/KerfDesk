/**
 * F45-04-002: SVG import UI must reject oversized files before file.text().
 *
 * Run: npx tsx tests/svg-file-size-preflight.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SVG_LIMITS,
  SvgImportLimitError,
  readSvgFileTextWithinLimit,
} from '../src/import/svg/SvgComplexityLimits';

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

console.log('\n=== F45-04-002 SVG file-size preflight ===\n');

void (async () => {
  {
    let textCalls = 0;
    const oversized = {
      size: SVG_LIMITS.MAX_BYTES + 1,
      text: async () => {
        textCalls++;
        return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      },
    };
    let error: unknown = null;
    try {
      await readSvgFileTextWithinLimit(oversized);
    } catch (err) {
      error = err;
    }
    assert(error instanceof SvgImportLimitError, 'oversized SVG file is rejected');
    assert(textCalls === 0, 'oversized SVG file.text() is not called');
  }

  {
    let textCalls = 0;
    const small = {
      size: SVG_LIMITS.MAX_BYTES,
      text: async () => {
        textCalls++;
        return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      },
    };
    const text = await readSvgFileTextWithinLimit(small);
    assert(text.includes('<svg'), 'limit-sized SVG file still reads text');
    assert(textCalls === 1, 'valid SVG file.text() is called exactly once');
  }

  {
    const toolbar = readFileSync(resolve(process.cwd(), 'src/ui/components/FileToolbar.tsx'), 'utf-8');
    const dropHook = readFileSync(resolve(process.cwd(), 'src/ui/hooks/useImport.ts'), 'utf-8');

    assert(
      toolbar.includes('readSvgFileTextWithinLimit(file)'),
      'toolbar SVG input uses shared SVG size preflight helper',
    );
    assert(
      dropHook.includes('readSvgFileTextWithinLimit(file)'),
      'drag/drop SVG import uses shared SVG size preflight helper',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
