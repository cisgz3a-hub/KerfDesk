/**
 * T0-2: built-in gcode template safety, homing preflight, profile migration.
 * Run: npx tsx tests/gcode-templates-safety.test.ts
 */
import {
  backfillGcodeTemplateNames,
  createBlankProfile,
  getDeviceProfiles,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import {
  BUILT_IN_FOOTER_TEMPLATES,
  BUILT_IN_HEADER_TEMPLATES,
  renderTemplate,
  emptyTemplateContext,
  LEGACY_FOOTER_BODY__PARK_AT_MAX_BED,
  LEGACY_FOOTER_BODY__WITH_BEEP,
} from '../src/core/plan/GcodeTemplates';
import { runPreflight, type PreflightContext, PREFLIGHT_CODES } from '../src/core/preflight/Preflight';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const memoryStore: Record<string, string> = {};

function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      const keys = Object.keys(memoryStore);
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function makeSceneForPreflight(): ReturnType<typeof createScene> {
  const s = createScene(300, 200, 'pref');
  s.objects.push(createRect(s.layers[0].id, 10, 10, 20, 20, 'r'));
  return s;
}

// ─── Case 1: park near corner + degenerate bed ───
{
  const tpl = BUILT_IN_FOOTER_TEMPLATES['Park near far corner'];
  assert(
    !Object.prototype.hasOwnProperty.call(BUILT_IN_FOOTER_TEMPLATES, 'Park at max bed'),
    "1. no built-in 'Park at max bed'",
  );
  assert(tpl != null, '1. Park near far corner exists');
  const o1 = renderTemplate(tpl, {
    ...emptyTemplateContext(),
    bedWidthMm: 400,
    bedHeightMm: 300,
    totalLines: 1,
  });
  assert(o1.includes('X395.000') && o1.includes('Y295.000'), '1. 5mm inset on 400×300');
  const o2 = renderTemplate(tpl, {
    ...emptyTemplateContext(),
    bedWidthMm: 3,
    bedHeightMm: 3,
    totalLines: 1,
  });
  assert(
    o2.includes('X0.000') && o2.includes('Y0.000'),
    '1. degenerate 3×3 clamps to 0,0',
  );
}

// ─── Case 2: beep → completion marker ───
{
  assert(
    !Object.prototype.hasOwnProperty.call(BUILT_IN_FOOTER_TEMPLATES, 'With beep on completion'),
    "2. 'With beep on completion' removed",
  );
  const tpl = BUILT_IN_FOOTER_TEMPLATES['With completion marker'];
  const out = renderTemplate(tpl, { ...emptyTemplateContext(), returnX: 0, returnY: 0, totalLines: 1 });
  assert(!out.toUpperCase().includes('M300'), '2. no M300');
  assert(out.includes('; ===== JOB COMPLETE ====='), '2. completion comment present');
}

// ─── Case 3–5: preflight $H + $22 ───
{
  const scene = makeSceneForPreflight();
  const baseProfile = createBlankProfile('p') as DeviceProfile;
  const headerH = BUILT_IN_HEADER_TEMPLATES['GRBL with homing'];

  const c3: PreflightContext = {
    scene,
    profile: { ...baseProfile, gcodeHeaderTemplate: headerH },
    optimizeOrderEnabled: true,
    gcodeHeaderPreview: headerH,
    liveMachineInfo: { bedWidthMm: 400, bedHeightMm: 300, homingEnabled: false },
  };
  const f3 = runPreflight(c3);
  assert(
    f3.some(
      r =>
        r.code === PREFLIGHT_CODES.HOMING_REQUESTED_BUT_DISABLED && r.severity === 'error',
    ),
    '3. fires when $H in template and live homing false',
  );

  const c4: PreflightContext = {
    ...c3,
    liveMachineInfo: { ...c3.liveMachineInfo!, homingEnabled: true },
  };
  const f4 = runPreflight(c4);
  assert(
    !f4.some(r => r.code === PREFLIGHT_CODES.HOMING_REQUESTED_BUT_DISABLED),
    '4. does not fire when homing enabled in firmware',
  );

  const c5a: PreflightContext = {
    ...c3,
    liveMachineInfo: { bedWidthMm: 400, bedHeightMm: 300 },
  };
  assert(
    !runPreflight(c5a).some(r => r.code === PREFLIGHT_CODES.HOMING_REQUESTED_BUT_DISABLED),
    "5. no homing field — don't error",
  );

  const c5b: PreflightContext = { ...c3, liveMachineInfo: undefined };
  assert(
    !runPreflight(c5b).some(r => r.code === PREFLIGHT_CODES.HOMING_REQUESTED_BUT_DISABLED),
    '5b. no liveMachineInfo — do not error',
  );
}

// ─── Case 6: profile migration (loader + backfill) ───
{
  const p0: DeviceProfile = { ...createBlankProfile('m'), gcodeFooterTemplate: LEGACY_FOOTER_BODY__PARK_AT_MAX_BED };
  const p1 = backfillGcodeTemplateNames(p0);
  assert(
    p1.gcodeFooterTemplate === BUILT_IN_FOOTER_TEMPLATES['Park near far corner'],
    "6. legacy 'park at max bed' body → Park near far corner",
  );
  const p2: DeviceProfile = { ...createBlankProfile('b'), gcodeFooterTemplate: LEGACY_FOOTER_BODY__WITH_BEEP };
  const p3 = backfillGcodeTemplateNames(p2);
  assert(
    p3.gcodeFooterTemplate === BUILT_IN_FOOTER_TEMPLATES['With completion marker'],
    '6b. legacy beep body → With completion marker',
  );

  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  memoryStore.laserforge_device_profiles = JSON.stringify([
    { ...createBlankProfile('x'), id: 'x', gcodeFooterTemplate: LEGACY_FOOTER_BODY__PARK_AT_MAX_BED },
  ]);
  const [loaded] = getDeviceProfiles();
  assert(loaded != null, '6c. profile loaded');
  assert(
    loaded.gcodeFooterTemplate === BUILT_IN_FOOTER_TEMPLATES['Park near far corner'],
    '6c. getDeviceProfiles rewrites park footer',
  );
}

console.log(`\n=== gcode-templates-safety: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
