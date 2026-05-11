/**
 * T1-135: regression test for the pure `validateJobTicket` helper
 * extracted from `MachineService.validateTicket`.
 *
 * Pre-T1-135 this 60-line method lived inside MachineService; testing
 * the four-gate validation logic required mounting the service AND
 * stubbing the `getActiveProfile()` singleton. Post-T1-135 every gate
 * is testable from synthetic inputs alone.
 *
 * The four gates fire in canonical order:
 *   1. Scene hash mismatch  → "The design changed..."
 *   2. Profile hash mismatch → "The device profile changed..."
 *   3. Controller type mismatch → "The controller type changed..."
 *   4. Gcode hash mismatch  → "Ticket is corrupted..."
 *
 * Each mismatch's user-facing copy is part of the contract (UI relies
 * on the verbatim message) so the test pins the exact strings.
 *
 * Run: npx tsx tests/validate-job-ticket.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/core/scene/Scene';
import type { DeviceProfile } from '../src/core/devices/DeviceProfile';
import type { ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import {
  hashObject,
  hashSceneForTicket,
  hashString,
} from '../src/core/job/ticketHashing';
import { validateJobTicket } from '../src/app/validateJobTicket';

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

const originalWarn = console.warn;
let warnCalls: Array<{ msg: string; args: unknown[] }> = [];
console.warn = (msg: string, ...args: unknown[]) => {
  warnCalls.push({ msg, args });
};

function resetWarns(): void {
  warnCalls = [];
}

function makeScene(seed = 1): Scene {
  return {
    id: `scene-${seed}`,
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects: [],
    layers: [],
    activeLayerId: '',
    metadata: { name: `t-${seed}` } as never,
  } as unknown as Scene;
}

function makeProfile(seed = 1): DeviceProfile {
  return {
    id: `prof-${seed}`,
    name: `Profile ${seed}`,
  } as unknown as DeviceProfile;
}

function makeTicket(args: {
  scene: Scene;
  profile: DeviceProfile | null;
  gcodeText: string;
  controllerType?: ValidatedJobTicket['controllerType'];
}): ValidatedJobTicket {
  return {
    ticketId: 't1',
    sceneHash: hashSceneForTicket(args.scene),
    profileHash: args.profile ? hashObject(args.profile) : hashString('no-profile'),
    gcodeHash: hashString(args.gcodeText),
    gcodeLines: args.gcodeText.split('\n'),
    gcodeText: args.gcodeText,
    machinePlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    machineTransform: {} as never,
    controllerType: args.controllerType ?? 'grbl',
    startMode: 'absolute' as never,
    savedOrigin: null,
    createdAt: Date.now(),
  } as ValidatedJobTicket;
}

console.log('\n=== T1-135 validateJobTicket ===\n');

// -------- 1. happy path: every gate passes --------
{
  resetWarns();
  const scene = makeScene();
  const profile = makeProfile();
  const ticket = makeTicket({ scene, profile, gcodeText: 'G0 X1\nG0 X2' });
  const r = validateJobTicket({
    ticket,
    scene,
    currentProfile: profile,
    currentControllerType: 'grbl',
  });
  assert(r.ok === true, 'happy path: ok = true');
  assert(warnCalls.length === 0, 'happy path: no warn diagnostics');
}

// -------- 2. scene hash mismatch --------
{
  resetWarns();
  const ticketScene = makeScene(1);
  const profile = makeProfile();
  const ticket = makeTicket({ scene: ticketScene, profile, gcodeText: 'G0' });
  const r = validateJobTicket({
    ticket,
    scene: makeScene(2),
    currentProfile: profile,
    currentControllerType: 'grbl',
  });
  assert(r.ok === false, 'scene mismatch: ok = false');
  assert(
    r.ok === false &&
      r.reason ===
        'The design changed after this G-code was created. '
          + 'Update G-code, then frame again before starting.',
    'scene mismatch: user-facing copy matches verbatim',
  );
  assert(warnCalls.length >= 1 && warnCalls[0].msg === '[ticket] scene hash mismatch',
    'scene mismatch: console.warn diagnostic emitted');
}

// -------- 3. profile hash mismatch --------
{
  resetWarns();
  const scene = makeScene();
  const ticketProfile = makeProfile(1);
  const ticket = makeTicket({ scene, profile: ticketProfile, gcodeText: 'G0' });
  const r = validateJobTicket({
    ticket,
    scene,
    currentProfile: makeProfile(2),
    currentControllerType: 'grbl',
  });
  assert(r.ok === false, 'profile mismatch: ok = false');
  assert(
    r.ok === false &&
      r.reason ===
        'The device profile changed after this G-code was created. '
          + 'Update G-code before starting.',
    'profile mismatch: user-facing copy matches verbatim',
  );
  assert(warnCalls.length >= 1 && warnCalls[0].msg === '[ticket] profile hash mismatch',
    'profile mismatch: console.warn diagnostic emitted');
}

// -------- 4. profile null vs ticket-with-profile --------
{
  resetWarns();
  const scene = makeScene();
  const ticketProfile = makeProfile();
  const ticket = makeTicket({ scene, profile: ticketProfile, gcodeText: 'G0' });
  const r = validateJobTicket({
    ticket,
    scene,
    currentProfile: null,
    currentControllerType: 'grbl',
  });
  assert(r.ok === false,
    'null currentProfile vs profile-bound ticket → mismatch');
}

// -------- 5. profile null on both sides → ok --------
{
  resetWarns();
  const scene = makeScene();
  const ticket = makeTicket({ scene, profile: null, gcodeText: 'G0' });
  const r = validateJobTicket({
    ticket,
    scene,
    currentProfile: null,
    currentControllerType: 'grbl',
  });
  assert(r.ok === true,
    'both sides null profile → ok (hashString("no-profile") match)');
}

// -------- 6. controller type mismatch --------
{
  resetWarns();
  const scene = makeScene();
  const profile = makeProfile();
  const ticket = makeTicket({ scene, profile, gcodeText: 'G0',
    controllerType: 'marlin' as never });
  const r = validateJobTicket({
    ticket,
    scene,
    currentProfile: profile,
    currentControllerType: 'grbl',
  });
  assert(r.ok === false, 'controller mismatch: ok = false');
  assert(
    r.ok === false &&
      r.reason ===
        'The controller type changed after this G-code was created. '
          + 'Update G-code before starting.',
    'controller mismatch: user-facing copy matches verbatim',
  );
  assert(warnCalls.length >= 1 && warnCalls[0].msg === '[ticket] controller type mismatch',
    'controller mismatch: console.warn diagnostic emitted');
}

// -------- 7. gcode hash mismatch (corrupted ticket) --------
{
  resetWarns();
  const scene = makeScene();
  const profile = makeProfile();
  const ticket = makeTicket({ scene, profile, gcodeText: 'G0' });
  // Corrupt the gcodeText after the hash was computed.
  const corrupted = { ...ticket, gcodeText: 'G1' } as ValidatedJobTicket;
  const r = validateJobTicket({
    ticket: corrupted,
    scene,
    currentProfile: profile,
    currentControllerType: 'grbl',
  });
  assert(r.ok === false, 'gcode hash mismatch: ok = false');
  assert(
    r.ok === false &&
      r.reason === 'Ticket is corrupted (gcode hash mismatch). Recompile to continue.',
    'gcode mismatch: user-facing copy matches verbatim',
  );
}

// -------- 8. gate order: scene mismatch wins over profile mismatch --------
{
  resetWarns();
  const ticketScene = makeScene(1);
  const ticketProfile = makeProfile(1);
  const ticket = makeTicket({ scene: ticketScene, profile: ticketProfile, gcodeText: 'G0' });
  // Both scene AND profile mismatch — scene is checked first.
  const r = validateJobTicket({
    ticket,
    scene: makeScene(2),
    currentProfile: makeProfile(2),
    currentControllerType: 'grbl',
  });
  assert(r.ok === false &&
    r.reason ===
      'The design changed after this G-code was created. '
        + 'Update G-code, then frame again before starting.',
    'gate order: scene mismatch wins over simultaneous profile mismatch');
  assert(warnCalls.length === 1,
    'gate order: only the first failing gate logs (no double-warn)');
}

// -------- 9. Source-level pin: MachineService delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const svcSrc = readFileSync(
    resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/from '\.\/validateJobTicket'/.test(svcSrc),
    'MachineService imports validateJobTicket');
  assert(/T1-135/.test(svcSrc),
    'MachineService carries T1-135 marker');
  // The pre-T1-135 inline implementation is gone. Pin two distinctive
  // signatures: the explicit `[ticket] scene hash mismatch` console
  // string literal and the `recomputedGcodeHash !== ticket.gcodeHash`
  // expression — both were in the inline body, both are now only in
  // the helper.
  assert(!/\[ticket\] scene hash mismatch/.test(svcSrc),
    'inline "[ticket] scene hash mismatch" diagnostic is gone from MachineService');
  assert(!/recomputedGcodeHash !== ticket\.gcodeHash/.test(svcSrc),
    'inline gcode-hash-recompute is gone from MachineService');

  const helperSrc = readFileSync(
    resolve(here, '../src/app/validateJobTicket.ts'),
    'utf-8',
  );
  assert(/T1-135/.test(helperSrc),
    'validateJobTicket carries T1-135 marker');
  assert(/export function validateJobTicket/.test(helperSrc),
    'validateJobTicket is exported');
}

console.warn = originalWarn;
console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
