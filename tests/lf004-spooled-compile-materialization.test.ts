/**
 * LF-004: device-send compile must not fake streaming by draining the spool
 * into a full G-code string and splitting it back into legacy ticket lines.
 *
 * Run: npx tsx tests/lf004-spooled-compile-materialization.test.ts
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { compileGcode } from '../src/app/PipelineService';
import {
  createBlankProfile,
  getActiveProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { addObject } from '../src/ui/history/SceneCommands';

const memoryStore: Record<string, string> = {};

function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const key of Object.keys(memoryStore)) delete memoryStore[key];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      return Object.keys(memoryStore)[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function makeScene() {
  const scene = createScene(400, 300, 'LF-004 spooled compile');
  return addObject(scene, createRect(scene.layers[0].id, 20, 20, 40, 30, 'lf004-rect'));
}

async function countSpoolLines(result: NonNullable<Awaited<ReturnType<typeof compileGcode>>>): Promise<number> {
  let observed = 0;
  for await (const chunk of result.ticket.gcodeSpool!.open({ chunkLines: 3 })) {
    observed += chunk.lines.length;
    assert(chunk.lines.every(line => line.trim().length > 0), 'spool chunks contain canonical non-empty lines');
  }
  return observed;
}

async function run(): Promise<void> {
  console.log('\n=== LF-004 spooled compile materialization ===\n');

  installMockLocalStorage();
  for (const key of Object.keys(memoryStore)) delete memoryStore[key];

  const profile = createBlankProfile('LF-004 profile');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  const scene = makeScene();

  const ticketOnly = await compileGcode(
    scene,
    'absolute',
    null,
    null,
    'grbl',
    null,
    null,
    getActiveProfile(),
    { gcodeMaterialization: 'ticket-only' },
  );
  assert(ticketOnly, 'ticket-only compile returns a result');
  assert.equal(ticketOnly.gcode, '', 'ticket-only compile does not return full G-code text');
  assert(ticketOnly.ticket.gcodeSpool, 'ticket-only compile returns a replayable G-code spool');
  assert.equal(ticketOnly.ticket.gcodeText, '', 'ticket-only compile does not store full G-code text on the ticket');
  assert.deepEqual(ticketOnly.ticket.gcodeLines, [], 'ticket-only compile does not store full G-code lines on the ticket');
  assert.equal(
    await countSpoolLines(ticketOnly),
    ticketOnly.ticket.gcodeSpool!.lineCount,
    'ticket-only spool replays exactly its recorded line count',
  );
  assert.equal(
    ticketOnly.ticket.gcodeHash,
    ticketOnly.ticket.gcodeSpool!.contentHash,
    'ticket-only ticket hash is derived from the replayable spool',
  );

  const materialized = await compileGcode(
    scene,
    'absolute',
    null,
    null,
    'grbl',
    null,
    null,
    getActiveProfile(),
    { gcodeMaterialization: 'full' },
  );
  assert(materialized, 'materialized compile returns a result');
  assert.equal(typeof materialized.gcode, 'string', 'materialized compile returns full G-code text');
  assert(materialized.gcode.length > 0, 'materialized compile returns non-empty G-code text');
  const materializedLines = materialized.gcode.split('\n').map(line => line.trim()).filter(Boolean);
  assert.deepEqual(materialized.ticket.gcodeLines, materializedLines, 'materialized ticket keeps legacy lines for export/preview compatibility');
  assert.equal(materialized.ticket.gcodeText, materialized.gcode, 'materialized ticket keeps legacy G-code text');
  assert.equal(
    await countSpoolLines(materialized),
    materializedLines.length,
    'materialized spool preserves line boundaries across chunks',
  );
  assert.match(ticketOnly.ticket.gcodeHash, /^[0-9a-f]{8}$/, 'ticket-only ticket hash is stable hash-shaped metadata');
  assert.match(materialized.ticket.gcodeHash, /^[0-9a-f]{8}$/, 'materialized ticket hash is stable hash-shaped metadata');

  const pipelineSrc = readFileSync('src/app/PipelineService.ts', 'utf8');
  assert(
    /gcodeMaterialization/.test(pipelineSrc),
    'PipelineService exposes an explicit materialization mode',
  );
  const compileManagerSrc = readFileSync('src/ui/hooks/useCompileManager.ts', 'utf8');
  assert(
    /gcodeMaterialization:\s*'ticket-only'/.test(compileManagerSrc),
    'connection compile path requests ticket-only spool-backed output',
  );

  console.log('\nLF-004 spooled compile materialization: passed\n');
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
