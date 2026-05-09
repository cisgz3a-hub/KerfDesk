/**
 * T3-76: save/load size warnings for raster-heavy projects.
 *
 * Run: npx tsx tests/large-project-handling.test.ts
 */
import { readFileSync } from 'node:fs';
import {
  LARGE_PROJECT_WARN_BYTES,
  PROJECT_PARSE_WORKER_THRESHOLD_BYTES,
  confirmLargeProjectLoad,
  confirmLargeProjectSave,
  formatBytes,
  largeProjectLoadWarning,
  largeProjectSaveWarning,
  parseSceneFile,
  projectLoadParsePlan,
  shouldWarnBeforeProjectLoad,
  shouldWarnBeforeProjectSave,
} from '../src/io/LargeProjectHandling';

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

console.log('\n=== T3-76 large project handling ===\n');

void (async () => {
  assert(LARGE_PROJECT_WARN_BYTES === 50_000_000, 'large project warning threshold is 50 MB');
  assert(PROJECT_PARSE_WORKER_THRESHOLD_BYTES === 5_000_000, 'worker parse threshold is tracked at 5 MB');
  assert(formatBytes(50_000_000) === '47.7 MB', 'formatBytes renders MB with one decimal');

  assert(!shouldWarnBeforeProjectSave(LARGE_PROJECT_WARN_BYTES), 'save warning does not fire at exact threshold');
  assert(shouldWarnBeforeProjectSave(LARGE_PROJECT_WARN_BYTES + 1), 'save warning fires above 50 MB');
  assert(!shouldWarnBeforeProjectLoad(LARGE_PROJECT_WARN_BYTES), 'load warning does not fire at exact threshold');
  assert(shouldWarnBeforeProjectLoad(LARGE_PROJECT_WARN_BYTES + 1), 'load warning fires above 50 MB');

  const saveMessage = largeProjectSaveWarning(60_000_000);
  assert(saveMessage.includes('57.2 MB'), 'save warning includes formatted estimated size');
  assert(saveMessage.includes('Continue saving?'), 'save warning asks for explicit confirmation');

  const loadMessage = largeProjectLoadWarning(60_000_000);
  assert(loadMessage.includes('57.2 MB'), 'load warning includes formatted file size');
  assert(loadMessage.includes('temporarily freeze'), 'load warning explains UI freeze risk');

  {
    let calls = 0;
    const ok = await confirmLargeProjectSave(60_000_000, async (title, message) => {
      calls++;
      return title === 'Large project' && message.includes('Continue saving?');
    });
    assert(ok && calls === 1, 'large save asks once and respects confirmation');
  }

  {
    let calls = 0;
    const ok = await confirmLargeProjectSave(1_000, async () => {
      calls++;
      return false;
    });
    assert(ok && calls === 0, 'small save does not ask for confirmation');
  }

  {
    let calls = 0;
    const ok = await confirmLargeProjectLoad(60_000_000, async (title, message) => {
      calls++;
      return title === 'Large project file' && message.includes('Loading may take');
    });
    assert(ok && calls === 1, 'large load asks once and respects confirmation');
  }

  {
    const smallPlan = projectLoadParsePlan(4_000_000);
    const largePlan = projectLoadParsePlan(6_000_000);
    assert(smallPlan.kind === 'main-thread', 'files under 5 MB keep the main-thread parse path');
    assert(largePlan.kind === 'worker', 'files above 5 MB route through the scene parse worker');
  }

  {
    const source = {
      size: 6_000_000,
      text: async () => JSON.stringify({
        format: 'laserforge',
        version: '1.0',
        scene: {
          id: 'scene-large',
          version: '1.0',
          canvas: { width: 400, height: 400 },
          layers: [{ id: 'layer-1', name: 'Cut', settings: { mode: 'cut' } }],
          objects: [],
          activeLayerId: 'layer-1',
          metadata: { name: 'Large' },
        },
      }),
    } as File;
    const parsed = await parseSceneFile(source);
    assert(parsed.id === 'scene-large', 'large files parse through shared parseSceneFile API');
  }

  {
    const toolbar = readFileSync('src/ui/components/FileToolbar.tsx', 'utf-8');
    assert(toolbar.includes('confirmLargeProjectSave'), 'FileToolbar warns before saving large projects');
    assert(toolbar.includes('confirmLargeProjectLoad'), 'FileToolbar warns before opening large project files');
    assert(toolbar.includes('file.size'), 'FileToolbar checks size before reading file.text()');
    assert(toolbar.includes('parseSceneFile'), 'FileToolbar uses the shared scene file parser');

    const fileHandlers = readFileSync('src/ui/hooks/useFileHandlers.ts', 'utf-8');
    assert(fileHandlers.includes('confirmLargeProjectSave'), 'keyboard save warns before saving large projects');
    assert(fileHandlers.includes('confirmLargeProjectLoad'), 'keyboard open warns before reading large files');
    assert(fileHandlers.includes('parseSceneFile'), 'keyboard open uses the shared scene file parser');

    const importHook = readFileSync('src/ui/hooks/useImport.ts', 'utf-8');
    assert(importHook.includes('confirmLargeProjectLoad'), 'drag/drop project import warns before reading large files');
    assert(importHook.includes('showConfirm'), 'drag/drop project import can ask for load confirmation');
    assert(importHook.includes('parseSceneFile'), 'drag/drop project import uses the shared scene file parser');

    const parser = readFileSync('src/io/LargeProjectHandling.ts', 'utf-8');
    assert(parser.includes('new Worker'), 'large project parser constructs a Web Worker');
    assert(parser.includes('SceneParseWorker.ts'), 'large project parser points at the scene parse worker module');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
