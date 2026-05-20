/**
 * T3-77: project file integrity checksum.
 *
 * Run: npx tsx tests/checksum-validation.test.ts
 */
import { readFileSync } from 'node:fs';
import { createScene } from '../src/core/scene/Scene';
import {
  deserializeSceneWithIntegrity,
  serializeForAutosave,
  serializeScene,
} from '../src/io/SceneSerializer';
import {
  PROJECT_CHECKSUM_ALGORITHM,
  ProjectChecksumLoadCancelledError,
  ProjectChecksumMismatchError,
  canonicalJson,
  confirmProjectChecksumMismatch,
  projectChecksumMismatchWarning,
  sha256Hex,
  validateSceneFileChecksum,
} from '../src/io/ProjectIntegrity';
import { parseSceneFile } from '../src/io/LargeProjectHandling';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

console.log('\n=== T3-77 project integrity checksum ===\n');

void (async () => {
  assert(PROJECT_CHECKSUM_ALGORITHM === 'sha256-canonical-scene-v1', 'checksum algorithm marker is versioned');
  assert(
    sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'sha256Hex matches empty-string test vector',
  );
  assert(
    sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'sha256Hex matches abc test vector',
  );
  assert(
    canonicalJson({ z: 3, a: { y: 2, x: 1 } }) === canonicalJson({ a: { x: 1, y: 2 }, z: 3 }),
    'canonicalJson is stable across object key order',
  );

  const scene = createScene(400, 300, 'Checksum Scene');
  const json = serializeScene(scene);
  const file = JSON.parse(json);
  assert(file.version === '1.2', 'saved project file version is bumped to 1.2');
  assert(file.checksumAlgorithm === PROJECT_CHECKSUM_ALGORITHM, 'saved project declares checksum algorithm');
  assert(/^[a-f0-9]{64}$/.test(file.checksum), 'saved project carries a sha256 checksum');
  assert(validateSceneFileChecksum(file).kind === 'match', 'fresh saved project checksum validates');
  assert(deserializeSceneWithIntegrity(json).id === scene.id, 'fresh saved project loads through integrity path');

  const autosave = JSON.parse(serializeForAutosave(scene));
  assert(/^[a-f0-9]{64}$/.test(autosave.checksum), 'autosave serialization carries a sha256 checksum');
  assert(validateSceneFileChecksum(autosave).kind === 'match', 'autosave checksum validates');

  const tampered = JSON.parse(json);
  tampered.scene.metadata.name = 'Tampered Name';
  const tamperedJson = JSON.stringify(tampered);
  const mismatch = validateSceneFileChecksum(tampered);
  assert(mismatch.kind === 'mismatch', 'tampered scene produces checksum mismatch');
  assert(
    mismatch.kind === 'mismatch' && mismatch.expected !== mismatch.actual,
    'checksum mismatch reports expected and actual hashes',
  );
  try {
    deserializeSceneWithIntegrity(tamperedJson);
    assert(false, 'integrity path rejects checksum mismatch');
  } catch (error) {
    assert(error instanceof ProjectChecksumMismatchError, 'integrity rejection uses ProjectChecksumMismatchError');
  }
  assert(
    deserializeSceneWithIntegrity(tamperedJson, { allowChecksumMismatch: true }).metadata.name === 'Tampered Name',
    'integrity path can load mismatch when caller explicitly allows it',
  );

  const legacy = JSON.parse(json);
  delete legacy.checksum;
  delete legacy.checksumAlgorithm;
  assert(validateSceneFileChecksum(legacy).kind === 'no-checksum', 'legacy project without checksum is detected');
  assert(deserializeSceneWithIntegrity(JSON.stringify(legacy)).id === scene.id, 'legacy project without checksum still loads');

  assert(
    projectChecksumMismatchWarning(mismatch).includes('File integrity check failed'),
    'checksum warning has user-facing title text',
  );
  {
    let calls = 0;
    const ok = await confirmProjectChecksumMismatch(mismatch, async (title, message) => {
      calls++;
      return title === 'File integrity check failed' && message.includes('try to load it');
    });
    assert(ok && calls === 1, 'checksum mismatch confirmation asks once');
  }
  {
    let cancelled = false;
    try {
      await parseSceneFile({
        size: tamperedJson.length,
        text: async () => tamperedJson,
      } as File, {
        confirmChecksumMismatch: async () => false,
      });
    } catch (error) {
      cancelled = error instanceof ProjectChecksumLoadCancelledError;
    }
    assert(cancelled, 'parseSceneFile treats declined checksum mismatch as user cancellation');
  }

  const parser = readFileSync('src/io/LargeProjectHandling.ts', 'utf-8');
  assert(parser.includes('confirmProjectChecksumMismatch'), 'shared file parser can prompt on checksum mismatch');
  assert(parser.includes('allowChecksumMismatch'), 'shared file parser can retry after explicit mismatch consent');

  const worker = readFileSync('src/io/SceneParseWorker.ts', 'utf-8');
  assert(worker.includes('deserializeSceneWithIntegrity'), 'scene parse worker enforces integrity validation');
  assert(worker.includes('allowChecksumMismatch'), 'scene parse worker accepts explicit mismatch override');

  const toolbar = readFileSync('src/ui/components/FileToolbar.tsx', 'utf-8');
  assert(toolbar.includes('confirmProjectChecksumMismatch'), 'toolbar open prompts on checksum mismatch');
  assert(toolbar.includes('ProjectChecksumLoadCancelledError'), 'toolbar open treats checksum mismatch cancel as non-error');

  const fileHandlers = readFileSync('src/ui/hooks/useFileHandlers.ts', 'utf-8');
  assert(fileHandlers.includes('confirmProjectChecksumMismatch'), 'keyboard open prompts on checksum mismatch');
  assert(fileHandlers.includes('ProjectChecksumLoadCancelledError'), 'keyboard open treats checksum mismatch cancel as non-error');

  const importHook = readFileSync('src/ui/hooks/useImport.ts', 'utf-8');
  assert(importHook.includes('confirmProjectChecksumMismatch'), 'drag/drop project import prompts on checksum mismatch');
  assert(importHook.includes('ProjectChecksumLoadCancelledError'), 'drag/drop project import treats checksum mismatch cancel as non-error');

  const wizardHandlers = readFileSync('src/ui/hooks/useWizardHandlers.ts', 'utf-8');
  assert(
    wizardHandlers.includes('deserializeSceneWithIntegrity'),
    'autosave recovery loads through integrity validation',
  );
  assert(
    wizardHandlers.includes('autosaveRecordChecksumValid'),
    'autosave recovery checks the atomic autosave record checksum',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
