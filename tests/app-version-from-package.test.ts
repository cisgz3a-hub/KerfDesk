/**
 * T1-72: SceneSerializer appVersion is supplied by Vite in production and
 * falls back to an explicit tsx-only marker in tests.
 *
 * Run: npx tsx tests/app-version-from-package.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import { serializeForAutosave, serializeScene } from '../src/io/SceneSerializer';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== T1-72 APP_VERSION from package.json ===\n');

const scene = createScene(100, 100);
const fileSave = JSON.parse(serializeScene(scene));
const autosave = JSON.parse(serializeForAutosave(scene));

assertContract(
  typeof fileSave.appVersion === 'string' && fileSave.appVersion.length > 0,
  'file-save serialization has a non-empty appVersion string',
);
assertContract(
  typeof autosave.appVersion === 'string' && autosave.appVersion.length > 0,
  'autosave serialization has a non-empty appVersion string',
);
assertContract(
  fileSave.appVersion === '0.0.0-tsx-fallback',
  'tsx file-save serialization uses the explicit fallback version',
);
assertContract(
  autosave.appVersion === '0.0.0-tsx-fallback',
  'tsx autosave serialization uses the explicit fallback version',
);
assertContract(
  fileSave.appVersion !== '0.1.0' && autosave.appVersion !== '0.1.0',
  'fallback value is not the legacy hardcoded "0.1.0"',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
