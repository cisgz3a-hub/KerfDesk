/**
 * T2-25: first-class ControllerCapabilities. Pre-T2-25 capabilities
 * were scattered across DeviceProfile booleans + implicit GRBL
 * assumptions. Audit 3A section 5 + Priority 2.
 *
 * Run: npx tsx tests/controller-capabilities-enforced.test.ts
 */
import {
  grblCapabilities,
  checkOperationCapability,
  applyProfileOverrides,
  type ControllerCapabilities,
  type OperationCapability,
} from '../src/controllers/ControllerCapabilities';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-25 ControllerCapabilities ===\n');

void (async () => {

// 1. GRBL: output capabilities pinned
{
  const c = grblCapabilities.output;
  assert(c.formats.includes('gcode-text'), `output.formats includes 'gcode-text'`);
  assert(c.jobExecution === 'line-stream', `jobExecution='line-stream'`);
  assert(c.supportsGcode === true && c.supportsBinary === false,
    `supportsGcode=true, supportsBinary=false`);
  assert(c.maxLineLength === 80, `GRBL maxLineLength=80`);
}

// 2. GRBL: laser capabilities pinned
{
  const c = grblCapabilities.laser;
  assert(c.powerUnit === 'spindle-s', `powerUnit='spindle-s'`);
  assert(c.maxPowerValue === 1000, `default $30=1000`);
  assert(c.supportsDynamicPower && c.supportsConstantPower,
    `M3 + M4 both supported`);
  assert(c.supportsInlinePower === false,
    `inline power NOT supported on GRBL`);
  assert(c.laserOffOperation === 'gcode-m5', `laser off via M5`);
}

// 3. GRBL: motion capabilities pinned
{
  const c = grblCapabilities.motion;
  assert(c.axes.includes('x') && c.axes.includes('y'),
    `axes include x and y`);
  assert(c.coordinateSystem === 'cartesian', `cartesian`);
  assert(c.supportsAbsolute && c.supportsRelative,
    `both absolute and relative supported`);
  assert(c.originModes.includes('absolute')
      && c.originModes.includes('current')
      && c.originModes.includes('savedOrigin'),
    `originModes covers absolute/current/savedOrigin`);
}

// 4. GRBL: operations capabilities pinned
{
  const c = grblCapabilities.operations;
  for (const k of [
    'canHome', 'canUnlock', 'canJog', 'canSetWorkOrigin',
    'canFrame', 'canTestFire', 'canPause', 'canResume',
    'canSoftStop', 'canEmergencyStop',
  ] as OperationCapability[]) {
    assert(c[k] === true, `GRBL: ${k}=true`);
  }
  assert(c.canAutofocus === false,
    `GRBL: canAutofocus=false (hardware-specific override required)`);
}

// 5. GRBL: transport capabilities pinned
{
  const c = grblCapabilities.transport;
  assert(c.supportedKinds.includes('usb-serial'), `supports usb-serial`);
  assert(c.ackModel === 'ok-line', `ack model: ok-line`);
}

// 6. checkOperationCapability: positive case
{
  const r = checkOperationCapability(grblCapabilities, 'canHome');
  assert(r.ok === true, `canHome supported → ok=true`);
}

// 7. checkOperationCapability: negative case with reason
{
  const r = checkOperationCapability(grblCapabilities, 'canAutofocus');
  assert(r.ok === false, `canAutofocus=false on GRBL → ok=false`);
  assert(r.reason != null && /autofocus/i.test(r.reason),
    `reason mentions 'autofocus' (got '${r.reason}')`);
}

// 8. checkOperationCapability: every operation has a human-readable reason
{
  const ops: OperationCapability[] = [
    'canHome', 'canUnlock', 'canJog', 'canSetWorkOrigin',
    'canFrame', 'canTestFire', 'canAutofocus', 'canPause',
    'canResume', 'canSoftStop', 'canEmergencyStop',
  ];
  const reasons = new Set<string>();
  for (const op of ops) {
    // Construct a capabilities where everything is false to elicit a reason
    const allFalse: ControllerCapabilities = JSON.parse(JSON.stringify(grblCapabilities));
    allFalse.operations[op] = false;
    const r = checkOperationCapability(allFalse, op);
    assert(r.ok === false, `${op}=false → ok=false`);
    assert(r.reason != null && r.reason.length > 0, `${op} reason non-empty`);
    if (r.reason) reasons.add(r.reason);
  }
  assert(reasons.size === ops.length, `every operation has a distinct reason (${reasons.size} unique)`);
}

// 9. applyProfileOverrides: homingEnabled=false flips canHome
{
  const next = applyProfileOverrides(grblCapabilities, { homingEnabled: false });
  assert(next.operations.canHome === false,
    `profile homingEnabled=false → caps.canHome=false`);
}

// 10. applyProfileOverrides: autofocusSupported=true flips canAutofocus
{
  const next = applyProfileOverrides(grblCapabilities, { autofocusSupported: true });
  assert(next.operations.canAutofocus === true,
    `profile autofocusSupported=true → caps.canAutofocus=true`);
}

// 11. applyProfileOverrides: bed dimensions
{
  const next = applyProfileOverrides(grblCapabilities, {
    bedWidthMm: 600, bedHeightMm: 400,
  });
  assert(next.motion.bedWidthMm === 600 && next.motion.bedHeightMm === 400,
    `bed dimensions overridden`);
}

// 12. applyProfileOverrides: maxPowerValue ($30 override)
{
  const next = applyProfileOverrides(grblCapabilities, { maxPowerValue: 255 });
  assert(next.laser.maxPowerValue === 255,
    `$30 override → maxPowerValue=255`);
}

// 13. applyProfileOverrides: invalid values silently ignored
{
  const next = applyProfileOverrides(grblCapabilities, {
    bedWidthMm: -1,
    maxPowerValue: NaN,
    bedHeightMm: 0,
  });
  assert(next.motion.bedWidthMm === grblCapabilities.motion.bedWidthMm,
    `bedWidthMm: negative ignored`);
  assert(next.laser.maxPowerValue === grblCapabilities.laser.maxPowerValue,
    `maxPowerValue: NaN ignored`);
  assert(next.motion.bedHeightMm === grblCapabilities.motion.bedHeightMm,
    `bedHeightMm: 0 ignored`);
}

// 14. applyProfileOverrides: no overrides → deep copy returned
{
  const next = applyProfileOverrides(grblCapabilities, {});
  assert(next !== grblCapabilities, `returns NEW object`);
  assert(next.operations.canHome === grblCapabilities.operations.canHome,
    `value-equal when no overrides`);
  // Mutation of next does NOT affect grblCapabilities
  next.operations.canHome = false;
  assert(grblCapabilities.operations.canHome === true,
    `original NOT mutated`);
}

// 15. Hypothetical Marlin (no $X / no $H) typechecks
{
  const marlin: ControllerCapabilities = {
    ...grblCapabilities,
    operations: {
      ...grblCapabilities.operations,
      canUnlock: false,
      canHome: false,
    },
  };
  assert(checkOperationCapability(marlin, 'canUnlock').ok === false,
    `Marlin without $X: unlock refused`);
  assert(checkOperationCapability(marlin, 'canHome').ok === false,
    `Marlin without $H: home refused`);
}

// 16. Hypothetical Ruida (file-upload, native binary, no jog UI)
{
  const ruida: ControllerCapabilities = {
    ...grblCapabilities,
    output: {
      ...grblCapabilities.output,
      formats: ['native-binary'],
      jobExecution: 'file-upload',
      supportsGcode: false,
      supportsBinary: true,
    },
    operations: {
      ...grblCapabilities.operations,
      canJog: false, canHome: false, canUnlock: false,
    },
    transport: {
      supportedKinds: ['wifi'],
      ackModel: 'device-progress',
    },
  };
  assert(ruida.output.jobExecution === 'file-upload',
    `Ruida: file-upload model`);
  assert(checkOperationCapability(ruida, 'canJog').ok === false,
    `Ruida: jog UI hidden`);
}

// 17. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/controllers/ControllerCapabilities.ts'), 'utf-8');
  assert(/T2-25/.test(src), 'T2-25 marker in ControllerCapabilities.ts');
  for (const id of [
    'ControllerCapabilities', 'OutputFormat', 'JobExecutionModel',
    'PowerUnit', 'LaserOffOperation', 'MotionAxis', 'CoordinateSystem',
    'TransportKind', 'AckModel', 'OperationCapability',
    'grblCapabilities', 'checkOperationCapability', 'applyProfileOverrides',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
